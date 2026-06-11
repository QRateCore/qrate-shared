'use client';

import React, { useEffect, useState } from 'react';
import { Plus, X } from 'lucide-react';
import type { RawCategorySummary } from '../../../types/restaurant';
import { UNGROUPED_KEY, normalizeSubcatKey } from '../lib/menuUtils';

/**
 * General-area drop popup (menu raw sub-categories). When item(s) are dropped
 * onto a course/canonical section, the owner picks how to file them. Three
 * options, in priority order:
 *
 *   (a) If the selection's raw category already EXISTS as a sub-category under
 *       this course → a one-click "Add <selection> to <raw category>".
 *   (b) Choose a different existing sub-category under this course (list — only
 *       shown when such sub-categories exist).
 *   (c) Create a new sub-category (text box, pre-filled with the selection's
 *       raw category, but only when no sub-category with that name exists).
 *
 * Plus a always-present "No sub-category (Ungrouped)" escape hatch.
 *
 * `labels` are the existing sub-categories ALREADY under this course, deduped
 * case/punctuation-insensitively by the caller (MenuManagerClient).
 * onConfirm receives the chosen label, or UNGROUPED_KEY for "no sub-category".
 */
export interface SubCategoryPickModalProps {
  open: boolean;
  category: string;
  itemCount: number;
  /** Human label for the dragged selection — e.g. "Chicken Tikka" or "3 items". */
  selectionLabel: string;
  labels: RawCategorySummary[];
  /** Selection's raw category — drives option (a) match + the (c) text default. */
  defaultLabel?: string;
  onConfirm: (label: string) => void;
  onCancel: () => void;
}

export function SubCategoryPickModal({
  open,
  category,
  itemCount,
  selectionLabel,
  labels,
  defaultLabel = '',
  onConfirm,
  onCancel,
}: SubCategoryPickModalProps) {
  const defaultKey = normalizeSubcatKey(defaultLabel);
  // (a) The existing sub-category that matches the selection's raw category.
  const matched = defaultKey
    ? labels.find((l) => normalizeSubcatKey(l.label) === defaultKey) ?? null
    : null;
  // (b) Every other existing sub-category under this course.
  const others = labels.filter((l) => l !== matched);

  // (c) Create-new field. Seeded with the selection's raw category, but only
  // when it isn't already an existing sub-category (otherwise option (a)
  // covers it and the box starts empty for a genuinely new name).
  const [query, setQuery] = useState('');
  useEffect(() => {
    if (!open) return;
    const dl = defaultLabel.trim();
    const exists = labels.some((l) => normalizeSubcatKey(l.label) === normalizeSubcatKey(dl));
    setQuery(dl && !exists ? dl : '');
  }, [open, defaultLabel, labels]);

  const trimmed = query.trim();
  const exactExists = labels.some((l) => normalizeSubcatKey(l.label) === normalizeSubcatKey(trimmed));
  const canCreate = trimmed.length > 0 && trimmed.length <= 60 && !exactExists;

  if (!open) return null;

  const rowCls =
    'flex items-center justify-between gap-2 rounded px-2 py-1.5 text-left text-sm hover:bg-[var(--bg2,#f3f4f6)]';
  const capCls = 'px-1 pt-2 pb-1 text-[10px] font-semibold uppercase tracking-wide';

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center p-4"
      style={{ background: 'rgba(0,0,0,0.45)' }}
      data-testid="subcategory-pick-modal"
      onClick={onCancel}
    >
      <div
        className="w-full max-w-sm rounded-lg shadow-xl"
        style={{ background: 'var(--bg, #fff)', color: 'var(--text)' }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-4 py-3 border-b" style={{ borderColor: 'var(--border)' }}>
          <div className="text-sm font-semibold">
            File under a sub-category
            <div className="text-[11px] font-normal" style={{ color: 'var(--text2)' }}>
              {selectionLabel} → {category}
            </div>
          </div>
          <button type="button" onClick={onCancel} aria-label="Cancel" data-testid="subcategory-pick-cancel">
            <X size={16} />
          </button>
        </div>

        <div className="p-3 flex flex-col gap-1">
          {/* (a) Add to the matching existing sub-category. */}
          {matched && (
            <button
              type="button"
              onClick={() => onConfirm(matched.label)}
              data-testid="subcategory-pick-matched"
              className="flex items-center gap-2 rounded px-2 py-2 text-left text-sm font-semibold"
              style={{ color: '#fff', background: 'var(--brand-s, #c2710a)' }}
            >
              <Plus size={14} />
              <span>
                Add {selectionLabel} to &ldquo;{matched.label}&rdquo;
              </span>
            </button>
          )}

          {/* (b) Choose a different existing sub-category under this course. */}
          {others.length > 0 && (
            <div>
              <div className={capCls} style={{ color: 'var(--text2)' }}>
                {matched ? 'Or choose a different sub-category' : 'Add to an existing sub-category'}
              </div>
              <div className="max-h-44 overflow-y-auto flex flex-col gap-0.5">
                {others.map((l) => (
                  <button
                    key={l.label}
                    type="button"
                    onClick={() => onConfirm(l.label)}
                    data-testid={`subcategory-pick-option-${l.label}`}
                    className={rowCls}
                  >
                    <span className="truncate">{l.label}</span>
                    <span className="text-[11px]" style={{ color: 'var(--text2)' }}>{l.item_count}</span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* (c) Create a new sub-category. */}
          <div>
            <div className={capCls} style={{ color: 'var(--text2)' }}>
              Create a new sub-category
            </div>
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && canCreate) onConfirm(trimmed);
                if (e.key === 'Escape') onCancel();
              }}
              maxLength={60}
              placeholder="New sub-category name…"
              data-testid="subcategory-pick-input"
              className="w-full rounded border px-2 py-1.5 text-sm"
              style={{ borderColor: 'var(--border)', background: 'var(--bg)' }}
            />
            {canCreate && (
              <button
                type="button"
                onClick={() => onConfirm(trimmed)}
                data-testid="subcategory-pick-create"
                className="mt-1 flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm hover:bg-[var(--bg2,#f3f4f6)]"
              >
                <Plus size={14} />
                <span>Create &ldquo;{trimmed}&rdquo;</span>
              </button>
            )}
            {trimmed.length > 0 && exactExists && (
              <div className="px-1 pt-1 text-[11px] italic" style={{ color: 'var(--text2)' }}>
                &ldquo;{trimmed}&rdquo; already exists above.
              </div>
            )}
          </div>

          {/* Ungrouped escape hatch. */}
          <div className="mt-1 pt-2 border-t" style={{ borderColor: 'var(--border)' }}>
            <button
              type="button"
              onClick={() => onConfirm(UNGROUPED_KEY)}
              data-testid="subcategory-pick-ungrouped"
              className="w-full rounded px-2 py-1.5 text-left text-sm hover:bg-[var(--bg2,#f3f4f6)]"
              style={{ color: 'var(--text2)' }}
            >
              No sub-category (add directly to {category})
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export default SubCategoryPickModal;
