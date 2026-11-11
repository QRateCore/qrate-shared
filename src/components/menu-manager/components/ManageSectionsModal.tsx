'use client';

import { useEffect, useId, useRef } from 'react';
import { createPortal } from 'react-dom';
import { ChevronDown, ChevronUp, X } from 'lucide-react';
import { SubCategoryCreateBox } from './SubCategoryCreateBox';

/**
 * "Manage sections" (Owner Portal redesign, 2026-11-10) — one dialog listing
 * the menu's course sections with their sub-categories: item counts, ▲▼ to
 * reorder, and the same [+] create box the section header carries. It drives
 * the SAME write paths the builder uses (`onReorderSubCategory`,
 * `onCreateSubCategory`); nothing here talks to the API on its own.
 *
 * Chrome mirrors the owner app's Kar `Modal` (45% ink scrim, white panel,
 * radius 16, head / body / foot, Esc + scrim close) — that component lives in
 * the owner app, and this builder is shared, so the shell is drawn here.
 *
 * Control ids are prefixed `menu-manage-sections-` so they never collide with
 * the section-header controls (`subcategory-move-up-*`, `subcategory-create-add-*`)
 * that stay mounted in the builder behind the dialog.
 */

export interface ManageSectionSubcategory {
  label: string;
  /** Distinct items filed under this sub-category in this course. */
  count: number;
}

export interface ManageSection {
  /** Canonical key the builder uses for ids / writes (e.g. "Entrees", "beer"). */
  canonical: string;
  /** Owner-facing label (e.g. "Mains"). */
  label: string;
  itemCount: number;
  /** Sub-categories in display order (Ungrouped excluded). */
  subcategories: ManageSectionSubcategory[];
}

export interface ManageSectionsModalProps {
  open: boolean;
  onClose: () => void;
  menuId: string;
  menuName: string;
  sections: ManageSection[];
  onReorderSubCategory?: (menuId: string, category: string, orderedLabels: string[]) => void | Promise<void>;
  onCreateSubCategory?: (menuId: string, category: string, name: string) => void | Promise<void>;
}

/** Pure: the new order after moving `label` one step. Returns null when the
 *  move is a no-op (already at the edge / unknown label). Exported for tests. */
export function movedOrder(labels: readonly string[], label: string, direction: 'up' | 'down'): string[] | null {
  const from = labels.indexOf(label);
  if (from < 0) return null;
  const to = direction === 'up' ? from - 1 : from + 1;
  if (to < 0 || to >= labels.length) return null;
  const next = [...labels];
  next.splice(from, 1);
  next.splice(to, 0, label);
  return next;
}

