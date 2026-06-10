'use client';

import React, { useState } from 'react';
import { ChevronRight, ChevronDown, Pencil, Trash2, Check, X } from 'lucide-react';
import type { MenuColor } from '../lib/menuUtils';
import { UNGROUPED_KEY } from '../lib/menuUtils';

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
}: SubCategoryGroupProps) {
  const isUngrouped = label === UNGROUPED_KEY;
  const display = isUngrouped ? 'Ungrouped' : label;
  const [collapsed, setCollapsed] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [draftName, setDraftName] = useState(label);
  const [busy, setBusy] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  // Rename/delete are never offered for the Ungrouped sentinel.
  const canManage = !isUngrouped;

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
      style={{ borderColor: isDragOver ? color.tabBorder : 'var(--border)' }}
    >
      {/* Header — always rendered (unconditional E2E sync-point). */}
      <div
        onDragEnter={onDragEnter}
        onDragLeave={onDragLeave}
        onDragOver={onDrop ? (e) => e.preventDefault() : undefined}
        onDrop={onDrop}
        data-testid={`subcategory-drop-${category}-${label}`}
        className="flex items-center gap-1 px-2 py-1 text-[11px] font-medium uppercase tracking-wide transition-colors"
        style={{
          color: 'var(--text2)',
          background: isDragOver ? color.tab : 'transparent',
        }}
      >
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
            {canManage && onRename && (
              <button
                type="button"
                onClick={() => {
                  setDraftName(label);
                  setRenaming(true);
                }}
                aria-label={`Rename ${display}`}
                data-testid={`subcategory-rename-${category}-${label}`}
                className="opacity-60 hover:opacity-100"
              >
                <Pencil size={11} />
              </button>
            )}
            {canManage && onDelete && !confirmingDelete && (
              <button
                type="button"
                onClick={() => setConfirmingDelete(true)}
                aria-label={`Delete ${display}`}
                data-testid={`subcategory-delete-${category}-${label}`}
                className="opacity-60 hover:opacity-100"
              >
                <Trash2 size={11} />
              </button>
            )}
            {canManage && onDelete && confirmingDelete && (
              <span className="flex items-center gap-1 normal-case" data-testid={`subcategory-delete-confirm-${category}-${label}`}>
                <span className="text-[10px]" style={{ color: 'var(--text2)' }}>
                  Delete? {itemCount} item{itemCount === 1 ? '' : 's'} → Ungrouped
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

      {!collapsed && <div>{children}</div>}
    </div>
  );
}

export default SubCategoryGroup;
