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
