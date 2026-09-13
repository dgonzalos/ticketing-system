import { AiBudgetExceededError } from '../common/errors/domain-errors.js';
import { estimateCallCostUsd, type AnthropicUsage, type ModelPrices } from './pricing.js';
import type { IUsageBudgetRepository } from './usage-budget.repository.js';

/**
 * Gate checked before every individual Anthropic API call (not once per
 * conversational turn — a single turn can make several tool-use round
 * trips, and each one must be checked). Framework-free: depends only on
 * {@link IUsageBudgetRepository}, so it is fully unit-testable with a fake.
 */
export class AiBudgetGuard {
  constructor(
    private readonly usageRepository: IUsageBudgetRepository,
    private readonly dailyBudgetUsd: number,
    private readonly prices: ModelPrices
  ) {}

  /** @throws {AiBudgetExceededError} if today's estimated spend is at or above the daily budget. */
  async assertWithinBudget(): Promise<void> {
    const todaySpendUsd = await this.usageRepository.getTodaySpendUsd();
    if (todaySpendUsd >= this.dailyBudgetUsd) {
      throw new AiBudgetExceededError(todaySpendUsd, this.dailyBudgetUsd);
    }
  }

  /**
   * Estimates the cost of one completed Anthropic call from its `usage`
   * field and records it. Always call this after every real API call,
   * success or not — a call that returned an error may still have been
   * billed for input tokens. Prefer {@link run} over calling this directly:
   * it's easy to forget this call on an error path, silently under-counting
   * spend forever afterward.
   */
  async recordCall(usage: AnthropicUsage): Promise<void> {
    const costUsd = estimateCallCostUsd(usage, this.prices);
    await this.usageRepository.recordUsage({
      inputTokens: usage.input_tokens,
      cacheWriteTokens: usage.cache_creation_input_tokens ?? 0,
      cacheReadTokens: usage.cache_read_input_tokens ?? 0,
      outputTokens: usage.output_tokens,
      costUsd,
    });
  }

  /**
   * The sanctioned way to spend against the budget: checks
   * {@link assertWithinBudget}, invokes `makeCall`, then records the usage
   * it returns — a single call site instead of three separate ones a
   * future caller has to remember to chain correctly (and can otherwise
   * skip the guard entirely by calling the Anthropic SDK directly).
   *
   * If `makeCall` itself rejects (e.g. a network failure) before returning
   * anything, there is no `usage` to record and `run` doesn't try — this
   * only ever records a call that actually got a response back from
   * Anthropic, matching {@link recordCall}'s contract.
   *
   * This does **not** close the check-then-act race between two calls
   * landing in the same narrow budget window: both can pass
   * `assertWithinBudget` before either has recorded, so the daily budget
   * remains a soft ceiling that concurrent in-flight calls can overshoot by
   * up to their combined cost, not a hard cap. Closing that fully would
   * mean reserving a pessimistic upper-bound cost before the call and
   * reconciling it against the real usage after — which needs a per-call
   * cost ceiling (e.g. derived from a `max_tokens` request parameter) that
   * doesn't exist until Phase 2 defines the actual call shape. Revisit then
   * if the overshoot in practice turns out to matter.
   */
  async run<T>(makeCall: () => Promise<{ result: T; usage: AnthropicUsage }>): Promise<T> {
    await this.assertWithinBudget();
    const { result, usage } = await makeCall();
    await this.recordCall(usage);
    return result;
  }
}
