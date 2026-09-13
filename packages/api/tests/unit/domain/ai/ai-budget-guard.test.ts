import { describe, expect, it, vi } from 'vitest';
import { AiBudgetExceededError } from '../../../../src/domain/common/errors/domain-errors.js';
import { AiBudgetGuard } from '../../../../src/domain/ai/ai-budget-guard.service.js';
import { estimateCallCostUsd } from '../../../../src/domain/ai/pricing.js';
import type { IUsageBudgetRepository } from '../../../../src/domain/ai/usage-budget.repository.js';

function createMockUsageBudgetRepository(): IUsageBudgetRepository {
  return {
    getTodaySpendUsd: vi.fn(),
    recordUsage: vi.fn(),
  };
}

const prices = { inputPricePerMTok: 3, outputPricePerMTok: 15 };

describe('AiBudgetGuard.assertWithinBudget', () => {
  it('resolves when today spend is well under budget', async () => {
    const usageRepository = createMockUsageBudgetRepository();
    vi.mocked(usageRepository.getTodaySpendUsd).mockResolvedValue(2.0);
    const guard = new AiBudgetGuard(usageRepository, 10.0, prices);

    await expect(guard.assertWithinBudget()).resolves.toBeUndefined();
  });

  it('resolves when today spend is exactly 0 and budget is positive', async () => {
    const usageRepository = createMockUsageBudgetRepository();
    vi.mocked(usageRepository.getTodaySpendUsd).mockResolvedValue(0);
    const guard = new AiBudgetGuard(usageRepository, 10.0, prices);

    await expect(guard.assertWithinBudget()).resolves.toBeUndefined();
  });

  it('throws AiBudgetExceededError when today spend exactly equals the budget', async () => {
    const usageRepository = createMockUsageBudgetRepository();
    vi.mocked(usageRepository.getTodaySpendUsd).mockResolvedValue(10.0);
    const guard = new AiBudgetGuard(usageRepository, 10.0, prices);

    await expect(guard.assertWithinBudget()).rejects.toThrow(AiBudgetExceededError);
  });

  it('throws AiBudgetExceededError with the actual numbers when over budget', async () => {
    const usageRepository = createMockUsageBudgetRepository();
    vi.mocked(usageRepository.getTodaySpendUsd).mockResolvedValue(12.5);
    const guard = new AiBudgetGuard(usageRepository, 10.0, prices);

    await expect(guard.assertWithinBudget()).rejects.toSatisfy((error: unknown) => {
      expect(error).toBeInstanceOf(AiBudgetExceededError);
      const budgetError = error as AiBudgetExceededError;
      expect(budgetError.todaySpendUsd).toBe(12.5);
      expect(budgetError.dailyBudgetUsd).toBe(10.0);
      return true;
    });
  });
});

describe('AiBudgetGuard.recordCall', () => {
  it('computes the cost from usage and records it with mapped fields', async () => {
    const usageRepository = createMockUsageBudgetRepository();
    const guard = new AiBudgetGuard(usageRepository, 10.0, prices);
    const usage = {
      input_tokens: 1000,
      cache_creation_input_tokens: 200,
      cache_read_input_tokens: 300,
      output_tokens: 500,
    };

    await guard.recordCall(usage);

    expect(usageRepository.recordUsage).toHaveBeenCalledTimes(1);
    expect(usageRepository.recordUsage).toHaveBeenCalledWith({
      inputTokens: 1000,
      cacheWriteTokens: 200,
      cacheReadTokens: 300,
      outputTokens: 500,
      costUsd: estimateCallCostUsd(usage, prices),
    });
  });

  it('records omitted optional cache fields as 0, not undefined', async () => {
    const usageRepository = createMockUsageBudgetRepository();
    const guard = new AiBudgetGuard(usageRepository, 10.0, prices);
    const usage = { input_tokens: 100, output_tokens: 50 };

    await guard.recordCall(usage);

    expect(usageRepository.recordUsage).toHaveBeenCalledWith({
      inputTokens: 100,
      cacheWriteTokens: 0,
      cacheReadTokens: 0,
      outputTokens: 50,
      costUsd: estimateCallCostUsd(usage, prices),
    });
  });
});

describe('AiBudgetGuard.run', () => {
  it('checks the budget, invokes makeCall, records its usage, and returns its result', async () => {
    const usageRepository = createMockUsageBudgetRepository();
    vi.mocked(usageRepository.getTodaySpendUsd).mockResolvedValue(0);
    const guard = new AiBudgetGuard(usageRepository, 10.0, prices);
    const usage = { input_tokens: 100, output_tokens: 50 };
    const makeCall = vi.fn().mockResolvedValue({ result: 'the answer', usage });

    const result = await guard.run(makeCall);

    expect(result).toBe('the answer');
    expect(makeCall).toHaveBeenCalledTimes(1);
    expect(usageRepository.recordUsage).toHaveBeenCalledWith({
      inputTokens: 100,
      cacheWriteTokens: 0,
      cacheReadTokens: 0,
      outputTokens: 50,
      costUsd: estimateCallCostUsd(usage, prices),
    });
  });

  it('throws AiBudgetExceededError and never invokes makeCall when already over budget', async () => {
    const usageRepository = createMockUsageBudgetRepository();
    vi.mocked(usageRepository.getTodaySpendUsd).mockResolvedValue(10.0);
    const guard = new AiBudgetGuard(usageRepository, 10.0, prices);
    const makeCall = vi.fn();

    await expect(guard.run(makeCall)).rejects.toThrow(AiBudgetExceededError);

    expect(makeCall).not.toHaveBeenCalled();
    expect(usageRepository.recordUsage).not.toHaveBeenCalled();
  });

  it('propagates a makeCall rejection without recording any usage', async () => {
    const usageRepository = createMockUsageBudgetRepository();
    vi.mocked(usageRepository.getTodaySpendUsd).mockResolvedValue(0);
    const guard = new AiBudgetGuard(usageRepository, 10.0, prices);
    const makeCall = vi.fn().mockRejectedValue(new Error('network failure'));

    await expect(guard.run(makeCall)).rejects.toThrow('network failure');

    expect(usageRepository.recordUsage).not.toHaveBeenCalled();
  });
});
