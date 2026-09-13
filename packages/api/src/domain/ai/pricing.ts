/** Cache writes cost more than a plain input token (Anthropic prompt caching pricing). */
const CACHE_WRITE_MULTIPLIER = 1.25;
/** Cache reads cost far less than a plain input token. */
const CACHE_READ_MULTIPLIER = 0.1;

/** Token usage as reported on an Anthropic Messages API response. */
export interface AnthropicUsage {
  input_tokens: number;
  cache_creation_input_tokens?: number;
  cache_read_input_tokens?: number;
  output_tokens: number;
}

/** Per-model USD pricing, per million tokens. */
export interface ModelPrices {
  inputPricePerMTok: number;
  outputPricePerMTok: number;
}

/**
 * Estimates the USD cost of a single Anthropic API call from its reported
 * token usage. Cache-creation and cache-read tokens are priced off the
 * same base input rate, scaled by their respective multipliers, per
 * Anthropic's prompt-caching pricing model (verify the two multipliers
 * below against https://platform.claude.com/docs/en/build-with-claude/prompt-caching
 * before relying on them — they are policy, not physics, and could change).
 */
export function estimateCallCostUsd(usage: AnthropicUsage, prices: ModelPrices): number {
  const { inputPricePerMTok, outputPricePerMTok } = prices;

  const inputCost = usage.input_tokens * inputPricePerMTok;
  const cacheWriteCost = (usage.cache_creation_input_tokens ?? 0) * inputPricePerMTok * CACHE_WRITE_MULTIPLIER;
  const cacheReadCost = (usage.cache_read_input_tokens ?? 0) * inputPricePerMTok * CACHE_READ_MULTIPLIER;
  const outputCost = usage.output_tokens * outputPricePerMTok;

  return (inputCost + cacheWriteCost + cacheReadCost) / 1_000_000 + outputCost / 1_000_000;
}
