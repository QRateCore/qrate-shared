// @vitest-environment jsdom
/**
 * Unit tests for BulkActionsPanel.
 *
 * Covers:
 *  - Render: item count display, all 6 mode tabs, item preview chips
 *  - Mode switching: tab click changes active form
 *  - Close: backdrop + close button call onClose
 *  - Assign mode: validation, service call per item×menu, onComplete payload
 *  - Remove mode: validation, skips items not in target menu
 *  - Boost mode: validation (no menus assigned), BoostLabel → integer string conversion
 *  - Special mode: chefs_special boolean forwarding
 *  - Availability mode: toggleMenuItemActive call
 *  - Delete mode: two-confirm gate, actual delete on second click
 *  - Execution framework: progress bar visibility, error on partial failure
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import BulkActionsPanel from '../BulkActionsPanel';
import { MenuManagerServiceProvider } from '../../context';
import type {
  MenuItemDisplay,
  MenuSummary,
  MenuAssociation,
  MenuManagerService,
} from '../../../../types/restaurant';

// ── Local BulkMode replica (avoids importing the 4000-line MenuManagerClient) ─
type BulkMode = 'assign' | 'remove' | 'removeFromMenu' | 'boost' | 'special' | 'availability' | 'delete' | 'spice' | 'dietary';

// ── Factories ─────────────────────────────────────────────────────────────────

function makeAssoc(menuId: string): MenuAssociation {
  return {
    menu_id: menuId,
    category_name: 'Entrees',
    price: null,
    boost_level: null,
    chefs_special: false,
    portion_type: 'single',
    portion_serves: null,
    canonical_categories: ['Entrees'],
    category_prices: {},
    category_boost_levels: {},
    category_chefs_specials: {},
    category_portions: {},
  } as MenuAssociation;
}

function makeItem(
  id: string,
  name: string,
  menuIds: string[] = [],
  price = 10,
): MenuItemDisplay {
  return {
    id,
    name,
    description: null,
    price,
    food_tags: {},
    thumbnail_url: null,
    active: true,
    item_type: 'dish',
    category: 'Entrees',
    menu_associations: menuIds.map(makeAssoc),
  } as MenuItemDisplay;
}

function makeMenu(id: string, name: string): MenuSummary {
  return { id, name, slug: id, active: true, item_count: 2 } as MenuSummary;
}

function makeService(
  overrides: Partial<MenuManagerService> = {},
): MenuManagerService {
  return {
    getAllMenuItems: vi.fn(),
    getMenus: vi.fn(),
    addMenuItem: vi.fn(),
    updateMenuItem: vi.fn(),
    deleteMenuItem: vi.fn().mockResolvedValue(undefined),
    toggleMenuItemActive: vi.fn().mockResolvedValue(undefined),
    createMenu: vi.fn(),
    updateMenu: vi.fn(),
    deleteMenu: vi.fn(),
    addItemToMenu: vi.fn().mockResolvedValue([makeAssoc('menu-1')]),
    removeItemFromMenu: vi.fn().mockResolvedValue([]),
    updateMenuItemInMenu: vi.fn().mockResolvedValue([makeAssoc('menu-1')]),
    updateItemModifiers: vi.fn(),
    approveAddonSuggestion: vi.fn(),
    getAddonItems: vi.fn(),
    bulkAssignModifiers: vi.fn(),
    getMenuItemImageUploadUrl: vi.fn(),
    confirmMenuItemImageUpload: vi.fn(),
    enhanceMenuItemImage: vi.fn(),
    generateMenuItemImage: vi.fn(),
    removeMenuItemImage: vi.fn(),
    ...overrides,
  };
}

// ── Render helper ─────────────────────────────────────────────────────────────

interface PanelConfig {
  selected: Set<string>;
  items: MenuItemDisplay[];
  menus: MenuSummary[];
  initialMode?: BulkMode;
  currentMenuId?: string;
  currentMenuName?: string;
  onClose?: ReturnType<typeof vi.fn>;
  onComplete?: ReturnType<typeof vi.fn>;
}

function renderPanel(config: PanelConfig, service: MenuManagerService) {
  const onClose = config.onClose ?? vi.fn();
  const onComplete = config.onComplete ?? vi.fn();
  render(
    <MenuManagerServiceProvider value={service}>
      <BulkActionsPanel
        selected={config.selected}
        items={config.items}
        menus={config.menus}
        initialMode={config.initialMode ?? 'assign'}
        currentMenuId={config.currentMenuId}
        currentMenuName={config.currentMenuName}
        onClose={onClose}
        onComplete={onComplete}
      />
    </MenuManagerServiceProvider>,
  );
  return { onClose, onComplete };
}

// ── Test data ─────────────────────────────────────────────────────────────────

const MENU_A = makeMenu('menu-a', 'All Day Menu');
const MENU_B = makeMenu('menu-b', 'Lunch Menu');
const ITEM_1 = makeItem('item-1', 'Grilled Chicken', ['menu-a']);
const ITEM_2 = makeItem('item-2', 'Caesar Salad', ['menu-a', 'menu-b']);
const ITEM_3 = makeItem('item-3', 'Garlic Bread', []);        // no menus
const ALL_ITEMS = [ITEM_1, ITEM_2, ITEM_3];
const ALL_MENUS = [MENU_A, MENU_B];

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('BulkActionsPanel — render', () => {
  it('shows item count in header', () => {
    const service = makeService();
    renderPanel(
      { selected: new Set(['item-1', 'item-2']), items: ALL_ITEMS, menus: ALL_MENUS },
      service,
    );
    expect(screen.getByText(/2 items selected/i)).toBeInTheDocument();
  });

  it('shows singular "item" when only 1 selected', () => {
    const service = makeService();
    renderPanel(
      { selected: new Set(['item-1']), items: ALL_ITEMS, menus: ALL_MENUS },
      service,
    );
    expect(screen.getByText(/1 item selected/i)).toBeInTheDocument();
  });

  it('renders all 6 mode tabs', () => {
    const service = makeService();
    renderPanel(
      { selected: new Set(['item-1']), items: ALL_ITEMS, menus: ALL_MENUS },
      service,
    );
    expect(screen.getByTestId('bulk-tab-assign')).toBeInTheDocument();
    expect(screen.getByTestId('bulk-tab-remove')).toBeInTheDocument();
    expect(screen.getByTestId('bulk-tab-boost')).toBeInTheDocument();
    expect(screen.getByTestId('bulk-tab-special')).toBeInTheDocument();
    expect(screen.getByTestId('bulk-tab-availability')).toBeInTheDocument();
    expect(screen.getByTestId('bulk-tab-delete')).toBeInTheDocument();
  });

  it('shows up to 4 item preview chips', () => {
    const items = [
      makeItem('i1', 'Dish One'),
      makeItem('i2', 'Dish Two'),
      makeItem('i3', 'Dish Three'),
      makeItem('i4', 'Dish Four'),
      makeItem('i5', 'Dish Five'),
    ];
    const service = makeService();
    renderPanel(
      { selected: new Set(['i1', 'i2', 'i3', 'i4', 'i5']), items, menus: ALL_MENUS },
      service,
    );
    expect(screen.getByText('Dish One')).toBeInTheDocument();
    expect(screen.getByText('Dish Four')).toBeInTheDocument();
    expect(screen.queryByText('Dish Five')).not.toBeInTheDocument();
    expect(screen.getByText('+1 more')).toBeInTheDocument();
  });

  it('panel and backdrop are present in the DOM', () => {
    const service = makeService();
    renderPanel(
      { selected: new Set(['item-1']), items: ALL_ITEMS, menus: ALL_MENUS },
      service,
    );
    expect(screen.getByTestId('bulk-actions-panel')).toBeInTheDocument();
    expect(screen.getByTestId('bulk-panel-backdrop')).toBeInTheDocument();
  });
});

// ── Mode switching ────────────────────────────────────────────────────────────

describe('BulkActionsPanel — mode switching', () => {
  it('clicking a tab switches the active form', async () => {
    const user = userEvent.setup();
    const service = makeService();
    renderPanel(
      {
        selected: new Set(['item-1']),
        items: ALL_ITEMS,
        menus: ALL_MENUS,
        initialMode: 'assign',
      },
      service,
    );

    // Switch to Boost — BoostForm should render
    await user.click(screen.getByTestId('bulk-tab-boost'));
    // Boost form renders "Set boost level" heading and level options
    expect(screen.getByText('Set boost level')).toBeInTheDocument();
    expect(screen.getByTestId('boost-option-Low')).toBeInTheDocument();

    // Switch to Delete — DeleteForm renders the warning box
    await user.click(screen.getByTestId('bulk-tab-delete'));
    expect(screen.getByTestId('delete-warning')).toBeInTheDocument();
  });

  it('switching modes clears the error state', async () => {
    const user = userEvent.setup();
    const service = makeService();
    renderPanel(
      {
        selected: new Set(['item-1']),
        items: ALL_ITEMS,
        menus: ALL_MENUS,
        initialMode: 'assign',
      },
      service,
    );

    // Trigger a validation error by clicking Apply without selecting a menu
    await user.click(screen.getByRole('button', { name: /apply/i }));
    expect(screen.getByTestId('bulk-error')).toBeInTheDocument();

    // Switch modes — error should disappear
    await user.click(screen.getByTestId('bulk-tab-boost'));
    expect(screen.queryByTestId('bulk-error')).not.toBeInTheDocument();
  });
});

// ── Close behaviour ───────────────────────────────────────────────────────────

describe('BulkActionsPanel — close', () => {
  it('close button calls onClose', async () => {
    const user = userEvent.setup();
    const service = makeService();
    const onClose = vi.fn();
    renderPanel(
      { selected: new Set(['item-1']), items: ALL_ITEMS, menus: ALL_MENUS, onClose },
      service,
    );
    await user.click(screen.getByTestId('bulk-panel-close'));
    // PDD 2026-05-22 — slide-out animation runs for 250ms before the
    // parent's onClose actually fires. waitFor covers the timeout.
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
  });

  it('clicking the backdrop calls onClose', async () => {
    const user = userEvent.setup();
    const service = makeService();
    const onClose = vi.fn();
    renderPanel(
      { selected: new Set(['item-1']), items: ALL_ITEMS, menus: ALL_MENUS, onClose },
      service,
    );
    await user.click(screen.getByTestId('bulk-panel-backdrop'));
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
  });
});

// ── Assign mode ───────────────────────────────────────────────────────────────

describe('BulkActionsPanel — assign mode', () => {
  it('shows validation error when Apply clicked with no menu selected', async () => {
    const user = userEvent.setup();
    const service = makeService();
    renderPanel(
      {
        selected: new Set(['item-1']),
        items: ALL_ITEMS,
        menus: ALL_MENUS,
        initialMode: 'assign',
      },
      service,
    );
    await user.click(screen.getByRole('button', { name: /apply/i }));
    expect(screen.getByTestId('bulk-error')).toBeInTheDocument();
    expect(screen.getByTestId('bulk-error')).toHaveTextContent(/select at least one menu/i);
    expect(service.addItemToMenu).not.toHaveBeenCalled();
  });

  it('calls addItemToMenu for each selected item × target menu', async () => {
    const user = userEvent.setup();
    const service = makeService();
    const onComplete = vi.fn();
    renderPanel(
      {
        selected: new Set(['item-1', 'item-2']),
        items: ALL_ITEMS,
        menus: ALL_MENUS,
        initialMode: 'assign',
        onComplete,
      },
      service,
    );

    // Select the first menu checkbox
    const menuCheckboxes = screen.getAllByRole('checkbox');
    await user.click(menuCheckboxes[0]); // MENU_A

    await user.click(screen.getByRole('button', { name: /apply/i }));

    await waitFor(() => {
      // 2 items × 1 menu = 2 calls
      expect(service.addItemToMenu).toHaveBeenCalledTimes(2);
    });
    expect(service.addItemToMenu).toHaveBeenCalledWith('item-1', 'menu-a', 10, expect.any(String));
    expect(service.addItemToMenu).toHaveBeenCalledWith('item-2', 'menu-a', 10, expect.any(String));
  });

  it('calls onComplete after all assign tasks succeed', async () => {
    const user = userEvent.setup();
    const service = makeService();
    const onComplete = vi.fn();
    renderPanel(
      {
        selected: new Set(['item-1']),
        items: ALL_ITEMS,
        menus: ALL_MENUS,
        initialMode: 'assign',
        onComplete,
      },
      service,
    );

    const menuCheckboxes = screen.getAllByRole('checkbox');
    await user.click(menuCheckboxes[0]);
    await user.click(screen.getByRole('button', { name: /apply/i }));

    await waitFor(() => expect(onComplete).toHaveBeenCalledTimes(1));
    // onComplete receives (updatedItems, selectedSet)
    const [updatedItems, clearedIds] = onComplete.mock.calls[0];
    expect(Array.isArray(updatedItems)).toBe(true);
    expect(clearedIds).toBeInstanceOf(Set);
  });

  it('falls back to "Entrees" category when item.category is unset', async () => {
    const user = userEvent.setup();
    const noCategory = { ...makeItem('item-nc', 'No Category Item'), category: undefined };
    const service = makeService();
    renderPanel(
      {
        selected: new Set(['item-nc']),
        items: [noCategory as MenuItemDisplay],
        menus: [MENU_A],
        initialMode: 'assign',
      },
      service,
    );

    const [checkbox] = screen.getAllByRole('checkbox');
    await user.click(checkbox);
    await user.click(screen.getByRole('button', { name: /apply/i }));

    await waitFor(() => expect(service.addItemToMenu).toHaveBeenCalledTimes(1));
    expect(service.addItemToMenu).toHaveBeenCalledWith(
      'item-nc', 'menu-a', expect.any(Number), 'Entrees',
    );
  });
});

// ── Remove mode ───────────────────────────────────────────────────────────────

describe('BulkActionsPanel — remove mode', () => {
  it('shows validation error when no menu selected', async () => {
    const user = userEvent.setup();
    const service = makeService();
    renderPanel(
      {
        selected: new Set(['item-1']),
        items: ALL_ITEMS,
        menus: ALL_MENUS,
        initialMode: 'remove',
      },
      service,
    );
    await user.click(screen.getByRole('button', { name: /apply/i }));
    expect(screen.getByTestId('bulk-error')).toHaveTextContent(/select at least one menu/i);
  });

  it('only calls removeItemFromMenu for items that are actually in the target menu', async () => {
    const user = userEvent.setup();
    const service = makeService();
    // ITEM_3 has no menus, so only ITEM_1 (which is in menu-a) should be removed
    renderPanel(
      {
        selected: new Set(['item-1', 'item-3']),
        items: ALL_ITEMS,
        menus: ALL_MENUS,
        initialMode: 'remove',
      },
      service,
    );

    // MENU_A is the only relevant menu (items 1 and 2 are there; item-3 is not)
    const [checkbox] = screen.getAllByRole('checkbox');
    await user.click(checkbox);
    await user.click(screen.getByRole('button', { name: /apply/i }));

    await waitFor(() => expect(service.removeItemFromMenu).toHaveBeenCalledTimes(1));
    expect(service.removeItemFromMenu).toHaveBeenCalledWith('item-1', 'menu-a');
    expect(service.removeItemFromMenu).not.toHaveBeenCalledWith('item-3', expect.anything());
  });

  it('shows empty-state message when selected items are not in any menu', () => {
    const service = makeService();
    // ITEM_3 has no menus — relevantMenus is empty, so RemoveForm shows a text message
    renderPanel(
      {
        selected: new Set(['item-3']),
        items: ALL_ITEMS,
        menus: ALL_MENUS,
        initialMode: 'remove',
      },
      service,
    );

    // RemoveForm empty state: no checkboxes, just the explanatory message
    expect(screen.queryAllByRole('checkbox')).toHaveLength(0);
    expect(
      screen.getByText(/none of the selected items are assigned to any menu/i),
    ).toBeInTheDocument();
  });
});

// ── Boost mode ────────────────────────────────────────────────────────────────

describe('BulkActionsPanel — boost mode', () => {
  it('shows error when no items are in any menu', async () => {
    const user = userEvent.setup();
    const service = makeService();
    // ITEM_3 has no menu_associations
    renderPanel(
      {
        selected: new Set(['item-3']),
        items: ALL_ITEMS,
        menus: ALL_MENUS,
        initialMode: 'boost',
      },
      service,
    );
    await user.click(screen.getByRole('button', { name: /apply/i }));
    expect(screen.getByTestId('bulk-error')).toHaveTextContent(/none of the selected items/i);
  });

  it('sends boost_level as "1" for Low, "2" for Moderate, "3" for High', async () => {
    const user = userEvent.setup();
    const service = makeService();
    renderPanel(
      {
        selected: new Set(['item-1']),
        items: [ITEM_1],
        menus: ALL_MENUS,
        initialMode: 'boost',
      },
      service,
    );

    await user.click(screen.getByText('Moderate'));
    await user.click(screen.getByRole('button', { name: /apply/i }));

    await waitFor(() => expect(service.updateMenuItemInMenu).toHaveBeenCalledTimes(1));
    expect(service.updateMenuItemInMenu).toHaveBeenCalledWith(
      'item-1', 'menu-a', { boost_level: '2' },
    );
  });

  it('sends boost_level as null when "None (clear boost)" is selected', async () => {
    const user = userEvent.setup();
    const service = makeService();
    renderPanel(
      {
        selected: new Set(['item-1']),
        items: [ITEM_1],
        menus: ALL_MENUS,
        initialMode: 'boost',
      },
      service,
    );

    await user.click(screen.getByTestId('boost-option-none'));
    await user.click(screen.getByRole('button', { name: /apply/i }));

    await waitFor(() => expect(service.updateMenuItemInMenu).toHaveBeenCalledTimes(1));
    expect(service.updateMenuItemInMenu).toHaveBeenCalledWith(
      'item-1', 'menu-a', { boost_level: null },
    );
  });

  it('calls updateMenuItemInMenu for each association across all selected items', async () => {
    const user = userEvent.setup();
    const service = makeService();
    // ITEM_2 is in menu-a AND menu-b → 2 calls
    renderPanel(
      {
        selected: new Set(['item-2']),
        items: ALL_ITEMS,
        menus: ALL_MENUS,
        initialMode: 'boost',
      },
      service,
    );

    await user.click(screen.getByText('High'));
    await user.click(screen.getByRole('button', { name: /apply/i }));

    await waitFor(() => expect(service.updateMenuItemInMenu).toHaveBeenCalledTimes(2));
    expect(service.updateMenuItemInMenu).toHaveBeenCalledWith('item-2', 'menu-a', { boost_level: '3' });
    expect(service.updateMenuItemInMenu).toHaveBeenCalledWith('item-2', 'menu-b', { boost_level: '3' });
  });
});

// ── Special mode ──────────────────────────────────────────────────────────────

describe('BulkActionsPanel — special mode', () => {
  it('sends chefs_special: true when "Mark as Chef\'s Special" selected (default)', async () => {
    const user = userEvent.setup();
    const service = makeService();
    renderPanel(
      {
        selected: new Set(['item-1']),
        items: [ITEM_1],
        menus: ALL_MENUS,
        initialMode: 'special',
      },
      service,
    );

    await user.click(screen.getByRole('button', { name: /apply/i }));

    await waitFor(() => expect(service.updateMenuItemInMenu).toHaveBeenCalledTimes(1));
    expect(service.updateMenuItemInMenu).toHaveBeenCalledWith(
      'item-1', 'menu-a', { chefs_special: true },
    );
  });

  it('sends chefs_special: false when "Remove Chef\'s Special" is toggled', async () => {
    const user = userEvent.setup();
    const service = makeService();
    renderPanel(
      {
        selected: new Set(['item-1']),
        items: [ITEM_1],
        menus: ALL_MENUS,
        initialMode: 'special',
      },
      service,
    );

    // Toggle off the Chef's Special (second button = "Remove")
    const removeBtn = screen.getByRole('button', { name: /remove chef/i });
    await user.click(removeBtn);
    await user.click(screen.getByRole('button', { name: /apply/i }));

    await waitFor(() => expect(service.updateMenuItemInMenu).toHaveBeenCalledTimes(1));
    expect(service.updateMenuItemInMenu).toHaveBeenCalledWith(
      'item-1', 'menu-a', { chefs_special: false },
    );
  });
});

// ── Availability mode ─────────────────────────────────────────────────────────

describe('BulkActionsPanel — availability mode', () => {
  it('calls toggleMenuItemActive for every selected item', async () => {
    const user = userEvent.setup();
    const service = makeService();
    const onComplete = vi.fn();
    renderPanel(
      {
        selected: new Set(['item-1', 'item-2']),
        items: ALL_ITEMS,
        menus: ALL_MENUS,
        initialMode: 'availability',
        onComplete,
      },
      service,
    );

    await user.click(screen.getByRole('button', { name: /apply/i }));

    await waitFor(() => expect(service.toggleMenuItemActive).toHaveBeenCalledTimes(2));
    // Default active state is true
    expect(service.toggleMenuItemActive).toHaveBeenCalledWith('item-1', true);
    expect(service.toggleMenuItemActive).toHaveBeenCalledWith('item-2', true);
    await waitFor(() => expect(onComplete).toHaveBeenCalledTimes(1));
  });

  it('calls toggleMenuItemActive with false when "86\'d" (inactive) is selected', async () => {
    const user = userEvent.setup();
    const service = makeService();
    renderPanel(
      {
        selected: new Set(['item-1']),
        items: [ITEM_1],
        menus: ALL_MENUS,
        initialMode: 'availability',
      },
      service,
    );

    // "86'd" button sets active = false
    const inactiveBtn = screen.getByRole('button', { name: /86/i });
    await user.click(inactiveBtn);
    await user.click(screen.getByRole('button', { name: /apply/i }));

    await waitFor(() => expect(service.toggleMenuItemActive).toHaveBeenCalledTimes(1));
    expect(service.toggleMenuItemActive).toHaveBeenCalledWith('item-1', false);
  });
});

// ── Delete mode ───────────────────────────────────────────────────────────────

describe('BulkActionsPanel — delete mode', () => {
  it('first Apply click shows confirmation prompt, does not delete', async () => {
    const user = userEvent.setup();
    const service = makeService();
    renderPanel(
      {
        selected: new Set(['item-1']),
        items: ALL_ITEMS,
        menus: ALL_MENUS,
        initialMode: 'delete',
      },
      service,
    );

    // Apply button says "Delete 1 item…" in delete mode — use testid to avoid ambiguity
    await user.click(screen.getByTestId('bulk-apply'));
    expect(service.deleteMenuItem).not.toHaveBeenCalled();
    // After first click, a confirm prompt appears and button text changes
    expect(screen.getByTestId('delete-confirm-prompt')).toBeInTheDocument();
    // Button now reads "Confirm — delete 1 items"
    expect(screen.getByTestId('bulk-apply')).toHaveTextContent(/confirm/i);
  });

  it('second Apply click (after confirmation) calls deleteMenuItem for each item', async () => {
    const user = userEvent.setup();
    const service = makeService();
    const onComplete = vi.fn();
    renderPanel(
      {
        selected: new Set(['item-1', 'item-2']),
        items: ALL_ITEMS,
        menus: ALL_MENUS,
        initialMode: 'delete',
        onComplete,
      },
      service,
    );

    // First click — confirmation (bulk-apply shows "Delete 2 items…")
    await user.click(screen.getByTestId('bulk-apply'));
    // Second click — actual delete (bulk-apply now shows "Confirm — delete 2 items")
    await user.click(screen.getByTestId('bulk-apply'));

    await waitFor(() => expect(service.deleteMenuItem).toHaveBeenCalledTimes(2));
    expect(service.deleteMenuItem).toHaveBeenCalledWith('item-1');
    expect(service.deleteMenuItem).toHaveBeenCalledWith('item-2');
    await waitFor(() => expect(onComplete).toHaveBeenCalledTimes(1));

    // The updated items list should exclude the deleted items
    const [updatedItems] = onComplete.mock.calls[0];
    const updatedIds = (updatedItems as MenuItemDisplay[]).map((i) => i.id);
    expect(updatedIds).not.toContain('item-1');
    expect(updatedIds).not.toContain('item-2');
    expect(updatedIds).toContain('item-3'); // unselected item remains
  });

  it('switching away from delete mode resets the confirm flag', async () => {
    const user = userEvent.setup();
    const service = makeService();
    renderPanel(
      {
        selected: new Set(['item-1']),
        items: ALL_ITEMS,
        menus: ALL_MENUS,
        initialMode: 'delete',
      },
      service,
    );

    // First click — enters confirmation stage
    await user.click(screen.getByTestId('bulk-apply'));
    expect(screen.getByTestId('delete-confirm-prompt')).toBeInTheDocument();

    // Switch to Boost and back
    await user.click(screen.getByTestId('bulk-tab-boost'));
    await user.click(screen.getByTestId('bulk-tab-delete'));

    // Confirm flag should be reset — confirm prompt gone, apply shows original text
    expect(screen.queryByTestId('delete-confirm-prompt')).not.toBeInTheDocument();
    expect(screen.getByTestId('bulk-apply')).toHaveTextContent(/delete 1 item/i);
  });
});

// ── Execution framework ───────────────────────────────────────────────────────

describe('BulkActionsPanel — execution framework', () => {
  it('shows progress bar while tasks are executing', async () => {
    const user = userEvent.setup();
    let resolveTask!: () => void;
    const slowAssoc: Promise<MenuAssociation[]> = new Promise(
      (res) => { resolveTask = () => res([makeAssoc('menu-a')]); },
    );
    const service = makeService({ addItemToMenu: vi.fn().mockReturnValue(slowAssoc) });
    renderPanel(
      {
        selected: new Set(['item-1']),
        items: [ITEM_1],
        menus: [MENU_A],
        initialMode: 'assign',
      },
      service,
    );

    const [checkbox] = screen.getAllByRole('checkbox');
    await user.click(checkbox);
    await user.click(screen.getByRole('button', { name: /apply/i }));

    // Progress bar should appear while task is running
    expect(screen.getByTestId('bulk-progress')).toBeInTheDocument();

    // Resolve the task
    resolveTask();
    await waitFor(() => expect(screen.queryByTestId('bulk-progress')).not.toBeInTheDocument());
  });

  it('shows partial failure error when some tasks reject', async () => {
    const user = userEvent.setup();
    let callCount = 0;
    const service = makeService({
      addItemToMenu: vi.fn().mockImplementation(() => {
        callCount++;
        if (callCount === 1) return Promise.resolve([makeAssoc('menu-a')]);
        return Promise.reject(new Error('Network error'));
      }),
    });
    renderPanel(
      {
        selected: new Set(['item-1', 'item-2']),
        items: ALL_ITEMS,
        menus: [MENU_A],
        initialMode: 'assign',
      },
      service,
    );

    const [checkbox] = screen.getAllByRole('checkbox');
    await user.click(checkbox);
    await user.click(screen.getByRole('button', { name: /apply/i }));

    await waitFor(() => expect(screen.getByTestId('bulk-error')).toBeInTheDocument());
    expect(screen.getByTestId('bulk-error')).toHaveTextContent(/1 operation.*failed/i);
  });

  it('Cancel button is disabled while executing', async () => {
    const user = userEvent.setup();
    let resolveTask!: () => void;
    const slowAssoc: Promise<MenuAssociation[]> = new Promise(
      (res) => { resolveTask = () => res([makeAssoc('menu-a')]); },
    );
    const service = makeService({ addItemToMenu: vi.fn().mockReturnValue(slowAssoc) });
    const onClose = vi.fn();
    renderPanel(
      {
        selected: new Set(['item-1']),
        items: [ITEM_1],
        menus: [MENU_A],
        initialMode: 'assign',
        onClose,
      },
      service,
    );

    const [checkbox] = screen.getAllByRole('checkbox');
    await user.click(checkbox);
    await user.click(screen.getByRole('button', { name: /apply/i }));

    // Cancel should be disabled during execution
    const cancelBtn = screen.getByTestId('bulk-cancel');
    expect(cancelBtn).toBeDisabled();

    resolveTask();
    await waitFor(() => expect(cancelBtn).not.toBeDisabled());
  });
});

// ── mergeAssociations (tested via assign flow) ────────────────────────────────

describe('BulkActionsPanel — mergeAssociations (via assign)', () => {
  it('returned updatedItems reflect the new associations from the service', async () => {
    const user = userEvent.setup();
    const newAssocs = [makeAssoc('menu-a'), makeAssoc('menu-b')]; // two menus after assign
    const service = makeService({
      addItemToMenu: vi.fn().mockResolvedValue(newAssocs),
    });
    const onComplete = vi.fn();
    renderPanel(
      {
        selected: new Set(['item-3']), // starts with no menus
        items: ALL_ITEMS,
        menus: [MENU_A],
        initialMode: 'assign',
        onComplete,
      },
      service,
    );

    const [checkbox] = screen.getAllByRole('checkbox');
    await user.click(checkbox);
    await user.click(screen.getByRole('button', { name: /apply/i }));

    await waitFor(() => expect(onComplete).toHaveBeenCalledTimes(1));
    const [updatedItems] = onComplete.mock.calls[0];
    const updatedItem3 = (updatedItems as MenuItemDisplay[]).find((i) => i.id === 'item-3');
    expect(updatedItem3?.menu_associations).toEqual(newAssocs);
  });
});

describe('BulkActionsPanel — Remove from menu (PDD 2026-06-12 #8)', () => {
  it('hides the Remove-from-menu tab with no current-menu context', () => {
    const service = makeService();
    renderPanel({ selected: new Set(['item-1']), items: ALL_ITEMS, menus: ALL_MENUS }, service);
    expect(screen.queryByTestId('bulk-tab-removeFromMenu')).not.toBeInTheDocument();
  });

  it('shows the tab on a builder (single-menu) context', () => {
    const service = makeService();
    renderPanel(
      { selected: new Set(['item-1']), items: ALL_ITEMS, menus: ALL_MENUS,
        currentMenuId: 'menu-a', currentMenuName: 'All Day Menu' },
      service,
    );
    expect(screen.getByTestId('bulk-tab-removeFromMenu')).toBeInTheDocument();
  });

  it('removes only selected items that are on the current menu; skips the rest', async () => {
    const user = userEvent.setup();
    const removeSpy = vi.fn().mockResolvedValue([]);
    const service = makeService({ removeItemFromMenu: removeSpy });
    const { onComplete } = renderPanel(
      { selected: new Set(['item-1', 'item-3']), // item-1 ∈ menu-a; item-3 ∈ no menus
        items: ALL_ITEMS, menus: ALL_MENUS, initialMode: 'removeFromMenu',
        currentMenuId: 'menu-a', currentMenuName: 'All Day Menu' },
      service,
    );
    expect(screen.getByTestId('remove-from-menu-form')).toBeInTheDocument();
    await user.click(screen.getByTestId('bulk-apply'));
    await waitFor(() => expect(removeSpy).toHaveBeenCalledTimes(1));
    expect(removeSpy).toHaveBeenCalledWith('item-1', 'menu-a');
    await waitFor(() => expect(onComplete).toHaveBeenCalled());
  });

  it('errors (and calls nothing) when none of the selected items are on the menu', async () => {
    const user = userEvent.setup();
    const service = makeService();
    renderPanel(
      { selected: new Set(['item-3']), items: ALL_ITEMS, menus: ALL_MENUS,
        initialMode: 'removeFromMenu', currentMenuId: 'menu-a' },
      service,
    );
    await user.click(screen.getByRole('button', { name: /apply/i }));
    expect(screen.getByTestId('bulk-error')).toBeInTheDocument();
    expect(service.removeItemFromMenu).not.toHaveBeenCalled();
  });

  it('removes a multi-menu item from this menu only; the merge keeps other-menu placements', async () => {
    const user = userEvent.setup();
    // item-2 ∈ menu-a + menu-b; the service returns the REMAINING associations
    // (menu-b) after removing menu-a — so the merged item keeps its menu-b row.
    const removeSpy = vi.fn().mockResolvedValue([makeAssoc('menu-b')]);
    const service = makeService({ removeItemFromMenu: removeSpy });
    const { onComplete } = renderPanel(
      { selected: new Set(['item-2']), items: ALL_ITEMS, menus: ALL_MENUS,
        initialMode: 'removeFromMenu', currentMenuId: 'menu-a', currentMenuName: 'All Day Menu' },
      service,
    );
    await user.click(screen.getByTestId('bulk-apply'));
    await waitFor(() => expect(removeSpy).toHaveBeenCalledWith('item-2', 'menu-a'));
    await waitFor(() => expect(onComplete).toHaveBeenCalled());
    const [updatedItems] = onComplete.mock.calls[0];
    const item2 = (updatedItems as MenuItemDisplay[]).find((i) => i.id === 'item-2');
    expect(item2?.menu_associations?.map((a) => a.menu_id)).toEqual(['menu-b']);
  });

  it('shows how many selected items will be skipped (not on this menu)', () => {
    const service = makeService();
    renderPanel(
      { selected: new Set(['item-1', 'item-3']), // item-1 ∈ menu-a; item-3 ∈ none
        items: ALL_ITEMS, menus: ALL_MENUS, initialMode: 'removeFromMenu', currentMenuId: 'menu-a' },
      service,
    );
    expect(screen.getByTestId('remove-from-menu-skipped')).toHaveTextContent(/1 of 2 .*skipped/i);
  });
});
