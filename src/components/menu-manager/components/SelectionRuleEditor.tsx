'use client';
/**
 * SelectionRuleEditor — inline popover for editing a grouping's selection rule.
 *
 * Maps the discriminated union (5 named presets) to/from the DB-flat shape
 * (min_select, max_select, default_select). See PDD idea-honing Q4.
 *
 * Presets:
 *   • All           → min=0,        max=NULL,  default_select='all'
 *   • Exactly N     → min=N,        max=N,     default_select='none'
 *   • At least N    → min=N,        max=NULL,  default_select='none'
 *   • At most N     → min=0,        max=N,     default_select='none'
 *   • Optional      → min=0,        max=NULL,  default_select='none'
 *   • Range (advanced)→ min=M,      max=N,     default_select='none'
 *
 * The editor is a small button that opens a popover. Caller passes the current
 * rule and a save callback; the editor handles preset selection + numeric
 * inputs internally.
 */
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { SelectionRule } from '../../../types/restaurant';

export type RulePresetKind = 'all' | 'exactly' | 'at_least' | 'at_most' | 'optional' | 'range';

interface Props {
  /** Current rule from the grouping. */
  rule: SelectionRule;
  /** Save the rule. Caller persists; editor closes on resolve. */
  onSave: (next: SelectionRule) => Promise<void> | void;
  /** Optional test ID prefix for the trigger button. */
  testIdPrefix?: string;
  /** Number of members in the grouping — clamps `max` and shows context. */
  memberCount?: number;
}

function describeRule(rule: SelectionRule): string {
  const { min_select, max_select, default_select } = rule;
  if (default_select === 'all') return 'All included';
  if (min_select === 0 && max_select === null) return 'Optional';
  if (min_select === 0 && max_select === 1) return 'At most 1';
  if (min_select === 1 && max_select === 1) return 'Exactly 1';
  if (min_select === max_select) return `Exactly ${min_select}`;
  if (min_select > 0 && max_select === null) return `At least ${min_select}`;
  if (min_select === 0 && max_select && max_select > 1) return `At most ${max_select}`;
  if (min_select && max_select && min_select !== max_select) return `${min_select}–${max_select}`;
  return 'Optional';
}

function detectPreset(rule: SelectionRule): RulePresetKind {
  if (rule.default_select === 'all') return 'all';
  if (rule.min_select === 0 && rule.max_select === null) return 'optional';
  if (rule.min_select === rule.max_select && rule.min_select > 0) return 'exactly';
  if (rule.min_select > 0 && rule.max_select === null) return 'at_least';
  if (rule.min_select === 0 && rule.max_select && rule.max_select > 0) return 'at_most';
  if (rule.min_select > 0 && rule.max_select && rule.min_select !== rule.max_select) return 'range';
  return 'optional';
}

function presetToRule(preset: RulePresetKind, n: number, m: number): SelectionRule {
  switch (preset) {
    case 'all':
      return { min_select: 0, max_select: null, default_select: 'all' };
    case 'exactly':
      return { min_select: n, max_select: n, default_select: 'none' };
    case 'at_least':
      return { min_select: n, max_select: null, default_select: 'none' };
    case 'at_most':
      return { min_select: 0, max_select: n, default_select: 'none' };
    case 'optional':
      return { min_select: 0, max_select: null, default_select: 'none' };
    case 'range':
      return { min_select: n, max_select: m, default_select: 'none' };
  }
}

