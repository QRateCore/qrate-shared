// @vitest-environment jsdom
/**
 * Unit tests for BulkModifierPanel.
 *
 * Covers:
 *  - Renders: addon preview chips, dish list, search input, select-all button
 *  - Error: "Select at least one dish" when apply clicked with no selection
 *  - Dish selection: clicking a dish row toggles its selected state
 *  - Select all: toggles all dishes; untoggling from all deselects
 *  - Search: filtering by name hides non-matching dishes
 *  - Apply: calls bulkAssignModifiers with correct payload
 *  - Apply: onComplete called with optimistically-updated dish items
 *  - Apply: skipped result shows info in error area, still calls onComplete
 *  - Apply: API error shows error message
 *  - Cancel/backdrop: onClose called from both close button and backdrop
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import BulkModifierPanel, {
  groupDishesByCategory,
  calcDiff,
  formatSelfAssocMessage,
} from '../BulkModifierPanel';
import { MenuManagerServiceProvider } from '../../context';
import type { MenuItemDisplay, MenuManagerService } from '../../../../types/restaurant';

// ── Factories ─────────────────────────────────────────────────────────────────

function makeAddon(id: string, name: string, price = 2): MenuItemDisplay {
  return {
    id,
    name,
    description: null,
    category: null,
    canonical_category: null,
    price,
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
  } as MenuItemDisplay;
}

function makeDish(id: string, name: string): MenuItemDisplay {
  return {
    id,
    name,
    description: 'A dish',
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
  } as MenuItemDisplay;
}

function makeService(overrides: Partial<MenuManagerService> = {}): MenuManagerService {
  return {
    // STR-415: default to []; renderPanel patches this to resolve with dishItems
    // so the panel's race-safe refetch settles isRefetching AND keeps the seed.
    getAllMenuItems: vi.fn().mockResolvedValue([]),
    getMenus: vi.fn().mockResolvedValue([]),
    addMenuItem: vi.fn().mockResolvedValue(makeAddon('a1', 'Extra Sauce')),
    updateMenuItem: vi.fn().mockResolvedValue(makeAddon('a1', 'Extra Sauce')),
    deleteMenuItem: vi.fn().mockResolvedValue(undefined),
    toggleMenuItemActive: vi.fn().mockResolvedValue(undefined),
    createMenu: vi.fn().mockResolvedValue({}),
    updateMenu: vi.fn().mockResolvedValue({}),
    deleteMenu: vi.fn().mockResolvedValue(undefined),
    addItemToMenu: vi.fn().mockResolvedValue([]),
    removeItemFromMenu: vi.fn().mockResolvedValue([]),
    updateMenuItemInMenu: vi.fn().mockResolvedValue([]),
    updateItemModifiers: vi.fn().mockResolvedValue(undefined),
    approveAddonSuggestion: vi.fn().mockResolvedValue(undefined),
    getAddonItems: vi.fn().mockResolvedValue([]),
    bulkAssignModifiers: vi.fn().mockResolvedValue({ created: 2, skipped: 0, total: 2 }),
    getMenuItemImageUploadUrl: vi.fn().mockResolvedValue({ upload_url: 'https://s3.example.com', s3_key: 'k' }),
    confirmMenuItemImageUpload: vi.fn().mockResolvedValue({ thumbnail_url: 'https://cdn.example.com/img.jpg' }),
    enhanceMenuItemImage: vi.fn().mockResolvedValue({ thumbnail_url: 'https://cdn.example.com/enhanced.jpg' }),
    generateMenuItemImage: vi.fn().mockResolvedValue({ thumbnail_url: 'https://cdn.example.com/gen.jpg' }),
    removeMenuItemImage: vi.fn().mockResolvedValue(undefined),
    getMenuItemPerformance: vi.fn().mockResolvedValue({ carousel_views: 0, conversions: 0, card_flips: 0, conversion_rate: 0 }),
    ...overrides,
  } as unknown as MenuManagerService;
}

interface RenderConfig {
  selectedAddons?: MenuItemDisplay[];
  dishItems?: MenuItemDisplay[];
  service?: MenuManagerService;
  onClose?: () => void;
  onComplete?: (items: MenuItemDisplay[]) => void;
}

function renderPanel(config: RenderConfig = {}) {
  const {
    selectedAddons = [makeAddon('addon-1', 'Extra Sauce')],
    dishItems = [makeDish('dish-1', 'Pasta'), makeDish('dish-2', 'Risotto')],
    service = makeService(),
    onClose = vi.fn(),
    onComplete = vi.fn(),
  } = config;

  // STR-415: ensure the panel's race-safe refetch resolves with the same dishItems
  // the test passed as a prop — keeps the seed AND settles isRefetching.
  // Tests that need a different refetch return value can override before render.
  (service.getAllMenuItems as ReturnType<typeof vi.fn>).mockResolvedValue(dishItems);

  render(
    <MenuManagerServiceProvider value={service}>
      <BulkModifierPanel
        restaurantId="rest-1"
        selectedAddons={selectedAddons}
        dishItems={dishItems}
        onClose={onClose}
        onComplete={onComplete}
      />
    </MenuManagerServiceProvider>,
  );

  return { service, onClose, onComplete };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('BulkModifierPanel — rendering', () => {
  it('shows the panel and backdrop', () => {
    renderPanel();
    expect(screen.getByTestId('bulk-modifier-panel')).toBeInTheDocument();
    expect(screen.getByTestId('bulk-modifier-panel-backdrop')).toBeInTheDocument();
  });

  it('renders addon preview chips for selected addons', () => {
    renderPanel({
      selectedAddons: [makeAddon('a1', 'Extra Sauce'), makeAddon('a2', 'Bacon')],
    });
    expect(screen.getByText('Extra Sauce')).toBeInTheDocument();
    expect(screen.getByText('Bacon')).toBeInTheDocument();
  });

  it('truncates preview to 5 addons and shows "+N more"', () => {
    const addons = ['A', 'B', 'C', 'D', 'E', 'F', 'G'].map((n, i) =>
      makeAddon(`a${i}`, n),
    );
    renderPanel({ selectedAddons: addons });
    expect(screen.getByText('+2 more')).toBeInTheDocument();
  });

  it('renders each dish as a selectable row (after expanding category)', async () => {
    const user = userEvent.setup();
    renderPanel();
    // Categories are collapsed by default per STR-415 — must expand first
    await user.click(screen.getByTestId('bulk-cat-expand-Entrees'));
    expect(screen.getByTestId('bulk-modifier-dish-dish-1')).toBeInTheDocument();
    expect(screen.getByTestId('bulk-modifier-dish-dish-2')).toBeInTheDocument();
  });

  it('renders categories collapsed by default (no dish rows in DOM)', () => {
    renderPanel();
    expect(screen.queryByTestId('bulk-modifier-dish-dish-1')).not.toBeInTheDocument();
    expect(screen.getByTestId('bulk-cat-toggle-Entrees')).toBeInTheDocument();
  });

  it('shows "No dishes available" when dishItems is empty', () => {
    renderPanel({ dishItems: [] });
    expect(screen.getByText('No dishes available')).toBeInTheDocument();
  });

  it('shows "Select dishes first" on apply button when none selected', () => {
    renderPanel();
    expect(screen.getByTestId('bulk-modifier-apply')).toHaveTextContent('Select dishes first');
  });
});

describe('BulkModifierPanel — dish selection', () => {
  it('clicking a dish row selects it and updates apply button text', async () => {
    const user = userEvent.setup();
    renderPanel();
    await user.click(screen.getByTestId('bulk-cat-expand-Entrees'));

    await user.click(screen.getByTestId('bulk-modifier-dish-dish-1'));

    // STR-415: new diff-aware label format
    expect(screen.getByTestId('bulk-modifier-apply')).toHaveTextContent('Apply (+1 / =0)');
  });

  it('clicking the same dish a second time deselects it', async () => {
    const user = userEvent.setup();
    renderPanel();
    await user.click(screen.getByTestId('bulk-cat-expand-Entrees'));

    await user.click(screen.getByTestId('bulk-modifier-dish-dish-1'));
    await user.click(screen.getByTestId('bulk-modifier-dish-dish-1'));

    expect(screen.getByTestId('bulk-modifier-apply')).toHaveTextContent('Select dishes first');
  });

  it('select-all selects every filtered dish (works regardless of expansion)', async () => {
    const user = userEvent.setup();
    renderPanel();

    await user.click(screen.getByTestId('bulk-modifier-select-all'));

    expect(screen.getByTestId('bulk-modifier-apply')).toHaveTextContent('Apply (+2 / =0)');
    expect(screen.getByTestId('bulk-modifier-select-all')).toHaveTextContent('2 dishes selected');
  });

  it('select-all again (all selected) deselects all', async () => {
    const user = userEvent.setup();
    renderPanel();

    await user.click(screen.getByTestId('bulk-modifier-select-all')); // select all
    await user.click(screen.getByTestId('bulk-modifier-select-all')); // deselect all

    expect(screen.getByTestId('bulk-modifier-apply')).toHaveTextContent('Select dishes first');
  });
});

describe('BulkModifierPanel — search filtering', () => {
  it('filters dish list by search term (after expanding category)', async () => {
    const user = userEvent.setup();
    renderPanel({
      dishItems: [makeDish('d1', 'Truffle Pasta'), makeDish('d2', 'Caesar Salad')],
    });

    await user.type(screen.getByTestId('bulk-modifier-dish-search'), 'pasta');
    await user.click(screen.getByTestId('bulk-cat-expand-Entrees'));

    expect(screen.getByTestId('bulk-modifier-dish-d1')).toBeInTheDocument();
    expect(screen.queryByTestId('bulk-modifier-dish-d2')).not.toBeInTheDocument();
  });

  it('shows "No dishes match" when search yields no results', async () => {
    const user = userEvent.setup();
    renderPanel({
      dishItems: [makeDish('d1', 'Truffle Pasta')],
    });

    await user.type(screen.getByTestId('bulk-modifier-dish-search'), 'xyz-no-match');

    expect(screen.getByText('No dishes match')).toBeInTheDocument();
  });
});

describe('BulkModifierPanel — validation', () => {
  it('apply button is disabled when no dish is selected', () => {
    // The button is disabled={selectedDishIds.size === 0}. This prevents
    // any API call. The internal guard ("Select at least one dish") is a
    // safety net for programmatic invocation only.
    renderPanel();

    expect(screen.getByTestId('bulk-modifier-apply')).toBeDisabled();
  });

  it('apply button becomes enabled after selecting a dish', async () => {
    const user = userEvent.setup();
    renderPanel();

    await user.click(screen.getByTestId('bulk-cat-expand-Entrees'));
    await user.click(screen.getByTestId('bulk-modifier-dish-dish-1'));

    expect(screen.getByTestId('bulk-modifier-apply')).not.toBeDisabled();
  });
});

describe('BulkModifierPanel — apply', () => {
  it('calls bulkAssignModifiers with correct addon and dish IDs', async () => {
    const user = userEvent.setup();
    const service = makeService();
    const onComplete = vi.fn();
    renderPanel({
      selectedAddons: [makeAddon('addon-1', 'Extra Sauce')],
      dishItems: [makeDish('dish-1', 'Pasta')],
      service,
      onComplete,
    });

    await user.click(screen.getByTestId('bulk-cat-expand-Entrees'));
    await user.click(screen.getByTestId('bulk-modifier-dish-dish-1'));
    await user.click(screen.getByTestId('bulk-modifier-apply'));

    await waitFor(() => {
      expect(service.bulkAssignModifiers).toHaveBeenCalledWith('rest-1', {
        modifier_type: 'addon',
        modifier_item_ids: ['addon-1'],
        dish_ids: ['dish-1'],
      });
    });
  });

  it('calls onComplete with optimistically-updated dish items', async () => {
    const user = userEvent.setup();
    const service = makeService({
      bulkAssignModifiers: vi.fn().mockResolvedValue({ created: 1, skipped: 0, total: 1 }),
    });
    const onComplete = vi.fn();
    const addonItem = makeAddon('addon-1', 'Extra Sauce', 3);
    const dishItem = makeDish('dish-1', 'Pasta');

    renderPanel({
      selectedAddons: [addonItem],
      dishItems: [dishItem],
      service,
      onComplete,
    });

    await user.click(screen.getByTestId('bulk-cat-expand-Entrees'));
    await user.click(screen.getByTestId('bulk-modifier-dish-dish-1'));
    await user.click(screen.getByTestId('bulk-modifier-apply'));

    await waitFor(() => {
      expect(onComplete).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({
            id: 'dish-1',
            addons: expect.arrayContaining([
              expect.objectContaining({ menu_item_id: 'addon-1', price_override: 3 }),
            ]),
          }),
        ]),
      );
    });
  });

  it('shows skipped info message and KEEPS panel open (does NOT call onComplete) when some were skipped', async () => {
    // Behavior change 2026-04-25: previously the panel called onComplete
    // immediately on partial success, which closed the panel via the parent's
    // setBulkModifiersOpen(false) before the user could see the skipped count.
    // Now the panel stays open with the message and the user dismisses
    // explicitly via Cancel/×. Parent state will pick up new assignments on
    // the next refresh.
    const user = userEvent.setup();
    const service = makeService({
      bulkAssignModifiers: vi.fn().mockResolvedValue({ created: 1, skipped: 1, total: 2 }),
    });
    const onComplete = vi.fn();
    renderPanel({
      dishItems: [makeDish('dish-1', 'Pasta'), makeDish('dish-2', 'Risotto')],
      service,
      onComplete,
    });

    await user.click(screen.getByTestId('bulk-modifier-select-all'));
    await user.click(screen.getByTestId('bulk-modifier-apply'));

    await waitFor(() => {
      expect(screen.getByTestId('bulk-modifier-error')).toHaveTextContent('already existed');
    });
    // Confirm onComplete is NOT called on partial success
    expect(onComplete).not.toHaveBeenCalled();
  });

  it('shows error message on API failure', async () => {
    const user = userEvent.setup();
    const service = makeService({
      bulkAssignModifiers: vi.fn().mockRejectedValue(new Error('Network error')),
    });
    renderPanel({ service });

    await user.click(screen.getByTestId('bulk-cat-expand-Entrees'));
    await user.click(screen.getByTestId('bulk-modifier-dish-dish-1'));
    await user.click(screen.getByTestId('bulk-modifier-apply'));

    await waitFor(() => {
      expect(screen.getByTestId('bulk-modifier-error')).toHaveTextContent('Assignment failed');
    });
  });
});

describe('BulkModifierPanel — close behaviour', () => {
  it('calls onClose when close button clicked', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    renderPanel({ onClose });

    await user.click(screen.getByTestId('bulk-modifier-panel-close'));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('calls onClose when cancel button clicked', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    renderPanel({ onClose });

    await user.click(screen.getByTestId('bulk-modifier-cancel'));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('calls onClose when backdrop clicked', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    renderPanel({ onClose });

    await user.click(screen.getByTestId('bulk-modifier-panel-backdrop'));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

// ── STR-415: bulk addon↔entree many-to-many — new tests ───────────────────────

describe('BulkModifierPanel — STR-415 pure helpers', () => {
  it('groupDishesByCategory groups by category and falls back to "Uncategorised"', () => {
    const d1 = makeDish('d1', 'Pasta');
    d1.category = 'Mains';
    d1.canonical_category = 'Mains';
    const d2 = makeDish('d2', 'Risotto');
    d2.category = 'Mains';
    d2.canonical_category = 'Mains';
    const d3 = makeDish('d3', 'Soup');
    d3.category = null;
    d3.canonical_category = null;
    const d4 = makeDish('d4', 'Salad');
    d4.category = '   ';
    d4.canonical_category = null;

    const groups = groupDishesByCategory([d1, d2, d3, d4]);
    const cats = groups.map((g) => g.category);
    expect(cats).toContain('Mains');
    expect(cats).toContain('Uncategorised');
    expect(groups.find((g) => g.category === 'Mains')!.dishes).toHaveLength(2);
    expect(groups.find((g) => g.category === 'Uncategorised')!.dishes).toHaveLength(2);
  });

  it('groupDishesByCategory prefers canonical_category over owner-typed category', () => {
    // Real Farm + Oak data shape: AI pipeline sets canonical_category, owner
    // often leaves the display `category` field empty. Group by canonical first.
    const d1 = makeDish('d1', 'Pasta');
    d1.category = '';
    d1.canonical_category = 'Entrees';
    const d2 = makeDish('d2', 'Salad');
    d2.category = '';
    d2.canonical_category = 'Appetizers';
    const d3 = makeDish('d3', 'Tiramisu');
    d3.category = 'Sweet things'; // owner-typed
    d3.canonical_category = 'Desserts'; // canonical wins

    const groups = groupDishesByCategory([d1, d2, d3]);
    const cats = groups.map((g) => g.category);
    expect(cats).toEqual(expect.arrayContaining(['Entrees', 'Appetizers', 'Desserts']));
    expect(cats).not.toContain('Sweet things');
    expect(cats).not.toContain('Uncategorised');
  });

  it('calcDiff partitions to-create vs already-existing addons', () => {
    const dish1 = makeDish('d1', 'Pasta');
    dish1.addons = [
      { menu_item_id: 'a1', name: 'Sauce', price_override: 1, thumbnail_url: null, status: 'approved', suggestion_source: 'manual' },
    ];
    const dish2 = makeDish('d2', 'Risotto');
    dish2.addons = [];

    expect(calcDiff([dish1, dish2], ['a1', 'a2'])).toEqual({ create: 3, existing: 1 });
    expect(calcDiff([], ['a1'])).toEqual({ create: 0, existing: 0 });
    expect(calcDiff([dish1], [])).toEqual({ create: 0, existing: 0 });
  });

  it('formatSelfAssocMessage handles singular/plural', () => {
    expect(formatSelfAssocMessage(1)).toBe('1 addon excluded — addons can only be attached to dishes');
    expect(formatSelfAssocMessage(3)).toBe('3 addons excluded — addons can only be attached to dishes');
  });
});

describe('BulkModifierPanel — STR-415 forward direction (legacy preserved)', () => {
  it('all-addons input → forward direction; addon preview shown', () => {
    renderPanel({
      selectedAddons: [makeAddon('a1', 'Extra Sauce')],
      dishItems: [makeDish('d1', 'Pasta')],
    });
    expect(screen.getByTestId('bulk-modifier-panel')).toHaveAttribute('data-direction', 'forward');
    expect(screen.queryByTestId('bulk-modifier-self-assoc-notice')).not.toBeInTheDocument();
    expect(screen.queryByTestId('bulk-modifier-addon-picker')).not.toBeInTheDocument();
  });
});

describe('BulkModifierPanel — STR-415 reverse direction', () => {
  it('mixed-input (entree + addon) → reverse direction; entrees pre-selected; addon picker shown', () => {
    const entree = makeDish('e1', 'Salmon');
    const addon = makeAddon('a1', 'Extra Sauce');
    renderPanel({
      selectedAddons: [entree, addon], // mixed input via prop name
      dishItems: [entree, addon, makeAddon('a2', 'Bacon')],
    });

    const panel = screen.getByTestId('bulk-modifier-panel');
    expect(panel).toHaveAttribute('data-direction', 'reverse');
    // Pre-selected entree visible (category auto-expanded)
    expect(screen.getByTestId('bulk-modifier-dish-e1')).toBeInTheDocument();
    expect(screen.getByTestId('bulk-modifier-addon-picker')).toBeInTheDocument();
    expect(screen.getByTestId('bulk-modifier-self-assoc-notice')).toHaveTextContent(
      '1 addon excluded',
    );
  });

  it('all-entrees input → reverse direction; NO self-assoc notice', () => {
    const entree = makeDish('e1', 'Salmon');
    renderPanel({
      selectedAddons: [entree],
      dishItems: [entree, makeAddon('a1', 'Sauce')],
    });
    expect(screen.getByTestId('bulk-modifier-panel')).toHaveAttribute('data-direction', 'reverse');
    expect(screen.queryByTestId('bulk-modifier-self-assoc-notice')).not.toBeInTheDocument();
  });

  it('reverse: hide Delete tab', () => {
    const entree = makeDish('e1', 'Salmon');
    renderPanel({
      selectedAddons: [entree],
      dishItems: [entree, makeAddon('a1', 'Sauce')],
    });
    expect(screen.queryByTestId('bulk-modifier-tab-delete')).not.toBeInTheDocument();
    expect(screen.getByTestId('bulk-modifier-tab-assign')).toBeInTheDocument();
    expect(screen.getByTestId('bulk-modifier-tab-remove')).toBeInTheDocument();
  });

  it('reverse: Apply calls bulkAssignModifiers with user-picked addon and pre-selected entree', async () => {
    const user = userEvent.setup();
    const service = makeService();
    const entree = makeDish('e1', 'Salmon');
    const addon = makeAddon('a1', 'Sauce');

    renderPanel({
      selectedAddons: [entree],
      dishItems: [entree, addon],
      service,
    });

    await user.click(screen.getByTestId('bulk-modifier-addon-a1'));
    await user.click(screen.getByTestId('bulk-modifier-apply'));

    await waitFor(() => {
      expect(service.bulkAssignModifiers).toHaveBeenCalledWith('rest-1', {
        modifier_type: 'addon',
        modifier_item_ids: ['a1'],
        dish_ids: ['e1'],
      });
    });
  });
});

describe('BulkModifierPanel — STR-415 category grouping', () => {
  it('renders category header with tri-state checkbox; click header toggles all', async () => {
    const user = userEvent.setup();
    const d1 = makeDish('d1', 'Pasta');
    d1.canonical_category = 'Mains'; // group key (canonical takes precedence)
    const d2 = makeDish('d2', 'Risotto');
    d2.canonical_category = 'Mains';
    renderPanel({
      selectedAddons: [makeAddon('a1', 'Sauce')],
      dishItems: [d1, d2],
    });

    const toggle = screen.getByTestId('bulk-cat-toggle-Mains');
    expect(toggle).toHaveAttribute('aria-checked', 'false');

    await user.click(toggle);
    expect(toggle).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByTestId('bulk-modifier-apply')).toHaveTextContent('Apply (+2 / =0)');

    await user.click(toggle);
    expect(toggle).toHaveAttribute('aria-checked', 'false');
  });

  it('partial category selection → aria-checked="mixed"', async () => {
    const user = userEvent.setup();
    const d1 = makeDish('d1', 'Pasta');
    d1.canonical_category = 'Mains';
    const d2 = makeDish('d2', 'Risotto');
    d2.canonical_category = 'Mains';
    renderPanel({
      selectedAddons: [makeAddon('a1', 'Sauce')],
      dishItems: [d1, d2],
    });

    await user.click(screen.getByTestId('bulk-cat-expand-Mains'));
    await user.click(screen.getByTestId('bulk-modifier-dish-d1'));
    expect(screen.getByTestId('bulk-cat-toggle-Mains')).toHaveAttribute('aria-checked', 'mixed');
  });

  it('chevron click toggles expansion only (no selection change)', async () => {
    const user = userEvent.setup();
    renderPanel(); // default Entrees category, collapsed

    expect(screen.queryByTestId('bulk-modifier-dish-dish-1')).not.toBeInTheDocument();
    await user.click(screen.getByTestId('bulk-cat-expand-Entrees'));
    expect(screen.getByTestId('bulk-modifier-dish-dish-1')).toBeInTheDocument();
    // Selection still empty
    expect(screen.getByTestId('bulk-cat-toggle-Entrees')).toHaveAttribute('aria-checked', 'false');
  });

  it('per-category counter renders +N / =M when category has selection', async () => {
    const user = userEvent.setup();
    renderPanel();
    await user.click(screen.getByTestId('bulk-cat-toggle-Entrees')); // select all in Entrees
    expect(screen.getByTestId('bulk-modifier-cat-counter-Entrees')).toHaveTextContent('+2 / =0');
  });
});

describe('BulkModifierPanel — STR-415 diff preview', () => {
  it('Apply button label shows Apply (+N / =M) and bulk-modifier-diff-total testid present', async () => {
    const user = userEvent.setup();
    renderPanel();
    await user.click(screen.getByTestId('bulk-modifier-select-all'));
    expect(screen.getByTestId('bulk-modifier-diff-total')).toHaveTextContent('Apply (+2 / =0)');
  });

  it('predicted diff matches mock service result (deterministic)', async () => {
    const user = userEvent.setup();
    const service = makeService({
      bulkAssignModifiers: vi.fn().mockResolvedValue({ created: 1, skipped: 1, total: 2 }),
    });
    const dishWithExisting = makeDish('d1', 'Pasta');
    dishWithExisting.addons = [
      {
        menu_item_id: 'a1',
        name: 'Sauce',
        price_override: 1,
        thumbnail_url: null,
        status: 'approved',
        suggestion_source: 'manual',
      },
    ];
    const dishFresh = makeDish('d2', 'Risotto');

    renderPanel({
      selectedAddons: [makeAddon('a1', 'Sauce')],
      dishItems: [dishWithExisting, dishFresh],
      service,
    });

    await user.click(screen.getByTestId('bulk-modifier-select-all'));
    // Predicted: dish-d2 = +1 (new), dish-d1 = =1 (existing)
    expect(screen.getByTestId('bulk-modifier-diff-total')).toHaveTextContent('Apply (+1 / =1)');
  });
});

describe('BulkModifierPanel — STR-415 refetch race-safety', () => {
  it('calls service.getAllMenuItems on mount with restaurantId', async () => {
    const service = makeService();
    renderPanel({ service });
    await waitFor(() => {
      expect(service.getAllMenuItems).toHaveBeenCalledWith('rest-1');
    });
  });

  it('does not throw if component unmounts before refetch resolves', async () => {
    let resolveRefetch: (value: MenuItemDisplay[]) => void;
    const refetchPromise = new Promise<MenuItemDisplay[]>((res) => {
      resolveRefetch = res;
    });
    const service = makeService({
      getAllMenuItems: vi.fn().mockReturnValue(refetchPromise),
    });
    const { unmount } = render(
      <MenuManagerServiceProvider value={service}>
        <BulkModifierPanel
          restaurantId="rest-1"
          selectedAddons={[makeAddon('a1', 'Sauce')]}
          dishItems={[makeDish('d1', 'Pasta')]}
          onClose={vi.fn()}
          onComplete={vi.fn()}
        />
      </MenuManagerServiceProvider>,
    );

    unmount();
    // resolve AFTER unmount — should not throw
    resolveRefetch!([makeDish('d2', 'Late')]);
    await refetchPromise;
    // No assertion needed — absence of "setState on unmounted component" warning is the test
  });
});

