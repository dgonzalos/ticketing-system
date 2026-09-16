export const THEMES = ['1', '2', '3'] as const;
export type ThemeName = (typeof THEMES)[number];
export const DEFAULT_THEME: ThemeName = '1';
const STORAGE_KEY = 'ticketing-theme';

export function isThemeName(value: unknown): value is ThemeName {
  return typeof value === 'string' && (THEMES as readonly string[]).includes(value);
}

/** Stored theme if valid, else DEFAULT_THEME. Never throws (private mode / blocked storage). */
export function getStoredTheme(): ThemeName {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    return isThemeName(stored) ? stored : DEFAULT_THEME;
  } catch {
    return DEFAULT_THEME;
  }
}

/** Sets data-theme on <html> and persists it. Storage failures are swallowed. */
export function setTheme(theme: ThemeName): void {
  document.documentElement.dataset.theme = theme;
  try {
    localStorage.setItem(STORAGE_KEY, theme);
  } catch {
    // private mode / blocked storage: theme still applied for this page load
  }
}
