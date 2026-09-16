import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const srcDir = fileURLToPath(new URL('../src', import.meta.url));
const rawColorPattern = /#[0-9a-fA-F]{3,8}\b|\b(?:rgba?|hsla?|oklch|lab|lch)\(/;

// The only file allowed to hold raw hex: the redesign's three brand color
// themes have no matching Radix step (see semantic.css's theme blocks), so
// they're hand-picked and verified against WCAG separately. Compared via a
// `path.relative` + forward-slash normalization, not a raw `endsWith` on the
// absolute path, because this repo is developed on Windows (backslash paths).
const ALLOWLISTED_RELATIVE_PATH = 'styles/primitives/theme-colors.css';

function isAllowlisted(file) {
  return relative(srcDir, file).split('\\').join('/') === ALLOWLISTED_RELATIVE_PATH;
}

function walk(dir) {
  const files = [];
  for (const entry of readdirSync(dir)) {
    const fullPath = join(dir, entry);
    if (statSync(fullPath).isDirectory()) {
      files.push(...walk(fullPath));
    } else if (entry.endsWith('.css')) {
      files.push(fullPath);
    }
  }
  return files;
}

const violations = [];
for (const file of walk(srcDir)) {
  if (isAllowlisted(file)) {
    continue;
  }
  const lines = readFileSync(file, 'utf8').split('\n');
  lines.forEach((line, index) => {
    if (rawColorPattern.test(line)) {
      violations.push(`${file}:${index + 1}: ${line.trim()}`);
    }
  });
}

if (violations.length > 0) {
  console.error('Raw color literals found — use a token from src/styles/ instead:\n');
  console.error(violations.join('\n'));
  process.exit(1);
}

console.log('No raw color literals found.');
