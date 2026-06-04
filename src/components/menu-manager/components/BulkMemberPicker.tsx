'use client';
import { useMemo, useState } from 'react';
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
  /**
   * When provided, renders a "Select all" button that selects every
   * currently-filtered unselected row — respecting the active type tab,
   * the active canonical-category chip, and the search box. The callback
   * receives the ids to ADD, already capped to the remaining capacity
   * (maxSelections - selectedIds.length), so the parent can append them
   * without re-checking the cap. Omit to hide the button (preserves
   * behaviour for consumers that don't want bulk-select).
   */
  onSelectAll?: (idsToAdd: string[]) => void;
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
  /**
   * When true, the picker takes flex: 1 of its parent and the row
   * container fills the remaining height (overflowing internally
   * via scroll). When false (default), the row container is capped
   * at maxHeight: 240 — keeps the bulk-grouping create-form's stacked
   * layout intact. Set this when the picker is the dominant child of
   * a flex-column drawer body (e.g. BulkMenuSidesPanel).
   */
  fillHeight?: boolean;
  /**
   * When true, render Dishes / Add-ons sub-tabs above the search input
   * and scope the pool (selected pins + unselected) to the active tab.
   * Per-tab selected-count badges render on each tab. Default false to
   * preserve current behaviour for sides-only consumers.
   */
  enableTypeTabs?: boolean;
  /**
   * When true, derive a canonical-category chip rail from the active
   * pool (post-tab, pre-search) and let the user filter the unselected
   * list by clicking a chip; clicking the active chip toggles it back
   * to "all". Default false.
   */
  enableCategoryFilter?: boolean;
}

type TypeTab = 'dishes' | 'addons';

/** Canonical category — falls back to 'Uncategorized'. Mirrors the
 *  owner-webapp FoodLibraryView helper so the chip set in the bulk
 *  picker is interpreted identically to the Food Library chip rail. */
function canonicalOf(item: MenuItemDisplay): string {
  if (item.canonical_category && item.canonical_category.trim().length > 0) {
    return item.canonical_category.trim();
  }
  if (item.canonical_categories && item.canonical_categories.length > 0) {
    return item.canonical_categories[0].trim() || 'Uncategorized';
  }
  return 'Uncategorized';
}

