import { describe, expect, it } from 'vitest';
import { estimateCallCostUsd } from '../../../../src/domain/ai/pricing.js';

const prices = { inputPricePerMTok: 3, outputPricePerMTok: 15 };

describe('estimateCallCostUsd', () => {
  it('prices plain input and output tokens with no cache activity', () => {
    const cost = estimateCallCostUsd({ input_tokens: 1_000_000, output_tokens: 1_000_000 }, prices);
    expect(cost).toBeCloseTo(3 + 15, 10);
  });

  it('prices cache-write tokens at 1.25x the input rate', () => {
    const cost = estimateCallCostUsd(
      { input_tokens: 0, cache_creation_input_tokens: 1_000_000, output_tokens: 0 },
      prices
    );
    expect(cost).toBeCloseTo(3 * 1.25, 10);
  });

  it('prices cache-read tokens at 0.1x the input rate', () => {
    const cost = estimateCallCostUsd({ input_tokens: 0, cache_read_input_tokens: 1_000_000, output_tokens: 0 }, prices);
    expect(cost).toBeCloseTo(3 * 0.1, 10);
  });

  it('sums all four components with no cross-term error', () => {
    const cost = estimateCallCostUsd(
      {
        input_tokens: 1_000_000,
        cache_creation_input_tokens: 1_000_000,
        cache_read_input_tokens: 1_000_000,
        output_tokens: 1_000_000,
      },
      prices
    );
    expect(cost).toBeCloseTo(3 + 3 * 1.25 + 3 * 0.1 + 15, 10);
  });

  it('returns exactly 0 for zero usage', () => {
    const cost = estimateCallCostUsd({ input_tokens: 0, output_tokens: 0 }, prices);
    expect(cost).toBe(0);
  });

  it('treats omitted optional cache fields as 0, never NaN', () => {
    const cost = estimateCallCostUsd({ input_tokens: 100, output_tokens: 50 }, prices);
    expect(cost).not.toBeNaN();
    expect(cost).toBeCloseTo((100 * 3) / 1_000_000 + (50 * 15) / 1_000_000, 10);
  });
});
