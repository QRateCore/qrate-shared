'use client';
/**
 * AddGroupingButton — `[+ Add grouping]` affordance + inline name+rule form.
 *
 * Click flow:
 *   1. Owner clicks the `+ Add grouping` button (collapsed state)
 *   2. Inline form expands: name input + rule preset selector + Save/Cancel
 *   3. Owner submits → caller persists via the API; on success, the form
 *      collapses back to the button.
 *
 * Step 7's one-shot intro popover (BYOIntroPopover) is rendered here as a
 * sibling — fires the first time the owner clicks the button, dismissed
 * forever via per-owner localStorage flag.
 */
import { useEffect, useState } from 'react';
import { Plus } from 'lucide-react';
import type { SelectionRule } from '../../../types/restaurant';
import { presetToRule, type RulePresetKind } from './SelectionRuleEditor';

const POPOVER_DISMISSED_KEY = 'qrate.byo_intro_popover_dismissed';

interface Props {
  /**
   * Save handler — caller persists via owner-groupings-service.createGrouping.
   * Resolves on success (form collapses) or rejects on error (form stays open
   * so the owner can retry; toast is the caller's responsibility).
   */
  onCreate: (body: { name: string; rule: SelectionRule }) => Promise<void>;
  /** Optional test ID prefix for the trigger + form fields. */
  testIdPrefix?: string;
}

export default function AddGroupingButton({
  onCreate,
  testIdPrefix = 'add-grouping',
}: Props) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [preset, setPreset] = useState<RulePresetKind>('optional');
  const [n, setN] = useState<number>(1);
  const [saving, setSaving] = useState(false);
  const [introOpen, setIntroOpen] = useState(false);

  // First-time intro popover. Fires on first click of the button only.
  useEffect(() => {
    if (!open) return;
    const dismissed =
      typeof window !== 'undefined' && localStorage.getItem(POPOVER_DISMISSED_KEY) === 'true';
    if (!dismissed) setIntroOpen(true);
  }, [open]);

  function dismissIntro() {
    setIntroOpen(false);
    if (typeof window !== 'undefined') {
      try {
        localStorage.setItem(POPOVER_DISMISSED_KEY, 'true');
      } catch {
        // ignore storage failures (private mode, full quota, etc.)
      }
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) return;
    setSaving(true);
    try {
      const rule = presetToRule(preset, n, n);
      await onCreate({ name: trimmed, rule });
      setName('');
      setPreset('optional');
      setN(1);
      setOpen(false);
    } catch {
      // Stay open on error — caller surfaces a toast.
    } finally {
      setSaving(false);
    }
  }

  return (
    <div style={{ position: 'relative', display: 'inline-block' }}>
      {!open ? (
        <button
          type="button"
          onClick={() => setOpen(true)}
          data-testid={`${testIdPrefix}-trigger`}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 4,
            padding: '6px 10px',
            border: '1px dashed #94a3b8',
            borderRadius: 6,
            background: '#f8fafc',
            color: '#475569',
            fontSize: 13,
            cursor: 'pointer',
          }}
        >
          <Plus size={14} />
          Add grouping
        </button>
      ) : (
        <form
          onSubmit={handleSubmit}
          data-testid={`${testIdPrefix}-form`}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            padding: 8,
            border: '1px solid #e2e8f0',
            borderRadius: 6,
            background: '#fff',
            boxShadow: '0 2px 6px rgba(0,0,0,0.04)',
            flexWrap: 'wrap',
          }}
        >
          <input
            autoFocus
            type="text"
            placeholder="Grouping name (e.g. Toppings)"
            value={name}
            onChange={(e) => setName(e.target.value)}
            data-testid={`${testIdPrefix}-name-input`}
            style={{
              padding: '4px 8px',
              fontSize: 13,
              border: '1px solid #cbd5e1',
              borderRadius: 4,
              minWidth: 180,
            }}
          />
          <select
            value={preset}
            onChange={(e) => setPreset(e.target.value as RulePresetKind)}
            data-testid={`${testIdPrefix}-preset-select`}
            style={{ fontSize: 12, padding: '4px 6px' }}
          >
            <option value="optional">Optional</option>
            <option value="exactly">Exactly</option>
            <option value="at_least">At least</option>
            <option value="at_most">At most</option>
            <option value="all">All included</option>
          </select>
          {(preset === 'exactly' || preset === 'at_least' || preset === 'at_most') && (
            <input
              type="number"
              min={1}
              max={99}
              value={n}
              onChange={(e) => setN(Math.max(1, parseInt(e.target.value, 10) || 1))}
              data-testid={`${testIdPrefix}-n-input`}
              style={{ width: 50, padding: '4px 6px', fontSize: 12 }}
            />
          )}
          <button
            type="submit"
            disabled={!name.trim() || saving}
            data-testid={`${testIdPrefix}-save`}
            style={{
              padding: '4px 10px',
              border: 'none',
              borderRadius: 4,
              background: '#0f766e',
              color: '#fff',
              fontSize: 12,
              cursor: saving ? 'wait' : 'pointer',
            }}
          >
            {saving ? 'Saving…' : 'Save'}
          </button>
          <button
            type="button"
            onClick={() => {
              setOpen(false);
              setName('');
            }}
            data-testid={`${testIdPrefix}-cancel`}
            style={{
              padding: '4px 8px',
              border: '1px solid #e2e8f0',
              borderRadius: 4,
              background: '#fff',
              color: '#64748b',
              fontSize: 12,
              cursor: 'pointer',
            }}
          >
            Cancel
          </button>
        </form>
      )}

      {introOpen && (
        <div
          data-testid={`${testIdPrefix}-intro-popover`}
          style={{
            position: 'absolute',
            top: '100%',
            left: 0,
            marginTop: 8,
            zIndex: 200,
            background: '#fff',
            border: '1px solid #e2e8f0',
            borderRadius: 8,
            boxShadow: '0 4px 14px rgba(0,0,0,0.1)',
            padding: 12,
            maxWidth: 320,
          }}
        >
          <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 4 }}>
            New: Custom groupings
          </div>
          <div style={{ fontSize: 12, color: '#475569', marginBottom: 10 }}>
            You can now add and rename groups beyond Sides, Add-ons, and Recommendations. Set
            rules like &ldquo;patron picks at most 2&rdquo; to build composable dishes.
          </div>
          <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
            <button
              type="button"
              onClick={dismissIntro}
              data-testid={`${testIdPrefix}-intro-dismiss`}
              style={{
                fontSize: 12,
                padding: '4px 10px',
                background: '#0f766e',
                color: '#fff',
                border: 'none',
                borderRadius: 4,
                cursor: 'pointer',
              }}
            >
              Got it
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