export default function SelectionRuleEditor({
  rule,
  onSave,
  testIdPrefix = 'rule-pill',
  memberCount,
}: Props) {
  const [open, setOpen] = useState(false);
  const [preset, setPreset] = useState<RulePresetKind>(() => detectPreset(rule));
  const [n, setN] = useState<number>(() => {
    if (rule.max_select !== null && rule.max_select > 0) return rule.max_select;
    if (rule.min_select > 0) return rule.min_select;
    return 1;
  });
  const [m, setM] = useState<number>(() => rule.max_select ?? Math.max(rule.min_select + 1, 2));
  const [saving, setSaving] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);

  // Popover renders via a portal at document.body so an overflow-hidden
  // ancestor (e.g. the grouping card in GroupingsSection) can't clip it.
  // We compute the popover's fixed top/left from the trigger's bounding
  // rect each time it opens AND on window resize/scroll so the popover
  // tracks the trigger if the page re-flows.
  const [coords, setCoords] = useState<{ top: number; left: number } | null>(null);

  const updateCoords = useCallback(() => {
    const rect = triggerRef.current?.getBoundingClientRect();
    if (!rect) return;
    // Default placement: just under the trigger, left-aligned to it.
    // Overflow handling:
    //  - Right edge: shift left so the popover stays in viewport.
    //  - Bottom edge: flip ABOVE the trigger so the save/cancel buttons
    //    remain reachable. Without this, the rule popover opened from a
    //    grouping row near the drawer bottom rendered partially off-
    //    viewport — Playwright then timed out on the Save click (E2E
    //    `groupings-authoring.spec.ts:170` regression 2026-05-26).
    const POPOVER_WIDTH = 260; // min-width 240 + side padding
    // Measure the rendered popover height if we've already mounted once;
    // otherwise estimate. Estimate is generous so the first paint doesn't
    // overflow either.
    const measuredHeight = popoverRef.current?.getBoundingClientRect().height;
    const POPOVER_HEIGHT_ESTIMATE = measuredHeight && measuredHeight > 0
      ? measuredHeight
      : 280; // 6 presets + n-input + footer + padding
    const MARGIN = 8;
    let left = rect.left;
    if (left + POPOVER_WIDTH + MARGIN > window.innerWidth) {
      left = Math.max(MARGIN, window.innerWidth - POPOVER_WIDTH - MARGIN);
    }
    // Prefer below-trigger; flip above if it would overflow the viewport.
    let top = rect.bottom + 4;
    if (top + POPOVER_HEIGHT_ESTIMATE + MARGIN > window.innerHeight) {
      const flippedTop = rect.top - POPOVER_HEIGHT_ESTIMATE - 4;
      // Only flip if the flipped position fits OR fits better than the
      // overflow-below position. If neither fits (popover taller than the
      // viewport), pin to MARGIN from the top — Playwright can still scroll.
      top = flippedTop >= MARGIN ? flippedTop : MARGIN;
    }
    setCoords({ top, left });
  }, []);

  useLayoutEffect(() => {
    if (!open) return;
    updateCoords();
    const handler = () => updateCoords();
    window.addEventListener('resize', handler);
    // capture=true so we still pick up scrolls inside any scrollable ancestor.
    window.addEventListener('scroll', handler, true);
    return () => {
      window.removeEventListener('resize', handler);
      window.removeEventListener('scroll', handler, true);
    };
  }, [open, updateCoords]);

  // After the popover first mounts (coords transitions null → set), the
  // popoverRef now points at a real node — re-measure so the flip-above
  // decision uses the ACTUAL height instead of the 280px estimate. Also
  // re-measure after preset selection changes the layout (e.g., adding
  // the inline numeric input under `exactly`/`at_least`/`at_most`/`range`).
  useLayoutEffect(() => {
    if (open && coords) updateCoords();
    // We deliberately depend on `preset` so the popover re-positions when
    // its content grows / shrinks.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [preset, open]);

  useEffect(() => {
    if (!open) return;
    function handleClickOutside(e: MouseEvent) {
      const target = e.target as Node;
      const inTrigger = containerRef.current?.contains(target);
      const inPopover = popoverRef.current?.contains(target);
      if (!inTrigger && !inPopover) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [open]);

  async function handleSave() {
    setSaving(true);
    try {
      const next = presetToRule(preset, n, m);
      await onSave(next);
      setOpen(false);
    } finally {
      setSaving(false);
    }
  }

  const isRequired = rule.min_select >= 1;

  return (
    <div ref={containerRef} style={{ position: 'relative', display: 'inline-block' }}>
      <button
        type="button"
        ref={triggerRef}
        onClick={() => setOpen((o) => !o)}
        data-testid={`${testIdPrefix}-trigger`}
        style={{
          fontSize: 12,
          padding: '2px 8px',
          border: '1px solid #cbd5e1',
          borderRadius: 12,
          background: isRequired ? '#fef3c7' : '#fff',
          color: isRequired ? '#92400e' : '#475569',
          cursor: 'pointer',
        }}
        title="Change selection rule"
      >
        {describeRule(rule)} {isRequired ? '· Required' : ''} ▾
      </button>

      {open && coords && typeof document !== 'undefined' && createPortal(
        <div
          ref={popoverRef}
          data-testid={`${testIdPrefix}-popover`}
          style={{
            position: 'fixed',
            top: coords.top,
            left: coords.left,
            zIndex: 1000,
            background: '#fff',
            border: '1px solid #e2e8f0',
            borderRadius: 8,
            boxShadow: '0 4px 12px rgba(0,0,0,0.08)',
            padding: 12,
            minWidth: 240,
          }}
        >
          <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 8 }}>Selection rule</div>

          {/* Presets */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginBottom: 8 }}>
            {([
              { value: 'all', label: 'All included' },
              { value: 'exactly', label: 'Exactly' },
              { value: 'at_least', label: 'At least' },
              { value: 'at_most', label: 'At most' },
              { value: 'optional', label: 'Optional' },
              { value: 'range', label: 'Range (advanced)' },
            ] as const).map(({ value, label }) => (
              <label
                key={value}
                data-testid={`${testIdPrefix}-preset-${value}`}
                style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, cursor: 'pointer' }}
              >
                <input
                  type="radio"
                  name={`${testIdPrefix}-preset`}
                  checked={preset === value}
                  onChange={() => setPreset(value)}
                />
                <span>{label}</span>
                {/* Inline numeric input for quantity-bearing presets */}
                {value === preset && (value === 'exactly' || value === 'at_least' || value === 'at_most') ? (
                  <input
                    type="number"
                    min={1}
                    max={memberCount && memberCount > 0 ? memberCount : 99}
                    value={n}
                    onChange={(e) => setN(Math.max(1, parseInt(e.target.value, 10) || 1))}
                    data-testid={`${testIdPrefix}-n`}
                    style={{ width: 50, padding: '2px 4px', fontSize: 12 }}
                  />
                ) : null}
                {value === preset && value === 'range' ? (
                  <span style={{ display: 'inline-flex', gap: 4, alignItems: 'center' }}>
                    <input
                      type="number"
                      min={0}
                      max={memberCount && memberCount > 0 ? memberCount : 99}
                      value={n}
                      onChange={(e) => setN(Math.max(0, parseInt(e.target.value, 10) || 0))}
                      data-testid={`${testIdPrefix}-min`}
                      style={{ width: 44, padding: '2px 4px', fontSize: 12 }}
                    />
                    <span>to</span>
                    <input
                      type="number"
                      min={Math.max(n, 1)}
                      max={memberCount && memberCount > 0 ? memberCount : 99}
                      value={m}
                      onChange={(e) => setM(Math.max(n, parseInt(e.target.value, 10) || n))}
                      data-testid={`${testIdPrefix}-max`}
                      style={{ width: 44, padding: '2px 4px', fontSize: 12 }}
                    />
                  </span>
                ) : null}
              </label>
            ))}
          </div>

          {memberCount !== undefined && memberCount > 0 ? (
            <div style={{ fontSize: 11, color: '#64748b', marginBottom: 8 }}>
              {memberCount} member{memberCount === 1 ? '' : 's'} in this grouping
            </div>
          ) : null}

          <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
            <button
              type="button"
              onClick={() => setOpen(false)}
              data-testid={`${testIdPrefix}-cancel`}
              style={{
                fontSize: 12,
                padding: '4px 8px',
                border: '1px solid #e2e8f0',
                borderRadius: 6,
                background: '#fff',
                cursor: 'pointer',
              }}
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleSave}
              disabled={saving}
              data-testid={`${testIdPrefix}-save`}
              style={{
                fontSize: 12,
                padding: '4px 10px',
                border: 'none',
                borderRadius: 6,
                background: '#0f766e',
                color: '#fff',
                cursor: saving ? 'wait' : 'pointer',
              }}
            >
              {saving ? 'Saving…' : 'Save'}
            </button>
          </div>
        </div>,
        document.body,
      )}
    </div>
  );
}

// Re-export helpers for tests + consumers.
export { describeRule, detectPreset, presetToRule };