function deriveCategoryEntries(
  items: MenuItemDisplay[],
): { id: string; name: string; count: number }[] {
  const map = new Map<string, number>();
  for (const it of items) {
    const c = canonicalOf(it);
    map.set(c, (map.get(c) ?? 0) + 1);
  }
  return [...map.entries()]
    .map(([name, count]) => ({ id: name, name, count }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

export function BulkMemberPicker({
  pool,
  selectedIds,
  search,
  onToggle,
  onClearAll,
  onChangeSearch,
  onSelectAll,
  maxSelections = DEFAULT_MAX_PICKER_SELECTIONS,
  testidPrefix,
  excludeIds,
  searchPlaceholder = 'Search items to add as members…',
  selectedCountSuffix = '',
  fillHeight = false,
  enableTypeTabs = false,
  enableCategoryFilter = false,
}: BulkMemberPickerProps) {
  const [activeTab, setActiveTab] = useState<TypeTab>('dishes');
  const [activeCategory, setActiveCategory] = useState<string>('all');

  // Tab pools — only computed when type-tab gating is enabled.
  const dishesPool = useMemo(
    () => (enableTypeTabs ? pool.filter((it) => (it.item_type ?? 'dish') !== 'addon') : pool),
    [enableTypeTabs, pool],
  );
  const addonsPool = useMemo(
    () => (enableTypeTabs ? pool.filter((it) => it.item_type === 'addon') : []),
    [enableTypeTabs, pool],
  );
  const activePool = enableTypeTabs ? (activeTab === 'dishes' ? dishesPool : addonsPool) : pool;

  // Canonical-category chip entries — derived from the active pool only,
  // so the chip set re-flows when the user switches tabs.
  const categoryEntries = useMemo(
    () => (enableCategoryFilter ? deriveCategoryEntries(activePool) : []),
    [enableCategoryFilter, activePool],
  );

  const q = search.trim().toLowerCase();
  const excludeSet = new Set(excludeIds ?? []);
  const itemById = new Map(pool.map((i) => [i.id, i] as const));

  // selectedRows pin to the top in selection order. When type-tab gating
  // is on, only items matching the active tab's type pin — items selected
  // on the other tab live in the per-tab badge count instead.
  const selectedRows: MenuItemDisplay[] = selectedIds
    .map((id) => itemById.get(id))
    .filter((it): it is MenuItemDisplay => !!it)
    .filter((it) => {
      if (!enableTypeTabs) return true;
      const isAddon = it.item_type === 'addon';
      return activeTab === 'dishes' ? !isAddon : isAddon;
    });

  // unselectedRows: in the active pool, not selected, not excluded, matches
  // search (when set), matches the active canonical-category chip (when set).
  const unselectedRows = activePool.filter((i) => {
    if (excludeSet.has(i.id)) return false;
    if (selectedIds.includes(i.id)) return false;
    if (q && !i.name.toLowerCase().includes(q)) return false;
    if (
      enableCategoryFilter
      && activeCategory !== 'all'
      && canonicalOf(i) !== activeCategory
    ) {
      return false;
    }
    return true;
  });

  // Per-tab selected-count badges — only computed when type tabs render.
  // Total across both tabs is reflected by the existing `selectedIds.length`
  // in the count label below, so the header still shows global progress.
  const dishesSelectedCount = enableTypeTabs
    ? selectedIds.filter((id) => {
        const it = itemById.get(id);
        return !!it && it.item_type !== 'addon';
      }).length
    : 0;
  const addonsSelectedCount = enableTypeTabs
    ? selectedIds.filter((id) => {
        const it = itemById.get(id);
        return !!it && it.item_type === 'addon';
      }).length
    : 0;

  const isAtCap = selectedIds.length >= maxSelections;
  const memberWord = selectedIds.length === 1 ? '' : 's';

  // "Select all" candidates — every currently-filtered unselected row
  // (unselectedRows already reflects type tab + category chip + search,
  // and is NOT limited by the 100-row render cap), trimmed to remaining
  // capacity so the parent can append without re-checking the cap.
  const remainingCapacity = Math.max(0, maxSelections - selectedIds.length);
  const selectAllIds = unselectedRows.slice(0, remainingCapacity).map((r) => r.id);

  // Switching tabs clears the chip filter — chip valid on one tab may
  // not exist on the other. Inlined to avoid setState-in-effect cascade.
  const handleTabChange = (next: TypeTab) => {
    setActiveTab(next);
    setActiveCategory('all');
  };

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 6,
        ...(fillHeight ? { flex: 1, minHeight: 0 } : {}),
      }}
    >
      {enableTypeTabs && (
        <div
          role="tablist"
          aria-label="Item type"
          data-testid={`${testidPrefix}-member-type-tabs`}
          style={{
            display: 'flex',
            gap: 4,
            borderBottom: '1px solid var(--border)',
          }}
        >
          {(
            [
              { id: 'dishes' as const, label: 'Dishes', count: dishesSelectedCount },
              { id: 'addons' as const, label: 'Add-ons', count: addonsSelectedCount },
            ]
          ).map((t) => {
            const isActive = activeTab === t.id;
            return (
              <button
                key={t.id}
                type="button"
                role="tab"
                aria-selected={isActive}
                data-testid={`${testidPrefix}-member-type-tab-${t.id}`}
                onClick={() => handleTabChange(t.id)}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 6,
                  padding: '6px 10px',
                  marginBottom: -1,
                  background: 'transparent',
                  border: 'none',
                  borderBottom: `2px solid ${isActive ? 'var(--brand)' : 'transparent'}`,
                  color: isActive ? 'var(--brand)' : 'var(--muted)',
                  cursor: 'pointer',
                  fontFamily: 'inherit',
                  fontSize: 12,
                  fontWeight: isActive ? 700 : 600,
                  letterSpacing: '-0.005em',
                  whiteSpace: 'nowrap',
                  transition: 'color .15s, border-color .15s',
                }}
              >
                {t.label}
                {t.count > 0 && (
                  <span
                    data-testid={`${testidPrefix}-member-type-tab-count-${t.id}`}
                    style={{
                      display: 'inline-flex',
                      minWidth: 16,
                      height: 16,
                      padding: '0 5px',
                      borderRadius: 999,
                      alignItems: 'center',
                      justifyContent: 'center',
                      background: isActive ? 'var(--brand)' : '#e5e7eb',
                      color: isActive ? '#fff' : '#374151',
                      fontSize: 10,
                      fontWeight: 700,
                    }}
                  >
                    {t.count}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      )}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <label style={{ fontSize: 11, fontWeight: 600, color: 'var(--muted)' }}>
          <span data-testid={`${testidPrefix}-member-selected-count`}>
            {selectedIds.length} member{memberWord} selected
          </span>
          {selectedCountSuffix}
        </label>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          {onSelectAll && selectAllIds.length > 0 && (
            <button
              type="button"
              data-testid={`${testidPrefix}-member-select-all-btn`}
              onClick={() => onSelectAll(selectAllIds)}
              title={`Select all ${selectAllIds.length} matching item${selectAllIds.length === 1 ? '' : 's'}`}
              style={{
                fontSize: 11, padding: '2px 6px',
                background: '#fff', border: '1px solid var(--brand)',
                borderRadius: 'var(--r-xs)', cursor: 'pointer',
                color: 'var(--brand)', fontWeight: 600,
              }}
            >
              Select all ({selectAllIds.length})
            </button>
          )}
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
      {enableCategoryFilter && categoryEntries.length > 0 && (
        <div
          role="tablist"
          aria-label="Courses"
          data-testid={`${testidPrefix}-member-categories`}
          style={{
            display: 'flex',
            flexWrap: 'wrap',
            gap: 4,
            // flexShrink:0 keeps the chip rail at its full wrapped height
            // inside a fillHeight (minHeight:0) flex column. Without it the
            // rail is squeezed below content height and its wrapped chips
            // overflow over the top member rows, intercepting their toggle
            // clicks (the regression that forced the 7ff3123 revert).
            flexShrink: 0,
          }}
        >
          {categoryEntries.map((c) => {
            const isActive = activeCategory === c.id;
            return (
              <button
                key={c.id}
                type="button"
                role="tab"
                aria-selected={isActive}
                data-testid={`${testidPrefix}-member-cat-${c.id.toLowerCase().replace(/\s+/g, '-')}`}
                onClick={() =>
                  setActiveCategory((cur) => (cur === c.id ? 'all' : c.id))
                }
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 5,
                  padding: '3px 8px',
                  background: isActive ? '#fff4ee' : '#fff',
                  color: isActive ? '#c2710a' : '#374151',
                  border: `1px solid ${isActive ? '#fed7aa' : 'var(--border)'}`,
                  borderRadius: 999,
                  cursor: 'pointer',
                  fontFamily: 'inherit',
                  fontSize: 11,
                  fontWeight: isActive ? 700 : 600,
                  whiteSpace: 'nowrap',
                  flexShrink: 0,
                }}
              >
                <span>{c.name}</span>
                <span
                  style={{
                    fontSize: 10,
                    fontWeight: 700,
                    padding: '0 5px',
                    borderRadius: 999,
                    background: isActive ? '#c2710a' : '#f3f4f6',
                    color: isActive ? '#fff' : '#6b7280',
                  }}
                >
                  {c.count}
                </span>
              </button>
            );
          })}
        </div>
      )}
      <div
        style={{
          ...(fillHeight
            ? { flex: 1, minHeight: 0 }
            : { maxHeight: 240 }),
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