export function ManageSectionsModal({
  open,
  onClose,
  menuId,
  menuName,
  sections,
  onReorderSubCategory,
  onCreateSubCategory,
}: ManageSectionsModalProps) {
  const titleId = useId();
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const prevFocus = document.activeElement as HTMLElement | null;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
    };
    document.addEventListener('keydown', onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    requestAnimationFrame(() => {
      const panel = panelRef.current;
      if (panel && !panel.contains(document.activeElement)) panel.focus();
    });
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prevOverflow;
      prevFocus?.focus?.();
    };
  }, [open, onClose]);

  if (!open || typeof document === 'undefined') return null;

  const reorderable = !!onReorderSubCategory;
  const iconBtn = 'inline-flex items-center justify-center w-7 h-7 rounded-ctl border-0 bg-transparent text-ink-soft cursor-pointer hover:bg-surface2 hover:text-ink disabled:opacity-25 disabled:cursor-not-allowed';

  return createPortal(
    <div className="fixed inset-0 z-[1000] flex items-center justify-center p-4 sm:p-8">
      <div
        className="absolute inset-0 bg-[var(--scrim,rgba(17,17,17,.45))]"
        data-testid="menu-manage-sections-scrim"
        aria-hidden="true"
        onClick={onClose}
      />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        data-testid="menu-manage-sections-modal"
        className="relative flex flex-col w-full max-w-[640px] max-h-[min(720px,calc(100vh-32px))] bg-surface rounded-[16px] shadow-float outline-none"
      >
        <div className="flex items-start gap-3 px-6 pt-5 pb-4 border-b border-line">
          <div className="flex-1 min-w-0">
            <div className="text-[11px] font-semibold tracking-[.06em] uppercase text-accent mb-1">Sections</div>
            <h2 id={titleId} className="m-0 text-lg font-bold text-ink leading-tight">Manage sections</h2>
            <div className="mt-1 text-sm text-ink-soft">
              {menuName} · the courses guests see, and the sub-categories inside each. Drag rows in the builder, or use the arrows here.
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            data-testid="menu-manage-sections-close"
            className={iconBtn}
          >
            <X size={16} aria-hidden="true" />
          </button>
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto px-6 py-4 flex flex-col gap-3">
          {sections.map((sec) => {
            const labels = sec.subcategories.map((s) => s.label);
            return (
              <div
                key={sec.canonical}
                data-testid={`menu-manage-section-${sec.canonical}`}
                // shrink-0: a flex child in a bounded, scrolling column would
                // otherwise be squeezed and clip its own create box.
                className="shrink-0 rounded-ctl border border-line overflow-hidden"
              >
                <div className="flex items-center gap-2.5 min-h-[44px] px-3.5 bg-surface2/50">
                  <span className="text-[15px] font-bold text-ink flex-1 min-w-0 truncate">{sec.label}</span>
                  <span className="text-sm text-ink-soft" style={{ fontVariantNumeric: 'tabular-nums' }}>
                    {sec.itemCount} item{sec.itemCount === 1 ? '' : 's'}
                  </span>
                </div>
                <div className="border-t border-line px-2.5 py-2">
                  {sec.subcategories.length === 0 ? (
                    <div className="px-1 py-1.5 text-[13px] text-ink-faint" data-testid={`menu-manage-section-empty-${sec.canonical}`}>
                      No sub-categories yet — items sit directly under {sec.label}.
                    </div>
                  ) : (
                    sec.subcategories.map((sub, idx) => (
                      <div
                        key={sub.label}
                        data-testid={`menu-manage-subcategory-${sec.canonical}-${sub.label}`}
                        className="flex items-center gap-2 min-h-[40px] px-2 rounded-ctl hover:bg-surface2"
                      >
                        <span className="flex-1 min-w-0 truncate text-[13px] font-semibold text-ink" title={sub.label}>{sub.label}</span>
                        <span className="text-[13px] text-ink-soft" style={{ fontVariantNumeric: 'tabular-nums' }}>
                          {sub.count}
                        </span>
                        {reorderable && (
                          <>
                            <button
                              type="button"
                              className={iconBtn}
                              disabled={idx === 0}
                              aria-label={`Move ${sub.label} up`}
                              data-testid={`menu-manage-sections-move-up-${sec.canonical}-${sub.label}`}
                              onClick={() => {
                                const next = movedOrder(labels, sub.label, 'up');
                                if (next) void onReorderSubCategory?.(menuId, sec.canonical, next);
                              }}
                            >
                              <ChevronUp size={14} aria-hidden="true" />
                            </button>
                            <button
                              type="button"
                              className={iconBtn}
                              disabled={idx === sec.subcategories.length - 1}
                              aria-label={`Move ${sub.label} down`}
                              data-testid={`menu-manage-sections-move-down-${sec.canonical}-${sub.label}`}
                              onClick={() => {
                                const next = movedOrder(labels, sub.label, 'down');
                                if (next) void onReorderSubCategory?.(menuId, sec.canonical, next);
                              }}
                            >
                              <ChevronDown size={14} aria-hidden="true" />
                            </button>
                          </>
                        )}
                      </div>
                    ))
                  )}
                  {onCreateSubCategory && (
                    <div className="flex items-center gap-2 px-2 pt-1.5 text-[13px] text-ink-soft">
                      <SubCategoryCreateBox
                        menuId={menuId}
                        category={sec.canonical}
                        onCreate={onCreateSubCategory}
                        testIdPrefix="menu-manage-sections-"
                        size="md"
                      />
                      <span>Add a sub-category to {sec.label}</span>
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        <div className="flex items-center justify-end gap-2 px-6 py-4 border-t border-line">
          <button
            type="button"
            onClick={onClose}
            data-testid="menu-manage-sections-done"
            className="inline-flex items-center h-10 px-4 rounded-ctl bg-ink text-on-ink border border-ink text-sm font-semibold cursor-pointer hover:bg-ink-hover"
          >
            Done
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

export default ManageSectionsModal;
