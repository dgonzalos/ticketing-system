import { useState } from 'react';
import clsx from 'clsx';
import { DEFAULT_THEME, isThemeName, setTheme, type ThemeName } from '../../styles/theme';
import styles from './ThemeSwitcher.module.css';

interface ThemeOption {
  id: ThemeName;
  label: string;
  swatchClassName: string;
}

const OPTIONS: ThemeOption[] = [
  { id: '1', label: 'Theme 1', swatchClassName: styles.swatch1 },
  { id: '2', label: 'Theme 2', swatchClassName: styles.swatch2 },
  { id: '3', label: 'Theme 3', swatchClassName: styles.swatch3 },
];

function getInitialTheme(): ThemeName {
  const current = document.documentElement.dataset.theme;
  return isThemeName(current) ? current : DEFAULT_THEME;
}

/** Lets a user switch the app's color theme. Feature-local: there is exactly one consumer (Header), so no context is needed. */
export function ThemeSwitcher() {
  const [theme, setThemeState] = useState<ThemeName>(getInitialTheme);

  const handleSelect = (id: ThemeName) => {
    setTheme(id);
    setThemeState(id);
  };

  return (
    <div className={styles.group} role="group" aria-label="Theme">
      {OPTIONS.map((option) => (
        <button
          key={option.id}
          type="button"
          className={clsx(styles.button, theme === option.id && styles.pressed)}
          aria-pressed={theme === option.id}
          aria-label={option.label}
          title={option.label}
          onClick={() => handleSelect(option.id)}
        >
          <span className={clsx(styles.swatch, option.swatchClassName)} aria-hidden="true" />
        </button>
      ))}
    </div>
  );
}
