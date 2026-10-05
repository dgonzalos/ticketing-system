/** The SVG coordinate space every poster motif is drawn in (`viewBox="0 0 320 200"`). */
export const POSTER_VIEWBOX = { width: 320, height: 200 } as const;

export type PosterTone = 1 | 2 | 3;

export type PosterShape =
  | { kind: 'circle'; cx: number; cy: number; r: number }
  | { kind: 'rings'; cx: number; cy: number; r: number; gap: number }
  | { kind: 'arc'; cx: number; cy: number; r: number; startAngle: number; sweep: 90 | 180 }
  | { kind: 'dots'; x: number; y: number; count: number; spacing: number; r: number };

export interface PosterArt {
  tone: PosterTone;
  shapes: PosterShape[];
}

/** FNV-1a, 32-bit: a tiny, stable string hash — the same id always yields the same seed. */
export function hashString(value: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < value.length; i++) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

/** mulberry32: a small seeded PRNG returning floats in [0, 1). Deterministic per seed, which `Math.random` isn't. */
export function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Generates an event's poster motif from its id: a colour tone plus 3–5
 * outline shapes. Pure and deterministic — the same event always gets the
 * same poster (on reload, in the hero and in its card), with no stored
 * artwork and no API change.
 *
 * Shapes sit in the right and upper part of the viewBox, keeping the
 * bottom-left clear for the poster's text. A shape may run off the right
 * or top edge (the poster clips it, like the original single circle did),
 * but its centre always stays inside.
 */
export function posterArt(eventId: string): PosterArt {
  const seed = hashString(eventId);
  const random = mulberry32(seed);
  const between = (min: number, max: number) => Math.round(min + random() * (max - min));

  const tone = ((seed % 3) + 1) as PosterTone;
  // Always one large anchor circle — the motif the posters had before, now placed per event.
  const shapes: PosterShape[] = [{ kind: 'circle', cx: between(200, 290), cy: between(50, 120), r: between(55, 85) }];

  const extra = between(2, 4);
  for (let i = 0; i < extra; i++) {
    const pick = random();
    if (pick < 0.3) {
      shapes.push({ kind: 'rings', cx: between(170, 300), cy: between(20, 90), r: between(14, 30), gap: between(6, 10) });
    } else if (pick < 0.65) {
      shapes.push({
        kind: 'arc',
        cx: between(150, 300),
        cy: between(30, 150),
        r: between(25, 60),
        startAngle: between(0, 3) * 90,
        sweep: random() < 0.5 ? 90 : 180,
      });
    } else {
      shapes.push({ kind: 'dots', x: between(150, 230), y: between(15, 60), count: between(3, 6), spacing: 12, r: 2 });
    }
  }

  return { tone, shapes };
}

/** SVG path data for an arc of `sweep` degrees starting at `startAngle` (0° = 3 o'clock, clockwise). */
export function arcPath({ cx, cy, r, startAngle, sweep }: Extract<PosterShape, { kind: 'arc' }>): string {
  const point = (angle: number) => {
    const radians = (angle * Math.PI) / 180;
    return `${(cx + r * Math.cos(radians)).toFixed(1)} ${(cy + r * Math.sin(radians)).toFixed(1)}`;
  };
  return `M ${point(startAngle)} A ${r} ${r} 0 0 1 ${point(startAngle + sweep)}`;
}
