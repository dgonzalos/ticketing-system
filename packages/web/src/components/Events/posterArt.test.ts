import { describe, expect, it } from 'vitest';
import { arcPath, hashString, POSTER_VIEWBOX, posterArt } from './posterArt';
import type { PosterShape } from './posterArt';

const ids = ['event-1', 'event-2', 'event-3', 'event-4', 'event-5', 'a', 'b9c0e1f2-0000-4000-8000-123456789abc'];

/** A shape's anchor point — its centre, or a dot row's first dot. */
function anchor(shape: PosterShape): { x: number; y: number } {
  return shape.kind === 'dots' ? { x: shape.x, y: shape.y } : { x: shape.cx, y: shape.cy };
}

describe('hashString', () => {
  it('is stable and returns an unsigned 32-bit integer', () => {
    expect(hashString('event-1')).toBe(hashString('event-1'));
    expect(hashString('event-1')).not.toBe(hashString('event-2'));
    expect(Number.isInteger(hashString('event-1'))).toBe(true);
    expect(hashString('event-1')).toBeGreaterThanOrEqual(0);
    expect(hashString('event-1')).toBeLessThan(2 ** 32);
  });
});

describe('posterArt', () => {
  it('gives the same event the same poster every time', () => {
    expect(posterArt('event-1')).toEqual(posterArt('event-1'));
  });

  it('gives different events different posters', () => {
    const posters = new Set(ids.map((id) => JSON.stringify(posterArt(id))));
    expect(posters.size).toBe(ids.length);
  });

  it('uses all three tones across the seeded events', () => {
    const tones = new Set(['event-1', 'event-2', 'event-3', 'event-4', 'event-5'].map((id) => posterArt(id).tone));
    expect(tones).toEqual(new Set([1, 2, 3]));
  });

  it.each(ids)('draws 3–5 shapes for %s, each anchored inside the viewBox', (id) => {
    const { tone, shapes } = posterArt(id);

    expect([1, 2, 3]).toContain(tone);
    expect(shapes.length).toBeGreaterThanOrEqual(3);
    expect(shapes.length).toBeLessThanOrEqual(5);
    expect(shapes[0].kind).toBe('circle');
    for (const shape of shapes) {
      const { x, y } = anchor(shape);
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThanOrEqual(POSTER_VIEWBOX.width);
      expect(y).toBeGreaterThanOrEqual(0);
      expect(y).toBeLessThanOrEqual(POSTER_VIEWBOX.height);
    }
  });
});

describe('arcPath', () => {
  it('draws a half circle from 3 o’clock to 9 o’clock', () => {
    expect(arcPath({ kind: 'arc', cx: 100, cy: 100, r: 50, startAngle: 0, sweep: 180 })).toBe(
      'M 150.0 100.0 A 50 50 0 0 1 50.0 100.0'
    );
  });
});
