'use client';

import React, { useState, useEffect } from 'react';
import { ChevronRight, ChevronDown, ChevronUp, GripVertical, Pencil, Trash2, Check, X } from 'lucide-react';
import type { MenuColor } from '../lib/menuUtils';
import { UNGROUPED_KEY } from '../lib/menuUtils';
import { useIsMobile } from '../../../hooks/useIsMobile';

/**
 * One raw sub-category group nested inside a CategoryBucket (menu raw
 * sub-categories feature, 2026-06-09). Renders a collapsible header (label +
 * count + rename/delete affordances) and the item rows passed as children.
 *
 * The header's outer wrapper always renders regardless of data state, so E2E
 * specs can anchor on `data-testid="subcategory-group-${category}-${label}"`
 * as an unconditional sync-point (QA confidence-vote condition #6).
 *
 * Drop-zone props (onDragEnter/Leave/Drop, isDragOver) and management props
 * (onRename, onDelete) are wired in Steps 7 and 9 respectively; they are
 * optional so Step 6 can render the nesting read-only.
 */
export interface SubCategoryGroupProps {
  /** Raw label, or UNGROUPED_KEY for the unlabeled group. */
  label: string;
  category: string;
  menuId: string;
  itemCount: number;
  color: MenuColor;
  children: React.ReactNode;
  /** Drop target (Step 7) — re-file an item into this sub-category. */
  isDragOver?: boolean;
  onDragEnter?: (e: React.DragEvent) => void;
  onDragLeave?: () => void;
  onDrop?: (e: React.DragEvent) => void;
  /** Bulk management (Step 9) — only offered for real labels, not Ungrouped. */
  onRename?: (from: string, to: string) => void | Promise<void>;
  onDelete?: (label: string) => void | Promise<void>;
  /**
   * Reorder (STR-775, refined in the STR-775 rework) — the WHOLE header row is
   * the drag source (the grip is the visual cue) plus keyboard ▲▼. The row is
   * also the drop target: an insertion line shows above/below it while hovered,
   * and dropping commits the move. Reorder-drag vs item-refile-drag are
   * disambiguated by `isReorderActive` (a sub-category reorder is in flight),
   * so the two drag modes never collide. Only wired for real labels.
   */
  reorderEnabled?: boolean;
  /** This row is the one currently being dragged (dims it). */
  isReorderDragging?: boolean;
  /** A sub-category reorder drag is in flight somewhere in this bucket. */
  isReorderActive?: boolean;
  /** Show the drop insertion line above/below this row while hovered. */
  insertionLine?: 'before' | 'after' | null;
  onReorderDragStart?: () => void;
  onReorderDragEnd?: () => void;
  /** Hover during a reorder drag — caller computes before/after from pointer Y. */
  onReorderDragOver?: (e: React.DragEvent) => void;
  onReorderDrop?: () => void;
  onMoveUp?: () => void;
  onMoveDown?: () => void;
  canMoveUp?: boolean;
  canMoveDown?: boolean;
  /** A deep-link (scrollToItemId) targets an item inside this sub-category —
   *  force it open so the item is visible. Set by MenuBuilder. */
  containsScrollTarget?: boolean;
}

