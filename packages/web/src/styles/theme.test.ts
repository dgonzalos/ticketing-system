import { afterEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_THEME, getStoredTheme, setTheme } from './theme';

const STORAGE_KEY = 'ticketing-theme';

afterEach(() => {
  delete document.documentElement.dataset.theme;
  localStorage.clear();
  vi.restoreAllMocks();
});

describe('setTheme', () => {
  it('sets data-theme on <html> and persists it', () => {
    setTheme('2');

    expect(document.documentElement.dataset.theme).toBe('2');
    expect(localStorage.getItem(STORAGE_KEY)).toBe('2');
  });

  it('does not throw when localStorage.setItem throws', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('storage blocked');
    });

    expect(() => setTheme('3')).not.toThrow();
    expect(document.documentElement.dataset.theme).toBe('3');
  });
});

describe('getStoredTheme', () => {
  it('returns the default when nothing is stored', () => {
    expect(getStoredTheme()).toBe(DEFAULT_THEME);
  });

  it('returns the default for an invalid stored value', () => {
    localStorage.setItem(STORAGE_KEY, 'neon');

    expect(getStoredTheme()).toBe(DEFAULT_THEME);
  });

  it('returns the stored theme when it is valid', () => {
    localStorage.setItem(STORAGE_KEY, '3');

    expect(getStoredTheme()).toBe('3');
  });

  it('returns the default when localStorage.getItem throws', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('storage blocked');
    });

    expect(getStoredTheme()).toBe(DEFAULT_THEME);
  });
});
