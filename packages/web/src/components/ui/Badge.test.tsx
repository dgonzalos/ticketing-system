import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Badge } from './Badge';

describe('Badge', () => {
  it('renders its label with a class per tone', () => {
    const { rerender } = render(<Badge tone="success">Paid</Badge>);
    const successClass = screen.getByText('Paid').className;

    rerender(<Badge tone="neutral">Paid</Badge>);
    const neutralClass = screen.getByText('Paid').className;

    expect(successClass).not.toBe(neutralClass);
  });
});
