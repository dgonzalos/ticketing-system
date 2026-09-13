import Anthropic from '@anthropic-ai/sdk';
import { AiBudgetGuard } from '../../domain/ai/ai-budget-guard.service.js';
import type { ModelPrices } from '../../domain/ai/pricing.js';
import type { IUsageBudgetRepository } from '../../domain/ai/usage-budget.repository.js';

/**
 * Constructs an Anthropic client from `ANTHROPIC_API_KEY`. Exported as a
 * factory (not a bare singleton) so it can be constructor-injected into
 * `AdminAssistantService` and swapped for a fake in tests, matching
 * `createStripeClient`'s shape.
 *
 * @throws {Error} if `ANTHROPIC_API_KEY` is not set.
 */
export function createAnthropicClient(): Anthropic {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error('ANTHROPIC_API_KEY environment variable is required');
  }
  return new Anthropic({ apiKey });
}

export interface AnthropicRuntimeConfig {
  model: string;
  prices: ModelPrices;
  dailyBudgetUsd: number;
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} environment variable is required`);
  }
  return value;
}

function requireNumericEnv(name: string): number {
  const raw = requireEnv(name);
  const value = Number(raw);
  if (Number.isNaN(value)) {
    throw new Error(`${name} environment variable must be a number`);
  }
  return value;
}

/** Reads and validates the model/pricing/budget env vars this integration needs. */
export function readAnthropicRuntimeConfig(): AnthropicRuntimeConfig {
  return {
    model: requireEnv('ANTHROPIC_MODEL'),
    prices: {
      inputPricePerMTok: requireNumericEnv('ANTHROPIC_INPUT_PRICE_PER_MTOK'),
      outputPricePerMTok: requireNumericEnv('ANTHROPIC_OUTPUT_PRICE_PER_MTOK'),
    },
    dailyBudgetUsd: requireNumericEnv('ANTHROPIC_DAILY_BUDGET_USD'),
  };
}

/**
 * Builds the `AiBudgetGuard` for this integration from the same env vars as
 * {@link readAnthropicRuntimeConfig}. Takes the repository as a parameter
 * rather than constructing one itself: this file has no natural access to
 * `db` (it mirrors `stripe-config.ts`'s zero-argument shape), so the caller
 * — `index.ts`, in a later phase — is what supplies an already-constructed
 * `DrizzleUsageBudgetRepository`.
 */
export function createAiBudgetGuard(usageRepository: IUsageBudgetRepository): AiBudgetGuard {
  const config = readAnthropicRuntimeConfig();
  return new AiBudgetGuard(usageRepository, config.dailyBudgetUsd, config.prices);
}
