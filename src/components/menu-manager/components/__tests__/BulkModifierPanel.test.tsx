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
import BulkModifierPanel from '../BulkModifierPanel';
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

  it('renders each dish as a selectable row', () => {
    renderPanel();
    expect(screen.getByTestId('bulk-modifier-dish-dish-1')).toBeInTheDocument();
    expect(screen.getByTestId('bulk-modifier-dish-dish-2')).toBeInTheDocument();
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

    await user.click(screen.getByTestId('bulk-modifier-dish-dish-1'));

    expect(screen.getByTestId('bulk-modifier-apply')).toHaveTextContent('Assign to 1 dish');
  });

  it('clicking the same dish a second time deselects it', async () => {
    const user = userEvent.setup();
    renderPanel();

    await user.click(screen.getByTestId('bulk-modifier-dish-dish-1'));
    await user.click(screen.getByTestId('bulk-modifier-dish-dish-1'));

    expect(screen.getByTestId('bulk-modifier-apply')).toHaveTextContent('Select dishes first');
  });

  it('select-all selects every visible dish', async () => {
    const user = userEvent.setup();
    renderPanel();

    await user.click(screen.getByTestId('bulk-modifier-select-all'));

    expect(screen.getByTestId('bulk-modifier-apply')).toHaveTextContent('Assign to 2 dishes');
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
  it('filters dish list by search term', async () => {
    const user = userEvent.setup();
    renderPanel({
      dishItems: [makeDish('d1', 'Truffle Pasta'), makeDish('d2', 'Caesar Salad')],
    });

    await user.type(screen.getByTestId('bulk-modifier-dish-search'), 'pasta');

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
