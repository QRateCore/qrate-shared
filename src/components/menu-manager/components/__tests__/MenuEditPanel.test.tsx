// @vitest-environment jsdom
/**
 * Unit tests for MenuEditPanel — all-menus-inactive warning.
 *
 * Covers:
 *  - Save: warning modal appears when deactivating the last active menu
 *  - Save: no warning when other active menus remain
 *  - Save: no warning when toggling to active
 *  - Delete: warning modal appears when deleting the last active menu
 *  - Delete: no warning when deleting an inactive menu
 *  - Delete: no warning when other active menus remain
 *  - Modal dismiss: "Got it" closes the modal
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import MenuEditPanel from '../MenuEditPanel';
import { MenuManagerServiceProvider } from '../../context';
import type { MenuSummary, MenuManagerService } from '../../../../types/restaurant';

// ── Factories ─────────────────────────────────────────────────────────────────

function makeMenu(
  id: string,
  name: string,
  active = true,
): MenuSummary {
  return {
    id,
    name,
    slug: id,
    active,
    is_all_day: true,
    item_count: 2,
    schedule: null,
    days_of_week: [0, 1, 2, 3, 4, 5, 6],
  } as MenuSummary;
}

function makeService(
  overrides: Partial<MenuManagerService> = {},
): MenuManagerService {
  return {
    getAllMenuItems: vi.fn(),
    getMenus: vi.fn(),
    addMenuItem: vi.fn(),
    updateMenuItem: vi.fn(),
    deleteMenuItem: vi.fn(),
    toggleMenuItemActive: vi.fn(),
    createMenu: vi.fn(),
    updateMenu: vi.fn().mockResolvedValue(makeMenu('menu-a', 'All Day Menu', false)),
    deleteMenu: vi.fn().mockResolvedValue(undefined),
    addItemToMenu: vi.fn(),
    removeItemFromMenu: vi.fn(),
    updateMenuItemInMenu: vi.fn(),
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
  menu: MenuSummary;
  allMenus: MenuSummary[];
  onClose?: ReturnType<typeof vi.fn>;
  onUpdate?: ReturnType<typeof vi.fn>;
  onDelete?: ReturnType<typeof vi.fn>;
}

function renderPanel(config: PanelConfig, service: MenuManagerService) {
  const onClose = config.onClose ?? vi.fn();
  const onUpdate = config.onUpdate ?? vi.fn();
  const onDelete = config.onDelete ?? vi.fn();
  render(
    <MenuManagerServiceProvider value={service}>
      <MenuEditPanel
        menu={config.menu}
        allMenus={config.allMenus}
        restaurantId="rest-1"
        onClose={onClose}
        onUpdate={onUpdate}
        onDelete={onDelete}
      />
    </MenuManagerServiceProvider>,
  );
  return { onClose, onUpdate, onDelete };
}

// ── Test data ─────────────────────────────────────────────────────────────────

const WARNING_TEXT = /Please refrain from inactivating all Menus/;

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('MenuEditPanel — all-menus-inactive warning', () => {
  let service: MenuManagerService;

  beforeEach(() => {
    service = makeService();
  });

  // ── Save: deactivating last active menu shows warning ───────────────────

  it('shows warning modal when saving would deactivate the last active menu', async () => {
    const menuA = makeMenu('menu-a', 'All Day Menu', true);
    renderPanel({ menu: menuA, allMenus: [menuA] }, service);

    // Toggle to inactive
    await userEvent.click(screen.getByTestId('menu-active-false'));
    // Click save
    await userEvent.click(screen.getByTestId('menu-edit-save'));

    // Warning modal should appear
    expect(screen.getByTestId('inactive-warning-modal')).toBeInTheDocument();
    expect(screen.getByText(WARNING_TEXT)).toBeInTheDocument();
    // Service should NOT have been called
    expect(service.updateMenu).not.toHaveBeenCalled();
  });

  it('shows warning when all OTHER menus are already inactive', async () => {
    const menuA = makeMenu('menu-a', 'All Day Menu', true);
    const menuB = makeMenu('menu-b', 'Lunch Menu', false);
    renderPanel({ menu: menuA, allMenus: [menuA, menuB] }, service);

    await userEvent.click(screen.getByTestId('menu-active-false'));
    await userEvent.click(screen.getByTestId('menu-edit-save'));

    expect(screen.getByTestId('inactive-warning-modal')).toBeInTheDocument();
    expect(service.updateMenu).not.toHaveBeenCalled();
  });

  // ── Save: no warning when other active menus remain ─────────────────────

  it('does NOT show warning when other menus are still active', async () => {
    const menuA = makeMenu('menu-a', 'All Day Menu', true);
    const menuB = makeMenu('menu-b', 'Lunch Menu', true);
    renderPanel({ menu: menuA, allMenus: [menuA, menuB] }, service);

    await userEvent.click(screen.getByTestId('menu-active-false'));
    await userEvent.click(screen.getByTestId('menu-edit-save'));

    expect(screen.queryByTestId('inactive-warning-modal')).not.toBeInTheDocument();
    await waitFor(() => {
      expect(service.updateMenu).toHaveBeenCalled();
    });
  });

  // ── Save: no warning when toggling to active ────────────────────────────

  it('does NOT show warning when saving an active toggle', async () => {
    const menuA = makeMenu('menu-a', 'All Day Menu', false);
    renderPanel({ menu: menuA, allMenus: [menuA] }, service);

    // Menu starts inactive, toggle to active
    await userEvent.click(screen.getByTestId('menu-active-true'));
    await userEvent.click(screen.getByTestId('menu-edit-save'));

    expect(screen.queryByTestId('inactive-warning-modal')).not.toBeInTheDocument();
    await waitFor(() => {
      expect(service.updateMenu).toHaveBeenCalled();
    });
  });

  // ── Delete: deleting the last active menu shows warning ─────────────────

  it('shows warning modal when deleting the last active menu', async () => {
    const menuA = makeMenu('menu-a', 'All Day Menu', true);
    renderPanel({ menu: menuA, allMenus: [menuA] }, service);

    const deleteBtn = screen.getByTestId('delete-menu-btn');
    // Click 1: "Delete this menu" → "Are you sure?"
    await userEvent.click(deleteBtn);
    // Click 2: confirmation step — should trigger warning instead
    await userEvent.click(deleteBtn);

    expect(screen.getByTestId('inactive-warning-modal')).toBeInTheDocument();
    expect(screen.getByText(WARNING_TEXT)).toBeInTheDocument();
    expect(service.deleteMenu).not.toHaveBeenCalled();
  });

  it('shows warning on delete when all other menus are inactive', async () => {
    const menuA = makeMenu('menu-a', 'All Day Menu', true);
    const menuB = makeMenu('menu-b', 'Lunch Menu', false);
    renderPanel({ menu: menuA, allMenus: [menuA, menuB] }, service);

    const deleteBtn = screen.getByTestId('delete-menu-btn');
    await userEvent.click(deleteBtn);
    await userEvent.click(deleteBtn);

    expect(screen.getByTestId('inactive-warning-modal')).toBeInTheDocument();
    expect(service.deleteMenu).not.toHaveBeenCalled();
  });

  // ── Delete: no warning when other active menus remain ───────────────────

  it('does NOT show warning when deleting a menu while others are active', async () => {
    const menuA = makeMenu('menu-a', 'All Day Menu', true);
    const menuB = makeMenu('menu-b', 'Lunch Menu', true);
    renderPanel({ menu: menuA, allMenus: [menuA, menuB] }, service);

    const deleteBtn = screen.getByTestId('delete-menu-btn');
    await userEvent.click(deleteBtn);  // step 0 → 1
    await userEvent.click(deleteBtn);  // step 1 → 2 (no warning)

    expect(screen.queryByTestId('inactive-warning-modal')).not.toBeInTheDocument();
    // Should proceed to step 2 (final confirmation text visible)
    expect(deleteBtn).toHaveTextContent(/once more/i);
  });

  // ── Delete: no warning when deleting an inactive menu ───────────────────

  it('does NOT show warning when deleting an already-inactive menu', async () => {
    const menuA = makeMenu('menu-a', 'All Day Menu', false);
    const menuB = makeMenu('menu-b', 'Lunch Menu', true);
    renderPanel({ menu: menuA, allMenus: [menuA, menuB] }, service);

    const deleteBtn = screen.getByTestId('delete-menu-btn');
    await userEvent.click(deleteBtn);
    await userEvent.click(deleteBtn);

    expect(screen.queryByTestId('inactive-warning-modal')).not.toBeInTheDocument();
    expect(deleteBtn).toHaveTextContent(/once more/i);
  });

  // ── Modal dismiss ───────────────────────────────────────────────────────

  it('"Got it" button dismisses the warning modal', async () => {
    const menuA = makeMenu('menu-a', 'All Day Menu', true);
    renderPanel({ menu: menuA, allMenus: [menuA] }, service);

    await userEvent.click(screen.getByTestId('menu-active-false'));
    await userEvent.click(screen.getByTestId('menu-edit-save'));

    expect(screen.getByTestId('inactive-warning-modal')).toBeInTheDocument();

    await userEvent.click(screen.getByTestId('inactive-warning-dismiss'));

    expect(screen.queryByTestId('inactive-warning-modal')).not.toBeInTheDocument();
  });

  it('clicking backdrop dismisses the warning modal', async () => {
    const menuA = makeMenu('menu-a', 'All Day Menu', true);
    renderPanel({ menu: menuA, allMenus: [menuA] }, service);

    await userEvent.click(screen.getByTestId('menu-active-false'));
    await userEvent.click(screen.getByTestId('menu-edit-save'));

    expect(screen.getByTestId('inactive-warning-modal')).toBeInTheDocument();

    fireEvent.click(screen.getByTestId('inactive-warning-backdrop'));

    expect(screen.queryByTestId('inactive-warning-modal')).not.toBeInTheDocument();
  });

  it('delete flow resets to step 0 after warning dismissal', async () => {
    const menuA = makeMenu('menu-a', 'All Day Menu', true);
    renderPanel({ menu: menuA, allMenus: [menuA] }, service);

    const deleteBtn = screen.getByTestId('delete-menu-btn');
    await userEvent.click(deleteBtn); // step 0 → 1
    await userEvent.click(deleteBtn); // step 1 → warning (resets to 0)

    expect(screen.getByTestId('inactive-warning-modal')).toBeInTheDocument();

    await userEvent.click(screen.getByTestId('inactive-warning-dismiss'));

    // Delete button should be back to initial state
    expect(deleteBtn).toHaveTextContent(/Delete this menu/i);
  });
});

// ── Drinks mode ───────────────────────────────────────────────────────────────

/**
 * Drinks mode is DESTRUCTIVE — switching wipes the menu's item placements and
 * sub-categories server-side. These tests pin the two properties that keep that
 * safe: the confirmation is mandatory, and the checkbox only moves after the
 * call actually succeeds.
 */
