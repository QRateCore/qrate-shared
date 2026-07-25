// @vitest-environment jsdom
/**
 * SelectionRuleEditor — popover + preset translation tests (BYO PDD Step 7).
 */
import { describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import SelectionRuleEditor, {
  describeRule,
  detectPreset,
  presetToRule,
} from '../SelectionRuleEditor';

const ANY_RULE = (overrides: Partial<{
  min_select: number;
  max_select: number | null;
  default_select: 'all' | 'none' | 'first';
}> = {}) => ({
  min_select: 0,
  max_select: null as number | null,
  default_select: 'none' as const,
  ...overrides,
});

describe('describeRule', () => {
  it('describes "all"', () => {
    expect(describeRule(ANY_RULE({ default_select: 'all' }))).toBe('All included');
  });
  it('describes optional', () => {
    expect(describeRule(ANY_RULE())).toBe('Optional');
  });
  it('describes optional-1 (STR-985: {0,1} = pick ≤1, not required)', () => {
    expect(describeRule(ANY_RULE({ max_select: 1 }))).toBe('Optional 1');
  });
  it('describes at-most-2 (guard: relabel must NOT bleed into the max>1 branch)', () => {
    expect(describeRule(ANY_RULE({ max_select: 2 }))).toBe('At most 2');
  });
  it('describes exactly-2', () => {
    expect(describeRule(ANY_RULE({ min_select: 2, max_select: 2 }))).toBe('Exactly 2');
  });
  it('describes at-least-3', () => {
    expect(describeRule(ANY_RULE({ min_select: 3 }))).toBe('At least 3');
  });
  it('describes range', () => {
    expect(describeRule(ANY_RULE({ min_select: 1, max_select: 3 }))).toBe('1–3');
  });
});

describe('detectPreset', () => {
  it('detects "all"', () => {
    expect(detectPreset(ANY_RULE({ default_select: 'all' }))).toBe('all');
  });
  it('detects "exactly"', () => {
    expect(detectPreset(ANY_RULE({ min_select: 2, max_select: 2 }))).toBe('exactly');
  });
  it('detects "at_least"', () => {
    expect(detectPreset(ANY_RULE({ min_select: 2 }))).toBe('at_least');
  });
  it('detects "at_most" (max>1)', () => {
    expect(detectPreset(ANY_RULE({ max_select: 3 }))).toBe('at_most');
  });
  it('detects "optional_one" for {0,1} (STR-985 — before the at_most branch)', () => {
    expect(detectPreset(ANY_RULE({ min_select: 0, max_select: 1 }))).toBe('optional_one');
  });
  it('detects "at_most" for {0,2} (guard: optional_one must NOT swallow max>1)', () => {
    expect(detectPreset(ANY_RULE({ min_select: 0, max_select: 2 }))).toBe('at_most');
  });
  it('detects "optional"', () => {
    expect(detectPreset(ANY_RULE())).toBe('optional');
  });
  it('detects "range"', () => {
    expect(detectPreset(ANY_RULE({ min_select: 1, max_select: 3 }))).toBe('range');
  });
});

describe('presetToRule', () => {
  it('all → default_select=all', () => {
    expect(presetToRule('all', 1, 1)).toEqual({
      min_select: 0, max_select: null, default_select: 'all',
    });
  });
  it('exactly N → min=max=N', () => {
    expect(presetToRule('exactly', 3, 3)).toEqual({
      min_select: 3, max_select: 3, default_select: 'none',
    });
  });
  it('at_least N → min=N, max=null', () => {
    expect(presetToRule('at_least', 2, 5)).toEqual({
      min_select: 2, max_select: null, default_select: 'none',
    });
  });
  it('at_most N → min=0, max=N', () => {
    expect(presetToRule('at_most', 4, 4)).toEqual({
      min_select: 0, max_select: 4, default_select: 'none',
    });
  });
  it('optional_one → min=0, max=1 (STR-985; ignores n)', () => {
    expect(presetToRule('optional_one', 7, 7)).toEqual({
      min_select: 0, max_select: 1, default_select: 'none',
    });
  });
  it('range M..N', () => {
    expect(presetToRule('range', 2, 5)).toEqual({
      min_select: 2, max_select: 5, default_select: 'none',
    });
  });
});

describe('SelectionRuleEditor — popover', () => {
  it('shows the current rule as a pill', () => {
    render(
      <SelectionRuleEditor
        rule={ANY_RULE({ min_select: 1, max_select: 1 })}
        onSave={vi.fn()}
      />
    );
    const trigger = screen.getByTestId('rule-pill-trigger');
    expect(trigger.textContent).toContain('Exactly 1');
  });

  it('marks required rules visually', () => {
    render(
      <SelectionRuleEditor
        rule={ANY_RULE({ min_select: 1 })}
        onSave={vi.fn()}
      />
    );
    expect(screen.getByTestId('rule-pill-trigger').textContent).toContain('Required');
  });

  it('opens the popover on trigger click', () => {
    render(
      <SelectionRuleEditor rule={ANY_RULE()} onSave={vi.fn()} />
    );
    expect(screen.queryByTestId('rule-pill-popover')).toBeNull();
    fireEvent.click(screen.getByTestId('rule-pill-trigger'));
    expect(screen.getByTestId('rule-pill-popover')).toBeInTheDocument();
  });

  it('saves the new rule when Save is clicked', async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    render(
      <SelectionRuleEditor rule={ANY_RULE()} onSave={onSave} />
    );
    fireEvent.click(screen.getByTestId('rule-pill-trigger'));
    // Switch to "Exactly N"
    fireEvent.click(screen.getByTestId('rule-pill-preset-exactly').querySelector('input')!);
    // Default n=1
    await act(async () => {
      fireEvent.click(screen.getByTestId('rule-pill-save'));
      await Promise.resolve();
    });
    expect(onSave).toHaveBeenCalledWith({
      min_select: 1, max_select: 1, default_select: 'none',
    });
  });

  it('cancels without saving', () => {
    const onSave = vi.fn();
    render(
      <SelectionRuleEditor rule={ANY_RULE()} onSave={onSave} />
    );
    fireEvent.click(screen.getByTestId('rule-pill-trigger'));
    fireEvent.click(screen.getByTestId('rule-pill-cancel'));
    expect(onSave).not.toHaveBeenCalled();
    expect(screen.queryByTestId('rule-pill-popover')).toBeNull();
  });
});
