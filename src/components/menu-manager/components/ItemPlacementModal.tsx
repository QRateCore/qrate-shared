'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { Plus, X } from 'lucide-react';
import type { RawCategorySummary } from '../../../types/restaurant';
import { UNGROUPED_KEY, normalizeSubcatKey } from '../lib/menuUtils';

/**
 * ItemPlacementModal — the single, unified confirm modal for placing a menu
 * item via drag-and-drop in the Menu Builder. It replaces the two divergent
 * popups that used to appear depending on the drop target:
 *
 *   - the old `SubCategoryPickModal` (drop onto a course / canonical bucket),
 *     and
 *   - the old `CategorySelectionModal` (drop an off-menu item into a green
 *     Recommendations / "Includes" zone).
 *
 * Both drop paths now render THIS component, so the owner sees one consistent
 * shell, copy, and button layout no matter where they drop. The modal has two
 * sections:
 *
 *   1. **Category (course)** — single-select pills. Shown (and required) only
 *      when `categories` is supplied and no `lockedCategory` is set — i.e. the
 *      item isn't on the menu yet and the course is unknown (rec/includes
 *      drop). When the item was dropped onto a specific course bucket the
 *      caller passes `lockedCategory`; the picker collapses to a read-only
 *      "→ course" summary and the sub-category section becomes primary.
 *
 *   2. **Sub-category (optional)** — pick an existing sub-category, create a
 *      new one, or skip ("No sub-category"). Existing labels come from
 *      `labels`; `defaultLabel` seeds the recommended choice / create field.
 *
 * `onConfirm` receives `{ category, subLabel }` where `category` is the chosen
 * (or locked) canonical category and `subLabel` is a raw sub-category label or
 * `UNGROUPED_KEY` for "no sub-category".
 *
 * Back-compat: the `testid` prop sets the root test id (the owner rec flow and
 * its E2E specs still expect `category-selection-modal`), and the
 * category/sub-category controls keep their historical `data-testid`s
 * (`category-pill-*`, `category-modal-confirm`, `subcategory-pick-*`).
 */

type SubSelection =
  | { type: 'none' }
  | { type: 'existing'; label: string }
  | { type: 'new'; value: string };

export interface ItemPlacementModalProps {
  open: boolean;
  /** Display name for the dragged selection — e.g. "Garlic Naan" or "3 items". */
  selectionLabel: string;
  itemCount: number;
  /**
   * Canonical categories (courses) to choose from. Supply for off-menu drops
   * where the course is unknown; omit when `lockedCategory` is set.
   */
  categories?: readonly string[];
  /** When set, the course is already known and the picker is read-only. */
  lockedCategory?: string | null;
  /** Friendly label for the locked course (e.g. "Drinks" for "Beverages"). */
  lockedCategoryLabel?: string;
  /** Existing sub-categories under the (locked or chosen) course. */
  labels?: RawCategorySummary[];
  /** Selection's raw category — drives the recommended match + create default. */
  defaultLabel?: string;
  pending?: boolean;
  error?: string | null;
  /** Optional menu picker (Food Library "Bring into Menu"). */
  menus?: readonly { id: string; name: string }[];
  selectedMenuId?: string;
  onMenuChange?: (menuId: string) => void;
  /** Root data-testid — defaults to `item-placement-modal`. */
  testid?: string;
  onConfirm: (result: { category: string; subLabel: string }) => void;
  onCancel: () => void;
}

