'use client';

import { useState } from 'react';
import { Plus } from 'lucide-react';

export interface SubCategoryCreateBoxProps {
  menuId: string;
  /** Canonical course (Beverages/Appetizers/Entrees/Desserts). */
  category: string;
  /**
   * Create a new (empty) sub-category in this course. The parent persists it
   * (subcatV2 `createMenuSubcategory`) and refreshes the structure so the new
   * empty box appears. Reject to keep the input open for a retry.
   */
  onCreate: (menuId: string, category: string, name: string) => void | Promise<void>;
}

/**
 * Bare "+" affordance at the end of a course's sub-category chip row (the
 * collapse-bucket header). Click → inline text box. Committing (Enter OR
 * blur / clicking away) with a non-empty name creates an EMPTY sub-category;
 * Escape or an empty commit cancels. All pointer/key events stopPropagation so
 * interacting with it never toggles the course's collapse state.
 */
export function SubCategoryCreateBox({
  menuId,
  category,
  onCreate,
}: SubCategoryCreateBoxProps) {
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);

  const stop = (e: { stopPropagation: () => void }) => e.stopPropagation();
  const close = () => {
    setCreating(false);
    setName('');
  };

  const submit = async () => {
    if (busy) return;
    const n = name.trim();
    if (!n) {
      close();
      return;
    }
    setBusy(true);
    try {
      await onCreate(menuId, category, n);
      close();
    } catch {
      // Parent toasts the error — keep the box open so the owner can retry.
    } finally {
      setBusy(false);
    }
  };

  if (!creating) {
    return (
      <button
        type="button"
        data-testid={`subcategory-create-add-${category}`}
        onClick={(e) => {
          stop(e);
          setCreating(true);
        }}
        title="Add a sub-category"
        aria-label="Add a sub-category"
        className="shrink-0 inline-flex h-4 w-4 items-center justify-center rounded border border-dashed border-[var(--border)] text-[var(--text2)] hover:bg-[var(--bg2)]"
      >
        <Plus size={11} aria-hidden />
      </button>
    );
  }

  return (
    <input
      autoFocus
      type="text"
      value={name}
      disabled={busy}
      maxLength={60}
      placeholder="New sub-category…"
      data-testid={`subcategory-create-input-${category}`}
      onClick={stop}
      onMouseDown={stop}
      onChange={(e) => setName(e.target.value)}
      onKeyDown={(e) => {
        stop(e);
        if (e.key === 'Enter') {
          e.preventDefault();
          void submit();
        } else if (e.key === 'Escape') {
          e.preventDefault();
          close();
        }
      }}
      onBlur={() => void submit()}
      className="w-32 shrink-0 rounded border border-[var(--border)] bg-[var(--bg)] px-1 py-px text-[10px] normal-case"
    />
  );
}

export default SubCategoryCreateBox;
