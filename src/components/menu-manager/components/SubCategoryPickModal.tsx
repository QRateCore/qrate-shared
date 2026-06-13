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

  const capCls = 'mb-2 text-xs font-semibold uppercase tracking-wide';

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center p-4"
      style={{ background: 'rgba(0,0,0,0.5)' }}
      data-testid="subcategory-pick-modal"
      onClick={onCancel}
    >
      <div
        className="w-full max-w-xl rounded-xl shadow-2xl"
        style={{ background: 'var(--bg, #fff)', color: 'var(--text)' }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-start justify-between px-6 py-4 border-b" style={{ borderColor: 'var(--border)' }}>
          <div>
            <div className="text-base font-bold">File under a sub-category</div>
            <div className="mt-1 text-sm" style={{ color: 'var(--text2)' }}>
              {selectionLabel} → {category}
            </div>
          </div>
          <button
            type="button"
            onClick={onCancel}
            aria-label="Cancel"
            data-testid="subcategory-pick-cancel"
            className="-mr-1 ml-3 rounded-full p-1.5 hover:bg-[var(--bg2,#f3f4f6)]"
          >
            <X size={20} />
          </button>
        </div>

        {/* Body — three visually-distinct, lightly-tinted sections. */}
        <div className="px-6 py-5 flex flex-col gap-4">
          {/* Section 1 (amber tint) — existing sub-categories as compact,
              wrapping chips. The matching one is the highlighted recommendation. */}
          {(matched || others.length > 0) && (
            <div className="rounded-lg p-4" style={{ background: '#FFF7ED' }}>
              <div className={capCls} style={{ color: '#9A6A1E' }}>
                Add to an existing sub-category
              </div>
              <div className="flex flex-wrap gap-2">
                {matched && (
                  <button
                    type="button"
                    onClick={() => onConfirm(matched.label)}
                    data-testid="subcategory-pick-matched"
                    title={`Recommended: file under "${matched.label}"`}
                    className="inline-flex items-center gap-1.5 rounded-full px-3.5 py-2 text-sm font-bold shadow-sm"
                    style={{ color: '#fff', background: 'var(--brand-s, #c2710a)' }}
                  >
                    <Plus size={15} />
                    <span className="truncate max-w-[15rem]">{matched.label}</span>
                    <span
                      className="rounded-full px-1.5 text-xs font-semibold"
                      style={{ background: 'rgba(255,255,255,0.28)' }}
                    >
                      {matched.item_count}
                    </span>
                  </button>
                )}
                {others.map((l) => (
                  <button
                    key={l.label}
                    type="button"
                    onClick={() => onConfirm(l.label)}
                    data-testid={`subcategory-pick-option-${l.label}`}
                    className="inline-flex items-center gap-1.5 rounded-full border px-3.5 py-2 text-sm font-medium hover:shadow-sm"
                    style={{ borderColor: '#E7C9A3', background: '#FFFFFF', color: 'var(--text)' }}
                  >
                    <span className="truncate max-w-[15rem]">{l.label}</span>
                    <span
                      className="rounded-full px-1.5 text-xs font-semibold"
                      style={{ background: '#F3EAD9', color: '#9A6A1E' }}
                    >
                      {l.item_count}
                    </span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Section 2 (green tint) — create a new sub-category. */}
          <div className="rounded-lg p-4" style={{ background: '#F0FDF4' }}>
            <div className={capCls} style={{ color: '#15803D' }}>
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
              className="w-full rounded-lg border px-4 py-3 text-sm"
              style={{ borderColor: '#BBF7D0', background: '#FFFFFF' }}
            />
            {canCreate && (
              <button
                type="button"
                onClick={() => onConfirm(trimmed)}
                data-testid="subcategory-pick-create"
                className="mt-2 inline-flex items-center gap-2 rounded-lg px-4 py-2.5 text-sm font-bold"
                style={{ color: '#fff', background: '#16A34A' }}
              >
                <Plus size={16} />
                <span className="truncate max-w-[18rem]">Create &ldquo;{trimmed}&rdquo;</span>
              </button>
            )}
            {trimmed.length > 0 && exactExists && (
              <div className="mt-2 text-xs italic" style={{ color: '#15803D' }}>
                &ldquo;{trimmed}&rdquo; already exists above.
              </div>
            )}
          </div>

          {/* Section 3 (slate tint) — no sub-category escape hatch. */}
          <div className="rounded-lg p-4" style={{ background: '#F1F5F9' }}>
            <button
              type="button"
              onClick={() => onConfirm(UNGROUPED_KEY)}
              data-testid="subcategory-pick-ungrouped"
              className="w-full rounded-lg px-1 text-left text-sm font-medium hover:underline"
              style={{ color: '#475569' }}
            >
              No sub-category — add directly to {category}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export default SubCategoryPickModal;
