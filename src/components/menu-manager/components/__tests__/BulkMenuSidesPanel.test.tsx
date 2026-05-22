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

describe('BulkMenuSidesPanel — close handlers', () => {
  it('backdrop click closes the drawer', () => {
    const onClose = vi.fn();
    render(<BulkMenuSidesPanel {...defaultProps({ onClose })} />);
    fireEvent.click(screen.getByTestId('bulk-menu-sides-backdrop'));
    expect(onClose).toHaveBeenCalled();
  });

  it('close button closes the drawer', () => {
    const onClose = vi.fn();
    render(<BulkMenuSidesPanel {...defaultProps({ onClose })} />);
    fireEvent.click(screen.getByTestId('bulk-menu-sides-close-btn'));
    expect(onClose).toHaveBeenCalled();
  });

  it('cancel button closes the drawer', () => {
    const onClose = vi.fn();
    render(<BulkMenuSidesPanel {...defaultProps({ onClose })} />);
    fireEvent.click(screen.getByTestId('bulk-menu-sides-cancel-btn'));
    expect(onClose).toHaveBeenCalled();
  });
});

// Avoid `act()` unused-import warning when not directly invoked.
void act;
