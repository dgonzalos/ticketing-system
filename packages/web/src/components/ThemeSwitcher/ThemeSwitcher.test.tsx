import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';
import { ThemeSwitcher } from './ThemeSwitcher';

afterEach(() => {
  delete document.documentElement.dataset.theme;
  localStorage.clear();
});

describe('ThemeSwitcher', () => {
  it('renders three buttons inside a group named Theme', () => {
    render(<ThemeSwitcher />);

    const group = screen.getByRole('group', { name: 'Theme' });
    expect(group).toBeInTheDocument();
    expect(screen.getAllByRole('button')).toHaveLength(3);
  });

  it('marks the current theme as pressed', () => {
    document.documentElement.dataset.theme = '2';
    render(<ThemeSwitcher />);

    expect(screen.getByRole('button', { name: 'Theme 2' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'Theme 1' })).toHaveAttribute('aria-pressed', 'false');
  });

  it('sets data-theme and moves aria-pressed when clicking Theme 3', async () => {
    render(<ThemeSwitcher />);

    await userEvent.click(screen.getByRole('button', { name: 'Theme 3' }));

    expect(document.documentElement.dataset.theme).toBe('3');
    expect(screen.getByRole('button', { name: 'Theme 3' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'Theme 1' })).toHaveAttribute('aria-pressed', 'false');
  });
});
