import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const srcDir = fileURLToPath(new URL('../src', import.meta.url));
const rawColorPattern = /#[0-9a-fA-F]{3,8}\b|\b(?:rgba?|hsla?|oklch|lab|lch)\(/;

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
