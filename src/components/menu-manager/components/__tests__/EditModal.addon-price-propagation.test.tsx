// @vitest-environment jsdom
/**
 * Regression tests — addon price propagation to dish associations.
 *
 * Bug: when an addon is created in the setup guide (or added to a dish from the
 * Dishes tab), the association's price_override was set from `item.price` (the
 * original prop, which starts at 0 for a newly created addon) rather than the
 * local `price` state (which holds the user-entered value, e.g. $2.50).
 *
 * Result: the addon showed $0.00 on the food item's edit modal and in the
 * menu-builder drag-and-drop zone even when the addon had a real price.
 *
 * Fix: handleAddToDish and handleAddToMultipleDishes now use `price ?? item.price ?? 0`.
 *
 * These tests cover all three code paths that create associations:
 *   1. handleAddToDish       — "+" button on a single dish in the Dishes tab
 *   2. handleAddToMultipleDishes — "Add Selected" button (bulk)
 *   3. preselectedDishIds save  — setup guide path: preselected dish flushed on save
 *   4. selectedDishIds save     — STR-323 path: checked dishes flushed on save
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import EditModal from '../EditModal';
import { MenuManagerServiceProvider } from '../../context';
import type {
  MenuItemDisplay,
  MenuSummary,
  MenuManagerService,
  AddonEntry,
} from '../../../../types/restaurant';

// ── Module mocks ──────────────────────────────────────────────────────────────

vi.mock('../../../../utils/imageProcessing', () => ({
  processImageForUpload: vi.fn(async (f: File) => f),
}));

vi.mock('../../../../hooks/useIsMobile', () => ({
  useIsMobile: () => false,
}));

// ── Factories ─────────────────────────────────────────────────────────────────

function makeAddonItem(overrides: Partial<MenuItemDisplay> = {}): MenuItemDisplay {
  return {
    id: 'addon-1',
    name: 'Extra Chutney',
    description: null,
    category: null,
    canonical_category: null,
    price: 0.5,
    active: true,
    item_type: 'addon',
    thumbnail_url: null,
    associations: [],
    food_tags: {},
    addons: [],
    sides: [],
    recommendations: [],
    boost_level: null,
    chefs_special: false,
    ...overrides,
  } as MenuItemDisplay;
}

function makeDishItem(id: string, overrides: Partial<MenuItemDisplay> = {}): MenuItemDisplay {
  return {
    id,
    name: `Dish ${id}`,
    description: 'A tasty dish',
    category: 'Entrees',
    canonical_category: 'Entrees',
    price: 18,
    active: true,
    item_type: 'dish',
    thumbnail_url: null,
    associations: [],
    food_tags: {},
    addons: [],
    sides: [],
    recommendations: [],
    boost_level: null,
    chefs_special: false,
    menu_associations: [],
    ...overrides,
  } as MenuItemDisplay;
}

const MOCK_PERF = { carousel_views: 0, conversions: 0, card_flips: 0, conversion_rate: 0 };

function makeService(overrides: Partial<MenuManagerService> = {}): MenuManagerService {
  const savedAddon = makeAddonItem();
  return {
    getAllMenuItems: vi.fn().mockResolvedValue([]),
    getMenus: vi.fn().mockResolvedValue([]),
    addMenuItem: vi.fn().mockResolvedValue(savedAddon),
    updateMenuItem: vi.fn().mockResolvedValue(savedAddon),
    deleteMenuItem: vi.fn().mockResolvedValue(undefined),
    toggleMenuItemActive: vi.fn().mockResolvedValue(undefined),
    createMenu: vi.fn().mockResolvedValue({ id: 'm1', name: 'Menu', items: [] }),
    updateMenu: vi.fn().mockResolvedValue({ id: 'm1', name: 'Menu', items: [] }),
    deleteMenu: vi.fn().mockResolvedValue(undefined),
    addItemToMenu: vi.fn().mockResolvedValue([]),
    removeItemFromMenu: vi.fn().mockResolvedValue([]),
    updateMenuItemInMenu: vi.fn().mockResolvedValue([]),
    updateItemModifiers: vi.fn().mockResolvedValue(undefined),
    approveAddonSuggestion: vi.fn().mockResolvedValue(undefined),
    getAddonItems: vi.fn().mockResolvedValue([]),
    bulkAssignModifiers: vi.fn().mockResolvedValue({ created: 0, skipped: 0, total: 0 }),
    getMenuItemImageUploadUrl: vi.fn().mockResolvedValue({ upload_url: 'https://s3.example.com/upload', s3_key: 'key1' }),
    confirmMenuItemImageUpload: vi.fn().mockResolvedValue({ thumbnail_url: 'https://cdn.example.com/img.jpg' }),
    enhanceMenuItemImage: vi.fn().mockResolvedValue({ thumbnail_url: 'https://cdn.example.com/enhanced.jpg' }),
    generateMenuItemImage: vi.fn().mockResolvedValue({ thumbnail_url: 'https://cdn.example.com/gen.jpg' }),
    removeMenuItemImage: vi.fn().mockResolvedValue(undefined),
    getMenuItemPerformance: vi.fn().mockResolvedValue(MOCK_PERF),
    ...overrides,
  } as unknown as MenuManagerService;
}

// ── Render helper ─────────────────────────────────────────────────────────────

interface RenderConfig {
  item?: MenuItemDisplay;
  allItems?: MenuItemDisplay[];
  menus?: MenuSummary[];
  isNewItem?: boolean;
  forceAddon?: boolean;
  preselectedDishIds?: string[];
  service?: MenuManagerService;
  onComplete?: (updated: MenuItemDisplay & { _deleted?: boolean }) => void;
}

function renderAddonModal(config: RenderConfig = {}) {
  const {
    item = makeAddonItem(),
    allItems = [],
    menus = [],
    isNewItem = false,
    forceAddon = false,
    preselectedDishIds,
    service = makeService(),
    onComplete = vi.fn(),
  } = config;

  render(
    <MenuManagerServiceProvider value={service}>
      <EditModal
        item={item}
        restaurantId="rest-1"
        allItems={allItems}
        menus={menus}
        isNewItem={isNewItem}
        forceAddon={forceAddon}
        preselectedDishIds={preselectedDishIds}
        onClose={vi.fn()}
        onComplete={onComplete}
      />
    </MenuManagerServiceProvider>,
  );

  return { service, onComplete };
}

// ── 1. handleAddToDish ────────────────────────────────────────────────────────

describe('EditModal — handleAddToDish price_override', () => {
  it('uses the current form price (not item.price) when adding to a single dish', async () => {
    const user = userEvent.setup();
    const dish = makeDishItem('dish-1');
    const service = makeService();

    // Item starts with price 0 — simulates a newly created addon where the user
    // enters a price in the form before clicking "Add to Dish"
    renderAddonModal({
      item: makeAddonItem({ price: 0 }),
      allItems: [dish],
      service,
    });

    // Set price to $2.50 in the basic-info panel (always visible, not tab-gated)
    const priceInput = screen.getByTestId('edit-price-input') as HTMLInputElement;
    fireEvent.change(priceInput, { target: { value: '2.50' } });

    // Navigate to Dishes tab to access "Add" button
    await user.click(screen.getByTestId('tab-dishes'));

    // Click the "+" button for dish-1
    await user.click(screen.getByTestId('add-to-dish-dish-1'));

    await waitFor(() => {
      expect(service.updateItemModifiers).toHaveBeenCalledWith(
        'dish-1',
        expect.objectContaining({
          addons: expect.arrayContaining([
            expect.objectContaining({
              menu_item_id: 'addon-1',
              price_override: 2.5,
            }),
          ]),
        }),
      );
    });
  });

  it('uses the unchanged item.price when the form price field is not modified', async () => {
    const user = userEvent.setup();
    const dish = makeDishItem('dish-1');
    const service = makeService();

    renderAddonModal({
      item: makeAddonItem({ price: 3.5 }),
      allItems: [dish],
      service,
    });

    // Navigate to Dishes tab without touching the price field
    await user.click(screen.getByTestId('tab-dishes'));
    await user.click(screen.getByTestId('add-to-dish-dish-1'));

    await waitFor(() => {
      expect(service.updateItemModifiers).toHaveBeenCalledWith(
        'dish-1',
        expect.objectContaining({
          addons: expect.arrayContaining([
            expect.objectContaining({ menu_item_id: 'addon-1', price_override: 3.5 }),
          ]),
        }),
      );
    });
  });

  it('uses price_override: 0 when addon base price is zero and form is not changed', async () => {
    const user = userEvent.setup();
    const dish = makeDishItem('dish-1');
    const service = makeService();

    renderAddonModal({
      item: makeAddonItem({ price: 0 }),
      allItems: [dish],
      service,
    });

    await user.click(screen.getByTestId('tab-dishes'));
    await user.click(screen.getByTestId('add-to-dish-dish-1'));

    await waitFor(() => {
      expect(service.updateItemModifiers).toHaveBeenCalledWith(
        'dish-1',
        expect.objectContaining({
          addons: expect.arrayContaining([
            expect.objectContaining({ menu_item_id: 'addon-1', price_override: 0 }),
          ]),
        }),
      );
    });
  });
});

// ── 2. handleAddToMultipleDishes (Add Selected) ───────────────────────────────

describe('EditModal — handleAddToMultipleDishes price_override', () => {
  it('uses the current form price when bulk-adding to multiple dishes via "Add Selected"', async () => {
    const user = userEvent.setup();
    const dish1 = makeDishItem('dish-1');
    const dish2 = makeDishItem('dish-2');
    const service = makeService();

    renderAddonModal({
      item: makeAddonItem({ price: 0 }),
      allItems: [dish1, dish2],
      service,
    });

    // Set price to $1.75
    const priceInput = screen.getByTestId('edit-price-input') as HTMLInputElement;
    fireEvent.change(priceInput, { target: { value: '1.75' } });

    await user.click(screen.getByTestId('tab-dishes'));

    // Select dish-1 via checkbox
    await user.click(screen.getByTestId('select-dish-dish-1'));

    // Click "Add Selected"
    await user.click(screen.getByTestId('add-selected-dishes'));

    await waitFor(() => {
      expect(service.updateItemModifiers).toHaveBeenCalledWith(
        'dish-1',
        expect.objectContaining({
          addons: expect.arrayContaining([
            expect.objectContaining({
              menu_item_id: 'addon-1',
              price_override: 1.75,
            }),
          ]),
        }),
      );
    });
  });

  it('propagates the same form price to all selected dishes', async () => {
    const user = userEvent.setup();
    const dish1 = makeDishItem('dish-1');
    const dish2 = makeDishItem('dish-2');
    const service = makeService();

    renderAddonModal({
      item: makeAddonItem({ price: 0 }),
      allItems: [dish1, dish2],
      service,
    });

    const priceInput = screen.getByTestId('edit-price-input') as HTMLInputElement;
    fireEvent.change(priceInput, { target: { value: '4.00' } });

    await user.click(screen.getByTestId('tab-dishes'));

    // Select both dishes
    await user.click(screen.getByTestId('select-dish-dish-1'));
    await user.click(screen.getByTestId('select-dish-dish-2'));
    await user.click(screen.getByTestId('add-selected-dishes'));

    await waitFor(() => {
      expect(service.updateItemModifiers).toHaveBeenCalledTimes(2);
    });

    const calls = (service.updateItemModifiers as ReturnType<typeof vi.fn>).mock.calls;
    const allPrices = calls.map(
      ([, payload]: [string, { addons: AddonEntry[] }]) => payload.addons[0].price_override,
    );
    expect(allPrices).toEqual([4, 4]);
  });
});

// ── 3. preselectedDishIds save path (setup guide regression) ─────────────────

describe('EditModal — preselectedDishIds price_override on save (setup guide regression)', () => {
  it('REGRESSION: saves the form price (not item.price=0) when a preselected dish is flushed on save', async () => {
    /**
     * Exact scenario that was broken:
     *   1. Setup guide creates an addon item with price: 0
     *   2. Owner edits the modal, enters $2.50 (price state = 2.50)
     *   3. On save, handleAddToMultipleDishes is called for the preselected dish
     *   4. BUG: price_override was set to item.price (0) instead of price state (2.50)
     *   5. FIX: price_override is now set to `price ?? item.price ?? 0` = 2.50
     *
     * Note: we use isNewItem=false so the name field is pre-populated and passes
     * validation. The preselectedDishIds save path is identical regardless of isNewItem.
     */
    const user = userEvent.setup();
    const dish = makeDishItem('dish-1');
    // dish does NOT have this addon assigned yet (simulates fresh setup guide flow)
    const addonItem = makeAddonItem({ id: 'addon-1', price: 0 });
    const savedAddon = makeAddonItem({ id: 'addon-1', price: 2.5 });
    const service = makeService({
      updateMenuItem: vi.fn().mockResolvedValue(savedAddon),
      updateItemModifiers: vi.fn().mockResolvedValue(undefined),
    });

    renderAddonModal({
      item: addonItem,
      allItems: [dish],
      preselectedDishIds: ['dish-1'],
      service,
    });

    // User types the price they want ($2.50)
    const priceInput = screen.getByTestId('edit-price-input') as HTMLInputElement;
    fireEvent.change(priceInput, { target: { value: '2.50' } });

    // Save — this triggers updateMenuItem then handleAddToMultipleDishes for 'dish-1'
    await user.click(screen.getByTestId('edit-save-btn'));

    await waitFor(() => {
      expect(service.updateItemModifiers).toHaveBeenCalledWith(
        'dish-1',
        expect.objectContaining({
          addons: expect.arrayContaining([
            expect.objectContaining({
              menu_item_id: 'addon-1',
              // Must be 2.5 (form price), NOT 0 (stale item.price prop)
              price_override: 2.5,
            }),
          ]),
        }),
      );
    });
  });

  it('skips updateItemModifiers for a preselected dish already carrying this addon', async () => {
    /**
     * If the dish already has the addon associated (reopening the modal), the
     * unsaved filter excludes it — no duplicate updateItemModifiers call.
     */
    const user = userEvent.setup();
    const addonItem = makeAddonItem({ id: 'addon-1', price: 2.5 });
    const savedAddon = makeAddonItem({ id: 'addon-1', price: 2.5 });

    // dish-1 already has this addon assigned
    const existingEntry: AddonEntry = {
      id: 'assoc-1',
      menu_item_id: 'addon-1',
      name: 'Extra Chutney',
      price_override: 2.5,
      thumbnail_url: null,
      status: 'approved',
      suggestion_source: 'manual',
    };
    const dish = makeDishItem('dish-1', { addons: [existingEntry] });

    const service = makeService({
      updateMenuItem: vi.fn().mockResolvedValue(savedAddon),
      updateItemModifiers: vi.fn().mockResolvedValue(undefined),
    });

    renderAddonModal({
      item: addonItem,
      allItems: [dish],
      preselectedDishIds: ['dish-1'],
      service,
    });

    await user.click(screen.getByTestId('edit-save-btn'));

    // updateMenuItem must be called (saves the addon item itself)
    await waitFor(() => {
      expect(service.updateMenuItem).toHaveBeenCalled();
    });

    // updateItemModifiers must NOT be called for the association (already exists)
    expect(service.updateItemModifiers).not.toHaveBeenCalled();
  });
});

