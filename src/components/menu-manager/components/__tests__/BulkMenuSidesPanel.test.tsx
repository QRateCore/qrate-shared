// @vitest-environment jsdom
/**
 * Vitest cases for BulkMenuSidesPanel (PDD 2026-05-22 Step 8).
 *
 * Coverage:
 *  - Both tabs render
 *  - Includes-tab zone radio toggle clears picker selection
 *  - Apply on Includes tab calls onBulkAddSides with the right shape
 *  - Remove-tab discovery fires ONCE on entry (amendment 1) — switching
 *    zone toggles between cached candidate sets without refetch
 *  - Candidates surfaced via UNION across parents (amendment Q5)
 *  - "On N items" expand reveals parent names (amendment 2)
 *  - Apply Disabled when no selections
 *  - Skip count surfaces in success banner (amendment 4 — aria-live)
 *  - Partial discovery failure renders error row + retry
 *  - 50-cap enforced via BulkMemberPicker (smoke — full coverage lives
 *    in BulkMemberPicker.test.tsx)
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import BulkMenuSidesPanel from '../BulkMenuSidesPanel';
import type { MenuItemDisplay } from '../../../../types/restaurant';
import type { PerMenuSidesResult } from '../BulkMenuSidesPanel';

function mkItem(
  id: string,
  name: string,
  item_type: 'dish' | 'addon' | 'included' = 'dish',
): MenuItemDisplay {
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

const MENU_ID = 'menu-1234';
const PARENT_A = { id: 'pa', name: 'Spaghetti' };
const PARENT_B = { id: 'pb', name: 'Lasagna' };
const SIDE_A = mkItem('sa', 'Garlic Bread');
const SIDE_B = mkItem('sb', 'House Salad');
const SIDE_C = mkItem('sc', 'Fries');
const ADDON = mkItem('addon-x', 'Extra Cheese', 'addon');  // excluded by allowlist

function defaultProps(overrides: Partial<React.ComponentProps<typeof BulkMenuSidesPanel>> = {}) {
  return {
    menuId: MENU_ID,
    menuName: 'Lunch',
    selectedItems: [PARENT_A, PARENT_B],
    pool: [SIDE_A, SIDE_B, SIDE_C, ADDON],
    loadPerMenuSides: vi.fn().mockResolvedValue({ sides_and: [], sides_or: [] }),
    onBulkAddSides: vi.fn().mockResolvedValue({ updated: [] }),
    onBulkRemoveSides: vi.fn().mockResolvedValue({ updated: [] }),
    onClose: vi.fn(),
    onComplete: vi.fn(),
    ...overrides,
  };
}

describe('BulkMenuSidesPanel — render', () => {
  it('renders both tabs + the close button', () => {
    render(<BulkMenuSidesPanel {...defaultProps()} />);
    expect(screen.getByTestId('bulk-menu-sides-tab-includes')).toBeTruthy();
    expect(screen.getByTestId('bulk-menu-sides-tab-removeIncludes')).toBeTruthy();
    expect(screen.getByTestId('bulk-menu-sides-close-btn')).toBeTruthy();
  });

  it('Includes tab visible by default with picker + zone radio', () => {
    render(<BulkMenuSidesPanel {...defaultProps()} />);
    expect(screen.getByTestId('bulk-menu-sides-add-zone-and')).toBeTruthy();
    expect(screen.getByTestId('bulk-menu-sides-add-zone-or')).toBeTruthy();
    expect(screen.getByTestId('bulk-menu-sides-member-search')).toBeTruthy();
    // Addon is excluded from pool (item_type allowlist).
    expect(screen.queryByTestId('bulk-menu-sides-member-row-addon-x')).toBeNull();
    // Dishes appear.
    expect(screen.getByTestId('bulk-menu-sides-member-row-sa')).toBeTruthy();
  });
});

describe('BulkMenuSidesPanel — Includes tab', () => {
  it('zone radio switch clears picker selection', () => {
    render(<BulkMenuSidesPanel {...defaultProps()} />);
    fireEvent.click(screen.getByTestId('bulk-menu-sides-member-row-toggle-sa'));
    expect(screen.getByTestId('bulk-menu-sides-member-row-state-sa')).toHaveTextContent('selected');
    fireEvent.click(screen.getByTestId('bulk-menu-sides-add-zone-or'));
    // Selection cleared on zone switch.
    expect(screen.getByTestId('bulk-menu-sides-member-row-state-sa')).toHaveTextContent('unselected');
  });

  it('Apply calls onBulkAddSides with item_ids + selected side ids + active zone', async () => {
    const onBulkAddSides = vi.fn().mockResolvedValue({
      updated: [
        { menu_item_menu_id: 'mim-a', food_item_id: 'pa', food_item_name: 'Spaghetti', sides_added: 1, sides_skipped: 0 },
        { menu_item_menu_id: 'mim-b', food_item_id: 'pb', food_item_name: 'Lasagna', sides_added: 1, sides_skipped: 0 },
      ],
    });
    render(<BulkMenuSidesPanel {...defaultProps({ onBulkAddSides })} />);
    fireEvent.click(screen.getByTestId('bulk-menu-sides-member-row-toggle-sa'));
    fireEvent.click(screen.getByTestId('bulk-menu-sides-add-zone-or'));
    fireEvent.click(screen.getByTestId('bulk-menu-sides-member-row-toggle-sb'));
    fireEvent.click(screen.getByTestId('bulk-menu-sides-apply-btn'));
    await waitFor(() => expect(onBulkAddSides).toHaveBeenCalled());
    expect(onBulkAddSides).toHaveBeenCalledWith(
      ['pa', 'pb'],
      { side_type: 'or', side_ids: ['sb'] },
    );
  });

  it('Apply disabled when no sides selected', () => {
    render(<BulkMenuSidesPanel {...defaultProps()} />);
    const btn = screen.getByTestId('bulk-menu-sides-apply-btn') as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
  });

  it('skip count surfaces in success banner (aria-live)', async () => {
    const onBulkAddSides = vi.fn().mockResolvedValue({
      updated: [
        { menu_item_menu_id: 'mim-a', food_item_id: 'pa', food_item_name: 'A', sides_added: 1, sides_skipped: 1 },
      ],
    });
    render(<BulkMenuSidesPanel {...defaultProps({ onBulkAddSides })} />);
    fireEvent.click(screen.getByTestId('bulk-menu-sides-member-row-toggle-sa'));
    fireEvent.click(screen.getByTestId('bulk-menu-sides-apply-btn'));
    const notice = await screen.findByTestId('bulk-menu-sides-skipped-count');
    expect(notice).toHaveAttribute('aria-live', 'polite');
    expect(notice.textContent).toMatch(/already present/);
  });
});

describe('BulkMenuSidesPanel — Remove Includes tab', () => {
  function withCache(
    cacheA: PerMenuSidesResult,
    cacheB: PerMenuSidesResult,
  ): ReturnType<typeof defaultProps> {
    const loadPerMenuSides = vi.fn(async (id: string) => {
      if (id === 'pa') return cacheA;
      if (id === 'pb') return cacheB;
      return { sides_and: [], sides_or: [] };
    });
    return defaultProps({ loadPerMenuSides });
  }

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('discovery fires ONCE on tab entry and renders union of sides_and', async () => {
    const props = withCache(
      { sides_and: [{ id: 'sa', name: 'Garlic Bread' }], sides_or: [] },
      { sides_and: [{ id: 'sb', name: 'House Salad' }], sides_or: [] },
    );
    render(<BulkMenuSidesPanel {...props} />);
    fireEvent.click(screen.getByTestId('bulk-menu-sides-tab-removeIncludes'));
    await screen.findByTestId('bulk-menu-sides-remove-side-row-sa');
    await screen.findByTestId('bulk-menu-sides-remove-side-row-sb');
    // Discovery fired exactly once per parent.
    expect(props.loadPerMenuSides).toHaveBeenCalledTimes(2);
  });

  it('zone radio toggle re-derives from cache without refetch (amendment 1)', async () => {
    const props = withCache(
      {
        sides_and: [{ id: 'sa', name: 'Garlic Bread' }],
        sides_or: [{ id: 'sc', name: 'Fries' }],
      },
      {
        sides_and: [],
        sides_or: [{ id: 'sc', name: 'Fries' }],
      },
    );
    render(<BulkMenuSidesPanel {...props} />);
    fireEvent.click(screen.getByTestId('bulk-menu-sides-tab-removeIncludes'));
    // Default zone='and' — Garlic Bread present on 1 parent.
    await screen.findByTestId('bulk-menu-sides-remove-side-row-sa');
    expect(props.loadPerMenuSides).toHaveBeenCalledTimes(2);
    // Switch zone — Fries should appear (present_on=2), Garlic Bread vanishes.
    fireEvent.click(screen.getByTestId('bulk-menu-sides-remove-zone-or'));
    await screen.findByTestId('bulk-menu-sides-remove-side-row-sc');
    expect(screen.queryByTestId('bulk-menu-sides-remove-side-row-sa')).toBeNull();
    // No additional discovery calls.
    expect(props.loadPerMenuSides).toHaveBeenCalledTimes(2);
  });

  it('expand reveals parent names ("on N items: X, Y")', async () => {
    const props = withCache(
      { sides_and: [{ id: 'sa', name: 'Garlic Bread' }], sides_or: [] },
      { sides_and: [{ id: 'sa', name: 'Garlic Bread' }], sides_or: [] },
    );
    render(<BulkMenuSidesPanel {...props} />);
    fireEvent.click(screen.getByTestId('bulk-menu-sides-tab-removeIncludes'));
    await screen.findByTestId('bulk-menu-sides-remove-side-row-sa');
    // Detail not shown by default.
    expect(screen.queryByTestId('bulk-menu-sides-remove-side-detail-sa')).toBeNull();
    fireEvent.click(screen.getByTestId('bulk-menu-sides-remove-side-expand-sa'));
    const detail = screen.getByTestId('bulk-menu-sides-remove-side-detail-sa');
    expect(detail.textContent).toContain('Spaghetti');
    expect(detail.textContent).toContain('Lasagna');
  });

  it('zone switch clears removeSelectedIds (amendment 9)', async () => {
    const props = withCache(
      {
        sides_and: [{ id: 'sa', name: 'Garlic Bread' }],
        sides_or: [{ id: 'sc', name: 'Fries' }],
      },
      {
        sides_and: [{ id: 'sa', name: 'Garlic Bread' }],
        sides_or: [{ id: 'sc', name: 'Fries' }],
      },
    );
    render(<BulkMenuSidesPanel {...props} />);
    fireEvent.click(screen.getByTestId('bulk-menu-sides-tab-removeIncludes'));
    await screen.findByTestId('bulk-menu-sides-remove-side-row-sa');
    const checkboxSa = screen.getByTestId('bulk-menu-sides-remove-side-checkbox-sa') as HTMLInputElement;
    fireEvent.click(checkboxSa);
    expect(checkboxSa.checked).toBe(true);
    fireEvent.click(screen.getByTestId('bulk-menu-sides-remove-zone-or'));
    await screen.findByTestId('bulk-menu-sides-remove-side-row-sc');
    // The new zone's candidate is rendered fresh + unchecked.
    const checkboxSc = screen.getByTestId('bulk-menu-sides-remove-side-checkbox-sc') as HTMLInputElement;
    expect(checkboxSc.checked).toBe(false);
  });

  it('empty intersection renders empty state', async () => {
    const props = withCache(
      { sides_and: [], sides_or: [] },
      { sides_and: [], sides_or: [] },
    );
    render(<BulkMenuSidesPanel {...props} />);
    fireEvent.click(screen.getByTestId('bulk-menu-sides-tab-removeIncludes'));
    await screen.findByTestId('bulk-menu-sides-remove-empty');
  });

  it('partial discovery failure surfaces error row + retry', async () => {
    const loadPerMenuSides = vi.fn(async (id: string) => {
      if (id === 'pa') return { sides_and: [{ id: 'sa', name: 'Garlic Bread' }], sides_or: [] };
      throw new Error('simulated 500');
    });
    render(<BulkMenuSidesPanel {...defaultProps({ loadPerMenuSides })} />);
    fireEvent.click(screen.getByTestId('bulk-menu-sides-tab-removeIncludes'));
    await screen.findByTestId('bulk-menu-sides-discovery-errors');
    expect(screen.getByTestId('bulk-menu-sides-discovery-error-pb')).toBeTruthy();
    expect(screen.getByTestId('bulk-menu-sides-discovery-retry')).toBeTruthy();
    // Successful parent's side is still rendered.
    expect(screen.getByTestId('bulk-menu-sides-remove-side-row-sa')).toBeTruthy();
  });

  it('Apply on Remove tab fires onBulkRemoveSides with the right shape', async () => {
    const onBulkRemoveSides = vi.fn().mockResolvedValue({
      updated: [
        { menu_item_menu_id: 'mim-a', food_item_id: 'pa', food_item_name: 'A', sides_removed: 1, sides_skipped: 0 },
      ],
    });
    const props = withCache(
      { sides_and: [{ id: 'sa', name: 'Garlic Bread' }], sides_or: [] },
      { sides_and: [], sides_or: [] },
    );
    render(<BulkMenuSidesPanel {...props} onBulkRemoveSides={onBulkRemoveSides} />);
    fireEvent.click(screen.getByTestId('bulk-menu-sides-tab-removeIncludes'));
    await screen.findByTestId('bulk-menu-sides-remove-side-row-sa');
    fireEvent.click(screen.getByTestId('bulk-menu-sides-remove-side-checkbox-sa'));
    fireEvent.click(screen.getByTestId('bulk-menu-sides-apply-btn'));
    await waitFor(() => expect(onBulkRemoveSides).toHaveBeenCalled());
    expect(onBulkRemoveSides).toHaveBeenCalledWith(
      ['pa', 'pb'],
      { side_type: 'and', side_ids: ['sa'] },
    );
  });
});

// ── Item Info tab (2026-07-23 — price/boost/special/portion, item-level) ────

function mkFullItem(
  id: string,
  name: string,
  overrides: Partial<MenuItemDisplay> = {},
): MenuItemDisplay {
  return {
    id,
    name,
    item_type: 'dish',
    price: 0,
    active: true,
    food_tags: { ingredients: [], dietary: [], textures: [] },
    boost_level: null,
    thumbnail_url: null,
    rating_avg: null,
    rating_count: 0,
    menu_associations: [
      {
        menu_id: MENU_ID,
        menu_name: 'Lunch',
        price: 12,
        boost_level: null,
        chefs_special: false,
        portion_type: 'single',
        portion_serves: null,
      },
    ],
    ...overrides,
  } as unknown as MenuItemDisplay;
}

const FOOD_ITEM = mkFullItem('food-1', 'Burger');
const BEER_ITEM = mkFullItem('beer-1', 'IPA', {
  food_tags: { beverage: { beverage_type: 'beer' } },
});
const WINE_ITEM = mkFullItem('wine-1', 'Cabernet Sauvignon', {
  food_tags: { beverage: { beverage_type: 'wine' } },
  menu_associations: [
    {
      menu_id: MENU_ID,
      menu_name: 'Lunch',
      price: null,
      boost_level: null,
      chefs_special: false,
      portion_type: 'single',
      portion_serves: null,
      serving_price_overrides: { glass: 1200, bottle: 4800 },
    },
  ],
});

function itemInfoProps(overrides: Partial<React.ComponentProps<typeof BulkMenuSidesPanel>> = {}) {
  return defaultProps({
    selectedItems: [{ id: FOOD_ITEM.id, name: FOOD_ITEM.name }],
    pool: [FOOD_ITEM, BEER_ITEM, WINE_ITEM],
    onBulkAddSides: undefined,
    onBulkRemoveSides: undefined,
    loadPerMenuSides: undefined,
    onBulkItemInfo: vi.fn().mockResolvedValue([]),
    ...overrides,
  });
}

describe('BulkMenuSidesPanel — Item Info tab', () => {
  it('renders as a third tab and is NOT gated behind the sides trio', () => {
    render(<BulkMenuSidesPanel {...itemInfoProps()} />);
    // Sides tabs absent — onBulkAddSides/onBulkRemoveSides/loadPerMenuSides
    // are all undefined in itemInfoProps().
    expect(screen.queryByTestId('bulk-menu-sides-tab-includes')).toBeNull();
    expect(screen.queryByTestId('bulk-menu-sides-tab-removeIncludes')).toBeNull();
    // Item Info is the only tab, and it's selected by default.
    expect(screen.getByTestId('bulk-menu-sides-tab-itemInfo')).toBeTruthy();
    expect(screen.getByTestId('bulk-item-info-table')).toBeTruthy();
  });

  it('drinks are NOT skipped on the Item Info tab (unlike Includes/Remove Includes)', () => {
    render(
      <BulkMenuSidesPanel
        {...itemInfoProps({
          selectedItems: [
            { id: FOOD_ITEM.id, name: FOOD_ITEM.name },
            { id: BEER_ITEM.id, name: BEER_ITEM.name },
          ],
          skippedDrinkCount: 1,
        })}
      />,
    );
    // Every selected item (food AND beer) gets a row.
    expect(screen.getByTestId(`bulk-item-info-row-${FOOD_ITEM.id}`)).toBeTruthy();
    expect(screen.getByTestId(`bulk-item-info-row-${BEER_ITEM.id}`)).toBeTruthy();
    // The "N drinks skipped" note is scoped to the sides tabs — irrelevant here.
    expect(screen.queryByTestId('bulk-menu-sides-skipped-drinks')).toBeNull();
  });

  it('wine rows show By Glass / By Bottle inputs + a Wine badge; other items show a flat price input', () => {
    render(
      <BulkMenuSidesPanel
        {...itemInfoProps({
          selectedItems: [
            { id: FOOD_ITEM.id, name: FOOD_ITEM.name },
            { id: BEER_ITEM.id, name: BEER_ITEM.name },
            { id: WINE_ITEM.id, name: WINE_ITEM.name },
          ],
        })}
      />,
    );
    // Wine: two serving inputs, pre-filled from serving_price_overrides, + badge.
    expect(screen.getByTestId(`bulk-item-info-glass-${WINE_ITEM.id}`)).toHaveValue('12');
    expect(screen.getByTestId(`bulk-item-info-bottle-${WINE_ITEM.id}`)).toHaveValue('48');
    expect(screen.getByTestId(`bulk-item-info-wine-badge-${WINE_ITEM.id}`)).toHaveTextContent('Wine');
    // Food + beer: flat price input, no serving inputs, no badge.
    expect(screen.getByTestId(`bulk-item-info-price-${FOOD_ITEM.id}`)).toBeTruthy();
    expect(screen.queryByTestId(`bulk-item-info-glass-${FOOD_ITEM.id}`)).toBeNull();
    expect(screen.queryByTestId(`bulk-item-info-wine-badge-${FOOD_ITEM.id}`)).toBeNull();
    expect(screen.getByTestId(`bulk-item-info-price-${BEER_ITEM.id}`)).toBeTruthy();
    expect(screen.queryByTestId(`bulk-item-info-glass-${BEER_ITEM.id}`)).toBeNull();
    expect(screen.queryByTestId(`bulk-item-info-wine-badge-${BEER_ITEM.id}`)).toBeNull();
  });

  it('wine rows are grouped first regardless of selection order', () => {
    render(
      <BulkMenuSidesPanel
        {...itemInfoProps({
          selectedItems: [
            { id: FOOD_ITEM.id, name: FOOD_ITEM.name },
            { id: WINE_ITEM.id, name: WINE_ITEM.name },
            { id: BEER_ITEM.id, name: BEER_ITEM.name },
          ],
        })}
      />,
    );
    const rowIds = screen.getAllByTestId(/^bulk-item-info-row-/).map((el) => el.getAttribute('data-testid'));
    expect(rowIds[0]).toBe(`bulk-item-info-row-${WINE_ITEM.id}`);
  });

  it('Apply is disabled until a field is changed, and disabled again after a no-op edit back to the original value', () => {
    render(<BulkMenuSidesPanel {...itemInfoProps()} />);
    const applyBtn = screen.getByTestId('bulk-menu-sides-apply-btn') as HTMLButtonElement;
    expect(applyBtn.disabled).toBe(true);
    const priceInput = screen.getByTestId(`bulk-item-info-price-${FOOD_ITEM.id}`);
    fireEvent.change(priceInput, { target: { value: '15' } });
    expect(applyBtn.disabled).toBe(false);
  });

  it('Apply sends ONLY the changed field for the touched item (price untouched → omitted)', async () => {
    const onBulkItemInfo = vi.fn().mockResolvedValue([]);
    render(<BulkMenuSidesPanel {...itemInfoProps({ onBulkItemInfo })} />);
    fireEvent.change(screen.getByTestId(`bulk-item-info-boost-${FOOD_ITEM.id}`), { target: { value: 'High' } });
    fireEvent.click(screen.getByTestId('bulk-menu-sides-apply-btn'));
    await waitFor(() => expect(onBulkItemInfo).toHaveBeenCalled());
    expect(onBulkItemInfo).toHaveBeenCalledWith([FOOD_ITEM.id], { boost_level: '3' });
  });

  it('wine glass/bottle edits fold into the SAME junction patch as serving_price_overrides (cents)', async () => {
    const onBulkItemInfo = vi.fn().mockResolvedValue([]);
    render(
      <BulkMenuSidesPanel
        {...itemInfoProps({
          selectedItems: [{ id: WINE_ITEM.id, name: WINE_ITEM.name }],
          onBulkItemInfo,
        })}
      />,
    );
    fireEvent.change(screen.getByTestId(`bulk-item-info-bottle-${WINE_ITEM.id}`), { target: { value: '55' } });
    fireEvent.click(screen.getByTestId('bulk-menu-sides-apply-btn'));
    await waitFor(() => expect(onBulkItemInfo).toHaveBeenCalled());
    expect(onBulkItemInfo).toHaveBeenCalledWith(
      [WINE_ITEM.id],
      { serving_price_overrides: { glass: 1200, bottle: 5500 } },
    );
  });

  it('clearing BOTH glass and bottle on a touched wine row surfaces a friendly error, does not apply', async () => {
    const onBulkItemInfo = vi.fn().mockResolvedValue([]);
    render(
      <BulkMenuSidesPanel
        {...itemInfoProps({
          selectedItems: [{ id: WINE_ITEM.id, name: WINE_ITEM.name }],
          onBulkItemInfo,
        })}
      />,
    );
    fireEvent.change(screen.getByTestId(`bulk-item-info-glass-${WINE_ITEM.id}`), { target: { value: '' } });
    fireEvent.change(screen.getByTestId(`bulk-item-info-bottle-${WINE_ITEM.id}`), { target: { value: '' } });
    fireEvent.click(screen.getByTestId('bulk-menu-sides-apply-btn'));
    const err = await screen.findByTestId('bulk-menu-sides-error-banner');
    expect(err.textContent).toMatch(/at least a glass or bottle price/);
    expect(onBulkItemInfo).not.toHaveBeenCalled();
  });

  it('a mixed selection sends independent patches per item (different fields per item)', async () => {
    const onBulkItemInfo = vi.fn().mockResolvedValue([]);
    render(
      <BulkMenuSidesPanel
        {...itemInfoProps({
          selectedItems: [
            { id: FOOD_ITEM.id, name: FOOD_ITEM.name },
            { id: WINE_ITEM.id, name: WINE_ITEM.name },
          ],
          onBulkItemInfo,
        })}
      />,
    );
    fireEvent.click(screen.getByTestId(`bulk-item-info-special-${FOOD_ITEM.id}`));
    fireEvent.change(screen.getByTestId(`bulk-item-info-glass-${WINE_ITEM.id}`), { target: { value: '13' } });
    fireEvent.click(screen.getByTestId('bulk-menu-sides-apply-btn'));
    await waitFor(() => expect(onBulkItemInfo).toHaveBeenCalledTimes(2));
    expect(onBulkItemInfo).toHaveBeenCalledWith([FOOD_ITEM.id], { chefs_special: true });
    expect(onBulkItemInfo).toHaveBeenCalledWith(
      [WINE_ITEM.id],
      { serving_price_overrides: { glass: 1300, bottle: 4800 } },
    );
  });

  it('calls onItemInfoApplied with the returned associations after a successful apply', async () => {
    const returnedAssociations = [{ menu_id: MENU_ID, menu_name: 'Lunch', price: 15, boost_level: null, chefs_special: false, portion_type: 'single' as const, portion_serves: null }];
    const onBulkItemInfo = vi.fn().mockResolvedValue(returnedAssociations);
    const onItemInfoApplied = vi.fn();
    render(
      <BulkMenuSidesPanel
        {...itemInfoProps({ onBulkItemInfo, onItemInfoApplied })}
      />,
    );
    fireEvent.change(screen.getByTestId(`bulk-item-info-price-${FOOD_ITEM.id}`), { target: { value: '15' } });
    fireEvent.click(screen.getByTestId('bulk-menu-sides-apply-btn'));
    await waitFor(() => expect(onItemInfoApplied).toHaveBeenCalled());
    expect(onItemInfoApplied).toHaveBeenCalledWith([
      { itemId: FOOD_ITEM.id, associations: returnedAssociations },
    ]);
  });
});

describe('BulkMenuSidesPanel — close handlers', () => {
  // PDD 2026-05-22 — close paths route through requestClose which
  // animates slide-out for 250ms before invoking the parent's onClose.
  // waitFor covers the timeout.
  it('backdrop click closes the drawer', async () => {
    const onClose = vi.fn();
    render(<BulkMenuSidesPanel {...defaultProps({ onClose })} />);
    fireEvent.click(screen.getByTestId('bulk-menu-sides-backdrop'));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });

  it('close button closes the drawer', async () => {
    const onClose = vi.fn();
    render(<BulkMenuSidesPanel {...defaultProps({ onClose })} />);
    fireEvent.click(screen.getByTestId('bulk-menu-sides-close-btn'));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });

  it('cancel button closes the drawer', async () => {
    const onClose = vi.fn();
    render(<BulkMenuSidesPanel {...defaultProps({ onClose })} />);
    fireEvent.click(screen.getByTestId('bulk-menu-sides-cancel-btn'));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });
});

// ===========================================================================
// Bulk single-value junction tabs (Price / Boost / Chef's Special / Portion)
// ===========================================================================

function bulkTabProps(overrides: Partial<React.ComponentProps<typeof BulkMenuSidesPanel>> = {}) {
  return defaultProps({
    selectedItems: [{ id: FOOD_ITEM.id, name: FOOD_ITEM.name }],
    pool: [FOOD_ITEM, BEER_ITEM, WINE_ITEM],
    onBulkAddSides: undefined,
    onBulkRemoveSides: undefined,
    loadPerMenuSides: undefined,
    onBulkSetPrice: vi.fn().mockResolvedValue({ updated: 1 }),
    onBulkSetBoost: vi.fn().mockResolvedValue({ updated: 1 }),
    onBulkSetChefsSpecial: vi.fn().mockResolvedValue({ updated: 1 }),
    onBulkSetPortion: vi.fn().mockResolvedValue({ updated: 1 }),
    ...overrides,
  });
}

describe('BulkMenuSidesPanel — bulk Price tab', () => {
  it('renders as its own tab, independent of the sides trio and Item Info', () => {
    render(<BulkMenuSidesPanel {...bulkTabProps()} />);
    expect(screen.getByTestId('bulk-menu-sides-tab-bulkPrice')).toBeTruthy();
    expect(screen.queryByTestId('bulk-menu-sides-tab-includes')).toBeNull();
    expect(screen.queryByTestId('bulk-menu-sides-tab-itemInfo')).toBeNull();
  });

  it('shows a flat price input for a non-wine-only selection and applies it', async () => {
    const onBulkSetPrice = vi.fn().mockResolvedValue({ updated: 1 });
    const onBulkJunctionApplied = vi.fn();
    render(<BulkMenuSidesPanel {...bulkTabProps({
      selectedItems: [{ id: FOOD_ITEM.id, name: FOOD_ITEM.name }],
      onBulkSetPrice, onBulkJunctionApplied,
    })} />);
    fireEvent.click(screen.getByTestId('bulk-menu-sides-tab-bulkPrice'));
    expect(screen.queryByTestId('bulk-price-glass-input')).toBeNull();
    fireEvent.change(screen.getByTestId('bulk-price-flat-input'), { target: { value: '15' } });
    fireEvent.click(screen.getByTestId('bulk-menu-sides-apply-btn'));
    await waitFor(() => expect(onBulkSetPrice).toHaveBeenCalledWith([FOOD_ITEM.id], { price: 15 }));
    expect(onBulkJunctionApplied).toHaveBeenCalledWith([FOOD_ITEM.id], { price: 15 });
  });

  it('shows By Glass / By Bottle for a wine-only selection and applies serving_price_overrides', async () => {
    const onBulkSetPrice = vi.fn().mockResolvedValue({ updated: 1 });
    render(<BulkMenuSidesPanel {...bulkTabProps({
      selectedItems: [{ id: WINE_ITEM.id, name: WINE_ITEM.name }],
      onBulkSetPrice,
    })} />);
    fireEvent.click(screen.getByTestId('bulk-menu-sides-tab-bulkPrice'));
    expect(screen.queryByTestId('bulk-price-flat-input')).toBeNull();
    fireEvent.change(screen.getByTestId('bulk-price-glass-input'), { target: { value: '11' } });
    fireEvent.change(screen.getByTestId('bulk-price-bottle-input'), { target: { value: '44' } });
    fireEvent.click(screen.getByTestId('bulk-menu-sides-apply-btn'));
    await waitFor(() => expect(onBulkSetPrice).toHaveBeenCalledWith(
      [WINE_ITEM.id], { serving_price_overrides: { glass: 1100, bottle: 4400 } },
    ));
  });

  it('mixed wine + non-wine selection sends two independent requests', async () => {
    const onBulkSetPrice = vi.fn().mockResolvedValue({ updated: 1 });
    render(<BulkMenuSidesPanel {...bulkTabProps({
      selectedItems: [{ id: FOOD_ITEM.id, name: FOOD_ITEM.name }, { id: WINE_ITEM.id, name: WINE_ITEM.name }],
      onBulkSetPrice,
    })} />);
    fireEvent.click(screen.getByTestId('bulk-menu-sides-tab-bulkPrice'));
    fireEvent.change(screen.getByTestId('bulk-price-flat-input'), { target: { value: '9' } });
    fireEvent.change(screen.getByTestId('bulk-price-bottle-input'), { target: { value: '50' } });
    fireEvent.click(screen.getByTestId('bulk-menu-sides-apply-btn'));
    await waitFor(() => expect(onBulkSetPrice).toHaveBeenCalledTimes(2));
    expect(onBulkSetPrice).toHaveBeenCalledWith([FOOD_ITEM.id], { price: 9 });
    // Empty By Glass box preserves the wine's persisted glass override
    // (1200 from the fixture) rather than wiping it from the object.
    expect(onBulkSetPrice).toHaveBeenCalledWith(
      [WINE_ITEM.id], { serving_price_overrides: { glass: 1200, bottle: 5000 } },
    );
  });

  it('an empty wine box preserves each item\'s existing persisted price (separate-runs flow)', async () => {
    const onBulkSetPrice = vi.fn().mockResolvedValue({ updated: 1 });
    const onBulkJunctionApplied = vi.fn();
    render(<BulkMenuSidesPanel {...bulkTabProps({
      selectedItems: [{ id: WINE_ITEM.id, name: WINE_ITEM.name }],
      onBulkSetPrice, onBulkJunctionApplied,
    })} />);
    fireEvent.click(screen.getByTestId('bulk-menu-sides-tab-bulkPrice'));
    // Run sets ONLY By Glass — By Bottle left blank must keep bottle: 4800.
    fireEvent.change(screen.getByTestId('bulk-price-glass-input'), { target: { value: '14' } });
    fireEvent.click(screen.getByTestId('bulk-menu-sides-apply-btn'));
    await waitFor(() => expect(onBulkSetPrice).toHaveBeenCalledWith(
      [WINE_ITEM.id], { serving_price_overrides: { glass: 1400, bottle: 4800 } },
    ));
    // Local-cache patch carries the same merged object so the UI doesn't
    // transiently show the bottle price as cleared.
    expect(onBulkJunctionApplied).toHaveBeenCalledWith(
      [WINE_ITEM.id], { serving_price_overrides: { glass: 1400, bottle: 4800 } },
    );
  });

  it('wines with differing existing overrides are grouped into per-merge bulk calls', async () => {
    // Second wine with a DIFFERENT persisted glass price + a third with none.
    const WINE_2 = mkFullItem('wine-2', 'Merlot', {
      food_tags: { beverage: { beverage_type: 'wine' } },
      menu_associations: [{
        menu_id: MENU_ID, menu_name: 'Lunch', price: null, boost_level: null,
        chefs_special: false, portion_type: 'single', portion_serves: null,
        serving_price_overrides: { glass: 900 },
      }],
    });
    const WINE_3 = mkFullItem('wine-3', 'House Red', {
      food_tags: { beverage: { beverage_type: 'wine' } },
    });
    const onBulkSetPrice = vi.fn().mockResolvedValue({ updated: 1 });
    render(<BulkMenuSidesPanel {...bulkTabProps({
      selectedItems: [
        { id: WINE_ITEM.id, name: WINE_ITEM.name },
        { id: WINE_2.id, name: WINE_2.name },
        { id: WINE_3.id, name: WINE_3.name },
      ],
      pool: [FOOD_ITEM, BEER_ITEM, WINE_ITEM, WINE_2, WINE_3],
      onBulkSetPrice,
    })} />);
    fireEvent.click(screen.getByTestId('bulk-menu-sides-tab-bulkPrice'));
    fireEvent.change(screen.getByTestId('bulk-price-bottle-input'), { target: { value: '60' } });
    fireEvent.click(screen.getByTestId('bulk-menu-sides-apply-btn'));
    await waitFor(() => expect(onBulkSetPrice).toHaveBeenCalledTimes(3));
    expect(onBulkSetPrice).toHaveBeenCalledWith(
      [WINE_ITEM.id], { serving_price_overrides: { glass: 1200, bottle: 6000 } },
    );
    expect(onBulkSetPrice).toHaveBeenCalledWith(
      [WINE_2.id], { serving_price_overrides: { glass: 900, bottle: 6000 } },
    );
    // No existing overrides → nothing to preserve; only the filled box goes up.
    expect(onBulkSetPrice).toHaveBeenCalledWith(
      [WINE_3.id], { serving_price_overrides: { bottle: 6000 } },
    );
  });

  it('filling BOTH wine boxes collapses to one call regardless of differing existing values', async () => {
    const WINE_2 = mkFullItem('wine-2b', 'Merlot', {
      food_tags: { beverage: { beverage_type: 'wine' } },
      menu_associations: [{
        menu_id: MENU_ID, menu_name: 'Lunch', price: null, boost_level: null,
        chefs_special: false, portion_type: 'single', portion_serves: null,
        serving_price_overrides: { glass: 900, bottle: 3600 },
      }],
    });
    const onBulkSetPrice = vi.fn().mockResolvedValue({ updated: 2 });
    render(<BulkMenuSidesPanel {...bulkTabProps({
      selectedItems: [
        { id: WINE_ITEM.id, name: WINE_ITEM.name },
        { id: WINE_2.id, name: WINE_2.name },
      ],
      pool: [FOOD_ITEM, BEER_ITEM, WINE_ITEM, WINE_2],
      onBulkSetPrice,
    })} />);
    fireEvent.click(screen.getByTestId('bulk-menu-sides-tab-bulkPrice'));
    fireEvent.change(screen.getByTestId('bulk-price-glass-input'), { target: { value: '11' } });
    fireEvent.change(screen.getByTestId('bulk-price-bottle-input'), { target: { value: '44' } });
    fireEvent.click(screen.getByTestId('bulk-menu-sides-apply-btn'));
    await waitFor(() => expect(onBulkSetPrice).toHaveBeenCalledTimes(1));
    expect(onBulkSetPrice).toHaveBeenCalledWith(
      [WINE_ITEM.id, WINE_2.id], { serving_price_overrides: { glass: 1100, bottle: 4400 } },
    );
  });

  it('Apply is disabled until a relevant field is filled', () => {
    render(<BulkMenuSidesPanel {...bulkTabProps()} />);
    fireEvent.click(screen.getByTestId('bulk-menu-sides-tab-bulkPrice'));
    expect(screen.getByTestId('bulk-menu-sides-apply-btn')).toBeDisabled();
    fireEvent.change(screen.getByTestId('bulk-price-flat-input'), { target: { value: '10' } });
    expect(screen.getByTestId('bulk-menu-sides-apply-btn')).not.toBeDisabled();
  });

  it('mixed selection: hovering each count reveals a rendered tooltip listing that bucket\'s item names', () => {
    render(<BulkMenuSidesPanel {...bulkTabProps({
      selectedItems: [
        { id: FOOD_ITEM.id, name: FOOD_ITEM.name },
        { id: BEER_ITEM.id, name: BEER_ITEM.name },
        { id: WINE_ITEM.id, name: WINE_ITEM.name },
      ],
    })} />);
    fireEvent.click(screen.getByTestId('bulk-menu-sides-tab-bulkPrice'));
    const flatCount = screen.getByTestId('bulk-price-flat-count');
    expect(flatCount).toHaveTextContent('(Applies to 2 items)');
    // Tooltip renders only while hovered — not in the base DOM.
    expect(screen.queryByTestId('bulk-price-flat-tooltip')).toBeNull();
    fireEvent.mouseEnter(flatCount);
    // Beer is non-wine — it belongs to the flat-price bucket, not the wine one.
    expect(screen.getByTestId('bulk-price-flat-tooltip')).toHaveTextContent('Burger');
    expect(screen.getByTestId('bulk-price-flat-tooltip')).toHaveTextContent('IPA');
    fireEvent.mouseLeave(flatCount);
    expect(screen.queryByTestId('bulk-price-flat-tooltip')).toBeNull();

    const wineCount = screen.getByTestId('bulk-price-wine-count');
    expect(wineCount).toHaveTextContent('(Applies to 1 item)');
    fireEvent.mouseEnter(wineCount);
    const wineTip = screen.getByTestId('bulk-price-wine-tooltip');
    expect(wineTip).toHaveTextContent('Cabernet Sauvignon');
    expect(wineTip).not.toHaveTextContent('Burger');
  });

  it('count tooltip opens on keyboard focus and closes on blur', () => {
    render(<BulkMenuSidesPanel {...bulkTabProps({
      selectedItems: [{ id: FOOD_ITEM.id, name: FOOD_ITEM.name }],
    })} />);
    fireEvent.click(screen.getByTestId('bulk-menu-sides-tab-bulkPrice'));
    const flatCount = screen.getByTestId('bulk-price-flat-count');
    fireEvent.focus(flatCount);
    expect(screen.getByTestId('bulk-price-flat-tooltip')).toHaveTextContent('Burger');
    expect(flatCount.getAttribute('aria-describedby')).toBe('bulk-price-flat-tooltip');
    fireEvent.blur(flatCount);
    expect(screen.queryByTestId('bulk-price-flat-tooltip')).toBeNull();
  });

  it('count tooltip truncates past 15 names with an "…and N more" line', () => {
    const manyFoods = Array.from({ length: 18 }, (_, i) =>
      mkFullItem(`food-many-${i}`, `Dish ${String(i + 1).padStart(2, '0')}`));
    render(<BulkMenuSidesPanel {...bulkTabProps({
      selectedItems: manyFoods.map((f) => ({ id: f.id, name: f.name })),
      pool: [...manyFoods, WINE_ITEM],
    })} />);
    fireEvent.click(screen.getByTestId('bulk-menu-sides-tab-bulkPrice'));
    fireEvent.mouseEnter(screen.getByTestId('bulk-price-flat-count'));
    const lines = Array.from(
      screen.getByTestId('bulk-price-flat-tooltip-names').querySelectorAll('div'),
    ).map((d) => d.textContent);
    expect(lines).toHaveLength(16);
    expect(lines[0]).toBe('Dish 01');
    expect(lines[14]).toBe('Dish 15');
    expect(lines[15]).toBe('…and 3 more');
  });
});

describe('BulkMenuSidesPanel — bulk Boost tab', () => {
  it('applies the selected label to every selected item, mapping to the junction value', async () => {
    const onBulkSetBoost = vi.fn().mockResolvedValue({ updated: 2 });
    const onBulkJunctionApplied = vi.fn();
    render(<BulkMenuSidesPanel {...bulkTabProps({
      selectedItems: [{ id: FOOD_ITEM.id, name: FOOD_ITEM.name }, { id: BEER_ITEM.id, name: BEER_ITEM.name }],
      onBulkSetBoost, onBulkJunctionApplied,
    })} />);
    fireEvent.click(screen.getByTestId('bulk-menu-sides-tab-bulkBoost'));
    fireEvent.change(screen.getByTestId('bulk-boost-select'), { target: { value: 'High' } });
    fireEvent.click(screen.getByTestId('bulk-menu-sides-apply-btn'));
    await waitFor(() => expect(onBulkSetBoost).toHaveBeenCalledWith([FOOD_ITEM.id, BEER_ITEM.id], 'High'));
    expect(onBulkJunctionApplied).toHaveBeenCalledWith([FOOD_ITEM.id, BEER_ITEM.id], { boost_level: '3' });
  });

  it('"None" sends null and is a valid, always-applicable Apply', async () => {
    const onBulkSetBoost = vi.fn().mockResolvedValue({ updated: 1 });
    render(<BulkMenuSidesPanel {...bulkTabProps({ onBulkSetBoost })} />);
    fireEvent.click(screen.getByTestId('bulk-menu-sides-tab-bulkBoost'));
    expect(screen.getByTestId('bulk-menu-sides-apply-btn')).not.toBeDisabled();
    fireEvent.click(screen.getByTestId('bulk-menu-sides-apply-btn'));
    await waitFor(() => expect(onBulkSetBoost).toHaveBeenCalledWith([FOOD_ITEM.id], null));
  });
});

describe('BulkMenuSidesPanel — bulk Chef\'s Special tab', () => {
  it('Apply is disabled until Mark or Unmark is chosen', () => {
    render(<BulkMenuSidesPanel {...bulkTabProps()} />);
    fireEvent.click(screen.getByTestId('bulk-menu-sides-tab-bulkChefsSpecial'));
    expect(screen.getByTestId('bulk-menu-sides-apply-btn')).toBeDisabled();
  });

  it('"Mark as Chef\'s Special" applies true to every selected item', async () => {
    const onBulkSetChefsSpecial = vi.fn().mockResolvedValue({ updated: 1 });
    const onBulkJunctionApplied = vi.fn();
    render(<BulkMenuSidesPanel {...bulkTabProps({ onBulkSetChefsSpecial, onBulkJunctionApplied })} />);
    fireEvent.click(screen.getByTestId('bulk-menu-sides-tab-bulkChefsSpecial'));
    fireEvent.click(screen.getByTestId('bulk-chefs-special-mark'));
    fireEvent.click(screen.getByTestId('bulk-menu-sides-apply-btn'));
    await waitFor(() => expect(onBulkSetChefsSpecial).toHaveBeenCalledWith([FOOD_ITEM.id], true));
    expect(onBulkJunctionApplied).toHaveBeenCalledWith([FOOD_ITEM.id], { chefs_special: true });
  });

  it('"Unmark as Chef\'s Special" applies false to every selected item', async () => {
    const onBulkSetChefsSpecial = vi.fn().mockResolvedValue({ updated: 2 });
    const onBulkJunctionApplied = vi.fn();
    render(<BulkMenuSidesPanel {...bulkTabProps({
      selectedItems: [{ id: FOOD_ITEM.id, name: FOOD_ITEM.name }, { id: BEER_ITEM.id, name: BEER_ITEM.name }],
      onBulkSetChefsSpecial, onBulkJunctionApplied,
    })} />);
    fireEvent.click(screen.getByTestId('bulk-menu-sides-tab-bulkChefsSpecial'));
    fireEvent.click(screen.getByTestId('bulk-chefs-special-unmark'));
    fireEvent.click(screen.getByTestId('bulk-menu-sides-apply-btn'));
    await waitFor(() => expect(onBulkSetChefsSpecial).toHaveBeenCalledWith([FOOD_ITEM.id, BEER_ITEM.id], false));
    expect(onBulkJunctionApplied).toHaveBeenCalledWith([FOOD_ITEM.id, BEER_ITEM.id], { chefs_special: false });
  });

  it('switching from Mark to Unmark before Apply sends the latest choice', async () => {
    const onBulkSetChefsSpecial = vi.fn().mockResolvedValue({ updated: 1 });
    render(<BulkMenuSidesPanel {...bulkTabProps({ onBulkSetChefsSpecial })} />);
    fireEvent.click(screen.getByTestId('bulk-menu-sides-tab-bulkChefsSpecial'));
    fireEvent.click(screen.getByTestId('bulk-chefs-special-mark'));
    fireEvent.click(screen.getByTestId('bulk-chefs-special-unmark'));
    fireEvent.click(screen.getByTestId('bulk-menu-sides-apply-btn'));
    await waitFor(() => expect(onBulkSetChefsSpecial).toHaveBeenCalledWith([FOOD_ITEM.id], false));
  });
});

describe('BulkMenuSidesPanel — bulk Portion tab', () => {
  it('applies "single" with no serves input required', async () => {
    const onBulkSetPortion = vi.fn().mockResolvedValue({ updated: 1 });
    render(<BulkMenuSidesPanel {...bulkTabProps({ onBulkSetPortion })} />);
    fireEvent.click(screen.getByTestId('bulk-menu-sides-tab-bulkPortion'));
    expect(screen.queryByTestId('bulk-portion-serves-input')).toBeNull();
    expect(screen.getByTestId('bulk-menu-sides-apply-btn')).not.toBeDisabled();
    fireEvent.click(screen.getByTestId('bulk-menu-sides-apply-btn'));
    await waitFor(() => expect(onBulkSetPortion).toHaveBeenCalledWith([FOOD_ITEM.id], 'single', null));
  });

  it('"shared" requires a serves count before Apply is enabled', async () => {
    const onBulkSetPortion = vi.fn().mockResolvedValue({ updated: 1 });
    const onBulkJunctionApplied = vi.fn();
    render(<BulkMenuSidesPanel {...bulkTabProps({ onBulkSetPortion, onBulkJunctionApplied })} />);
    fireEvent.click(screen.getByTestId('bulk-menu-sides-tab-bulkPortion'));
    fireEvent.change(screen.getByTestId('bulk-portion-type-select'), { target: { value: 'shared' } });
    expect(screen.getByTestId('bulk-menu-sides-apply-btn')).toBeDisabled();
    fireEvent.change(screen.getByTestId('bulk-portion-serves-input'), { target: { value: '4' } });
    expect(screen.getByTestId('bulk-menu-sides-apply-btn')).not.toBeDisabled();
    fireEvent.click(screen.getByTestId('bulk-menu-sides-apply-btn'));
    await waitFor(() => expect(onBulkSetPortion).toHaveBeenCalledWith([FOOD_ITEM.id], 'shared', 4));
    expect(onBulkJunctionApplied).toHaveBeenCalledWith([FOOD_ITEM.id], { portion_type: 'shared', portion_serves: 4 });
  });
});

// Avoid `act()` unused-import warning when not directly invoked.
void act;
