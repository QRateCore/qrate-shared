// @vitest-environment jsdom
/**
 * Vitest cases for the extracted `BulkMemberPicker` shared component
 * (PDD 2026-05-22 Step 7). The component replaces the inline PickerRow
 * that lived in BulkActionsPanel.BulkGroupingForm; existing E2E specs
 * (`bulk-grouping.spec.ts`, `bulk-add-existing-grouping.spec.ts`) depend
 * on the exact testid strings being preserved when `testidPrefix='bulk-
 * grouping'`. Amendment 10 of the Phase-3 vote requires snapshotting
 * the rendered testids with BOTH prefixes to catch hyphen-level drift.
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { BulkMemberPicker } from '../BulkMemberPicker';
import type { MenuItemDisplay } from '../../../../types/restaurant';

function mkItem(id: string, name: string, item_type: 'dish' | 'addon' | 'included' = 'dish'): MenuItemDisplay {
  // The MenuItemDisplay shape has many fields we don't care about for
  // picker rendering — cast through `unknown` so we don't have to
  // re-declare every property for a unit test.
  return {
    id,
    name,
    item_type,
    price: 0,
    active: true,
    food_tags: { ingredients: [], dietary: [], textures: [] },
    boost_level: null,
    thumbnail_url: null,
    rating_avg: null,
    rating_count: 0,
    menu_associations: [],
  } as unknown as MenuItemDisplay;
}

/** Like mkItem but stamps a canonical_category so the chip rail derives. */
function mkItemCat(
  id: string,
  name: string,
  canonical_category: string,
  item_type: 'dish' | 'addon' | 'included' = 'dish',
): MenuItemDisplay {
  return { ...mkItem(id, name, item_type), canonical_category } as unknown as MenuItemDisplay;
}

describe('BulkMemberPicker — testid contract', () => {
  it('renders bulk-grouping-* testids exactly when testidPrefix="bulk-grouping"', () => {
    const items = [mkItem('aaa', 'Garlic Bread'), mkItem('bbb', 'House Salad')];
    render(
      <BulkMemberPicker
        pool={items}
        selectedIds={['aaa']}
        search=""
        onToggle={() => {}}
        onClearAll={() => {}}
        onChangeSearch={() => {}}
        testidPrefix="bulk-grouping"
      />,
    );
    // Existing E2E specs depend on these exact strings — snapshot-check
    // each one literally rather than via prefix-match.
    expect(screen.getByTestId('bulk-grouping-member-selected-count')).toBeTruthy();
    expect(screen.getByTestId('bulk-grouping-member-clear-all-btn')).toBeTruthy();
    expect(screen.getByTestId('bulk-grouping-member-search')).toBeTruthy();
    expect(screen.getByTestId('bulk-grouping-member-row-aaa')).toBeTruthy();
    expect(screen.getByTestId('bulk-grouping-member-row-bbb')).toBeTruthy();
    expect(screen.getByTestId('bulk-grouping-member-row-state-aaa')).toHaveTextContent('selected');
    expect(screen.getByTestId('bulk-grouping-member-row-state-bbb')).toHaveTextContent('unselected');
    expect(screen.getByTestId('bulk-grouping-member-row-toggle-aaa')).toBeTruthy();
    expect(screen.getByTestId('bulk-grouping-member-row-toggle-bbb')).toBeTruthy();
  });

  it('renders bulk-menu-sides-* testids exactly when testidPrefix="bulk-menu-sides"', () => {
    const items = [mkItem('aaa', 'Garlic Bread'), mkItem('bbb', 'House Salad')];
    render(
      <BulkMemberPicker
        pool={items}
        selectedIds={['aaa']}
        search=""
        onToggle={() => {}}
        onClearAll={() => {}}
        onChangeSearch={() => {}}
        testidPrefix="bulk-menu-sides"
      />,
    );
    expect(screen.getByTestId('bulk-menu-sides-member-selected-count')).toBeTruthy();
    expect(screen.getByTestId('bulk-menu-sides-member-clear-all-btn')).toBeTruthy();
    expect(screen.getByTestId('bulk-menu-sides-member-search')).toBeTruthy();
    expect(screen.getByTestId('bulk-menu-sides-member-row-aaa')).toBeTruthy();
    expect(screen.getByTestId('bulk-menu-sides-member-row-bbb')).toBeTruthy();
    expect(screen.getByTestId('bulk-menu-sides-member-row-toggle-aaa')).toBeTruthy();
    // The bulk-grouping-* prefix MUST be absent.
    expect(screen.queryByTestId('bulk-grouping-member-row-aaa')).toBeNull();
  });
});