// ── 4. selectedDishIds flushed on save (STR-323 path) ────────────────────────

describe('EditModal — selectedDishIds flushed on save use current price', () => {
  it('uses form price when dish selections are flushed on save (STR-323)', async () => {
    /**
     * STR-323: if the user ticks dish checkboxes and clicks "Save Changes" directly
     * (without first clicking "Add Selected"), the pending selections are flushed
     * in the save handler via handleAddToMultipleDishes. Those associations must
     * also use the form's current price state, not the stale item.price prop.
     */
    const user = userEvent.setup();
    const dish = makeDishItem('dish-1');
    const addonItem = makeAddonItem({ price: 0 });
    const savedAddon = makeAddonItem({ price: 3 });
    const service = makeService({
      updateMenuItem: vi.fn().mockResolvedValue(savedAddon),
      updateItemModifiers: vi.fn().mockResolvedValue(undefined),
    });

    renderAddonModal({
      item: addonItem,
      allItems: [dish],
      service,
    });

    // Change price first
    const priceInput = screen.getByTestId('edit-price-input') as HTMLInputElement;
    fireEvent.change(priceInput, { target: { value: '3.00' } });

    // Navigate to Dishes tab and select a dish — but do NOT click "Add Selected"
    await user.click(screen.getByTestId('tab-dishes'));
    await user.click(screen.getByTestId('select-dish-dish-1'));

    // Save directly — selectedDishIds flush happens inside the save handler
    await user.click(screen.getByTestId('edit-save-btn'));

    await waitFor(() => {
      expect(service.updateItemModifiers).toHaveBeenCalledWith(
        'dish-1',
        expect.objectContaining({
          addons: expect.arrayContaining([
            expect.objectContaining({
              menu_item_id: 'addon-1',
              price_override: 3,
            }),
          ]),
        }),
      );
    });
  });
});
