import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { PageHeader } from './PageHeader';

describe('PageHeader', () => {
  it('renders the title', () => {
    render(<PageHeader title="What's on" />);

    expect(screen.getByRole('heading', { name: "What's on" })).toBeInTheDocument();
  });

  it('omits the eyebrow and description when absent', () => {
    render(<PageHeader title="What's on" />);

    expect(screen.queryByText(/./, { selector: 'p' })).not.toBeInTheDocument();
  });

  it('renders the eyebrow and description when provided', () => {
    render(<PageHeader eyebrow="On sale now" title="What's on" description="Choose an event." />);

    expect(screen.getByText('On sale now')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: "What's on" })).toBeInTheDocument();
    expect(screen.getByText('Choose an event.')).toBeInTheDocument();
  });
});