export function ItemPlacementModal({
  open,
  selectionLabel,
  itemCount,
  categories,
  lockedCategory = null,
  lockedCategoryLabel,
  labels = [],
  defaultLabel = '',
  pending = false,
  error = null,
  menus,
  selectedMenuId,
  onMenuChange,
  testid = 'item-placement-modal',
  onConfirm,
  onCancel,
}: ItemPlacementModalProps) {
  const showCategoryPicker = !lockedCategory && (categories?.length ?? 0) > 0;

  // ── Category (course) selection ───────────────────────────────────────────
  const [pickedCategory, setPickedCategory] = useState<string | null>(null);
  const category = lockedCategory ?? pickedCategory;

  // ── Sub-category selection ────────────────────────────────────────────────
  const defaultKey = normalizeSubcatKey(defaultLabel);
  // The existing sub-category that matches the selection's raw category.
  const matched = useMemo(
    () =>
      defaultKey ? labels.find((l) => normalizeSubcatKey(l.label) === defaultKey) ?? null : null,
    [defaultKey, labels],
  );
  const others = useMemo(() => labels.filter((l) => l !== matched), [labels, matched]);

  const [sub, setSub] = useState<SubSelection>({ type: 'none' });

  // Re-seed everything whenever the modal (re)opens. Recommend the matching
  // existing sub-category; otherwise pre-fill the create field with the
  // selection's raw category (when it isn't already an existing label).
  useEffect(() => {
    if (!open) return;
    setPickedCategory(null);
    const dl = defaultLabel.trim();
    const exists = labels.some((l) => normalizeSubcatKey(l.label) === normalizeSubcatKey(dl));
    if (matched) {
      setSub({ type: 'existing', label: matched.label });
    } else if (dl && !exists) {
      setSub({ type: 'new', value: dl });
    } else {
      setSub({ type: 'none' });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Esc closes (mirrors the old dialog behaviour).
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancel();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onCancel]);

  const newValue = sub.type === 'new' ? sub.value.trim() : '';
  const newExactExists =
    sub.type === 'new' &&
    !!newValue &&
    labels.some((l) => normalizeSubcatKey(l.label) === normalizeSubcatKey(newValue));
  // A typed-but-duplicate name is the only thing that blocks confirm in the
  // sub-category section; an empty create field just means "skip".
  const subResolves = !(sub.type === 'new' && newValue.length > 0 && (newValue.length > 60 || newExactExists));
  const resolvedSubLabel: string =
    sub.type === 'existing'
      ? sub.label
      : sub.type === 'new' && newValue.length > 0 && !newExactExists && newValue.length <= 60
        ? newValue
        : UNGROUPED_KEY;

  const canConfirm = !!category && subResolves && !pending;

  if (!open) return null;

  const dest =
    lockedCategoryLabel ?? lockedCategory ?? (category ? category : 'the menu');
  const capCls = 'mb-2 text-xs font-semibold uppercase tracking-wide';
  const ungroupedSelected = sub.type === 'none';

  function confirm() {
    if (!category || !canConfirm) return;
    onConfirm({ category, subLabel: resolvedSubLabel });
  }

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center p-4"
      style={{ background: 'rgba(0,0,0,0.5)' }}
      data-testid={testid}
      onClick={onCancel}
      role="dialog"
      aria-modal="true"
      aria-labelledby="item-placement-title"
    >
      <div
        className="w-full max-w-xl rounded-xl shadow-2xl"
        style={{ background: 'var(--bg, #fff)', color: 'var(--text)' }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div
          className="flex items-start justify-between px-6 py-4 border-b"
          style={{ borderColor: 'var(--border)' }}
        >
          <div>
            <div id="item-placement-title" className="text-base font-bold">
              Add {selectionLabel} to {lockedCategory ? dest : 'the menu'}
            </div>
            <div className="mt-1 text-sm" style={{ color: 'var(--text2)' }}>
              {showCategoryPicker
                ? 'Choose a category, then optionally a sub-category.'
                : `Choose a sub-category under ${dest}, or add it directly.`}
            </div>
          </div>
          <button
            type="button"
            onClick={onCancel}
            disabled={pending}
            aria-label="Cancel"
            data-testid="category-modal-cancel"
            className="-mr-1 ml-3 rounded-full p-1.5 hover:bg-[var(--bg2,#f3f4f6)] disabled:opacity-50"
          >
            <X size={20} />
          </button>
        </div>

        <div className="px-6 py-5 flex flex-col gap-4">
          {/* Optional menu picker (Food Library "Bring into Menu"). */}
          {menus && menus.length > 0 && (
            <div>
              <label
                htmlFor="item-placement-menu-picker"
                className={capCls}
                style={{ color: 'var(--text2)' }}
              >
                Add to menu
              </label>
              <select
                id="item-placement-menu-picker"
                data-testid="category-modal-menu-picker"
                value={selectedMenuId ?? ''}
                onChange={(e) => onMenuChange?.(e.target.value)}
                disabled={pending}
                className="block w-full min-h-11 rounded-lg border px-3 py-2 text-sm"
                style={{ borderColor: 'var(--border)', background: 'var(--bg)' }}
              >
                {menus.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name}
                  </option>
                ))}
              </select>
            </div>
          )}

          {/* Section 1 — Category (course). Single-select; required when shown. */}
          {showCategoryPicker ? (
            <div className="rounded-lg p-4" style={{ background: '#FFF7ED' }}>
              <div className={capCls} style={{ color: '#9A6A1E' }}>
                Category (course)
              </div>
              <div className="flex flex-wrap gap-2" role="group" aria-label="Category">
                {categories!.map((cat) => {
                  const isSel = pickedCategory === cat;
                  return (
                    <button
                      key={cat}
                      type="button"
                      role="radio"
                      aria-checked={isSel}
                      data-testid={`category-pill-${cat}`}
                      disabled={pending}
                      onClick={() => setPickedCategory(cat)}
                      className="rounded-full border px-3.5 py-2 text-sm font-medium transition-colors"
                      style={
                        isSel
                          ? { borderColor: 'var(--brand, #FF6B2B)', background: 'var(--brand, #FF6B2B)', color: '#fff' }
                          : { borderColor: '#E7C9A3', background: '#fff', color: 'var(--text)' }
                      }
                    >
                      {cat}
                    </button>
                  );
                })}
              </div>
            </div>
          ) : (
            lockedCategory && (
              <div
                className="rounded-lg px-4 py-2.5 text-sm font-medium"
                style={{ background: '#FFF7ED', color: '#9A6A1E' }}
                data-testid="item-placement-locked-category"
              >
                Category: {dest}
              </div>
            )
          )}

          {/* Section 2 — Sub-category (optional). */}
          <div
            className="rounded-lg p-4"
            style={{ background: showCategoryPicker && !category ? '#F8FAFC' : '#F0FDF4', opacity: showCategoryPicker && !category ? 0.6 : 1 }}
          >
            <div className={capCls} style={{ color: '#15803D' }}>
              Sub-category <span style={{ textTransform: 'none', fontWeight: 500 }}>(optional)</span>
            </div>

            {/* Existing sub-categories under this course. */}
            {(matched || others.length > 0) && (
              <div className="mb-3 flex flex-wrap gap-2">
                {matched && (
                  <button
                    type="button"
                    onClick={() => setSub({ type: 'existing', label: matched.label })}
                    data-testid="subcategory-pick-matched"
                    title={`Recommended: file under "${matched.label}"`}
                    className="inline-flex items-center gap-1.5 rounded-full px-3.5 py-2 text-sm font-bold shadow-sm"
                    style={
                      sub.type === 'existing' && sub.label === matched.label
                        ? { color: '#fff', background: 'var(--brand-s, #c2710a)' }
                        : { color: 'var(--brand-s, #c2710a)', background: '#fff', border: '1px solid #E7C9A3' }
                    }
                  >
                    <Plus size={15} />
                    <span className="truncate max-w-[15rem]">{matched.label}</span>
                    <span
                      className="rounded-full px-1.5 text-xs font-semibold"
                      style={{ background: 'rgba(0,0,0,0.08)' }}
                    >
                      {matched.item_count}
                    </span>
                  </button>
                )}
                {others.map((l) => {
                  const isSel = sub.type === 'existing' && sub.label === l.label;
                  return (
                    <button
                      key={l.label}
                      type="button"
                      onClick={() => setSub({ type: 'existing', label: l.label })}
                      data-testid={`subcategory-pick-option-${l.label}`}
                      className="inline-flex items-center gap-1.5 rounded-full border px-3.5 py-2 text-sm font-medium"
                      style={
                        isSel
                          ? { borderColor: '#16A34A', background: '#16A34A', color: '#fff' }
                          : { borderColor: '#BBF7D0', background: '#fff', color: 'var(--text)' }
                      }
                    >
                      <span className="truncate max-w-[15rem]">{l.label}</span>
                      <span
                        className="rounded-full px-1.5 text-xs font-semibold"
                        style={{ background: isSel ? 'rgba(255,255,255,0.28)' : '#F3EAD9', color: isSel ? '#fff' : '#9A6A1E' }}
                      >
                        {l.item_count}
                      </span>
                    </button>
                  );
                })}
              </div>
            )}

            {/* Create a new sub-category. */}
            <input
              type="text"
              value={sub.type === 'new' ? sub.value : ''}
              onFocusCapture={() => {
                if (sub.type !== 'new') setSub({ type: 'new', value: '' });
              }}
              onChange={(e) => setSub({ type: 'new', value: e.target.value })}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && canConfirm) confirm();
              }}
              maxLength={60}
              placeholder="+ Create a new sub-category…"
              data-testid="subcategory-pick-input"
              className="w-full rounded-lg border px-4 py-3 text-sm"
              style={{ borderColor: '#BBF7D0', background: '#fff' }}
            />
            {sub.type === 'new' && newValue.length > 0 && newExactExists && (
              <div className="mt-2 text-xs italic" style={{ color: '#15803D' }}>
                &ldquo;{newValue}&rdquo; already exists above.
              </div>
            )}

            {/* No sub-category — add directly to the course. */}
            <button
              type="button"
              onClick={() => setSub({ type: 'none' })}
              data-testid="subcategory-pick-ungrouped"
              className="mt-3 w-full rounded-lg px-3 py-2 text-left text-sm font-medium"
              style={
                ungroupedSelected
                  ? { background: '#E2E8F0', color: '#334155' }
                  : { background: '#F1F5F9', color: '#475569' }
              }
            >
              {ungroupedSelected ? '✓ ' : ''}No sub-category — add directly to {dest}
            </button>
          </div>

          {error && (
            <p data-testid="category-modal-error" className="text-sm" style={{ color: 'var(--danger, #dc2626)' }} role="alert">
              {error}
            </p>
          )}

          {/* Footer — one consistent confirm row for every drop path. */}
          <div className="flex items-center justify-end gap-3">
            <button
              type="button"
              onClick={onCancel}
              disabled={pending}
              className="min-h-11 rounded-lg px-4 py-2 text-sm font-medium"
              style={{ color: 'var(--text2)' }}
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={confirm}
              disabled={!canConfirm}
              data-testid="category-modal-confirm"
              className="min-h-11 inline-flex items-center gap-2 rounded-lg px-5 py-2.5 text-sm font-bold"
              style={
                canConfirm
                  ? { color: '#fff', background: 'var(--brand, #FF6B2B)' }
                  : { color: '#fff', background: '#CBD5E1', cursor: 'not-allowed' }
              }
            >
              <Plus size={16} />
              {pending ? 'Adding…' : 'Add to menu'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export default ItemPlacementModal;
