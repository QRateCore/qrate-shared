'use client';
import { Search } from 'lucide-react';
import type { MenuItemDisplay } from '../../../types/restaurant';

// Per PDD 2026-05-22 amendment 4 — stable-keyed picker extraction so two
// drawers (BulkActionsPanel.BulkGroupingForm and BulkMenuSidesPanel) can
// share the selection UX without duplicating the pinned-on-top + 50-cap
// logic. testidPrefix lets each consumer keep its own E2E selectors:
//   - 'bulk-grouping' (existing — preserves shipped Food Library specs)
//   - 'bulk-menu-sides' (new — Menu Builder bulk Includes)

export const DEFAULT_MAX_PICKER_SELECTIONS = 50;

export interface BulkMemberPickerProps {
  /** Candidate items to render in the unselected pool. */
  pool: MenuItemDisplay[];
  /** Currently-selected ids, in selection order (controls pin order). */
  selectedIds: string[];
  /** Current search filter — applies to UNSELECTED rows only. Selected
   *  rows pin regardless of search. */
  search: string;
  onToggle: (id: string) => void;
  onClearAll: () => void;
  onChangeSearch: (v: string) => void;
  /** Default 50. When selectedIds.length >= max, unselected Select
   *  buttons disable with a tooltip. */
  maxSelections?: number;
  /** Stable testid prefix; e.g. 'bulk-grouping' or 'bulk-menu-sides'. */
  testidPrefix: string;
  /** Ids never to render in the pool (e.g., the selected parents). */
  excludeIds?: string[];
  /** Optional label/copy for the search input placeholder. */
  searchPlaceholder?: string;
  /** Optional suffix for the "N members selected" label (e.g. ' — optional'). */
  selectedCountSuffix?: string;
}

export function BulkMemberPicker({
  pool,
  selectedIds,
  search,
  onToggle,
  onClearAll,
  onChangeSearch,
  maxSelections = DEFAULT_MAX_PICKER_SELECTIONS,
  testidPrefix,
  excludeIds,
  searchPlaceholder = 'Search items to add as members…',
  selectedCountSuffix = '',
}: BulkMemberPickerProps) {
  const q = search.trim().toLowerCase();
  const excludeSet = new Set(excludeIds ?? []);
  const itemById = new Map(pool.map((i) => [i.id, i] as const));
  // selectedRows pin to the top in selection order regardless of search.
  const selectedRows: MenuItemDisplay[] = selectedIds
    .map((id) => itemById.get(id))
    .filter((it): it is MenuItemDisplay => !!it);
  // unselectedRows: not selected, not excluded, matches search (when set).
  const unselectedRows = pool.filter((i) => {
    if (excludeSet.has(i.id)) return false;
    if (selectedIds.includes(i.id)) return false;
    if (q && !i.name.toLowerCase().includes(q)) return false;
    return true;
  });
  const isAtCap = selectedIds.length >= maxSelections;
  const memberWord = selectedIds.length === 1 ? '' : 's';

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <label style={{ fontSize: 11, fontWeight: 600, color: 'var(--muted)' }}>
          <span data-testid={`${testidPrefix}-member-selected-count`}>
            {selectedIds.length} member{memberWord} selected
          </span>
          {selectedCountSuffix}
        </label>
        {selectedIds.length > 0 && (
          <button
            type="button"
            data-testid={`${testidPrefix}-member-clear-all-btn`}
            onClick={onClearAll}
            style={{
              fontSize: 11, padding: '2px 6px',
              background: '#fff', border: '1px solid var(--border)',
              borderRadius: 'var(--r-xs)', cursor: 'pointer',
              color: 'var(--muted)',
            }}
          >
            Clear all
          </button>
        )}
      </div>
      <div style={{ position: 'relative' }}>
        <Search
          size={12}
          style={{ position: 'absolute', left: 8, top: '50%', transform: 'translateY(-50%)', color: 'var(--muted)' }}
        />
        <input
          data-testid={`${testidPrefix}-member-search`}
          type="text"
          value={search}
          onChange={(e) => onChangeSearch(e.target.value)}
          placeholder={searchPlaceholder}
          style={{
            width: '100%',
            padding: '7px 8px 7px 26px',
            border: '1px solid var(--border)',
            borderRadius: 'var(--r-xs)',
            fontSize: 12,
          }}
        />
      </div>
      <div
        style={{
          maxHeight: 240,
          overflowY: 'auto',
          border: '1px solid var(--border)',
          borderRadius: 'var(--r-xs)',
          background: '#fff',
        }}
      >
        {selectedRows.length === 0 && unselectedRows.length === 0 && (
          <div style={{ padding: 10, fontSize: 11, color: 'var(--muted)', textAlign: 'center' }}>
            {q ? 'No matching items' : 'No items available'}
          </div>
        )}
        {selectedRows.map((it) => (
          <PickerRow
            key={it.id}
            item={it}
            selected
            disabled={false}
            onToggle={() => onToggle(it.id)}
            testidPrefix={testidPrefix}
            maxSelections={maxSelections}
          />
        ))}
        {selectedRows.length > 0 && unselectedRows.length > 0 && (
          <div
            style={{ height: 1, background: 'var(--border)', margin: '2px 8px' }}
            aria-hidden="true"
          />
        )}
        {unselectedRows.slice(0, 100).map((it) => (
          <PickerRow
            key={it.id}
            item={it}
            selected={false}
            disabled={isAtCap}
            onToggle={() => onToggle(it.id)}
            testidPrefix={testidPrefix}
            maxSelections={maxSelections}
          />
        ))}
      </div>
    </div>
  );
}

