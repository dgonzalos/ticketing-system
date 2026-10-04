import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Skeleton } from './Skeleton';

describe('Skeleton', () => {
  it('renders a decorative block at the requested size', () => {
    const { container } = render(<Skeleton width="10rem" height="2rem" />);

    const block = container.firstElementChild as HTMLElement;
    expect(block).toHaveAttribute('aria-hidden', 'true');
    expect(block.style.width).toBe('10rem');
    expect(block.style.height).toBe('2rem');
  });

  it('uses the card radius when asked', () => {
    const { container } = render(<Skeleton radius="card" />);

    expect((container.firstElementChild as HTMLElement).className).toMatch(/card/);
  });
});
