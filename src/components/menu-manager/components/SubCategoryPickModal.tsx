'use client';

import React, { useMemo, useState } from 'react';
import { Plus, X } from 'lucide-react';
import type { RawCategorySummary } from '../../../types/restaurant';
import { UNGROUPED_KEY } from '../lib/menuUtils';

/**
 * General-area drop popup (menu raw sub-categories, 7b). Lets the owner file the
 * dragged item(s) under an existing sub-category (typeahead), a newly-created
 * one, or "Ungrouped" (no label). Self-contained — labels are fetched by the
 * caller (MenuManagerClient) via service.listMenuRawCategories and passed in.
 *
 * onConfirm receives the chosen label, or UNGROUPED_KEY for "no sub-category".
 */
export interface SubCategoryPickModalProps {
  open: boolean;
  category: string;
  itemCount: number;
  labels: RawCategorySummary[];
  onConfirm: (label: string) => void;
  onCancel: () => void;
}

export function SubCategoryPickModal({
  open,
  category,
  itemCount,
  labels,
  onConfirm,
  onCancel,
}: SubCategoryPickModalProps) {
  const [query, setQuery] = useState('');

  const trimmed = query.trim();
  const filtered = useMemo(() => {
    const q = trimmed.toLowerCase();
    return labels
      .filter((l) => !q || l.label.toLowerCase().includes(q))
      .slice(0, 50);
  }, [labels, trimmed]);

  const exactExists = labels.some((l) => l.label.toLowerCase() === trimmed.toLowerCase());
  const canCreate = trimmed.length > 0 && trimmed.length <= 60 && !exactExists;

  if (!open) return null;

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
              {itemCount} item{itemCount === 1 ? '' : 's'} → {category}
            </div>
          </div>
          <button type="button" onClick={onCancel} aria-label="Cancel" data-testid="subcategory-pick-cancel">
            <X size={16} />
          </button>
        </div>

        <div className="p-3">
          <input
            autoFocus
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && canCreate) onConfirm(trimmed);
              if (e.key === 'Escape') onCancel();
            }}
            maxLength={60}
            placeholder="Search or create a sub-category…"
            data-testid="subcategory-pick-input"
            className="w-full rounded border px-2 py-1.5 text-sm"
            style={{ borderColor: 'var(--border)', background: 'var(--bg)' }}
          />

          <div className="mt-2 max-h-56 overflow-y-auto flex flex-col gap-0.5">
            {canCreate && (
              <button
                type="button"
                onClick={() => onConfirm(trimmed)}
                data-testid="subcategory-pick-create"
                className="flex items-center gap-2 rounded px-2 py-1.5 text-left text-sm hover:bg-[var(--bg2,#f3f4f6)]"
              >
                <Plus size={14} />
                <span>Create &ldquo;{trimmed}&rdquo;</span>
              </button>
            )}

            {filtered.map((l) => (
              <button
                key={l.label}
                type="button"
                onClick={() => onConfirm(l.label)}
                data-testid={`subcategory-pick-option-${l.label}`}
                className="flex items-center justify-between rounded px-2 py-1.5 text-left text-sm hover:bg-[var(--bg2,#f3f4f6)]"
              >
                <span className="truncate">{l.label}</span>
                <span className="text-[11px]" style={{ color: 'var(--text2)' }}>{l.item_count}</span>
              </button>
            ))}

            {filtered.length === 0 && !canCreate && (
              <div className="px-2 py-1.5 text-xs italic" style={{ color: 'var(--text2)' }}>
                No sub-categories yet — type to create one.
              </div>
            )}
          </div>

          <div className="mt-2 pt-2 border-t" style={{ borderColor: 'var(--border)' }}>
            <button
              type="button"
              onClick={() => onConfirm(UNGROUPED_KEY)}
              data-testid="subcategory-pick-ungrouped"
              className="w-full rounded px-2 py-1.5 text-left text-sm hover:bg-[var(--bg2,#f3f4f6)]"
              style={{ color: 'var(--text2)' }}
            >
              No sub-category (Ungrouped)
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export default SubCategoryPickModal;