export function SubCategoryGroup({
  label,
  category,
  menuId,
  itemCount,
  color,
  children,
  isDragOver = false,
  onDragEnter,
  onDragLeave,
  onDrop,
  onRename,
  onDelete,
  reorderEnabled = false,
  isReorderDragging = false,
  isReorderActive = false,
  insertionLine = null,
  onReorderDragStart,
  onReorderDragEnd,
  onReorderDragOver,
  onReorderDrop,
  onMoveUp,
  onMoveDown,
  canMoveUp = false,
  canMoveDown = false,
  containsScrollTarget = false,
}: SubCategoryGroupProps) {
  const isUngrouped = label === UNGROUPED_KEY;
  const display = isUngrouped ? 'Ungrouped' : label;
  // Sub-accordions start collapsed when their parent canonical/section bucket
  // is expanded (2026-06-11) — the owner drills in one level at a time.
  const [collapsed, setCollapsed] = useState(!containsScrollTarget);
  // Auto-expand when a deep-link (scrollToItemId) targets an item in THIS
  // sub-category, so "open this item on the menu" lands with its sub-category
  // open (the course is expanded by MenuBuilder in tandem).
  useEffect(() => {
    if (containsScrollTarget) setCollapsed(false);
  }, [containsScrollTarget]);
  const [renaming, setRenaming] = useState(false);
  const [draftName, setDraftName] = useState(label);
  const [busy, setBusy] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const isMobile = useIsMobile();

  // Rename/delete are never offered for the Ungrouped sentinel. On mobile
  // (STR-858) they're deferred to desktop — sub-category authoring isn't an
  // in-shift task and the tiny icons crowd the phone header.
  const canManage = !isUngrouped && !isMobile;
  // ≥44px tap target for the ▲▼ reorder buttons on mobile (the one structural
  // control kept on the phone). Empty on desktop → unchanged.
  const mobileTapClass = isMobile ? 'min-w-11 min-h-11 flex items-center justify-center' : '';

  async function submitRename() {
    const next = draftName.trim();
    if (!next || next === label) {
      setRenaming(false);
      setDraftName(label);
      return;
    }
    setBusy(true);
    try {
      await onRename?.(label, next);
      setRenaming(false);
    } catch {
      // Stay open on error — caller surfaces a toast.
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      data-testid={`subcategory-group-${category}-${label}`}
      data-sub-label={label}
      className="ml-1 border-l-2"
      // Green = "valid drop target", consistent with the course buckets and
      // modifier zones (see DROP_TARGET in MenuBuilder).
      style={{ borderColor: isDragOver ? '#16A34A' : 'var(--border)' }}
    >
      {/* Insertion line above this row while a reorder drag hovers its top half. */}
      {insertionLine === 'before' && (
        <div
          data-testid={`subcategory-insertion-before-${category}-${label}`}
          aria-hidden="true"
          className="ml-1 mr-1 rounded-full"
          style={{ height: 3, background: '#2563EB' }}
        />
      )}
      {/* Header — always rendered (unconditional E2E sync-point). The WHOLE row
          is the reorder drag source (when reorderEnabled && not renaming) and
          the drop target; the grip is the visual affordance. */}
      <div
        // Row-level drag source — grab anywhere on the header to reorder. A
        // separate marker keeps the header's item-refile drop from mistaking a
        // group reorder for an item drag.
        draggable={reorderEnabled && !renaming}
        onDragStart={reorderEnabled && !renaming ? (e) => {
          e.dataTransfer.effectAllowed = 'move';
          try { e.dataTransfer.setData('application/x-qrate-subcat-reorder', label); } catch { /* jsdom noop */ }
          onReorderDragStart?.();
        } : undefined}
        onDragEnd={reorderEnabled ? () => onReorderDragEnd?.() : undefined}
        // Item-refile enter/leave only when NOT reordering (no green highlight
        // during a group reorder).
        onDragEnter={isReorderActive ? undefined : onDragEnter}
        onDragLeave={isReorderActive ? undefined : onDragLeave}
        onDragOver={(e) => {
          if (isReorderActive) { e.preventDefault(); onReorderDragOver?.(e); }
          else if (onDrop) { e.preventDefault(); }
        }}
        onDrop={(e) => {
          if (isReorderActive) { e.preventDefault(); e.stopPropagation(); onReorderDrop?.(); }
          else { onDrop?.(e); }
        }}
        // Row-level click-to-toggle (2026-07-02): the entire header row is a
        // click target for expand/collapse. Interactive children (chevron
        // toggle, rename input, action buttons) bail via the closest() check
        // so their onClick handlers keep working without a double-toggle.
        // Skip in rename mode so clicking outside the input doesn't fire.
        onClick={(e) => {
          if (renaming) return;
          const target = e.target as HTMLElement | null;
          // NOTE: intentionally NOT matching [role="button"] — we set that on
          // the row itself, so closest() would match self and short-circuit
          // every click. Native <button>/<input>/<a> descendants are what
          // we actually want to bail on.
          if (target?.closest('button, input, a')) return;
          setCollapsed((c) => !c);
        }}
        // Keyboard equivalent — Enter or Space on the row toggles too.
        onKeyDown={(e) => {
          if (renaming) return;
          if (e.key === 'Enter' || e.key === ' ') {
            const target = e.target as HTMLElement | null;
            if (target?.closest('button, input, a')) return;
            e.preventDefault();
            setCollapsed((c) => !c);
          }
        }}
        role="button"
        tabIndex={renaming ? -1 : 0}
        aria-expanded={!collapsed}
        aria-label={collapsed ? `Expand ${display}` : `Collapse ${display}`}
        // Full-width row: opt out of the global press-scale (see the course
        // header in MenuBuilder.tsx — same owner feedback 2026-07-21).
        data-no-press
        data-testid={`subcategory-drop-${category}-${label}`}
        // font-semibold + var(--text) (was font-medium + gray --text2):
        // high-contrast black sub-category labels per owner feedback
        // 2026-07-21 — gray read as disabled inside expanded courses.
        className="flex items-center gap-1 px-2 py-2 text-[11px] font-semibold uppercase tracking-wide transition-colors"
        style={{
          color: isDragOver ? '#15803D' : 'var(--text)',
          background: isDragOver ? '#DCFCE7' : 'transparent',
          // grab cursor when reorder is armed; pointer otherwise (row is clickable)
          cursor: reorderEnabled && !renaming ? 'grab' : (renaming ? 'text' : 'pointer'),
          opacity: isReorderDragging ? 0.4 : undefined,
        }}
      >
        {reorderEnabled && (
          <span
            aria-hidden="true"
            data-testid={`subcategory-reorder-grip-${category}-${label}`}
            className="flex items-center justify-center shrink-0"
            style={{ cursor: 'grab', opacity: 0.55, width: 18, height: 18 }}
          >
            <GripVertical size={14} />
          </span>
        )}
        <button
          type="button"
          onClick={() => setCollapsed((c) => !c)}
          aria-label={collapsed ? `Expand ${display}` : `Collapse ${display}`}
          data-testid={`subcategory-toggle-${category}-${label}`}
          className="flex items-center"
        >
          {collapsed ? <ChevronRight size={12} /> : <ChevronDown size={12} />}
        </button>

        {renaming ? (
          <span className="flex items-center gap-1 flex-1">
            <input
              autoFocus
              type="text"
              value={draftName}
              onChange={(e) => setDraftName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void submitRename();
                if (e.key === 'Escape') {
                  setRenaming(false);
                  setDraftName(label);
                }
              }}
              maxLength={60}
              disabled={busy}
              data-testid={`subcategory-rename-input-${category}-${label}`}
              className="flex-1 min-w-0 rounded border px-1 py-0.5 text-[11px] normal-case"
              style={{ borderColor: 'var(--border)', background: 'var(--bg)' }}
            />
            <button
              type="button"
              onClick={() => void submitRename()}
              disabled={busy}
              aria-label="Save name"
              data-testid={`subcategory-rename-save-${category}-${label}`}
            >
              <Check size={12} />
            </button>
            <button
              type="button"
              onClick={() => {
                setRenaming(false);
                setDraftName(label);
              }}
              aria-label="Cancel rename"
            >
              <X size={12} />
            </button>
          </span>
        ) : (
          <>
            <span className="flex-1 truncate normal-case" title={display}>
              {display}
            </span>
            <span
              className="rounded-full px-1.5"
              style={{ background: color.chip, color: color.chipText }}
              data-testid={`subcategory-count-${category}-${label}`}
            >
              {itemCount}
            </span>
            {reorderEnabled && (
              <>
                <button
                  type="button"
                  onClick={onMoveUp}
                  disabled={!canMoveUp}
                  aria-label={`Move ${display} up`}
                  data-testid={`subcategory-move-up-${category}-${label}`}
                  className={`opacity-60 hover:opacity-100 disabled:opacity-20 ${mobileTapClass}`}
                >
                  <ChevronUp size={isMobile ? 18 : 12} />
                </button>
                <button
                  type="button"
                  onClick={onMoveDown}
                  disabled={!canMoveDown}
                  aria-label={`Move ${display} down`}
                  data-testid={`subcategory-move-down-${category}-${label}`}
                  className={`opacity-60 hover:opacity-100 disabled:opacity-20 ${mobileTapClass}`}
                >
                  <ChevronDown size={isMobile ? 18 : 12} />
                </button>
              </>
            )}
            {canManage && onRename && (
              <button
                type="button"
                onClick={() => {
                  setDraftName(label);
                  setRenaming(true);
                }}
                aria-label={`Rename ${display}`}
                data-testid={`subcategory-rename-${category}-${label}`}
                className="opacity-70 hover:opacity-100"
              >
                <Pencil size={15} />
              </button>
            )}
            {canManage && onDelete && !confirmingDelete && (
              <button
                type="button"
                onClick={() => setConfirmingDelete(true)}
                aria-label={`Delete ${display}`}
                data-testid={`subcategory-delete-${category}-${label}`}
                className="text-[var(--red)] opacity-100 hover:opacity-80"
              >
                <Trash2 size={15} />
              </button>
            )}
            {canManage && onDelete && confirmingDelete && (
              <span className="flex items-center gap-1 normal-case" data-testid={`subcategory-delete-confirm-${category}-${label}`}>
                <span className="text-[10px]" style={{ color: 'var(--text2)' }}>
                  {itemCount === 0
                    ? 'Delete this sub-category?'
                    : `Delete + remove ${itemCount} item${itemCount === 1 ? '' : 's'} from this menu?`}
                </span>
                <button
                  type="button"
                  onClick={() => {
                    setConfirmingDelete(false);
                    void onDelete(label);
                  }}
                  aria-label={`Confirm delete ${display}`}
                  data-testid={`subcategory-delete-yes-${category}-${label}`}
                  style={{ color: 'var(--danger, #dc2626)' }}
                >
                  <Check size={12} />
                </button>
                <button
                  type="button"
                  onClick={() => setConfirmingDelete(false)}
                  aria-label="Cancel delete"
                >
                  <X size={12} />
                </button>
              </span>
            )}
          </>
        )}
      </div>

      {/* Insertion line below this row while a reorder drag hovers its bottom half. */}
      {insertionLine === 'after' && (
        <div
          data-testid={`subcategory-insertion-after-${category}-${label}`}
          aria-hidden="true"
          className="ml-1 mr-1 rounded-full"
          style={{ height: 3, background: '#2563EB' }}
        />
      )}

      {!collapsed && <div>{children}</div>}
    </div>
  );
}

export default SubCategoryGroup;