describe('BulkMemberPicker — selection behavior', () => {
  it('fires onToggle with the item id when a Select button is clicked', () => {
    const onToggle = vi.fn();
    render(
      <BulkMemberPicker
        pool={[mkItem('aaa', 'Garlic Bread')]}
        selectedIds={[]}
        search=""
        onToggle={onToggle}
        onClearAll={() => {}}
        onChangeSearch={() => {}}
        testidPrefix="bulk-grouping"
      />,
    );
    fireEvent.click(screen.getByTestId('bulk-grouping-member-row-toggle-aaa'));
    expect(onToggle).toHaveBeenCalledWith('aaa');
  });

  it('pins selected rows above unselected rows (DOM order)', () => {
    const items = [
      mkItem('aaa', 'Garlic Bread'),  // unselected (in pool but not selected)
      mkItem('bbb', 'House Salad'),   // selected
      mkItem('ccc', 'Fries'),         // unselected
    ];
    render(
      <BulkMemberPicker
        pool={items}
        selectedIds={['bbb']}
        search=""
        onToggle={() => {}}
        onClearAll={() => {}}
        onChangeSearch={() => {}}
        testidPrefix="bulk-grouping"
      />,
    );
    const rows = [
      screen.getByTestId('bulk-grouping-member-row-aaa'),
      screen.getByTestId('bulk-grouping-member-row-bbb'),
      screen.getByTestId('bulk-grouping-member-row-ccc'),
    ];
    // bbb pinned first; aaa and ccc follow in pool order.
    const positions = rows.map((r) =>
      r.compareDocumentPosition(rows[1]) & Node.DOCUMENT_POSITION_FOLLOWING ? 'after' : 'before-or-same',
    );
    expect(positions[1]).toBe('before-or-same');  // bbb is itself
    // The bbb row comes before the aaa and ccc rows in document order.
    expect(
      rows[1].compareDocumentPosition(rows[0]) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(
      rows[1].compareDocumentPosition(rows[2]) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it('search filters unselected rows but keeps selected rows visible', () => {
    const items = [
      mkItem('aaa', 'Garlic Bread'),
      mkItem('bbb', 'House Salad'),
      mkItem('ccc', 'Fries'),
    ];
    render(
      <BulkMemberPicker
        pool={items}
        selectedIds={['bbb']}
        search="garlic"
        onToggle={() => {}}
        onClearAll={() => {}}
        onChangeSearch={() => {}}
        testidPrefix="bulk-grouping"
      />,
    );
    // bbb stays pinned despite not matching search.
    expect(screen.getByTestId('bulk-grouping-member-row-bbb')).toBeTruthy();
    // aaa matches the search filter.
    expect(screen.getByTestId('bulk-grouping-member-row-aaa')).toBeTruthy();
    // ccc is filtered out.
    expect(screen.queryByTestId('bulk-grouping-member-row-ccc')).toBeNull();
  });

  it('disables Select buttons on unselected rows when at cap', () => {
    const items = [mkItem('aaa', 'A'), mkItem('bbb', 'B')];
    render(
      <BulkMemberPicker
        pool={items}
        selectedIds={['aaa']}
        search=""
        onToggle={() => {}}
        onClearAll={() => {}}
        onChangeSearch={() => {}}
        testidPrefix="bulk-grouping"
        maxSelections={1}
      />,
    );
    // bbb's Select is disabled (at cap).
    const bbbBtn = screen.getByTestId('bulk-grouping-member-row-toggle-bbb') as HTMLButtonElement;
    expect(bbbBtn.disabled).toBe(true);
    // aaa's "Deselect" toggle remains enabled.
    const aaaBtn = screen.getByTestId('bulk-grouping-member-row-toggle-aaa') as HTMLButtonElement;
    expect(aaaBtn.disabled).toBe(false);
    // The at-cap testid surfaces on the disabled row.
    expect(screen.getByTestId('bulk-grouping-member-row-at-cap')).toBeTruthy();
  });

  it('clearAll button calls the prop and is hidden when nothing is selected', () => {
    const onClearAll = vi.fn();
    const { rerender } = render(
      <BulkMemberPicker
        pool={[mkItem('aaa', 'A')]}
        selectedIds={['aaa']}
        search=""
        onToggle={() => {}}
        onClearAll={onClearAll}
        onChangeSearch={() => {}}
        testidPrefix="bulk-grouping"
      />,
    );
    fireEvent.click(screen.getByTestId('bulk-grouping-member-clear-all-btn'));
    expect(onClearAll).toHaveBeenCalled();
    // With zero selections, the button is not rendered.
    rerender(
      <BulkMemberPicker
        pool={[mkItem('aaa', 'A')]}
        selectedIds={[]}
        search=""
        onToggle={() => {}}
        onClearAll={onClearAll}
        onChangeSearch={() => {}}
        testidPrefix="bulk-grouping"
      />,
    );
    expect(screen.queryByTestId('bulk-grouping-member-clear-all-btn')).toBeNull();
  });

  it('excludeIds removes items from the unselected pool', () => {
    const items = [mkItem('aaa', 'A'), mkItem('bbb', 'B')];
    render(
      <BulkMemberPicker
        pool={items}
        selectedIds={[]}
        search=""
        onToggle={() => {}}
        onClearAll={() => {}}
        onChangeSearch={() => {}}
        testidPrefix="bulk-grouping"
        excludeIds={['bbb']}
      />,
    );
    expect(screen.getByTestId('bulk-grouping-member-row-aaa')).toBeTruthy();
    expect(screen.queryByTestId('bulk-grouping-member-row-bbb')).toBeNull();
  });
});

describe('BulkMemberPicker — canonical category chip rail', () => {
  const pool = [
    mkItemCat('a1', 'Garlic Bread', 'Appetizers'),
    mkItemCat('a2', 'Bruschetta', 'Appetizers'),
    mkItemCat('s1', 'Fries', 'Sides'),
    mkItemCat('e1', 'Ribeye', 'Entrees'),
  ];

  it('does NOT render the chip rail unless enableCategoryFilter is set', () => {
    render(
      <BulkMemberPicker
        pool={pool}
        selectedIds={[]}
        search=""
        onToggle={() => {}}
        onClearAll={() => {}}
        onChangeSearch={() => {}}
        testidPrefix="bulk-menu-sides"
      />,
    );
    expect(screen.queryByTestId('bulk-menu-sides-member-categories')).toBeNull();
  });

  it('renders one chip per canonical category, sorted, with counts', () => {
    render(
      <BulkMemberPicker
        pool={pool}
        selectedIds={[]}
        search=""
        onToggle={() => {}}
        onClearAll={() => {}}
        onChangeSearch={() => {}}
        testidPrefix="bulk-menu-sides"
        enableCategoryFilter
      />,
    );
    expect(screen.getByTestId('bulk-menu-sides-member-categories')).toBeTruthy();
    // slug = lowercased, spaces → hyphens
    expect(screen.getByTestId('bulk-menu-sides-member-cat-appetizers')).toHaveTextContent('Appetizers');
    expect(screen.getByTestId('bulk-menu-sides-member-cat-appetizers')).toHaveTextContent('2');
    expect(screen.getByTestId('bulk-menu-sides-member-cat-sides')).toHaveTextContent('Sides');
    expect(screen.getByTestId('bulk-menu-sides-member-cat-entrees')).toHaveTextContent('Entrees');
  });

  it('clicking a chip filters the unselected rows to that category; clicking it again resets', () => {
    render(
      <BulkMemberPicker
        pool={pool}
        selectedIds={[]}
        search=""
        onToggle={() => {}}
        onClearAll={() => {}}
        onChangeSearch={() => {}}
        testidPrefix="bulk-menu-sides"
        enableCategoryFilter
      />,
    );
    // All four rows visible initially.
    expect(screen.getByTestId('bulk-menu-sides-member-row-a1')).toBeTruthy();
    expect(screen.getByTestId('bulk-menu-sides-member-row-s1')).toBeTruthy();

    // Filter to Appetizers — only a1/a2 remain.
    fireEvent.click(screen.getByTestId('bulk-menu-sides-member-cat-appetizers'));
    expect(screen.getByTestId('bulk-menu-sides-member-row-a1')).toBeTruthy();
    expect(screen.getByTestId('bulk-menu-sides-member-row-a2')).toBeTruthy();
    expect(screen.queryByTestId('bulk-menu-sides-member-row-s1')).toBeNull();
    expect(screen.queryByTestId('bulk-menu-sides-member-row-e1')).toBeNull();

    // Click the active chip again → back to "all".
    fireEvent.click(screen.getByTestId('bulk-menu-sides-member-cat-appetizers'));
    expect(screen.getByTestId('bulk-menu-sides-member-row-s1')).toBeTruthy();
    expect(screen.getByTestId('bulk-menu-sides-member-row-e1')).toBeTruthy();
  });

  it('REGRESSION GUARD: chip rail keeps flexShrink:0 so it cannot overflow over member rows under fillHeight (7ff3123)', () => {
    // The 7ff3123 revert was forced because, under fillHeight (minHeight:0
    // flex column), the chip rail was squeezed below its content height and
    // its wrapped chips overflowed over the top member rows, intercepting
    // their toggle clicks. flexShrink:0 on the rail container prevents this.
    render(
      <BulkMemberPicker
        pool={pool}
        selectedIds={[]}
        search=""
        onToggle={() => {}}
        onClearAll={() => {}}
        onChangeSearch={() => {}}
        testidPrefix="bulk-grouping"
        enableCategoryFilter
        fillHeight
      />,
    );
    const rail = screen.getByTestId('bulk-grouping-member-categories');
    expect(rail.style.flexShrink).toBe('0');
  });

  it('member-row toggle still fires when the chip rail is present under fillHeight', () => {
    // Behavioural complement to the style guard: the click path is intact.
    const onToggle = vi.fn();
    render(
      <BulkMemberPicker
        pool={pool}
        selectedIds={[]}
        search=""
        onToggle={onToggle}
        onClearAll={() => {}}
        onChangeSearch={() => {}}
        testidPrefix="bulk-grouping"
        enableCategoryFilter
        fillHeight
      />,
    );
    fireEvent.click(screen.getByTestId('bulk-grouping-member-row-toggle-a1'));
    expect(onToggle).toHaveBeenCalledWith('a1');
  });
});

describe('BulkMemberPicker — select all', () => {
  const pool = [
    mkItemCat('a1', 'Garlic Bread', 'Appetizers'),
    mkItemCat('a2', 'Bruschetta', 'Appetizers'),
    mkItemCat('s1', 'Fries', 'Sides'),
    mkItemCat('e1', 'Ribeye', 'Entrees'),
  ];

  it('does NOT render the Select-all button unless onSelectAll is provided', () => {
    render(
      <BulkMemberPicker
        pool={pool}
        selectedIds={[]}
        search=""
        onToggle={() => {}}
        onClearAll={() => {}}
        onChangeSearch={() => {}}
        testidPrefix="bulk-grouping"
      />,
    );
    expect(screen.queryByTestId('bulk-grouping-member-select-all-btn')).toBeNull();
  });

  it('selects every currently-unfiltered unselected row, with a count label', () => {
    const onSelectAll = vi.fn();
    render(
      <BulkMemberPicker
        pool={pool}
        selectedIds={[]}
        search=""
        onToggle={() => {}}
        onClearAll={() => {}}
        onChangeSearch={() => {}}
        onSelectAll={onSelectAll}
        testidPrefix="bulk-grouping"
      />,
    );
    const btn = screen.getByTestId('bulk-grouping-member-select-all-btn');
    expect(btn).toHaveTextContent('Select all (4)');
    fireEvent.click(btn);
    expect(onSelectAll).toHaveBeenCalledWith(['a1', 'a2', 's1', 'e1']);
  });

  it('only selects rows matching the active category chip', () => {
    const onSelectAll = vi.fn();
    render(
      <BulkMemberPicker
        pool={pool}
        selectedIds={[]}
        search=""
        onToggle={() => {}}
        onClearAll={() => {}}
        onChangeSearch={() => {}}
        onSelectAll={onSelectAll}
        testidPrefix="bulk-grouping"
        enableCategoryFilter
      />,
    );
    // Filter to Appetizers, then Select all → only the two appetizers.
    fireEvent.click(screen.getByTestId('bulk-grouping-member-cat-appetizers'));
    const btn = screen.getByTestId('bulk-grouping-member-select-all-btn');
    expect(btn).toHaveTextContent('Select all (2)');
    fireEvent.click(btn);
    expect(onSelectAll).toHaveBeenCalledWith(['a1', 'a2']);
  });

  it('only selects rows matching the search filter', () => {
    const onSelectAll = vi.fn();
    render(
      <BulkMemberPicker
        pool={pool}
        selectedIds={[]}
        search="bruschetta"
        onToggle={() => {}}
        onClearAll={() => {}}
        onChangeSearch={() => {}}
        onSelectAll={onSelectAll}
        testidPrefix="bulk-grouping"
      />,
    );
    fireEvent.click(screen.getByTestId('bulk-grouping-member-select-all-btn'));
    expect(onSelectAll).toHaveBeenCalledWith(['a2']);
  });

  it('caps the selection to the remaining capacity (maxSelections)', () => {
    const onSelectAll = vi.fn();
    render(
      <BulkMemberPicker
        pool={pool}
        selectedIds={['a1']}        // 1 already selected
        search=""
        onToggle={() => {}}
        onClearAll={() => {}}
        onChangeSearch={() => {}}
        onSelectAll={onSelectAll}
        testidPrefix="bulk-grouping"
        maxSelections={3}           // capacity remaining = 2
      />,
    );
    const btn = screen.getByTestId('bulk-grouping-member-select-all-btn');
    // Only 2 of the 3 unselected rows fit under the cap.
    expect(btn).toHaveTextContent('Select all (2)');
    fireEvent.click(btn);
    expect(onSelectAll).toHaveBeenCalledWith(['a2', 's1']);
  });

  it('hides the Select-all button when at capacity (nothing left to add)', () => {
    render(
      <BulkMemberPicker
        pool={pool}
        selectedIds={['a1', 'a2']}
        search=""
        onToggle={() => {}}
        onClearAll={() => {}}
        onChangeSearch={() => {}}
        onSelectAll={() => {}}
        testidPrefix="bulk-grouping"
        maxSelections={2}           // full
      />,
    );
    expect(screen.queryByTestId('bulk-grouping-member-select-all-btn')).toBeNull();
  });

  it('hides the Select-all button when the filter yields no unselected rows', () => {
    render(
      <BulkMemberPicker
        pool={pool}
        selectedIds={[]}
        search="nonexistent-zzz"
        onToggle={() => {}}
        onClearAll={() => {}}
        onChangeSearch={() => {}}
        onSelectAll={() => {}}
        testidPrefix="bulk-grouping"
      />,
    );
    expect(screen.queryByTestId('bulk-grouping-member-select-all-btn')).toBeNull();
  });
});