interface PickerRowProps {
  item: MenuItemDisplay;
  selected: boolean;
  disabled: boolean;
  onToggle: () => void;
  testidPrefix: string;
  maxSelections: number;
}

function PickerRow({
  item,
  selected,
  disabled,
  onToggle,
  testidPrefix,
  maxSelections,
}: PickerRowProps) {
  return (
    <div
      data-testid={`${testidPrefix}-member-row-${item.id}`}
      style={{
        display: 'flex', alignItems: 'center', gap: 8,
        padding: '6px 10px',
        borderBottom: '1px solid var(--border)',
        background: selected ? 'var(--brand-l)' : '#fff',
        fontSize: 12,
      }}
    >
      <span
        data-testid={`${testidPrefix}-member-row-state-${item.id}`}
        style={{ display: 'none' }}
      >
        {selected ? 'selected' : 'unselected'}
      </span>
      <span style={{ flex: 1 }}>
        {item.name}
        {item.item_type && item.item_type !== 'dish' && (
          <span style={{ marginLeft: 6, fontSize: 10, color: 'var(--muted)' }}>
            ({item.item_type})
          </span>
        )}
      </span>
      <button
        type="button"
        data-testid={`${testidPrefix}-member-row-toggle-${item.id}`}
        onClick={onToggle}
        disabled={disabled && !selected}
        aria-label={selected ? `Deselect ${item.name}` : `Select ${item.name}`}
        title={disabled && !selected ? `Maximum ${maxSelections} members per grouping` : undefined}
        style={{
          padding: '3px 8px',
          fontSize: 11,
          border: `1px solid ${selected ? 'var(--brand)' : 'var(--border)'}`,
          background: selected ? 'var(--brand)' : '#fff',
          color: selected ? '#fff' : 'var(--ink)',
          borderRadius: 'var(--r-xs)',
          cursor: disabled && !selected ? 'not-allowed' : 'pointer',
          opacity: disabled && !selected ? 0.5 : 1,
        }}
      >
        {selected ? '✓ Selected' : 'Select'}
      </button>
      {disabled && !selected && (
        <span
          data-testid={`${testidPrefix}-member-row-at-cap`}
          style={{ display: 'none' }}
        />
      )}
    </div>
  );
}
