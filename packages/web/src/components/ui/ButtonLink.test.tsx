import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import { ButtonLink } from './ButtonLink';

describe('ButtonLink', () => {
  it('renders a link to the given route', () => {
    render(
      <MemoryRouter>
        <ButtonLink to="/login">Log in</ButtonLink>
      </MemoryRouter>
    );

    expect(screen.getByRole('link', { name: 'Log in' })).toHaveAttribute('href', '/login');
  });

  it('applies the variant and size classes shared with Button', () => {
    render(
      <MemoryRouter>
        <ButtonLink to="/login" variant="secondary" size="sm">
          Log in
        </ButtonLink>
      </MemoryRouter>
    );

    const link = screen.getByRole('link', { name: 'Log in' });
    expect(link.className).toMatch(/secondary/);
    expect(link.className).toMatch(/sm/);
  });
});
