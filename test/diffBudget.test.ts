import { describe, expect, it } from 'vitest';

import { applyDiffBudget } from '../src/utils/diffBudget';

describe('applyDiffBudget', () => {
  it('should keep diff when under budget', () => {
    const diff = 'diff --git a/a.ts b/a.ts\n+hello';
    const result = applyDiffBudget(diff, 1000);
    expect(result.truncated).toBe(false);
    expect(result.diff).toBe(diff);
    expect(result.usedChars).toBe(diff.length);
  });

  it('should truncate diff when over budget', () => {
    const diff = [
      'diff --git a/a.ts b/a.ts',
      '--- a/a.ts',
      '+++ b/a.ts',
      '+line1',
      '+line2',
      '+line3'
    ].join('\n');
    const result = applyDiffBudget(diff, 40);
    expect(result.truncated).toBe(true);
    expect(result.usedChars).toBeLessThanOrEqual(40);
    expect(result.originalChars).toBe(diff.length);
    expect(result.diff.length).toBeLessThan(diff.length);
  });
});