describe('MenuEditPanel — drinks mode', () => {
  const CONFIRM_TEXT = /permanently removed/i;

  function drinksService(overrides: Partial<MenuManagerService> = {}) {
    return makeService({
      setMenuDrinksMode: vi
        .fn()
        .mockResolvedValue({ ...makeMenu('menu-a', 'Bar List'), drinks_only: true }),
      ...overrides,
    });
  }

  it('renders unchecked when drinks_only is absent', () => {
    renderPanel(
      { menu: makeMenu('menu-a', 'Lunch'), allMenus: [makeMenu('menu-a', 'Lunch'), makeMenu('menu-b', 'Dinner')] },
      drinksService(),
    );
    expect(screen.getByTestId('menu-drinks-only')).not.toBeChecked();
  });

  it('renders checked for a menu already in drinks mode', () => {
    const menu = { ...makeMenu('menu-a', 'Bar List'), drinks_only: true } as MenuSummary;
    renderPanel({ menu, allMenus: [menu, makeMenu('menu-b', 'Dinner')] }, drinksService());
    expect(screen.getByTestId('menu-drinks-only')).toBeChecked();
  });

  it('does NOT switch immediately — it opens a confirmation first', async () => {
    const service = drinksService();
    renderPanel(
      { menu: makeMenu('menu-a', 'Lunch'), allMenus: [makeMenu('menu-a', 'Lunch'), makeMenu('menu-b', 'Dinner')] },
      service,
    );

    fireEvent.click(screen.getByTestId('menu-drinks-only'));

    expect(await screen.findByTestId('drinks-mode-modal')).toBeInTheDocument();
    expect(screen.getByText(CONFIRM_TEXT)).toBeInTheDocument();
    expect(service.setMenuDrinksMode).not.toHaveBeenCalled();
  });

  it('cancelling leaves the menu untouched and the box unchecked', async () => {
    const service = drinksService();
    renderPanel(
      { menu: makeMenu('menu-a', 'Lunch'), allMenus: [makeMenu('menu-a', 'Lunch'), makeMenu('menu-b', 'Dinner')] },
      service,
    );

    fireEvent.click(screen.getByTestId('menu-drinks-only'));
    fireEvent.click(await screen.findByTestId('drinks-mode-cancel'));

    await waitFor(() => {
      expect(screen.queryByTestId('drinks-mode-modal')).not.toBeInTheDocument();
    });
    expect(service.setMenuDrinksMode).not.toHaveBeenCalled();
    expect(screen.getByTestId('menu-drinks-only')).not.toBeChecked();
  });

  it('confirming calls the service and checks the box', async () => {
    const service = drinksService();
    const { onUpdate } = renderPanel(
      { menu: makeMenu('menu-a', 'Lunch'), allMenus: [makeMenu('menu-a', 'Lunch'), makeMenu('menu-b', 'Dinner')] },
      service,
    );

    fireEvent.click(screen.getByTestId('menu-drinks-only'));
    fireEvent.click(await screen.findByTestId('drinks-mode-confirm'));

    await waitFor(() => {
      expect(service.setMenuDrinksMode).toHaveBeenCalledWith('rest-1', 'menu-a', true);
    });
    await waitFor(() => expect(onUpdate).toHaveBeenCalled());
    expect(screen.getByTestId('menu-drinks-only')).toBeChecked();
  });

  it('keeps the box unchecked and shows why when the server refuses', async () => {
    const service = drinksService({
      setMenuDrinksMode: vi
        .fn()
        .mockRejectedValue(new Error('"Bar List" is already this restaurant\'s drinks menu.')),
    });
    renderPanel(
      { menu: makeMenu('menu-a', 'Lunch'), allMenus: [makeMenu('menu-a', 'Lunch'), makeMenu('menu-b', 'Dinner')] },
      service,
    );

    fireEvent.click(screen.getByTestId('menu-drinks-only'));
    fireEvent.click(await screen.findByTestId('drinks-mode-confirm'));

    // Dialog stays open carrying the reason — the 409/400 messages are both
    // actionable, so dismissing them would strand the owner.
    expect(await screen.findByTestId('drinks-mode-error')).toHaveTextContent(/already this restaurant/i);
    expect(screen.getByTestId('drinks-mode-modal')).toBeInTheDocument();
    expect(screen.getByTestId('menu-drinks-only')).not.toBeChecked();
  });

  it('turning drinks mode OFF also requires confirmation', async () => {
    const service = drinksService({
      setMenuDrinksMode: vi
        .fn()
        .mockResolvedValue({ ...makeMenu('menu-a', 'Bar List'), drinks_only: false }),
    });
    const menu = { ...makeMenu('menu-a', 'Bar List'), drinks_only: true } as MenuSummary;
    renderPanel({ menu, allMenus: [menu, makeMenu('menu-b', 'Dinner')] }, service);

    fireEvent.click(screen.getByTestId('menu-drinks-only'));
    expect(await screen.findByTestId('drinks-mode-modal')).toBeInTheDocument();

    fireEvent.click(screen.getByTestId('drinks-mode-confirm'));
    await waitFor(() => {
      expect(service.setMenuDrinksMode).toHaveBeenCalledWith('rest-1', 'menu-a', false);
    });
  });
});
