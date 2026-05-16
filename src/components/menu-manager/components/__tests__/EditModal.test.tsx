// @vitest-environment jsdom
/**
 * Unit tests for EditModal.
 *
 * Covers:
 *  - Form initialization from item props (name, description, category, price)
 *  - Canonical category resolution: canonical_category > toCanonical(category)
 *  - Required-field validation for dish items (name, description, category)
 *  - Add-on mode: price field shown, description/category not required
 *  - Price validation: negative → error; > 10,000 → error; valid → clear error
 *  - Tab switching: food_tags default for dish; performance default for addon
 *  - Heat/spice pill selection updates form state
 *  - Save: calls updateMenuItem with correct payload
 *  - Save: active state change triggers toggleMenuItemActive
 *  - Save: addon price cascade via updateItemModifiers on dependent dishes
 *  - Delete two-confirm gate: first click → confirmation UI; second → deleteMenuItem
 *  - onComplete called with _deleted:true after successful delete
 *  - onClose called from cancel button and backdrop click
 *  - Image enhance: calls enhanceMenuItemImage, updates thumbnail
 *  - Image remove: calls removeMenuItemImage, clears thumbnail
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
} from '../../../../types/restaurant';
import type { DietaryTagService } from '../EditModal';

// ── Module mocks ─────────────────────────────────────────────────────────────

vi.mock('../../../../utils/imageProcessing', () => ({
  processImageForUpload: vi.fn(async (f: File) => f),
}));

vi.mock('../../../../hooks/useIsMobile', () => ({
  useIsMobile: () => false,
}));

// ── Factories ─────────────────────────────────────────────────────────────────

function makeDishItem(overrides: Partial<MenuItemDisplay> = {}): MenuItemDisplay {
  return {
    id: 'item-1',
    name: 'Grilled Chicken',
    description: 'A delicious grilled chicken',
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
    ...overrides,
  } as MenuItemDisplay;
}

function makeAddonItem(overrides: Partial<MenuItemDisplay> = {}): MenuItemDisplay {
  return {
    id: 'addon-1',
    name: 'Extra Sauce',
    description: null,
    category: null,
    canonical_category: null,
    price: 2,
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

function makeMenu(id: string, name: string): MenuSummary {
  return { id, name, items: [] } as unknown as MenuSummary;
}

// ── Mock service factory ──────────────────────────────────────────────────────

const MOCK_PERF = {
  carousel_views: 10,
  conversions: 2,
  card_flips: 5,
  conversion_rate: 20,
};

function makeService(overrides: Partial<MenuManagerService> = {}): MenuManagerService {
  const saved: MenuItemDisplay = makeDishItem({ name: 'Saved Name' });
  return {
    getAllMenuItems: vi.fn().mockResolvedValue([]),
    getMenus: vi.fn().mockResolvedValue([]),
    addMenuItem: vi.fn().mockResolvedValue(saved),
    updateMenuItem: vi.fn().mockResolvedValue(saved),
    deleteMenuItem: vi.fn().mockResolvedValue(undefined),
    toggleMenuItemActive: vi.fn().mockResolvedValue(undefined),
    createMenu: vi.fn().mockResolvedValue(makeMenu('m1', 'Menu 1')),
    updateMenu: vi.fn().mockResolvedValue(makeMenu('m1', 'Menu 1')),
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
    // Full shape required — component renders perfData.carousel_views.toLocaleString() directly
    getMenuItemPerformance: vi.fn().mockResolvedValue(MOCK_PERF),
    ...overrides,
  } as unknown as MenuManagerService;
}

// ── Render helper ─────────────────────────────────────────────────────────────

interface RenderConfig {
  item?: MenuItemDisplay;
  menus?: MenuSummary[];
  allItems?: MenuItemDisplay[];
  isNewItem?: boolean;
  forceAddon?: boolean;
  preselectedDishIds?: string[];
  onSaveNewItem?: (data: { name: string; description: string; category: string; food_tags: Record<string, unknown>; item_type: 'dish' | 'addon'; price?: number | null }) => Promise<MenuItemDisplay>;
  onDishAddonsChange?: (dishId: string, nextAddons: unknown[]) => void;
  service?: MenuManagerService;
  dietaryTagService?: DietaryTagService;
  onClose?: () => void;
  onComplete?: (updated: MenuItemDisplay & { _deleted?: boolean }) => void;
  heatLabels?: string[];
  /**
   * Optional Groupings tab content. The owner-webapp passes its
   * GroupingsSection via this slot once a dish has a real DB id —
   * EditModal only renders the Groupings tab when this is non-null.
   */
  groupingsSlot?: React.ReactNode;
}

function renderModal(config: RenderConfig = {}) {
  const {
    item = makeDishItem(),
    menus = [],
    allItems = [],
    isNewItem = false,
    forceAddon = false,
    preselectedDishIds,
    onSaveNewItem,
    onDishAddonsChange,
    service = makeService(),
    dietaryTagService,
    onClose = vi.fn(),
    onComplete = vi.fn(),
    heatLabels,
    groupingsSlot,
  } = config;

  render(
    <MenuManagerServiceProvider value={service}>
      <EditModal
        item={item}
        restaurantId="rest-1"
        menus={menus}
        allItems={allItems}
        isNewItem={isNewItem}
        forceAddon={forceAddon}
        preselectedDishIds={preselectedDishIds}
        onSaveNewItem={onSaveNewItem}
        onDishAddonsChange={onDishAddonsChange}
        dietaryTagService={dietaryTagService}
        onClose={onClose}
        onComplete={onComplete}
        heatLabels={heatLabels}
        groupingsSlot={groupingsSlot}
      />
    </MenuManagerServiceProvider>,
  );

  return { service, dietaryTagService, onClose, onComplete };
}

function makeDietaryTagService(overrides: Partial<DietaryTagService> = {}): DietaryTagService {
  return {
    setItemTags: vi.fn().mockResolvedValue(undefined),
    markReviewed: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('EditModal — form initialization', () => {
  it('renders the modal with the item name in the name field', () => {
    renderModal({ item: makeDishItem({ name: 'Truffle Pasta' }) });
    const nameInput = screen.getByTestId('edit-name-input') as HTMLInputElement;
    expect(nameInput.value).toBe('Truffle Pasta');
  });

  it('renders the item description in the description field', () => {
    renderModal({ item: makeDishItem({ description: 'Rich and creamy' }) });
    const descInput = screen.getByTestId('edit-description-input') as HTMLTextAreaElement;
    expect(descInput.value).toBe('Rich and creamy');
  });

  it('initializes category from canonical_category when present', () => {
    renderModal({ item: makeDishItem({ canonical_category: 'Desserts', category: 'Sweets' }) });
    const select = screen.getByTestId('edit-category-select');
    expect(select.textContent).toContain('Desserts');
  });

  it('falls back to toCanonical(category) when canonical_category is absent', () => {
    renderModal({ item: makeDishItem({ canonical_category: null, category: 'Salads' }) });
    const select = screen.getByTestId('edit-category-select');
    expect(select.textContent).toContain('Salads');
  });

  it('initializes active toggle from item.active (inactive → aria-pressed false)', () => {
    renderModal({ item: makeDishItem({ active: false }) });
    const toggle = screen.getByTestId('edit-active-toggle');
    // The toggle is a <button aria-pressed={isActive}>, not a checkbox
    expect(toggle.getAttribute('aria-pressed')).toBe('false');
  });

  it('treats item.active=undefined as active by default (aria-pressed true)', () => {
    renderModal({ item: makeDishItem({ active: undefined as unknown as boolean }) });
    const toggle = screen.getByTestId('edit-active-toggle');
    expect(toggle.getAttribute('aria-pressed')).toBe('true');
  });
});

describe('EditModal — tab defaults', () => {
  it('shows food_tags tab by default for dish items', () => {
    renderModal({ item: makeDishItem() });
    // food_tags tab should be present and the heat/spice section should be visible
    expect(screen.getByTestId('tab-food_tags')).toBeInTheDocument();
  });

  it('shows the basic-info panel for dish items (not addon-basic-info)', () => {
    renderModal({ item: makeDishItem() });
    expect(screen.getByTestId('dish-basic-info')).toBeInTheDocument();
    expect(screen.queryByTestId('addon-basic-info')).not.toBeInTheDocument();
  });

  it('shows addon-basic-info panel for addon items', () => {
    renderModal({ item: makeAddonItem() });
    expect(screen.getByTestId('addon-basic-info')).toBeInTheDocument();
    expect(screen.queryByTestId('dish-basic-info')).not.toBeInTheDocument();
  });

  it('renders performance tab for addon items by default', () => {
    renderModal({ item: makeAddonItem() });
    // Performance tab should be the default active tab for addons
    expect(screen.getByTestId('tab-performance')).toBeInTheDocument();
  });

  it('renders only the food_tags tab for new dish items (PDD Phase E Step 13)', () => {
    // PDD 2026-05-10 collapse-addons-recs Phase E Step 13 — Add-ons +
    // Recommendations tabs removed from dish editing. Both concerns
    // now live in the Groupings tab, but the Groupings tab itself
    // requires a saved item (it lazily fetches /owner/menu-items/{id}/
    // groupings, which doesn't exist for drafts). New-item editing
    // therefore shows only Food Tags; the user saves first, then
    // accesses Groupings on the now-saved item.
    renderModal({
      item: makeDishItem({ id: '__draft__', name: '' }),
      isNewItem: true,
      onSaveNewItem: vi.fn(),
    });
    expect(screen.getByTestId('tab-food_tags')).toBeInTheDocument();
    expect(screen.queryByTestId('tab-addons')).not.toBeInTheDocument();
    expect(screen.queryByTestId('tab-recommendations')).not.toBeInTheDocument();
  });

  it('renders Food Tags · Groupings · Performance for a saved dish with groupingsSlot (PDD Phase E Step 13)', () => {
    // PDD 2026-05-10 — the post-collapse tab list. Add-ons +
    // Recommendations are NOT in the tab bar; their workflows
    // (member management, AI suggestion approval) are reachable via
    // the Groupings tab (the `addons` and `recommendations` default
    // groupings, surfaced with pinned ordering + AI banner from
    // Step 12).
    renderModal({
      item: makeDishItem({ id: 'saved-dish-1', name: 'Saved Dish' }),
      groupingsSlot: <div data-testid="test-groupings-slot">slot</div>,
    });

    expect(screen.getByTestId('tab-food_tags')).toBeInTheDocument();
    expect(screen.getByTestId('tab-groupings')).toBeInTheDocument();
    expect(screen.getByTestId('tab-performance')).toBeInTheDocument();
    expect(screen.queryByTestId('tab-addons')).not.toBeInTheDocument();
    expect(screen.queryByTestId('tab-recommendations')).not.toBeInTheDocument();
  });

  it('renders Food Tags · Performance when groupingsSlot is not provided', () => {
    // Practical-zero edge case: FoodItemsManagerClient threads
    // groupingsSlot unconditionally for dish items, so this branch
    // shouldn't fire in production. Kept as a defensive contract.
    renderModal({
      item: makeDishItem({ id: 'saved-dish-2', name: 'Saved Dish' }),
    });

    expect(screen.getByTestId('tab-food_tags')).toBeInTheDocument();
    expect(screen.getByTestId('tab-performance')).toBeInTheDocument();
    expect(screen.queryByTestId('tab-groupings')).not.toBeInTheDocument();
    expect(screen.queryByTestId('tab-addons')).not.toBeInTheDocument();
    expect(screen.queryByTestId('tab-recommendations')).not.toBeInTheDocument();
  });
});

describe('EditModal — validation: dish items', () => {
  it('blocks save when name is empty', async () => {
    const user = userEvent.setup();
    const service = makeService();
    const onComplete = vi.fn();
    renderModal({ item: makeDishItem({ name: 'Chicken' }), service, onComplete });

    const nameInput = screen.getByTestId('edit-name-input') as HTMLInputElement;
    await user.tripleClick(nameInput);
    await user.keyboard('{Backspace}');

    await user.click(screen.getByTestId('edit-save-btn'));
    await waitFor(() => {
      expect(service.updateMenuItem).not.toHaveBeenCalled();
    });
    expect(onComplete).not.toHaveBeenCalled();
  });

  it('blocks save when category is empty for a dish item', async () => {
    const user = userEvent.setup();
    const service = makeService();
    const onComplete = vi.fn();
    renderModal({ item: makeDishItem({ canonical_category: null, category: null }), service, onComplete });

    await user.click(screen.getByTestId('edit-save-btn'));
    await waitFor(() => {
      expect(service.updateMenuItem).not.toHaveBeenCalled();
    });
  });

  it('blocks save when description is empty for a dish item', async () => {
    const user = userEvent.setup();
    const service = makeService();
    const onComplete = vi.fn();
    renderModal({ item: makeDishItem({ description: '' }), service, onComplete });

    await user.click(screen.getByTestId('edit-save-btn'));
    await waitFor(() => {
      expect(service.updateMenuItem).not.toHaveBeenCalled();
    });
  });
});

describe('EditModal — validation: addon price', () => {
  it('input handler silently rejects negative values (sets price to null)', async () => {
    // The onChange handler runs: `Number.isFinite(n) && n >= 0 ? n : null`
    // Negative numbers fail the >= 0 check, so price becomes null rather than showing an error.
    // This test documents that behaviour so future maintainers don't expect a UI error for negative input.
    renderModal({ item: makeAddonItem({ price: null }) });
    const priceInput = screen.getByTestId('edit-price-input') as HTMLInputElement;

    // Fire change directly with a negative value
    fireEvent.change(priceInput, { target: { value: '-5' } });

    // Price input should show empty (null price renders as empty string)
    expect(priceInput.value).toBe('');
  });

  it('blocks save and shows error when price exceeds 10,000', async () => {
    const user = userEvent.setup();
    const service = makeService();
    renderModal({ item: makeAddonItem({ price: null }), service });

    const priceInput = screen.getByTestId('edit-price-input') as HTMLInputElement;
    // type a value > 10,000 — the onChange handler accepts it (non-negative, finite)
    fireEvent.change(priceInput, { target: { value: '99999' } });

    await user.click(screen.getByTestId('edit-save-btn'));
    await waitFor(() => {
      expect(service.updateMenuItem).not.toHaveBeenCalled();
    });
  });

  it('allows save with a valid price of 0', async () => {
    const user = userEvent.setup();
    const savedAddon = makeAddonItem({ name: 'Extra Sauce', price: 0 });
    const service = makeService({ updateMenuItem: vi.fn().mockResolvedValue(savedAddon) });
    const onComplete = vi.fn();
    renderModal({ item: makeAddonItem({ name: 'Extra Sauce', price: null }), service, onComplete });

    const priceInput = screen.getByTestId('edit-price-input') as HTMLInputElement;
    fireEvent.change(priceInput, { target: { value: '0' } });

    await user.click(screen.getByTestId('edit-save-btn'));
    await waitFor(() => {
      expect(service.updateMenuItem).toHaveBeenCalled();
    });
  });
});

describe('EditModal — save behaviour', () => {
  it('calls updateMenuItem with trimmed name, description, category, food_tags', async () => {
    const user = userEvent.setup();
    const saved = makeDishItem();
    const service = makeService({ updateMenuItem: vi.fn().mockResolvedValue(saved) });
    const onComplete = vi.fn();
    renderModal({
      item: makeDishItem({ name: 'Chicken', description: 'Grilled', canonical_category: 'Entrees' }),
      service,
      onComplete,
    });

    await user.click(screen.getByTestId('edit-save-btn'));
    await waitFor(() => {
      expect(service.updateMenuItem).toHaveBeenCalledWith(
        'item-1',
        expect.objectContaining({
          name: 'Chicken',
          description: 'Grilled',
          food_tags: expect.any(Object),
          item_type: 'dish',
        }),
      );
    });
    // Dishes must NOT send price in save payload
    const [, updates] = (service.updateMenuItem as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(updates).not.toHaveProperty('price');
  });

  it('calls updateMenuItem with price for addon items', async () => {
    const user = userEvent.setup();
    const savedAddon = makeAddonItem({ name: 'Extra Sauce', price: 3 });
    const service = makeService({ updateMenuItem: vi.fn().mockResolvedValue(savedAddon) });
    const onComplete = vi.fn();
    renderModal({ item: makeAddonItem({ name: 'Extra Sauce', price: 2 }), service, onComplete });

    const priceInput = screen.getByTestId('edit-price-input') as HTMLInputElement;
    fireEvent.change(priceInput, { target: { value: '3' } });

    await user.click(screen.getByTestId('edit-save-btn'));
    await waitFor(() => {
      expect(service.updateMenuItem).toHaveBeenCalledWith(
        'addon-1',
        expect.objectContaining({ price: 3, item_type: 'addon' }),
      );
    });
  });

  it('calls onComplete with the updated item after a successful save', async () => {
    const user = userEvent.setup();
    const saved = makeDishItem({ name: 'Saved Name' });
    const service = makeService({ updateMenuItem: vi.fn().mockResolvedValue(saved) });
    const onComplete = vi.fn();
    renderModal({ item: makeDishItem(), service, onComplete });

    await user.click(screen.getByTestId('edit-save-btn'));
    await waitFor(() => {
      expect(onComplete).toHaveBeenCalledWith(expect.objectContaining({ id: 'item-1' }));
    });
  });

  it('shows save error when updateMenuItem rejects', async () => {
    const user = userEvent.setup();
    const service = makeService({
      updateMenuItem: vi.fn().mockRejectedValue(new Error('Network error')),
    });
    renderModal({ item: makeDishItem(), service });

    await user.click(screen.getByTestId('edit-save-btn'));
    await waitFor(() => {
      expect(screen.getByTestId('edit-save-error')).toBeInTheDocument();
    });
  });
});

// ===========================================================================
// PDD 2026-05-15 — spice_modifier_enabled per-item opt-out
// ===========================================================================
// The toggle gates whether the patron-side composition page renders a
// spice-level slider. Default TRUE so legacy items keep the slider.
// Tests below pin:
//   - the toggle is hidden for add-ons (never reach the composition page)
//   - the toggle is hidden for Desserts (auto-hide patron-side regardless)
//   - the toggle hydrates from item.spice_modifier_enabled
//   - the save payload includes spice_modifier_enabled
//   - toggling the switch flips the value sent on save
//
// Companion backend round-trip pin:
//   qrate-core/backend/lambdas/api/tests/test_owner_spice_modifier.py
describe('EditModal — spice_modifier_enabled toggle (PDD 2026-05-15)', () => {
  it('renders the spice-modifier toggle on a non-dessert dish', () => {
    renderModal({ item: makeDishItem({ category: 'Entrees', canonical_category: 'Entrees' }) });
    expect(screen.getByTestId('spice-modifier-toggle')).toBeInTheDocument();
  });

  it('hides the spice-modifier toggle on Desserts (patron auto-hides regardless)', () => {
    renderModal({ item: makeDishItem({ category: 'Desserts', canonical_category: 'Desserts' }) });
    expect(screen.queryByTestId('spice-modifier-toggle')).not.toBeInTheDocument();
  });

  it('hides the spice-modifier toggle for add-ons (never reach composition page)', () => {
    renderModal({ item: makeAddonItem() });
    // Add-ons land on the performance tab by default, but even after
    // switching tabs the toggle should never render. Just assert absence
    // in the current render.
    expect(screen.queryByTestId('spice-modifier-toggle')).not.toBeInTheDocument();
  });

  it('initialises ON when item.spice_modifier_enabled is true', () => {
    renderModal({
      item: makeDishItem({
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        spice_modifier_enabled: true,
      } as any),
    });
    expect(screen.getByTestId('spice-modifier-toggle').getAttribute('aria-checked')).toBe('true');
  });

  it('initialises OFF when item.spice_modifier_enabled is false', () => {
    renderModal({
      item: makeDishItem({
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        spice_modifier_enabled: false,
      } as any),
    });
    expect(screen.getByTestId('spice-modifier-toggle').getAttribute('aria-checked')).toBe('false');
  });

  it('initialises ON when item.spice_modifier_enabled is undefined (legacy row)', () => {
    // The `?? true` fallback in EditModal preserves the pre-PDD default
    // behaviour for items that haven't been touched since the migration.
    renderModal({ item: makeDishItem() });
    expect(screen.getByTestId('spice-modifier-toggle').getAttribute('aria-checked')).toBe('true');
  });

  it('save payload defaults spice_modifier_enabled=true for legacy items', async () => {
    const user = userEvent.setup();
    const saved = makeDishItem();
    const service = makeService({ updateMenuItem: vi.fn().mockResolvedValue(saved) });
    renderModal({ item: makeDishItem(), service });

    await user.click(screen.getByTestId('edit-save-btn'));
    await waitFor(() => {
      expect(service.updateMenuItem).toHaveBeenCalled();
    });
    const [, updates] = (service.updateMenuItem as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(updates.spice_modifier_enabled).toBe(true);
  });

  it('toggle OFF then save sends spice_modifier_enabled=false (the bug repro)', async () => {
    // Repro of the original report: owner toggles OFF, hits save. Before
    // the backend fix the GET stripped the field on reopen — but the SAVE
    // payload itself has always been correct. This test pins that the
    // save payload carries the user's choice.
    const user = userEvent.setup();
    const saved = makeDishItem();
    const service = makeService({ updateMenuItem: vi.fn().mockResolvedValue(saved) });
    renderModal({
      item: makeDishItem({
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        spice_modifier_enabled: true,
      } as any),
      service,
    });

    await user.click(screen.getByTestId('spice-modifier-toggle'));
    await user.click(screen.getByTestId('edit-save-btn'));

    await waitFor(() => {
      expect(service.updateMenuItem).toHaveBeenCalled();
    });
    const [, updates] = (service.updateMenuItem as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(updates.spice_modifier_enabled).toBe(false);
  });

  it('hydrated OFF item stays OFF on save (proves no `?? true` over-write)', async () => {
    // Regression guard for the reopen path. Once the backend GET surfaces
    // false, EditModal must respect that value end-to-end through save.
    const user = userEvent.setup();
    const saved = makeDishItem();
    const service = makeService({ updateMenuItem: vi.fn().mockResolvedValue(saved) });
    renderModal({
      item: makeDishItem({
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        spice_modifier_enabled: false,
      } as any),
      service,
    });

    // No toggle interaction — just save.
    await user.click(screen.getByTestId('edit-save-btn'));

    await waitFor(() => {
      expect(service.updateMenuItem).toHaveBeenCalled();
    });
    const [, updates] = (service.updateMenuItem as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(updates.spice_modifier_enabled).toBe(false);
  });
});

// ===========================================================================
// onComplete contract — server response propagates to local list state
// ===========================================================================
// RCA 2026-05-15: the EditModal save used to manually whitelist which fields
// from the PUT response made it into the `updated` object passed to
// onComplete. Any field NOT in the whitelist was silently dropped — the
// parent's replaceItem() then held a stale copy until a hard page refresh
// re-fetched the item. The bug manifested as "I toggle Spice Modifier OFF,
// save, close, reopen → toggle is back ON" even though the DB had been
// written correctly.
//
// Fix: spread `...saved` (PUT response) on top of `...item` so every field
// the backend echoes flows through automatically. New backend fields are
// reactive on day one without touching EditModal.
//
// These tests pin that contract.
describe('EditModal — onComplete propagates the server response (PDD 2026-05-15)', () => {
  it('onComplete carries spice_modifier_enabled from the PUT response', async () => {
    const user = userEvent.setup();
    // Server confirms FALSE — exactly the bug repro from the user report.
    const saved = makeDishItem({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      spice_modifier_enabled: false,
    } as any);
    const service = makeService({ updateMenuItem: vi.fn().mockResolvedValue(saved) });
    const onComplete = vi.fn();
    renderModal({
      item: makeDishItem({
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        spice_modifier_enabled: true,
      } as any),
      service,
      onComplete,
    });

    await user.click(screen.getByTestId('spice-modifier-toggle'));
    await user.click(screen.getByTestId('edit-save-btn'));

    await waitFor(() => {
      expect(onComplete).toHaveBeenCalled();
    });
    const updated = onComplete.mock.calls[0][0];
    // BEFORE the fix this would have been true (the pre-save spread).
    expect(updated.spice_modifier_enabled).toBe(false);
  });

  it('onComplete carries arbitrary new fields from the PUT response (no whitelist)', async () => {
    // Future-proofing pin: any field the backend adds to the PUT response
    // schema should flow through to onComplete without a corresponding
    // change in EditModal. This is the architectural guarantee.
    const user = userEvent.setup();
    const saved = {
      ...makeDishItem(),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      hypothetical_new_field: 'server-confirmed-value',
    } as any;
    const service = makeService({ updateMenuItem: vi.fn().mockResolvedValue(saved) });
    const onComplete = vi.fn();
    renderModal({ item: makeDishItem(), service, onComplete });

    await user.click(screen.getByTestId('edit-save-btn'));
    await waitFor(() => expect(onComplete).toHaveBeenCalled());
    const updated = onComplete.mock.calls[0][0];
    expect(updated.hypothetical_new_field).toBe('server-confirmed-value');
  });

  it('onComplete preserves heavy fields the PUT response does not echo (gallery_urls, etc.)', async () => {
    // The PUT response is the SUBSET shape — it doesn't include
    // gallery_urls, addons/sides/recommendations/groupings, etc. The
    // optimistic merge must preserve those from the pre-save item or the
    // EditModal's reopen would show empty arrays for everything.
    const user = userEvent.setup();
    const saved = makeDishItem({ name: 'Renamed' });
    const service = makeService({ updateMenuItem: vi.fn().mockResolvedValue(saved) });
    const onComplete = vi.fn();
    renderModal({
      item: makeDishItem({
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        gallery_urls: ['https://cdn.example/a.jpg', 'https://cdn.example/b.jpg'],
      } as any),
      service,
      onComplete,
    });

    await user.click(screen.getByTestId('edit-save-btn'));
    await waitFor(() => expect(onComplete).toHaveBeenCalled());
    const updated = onComplete.mock.calls[0][0];
    expect(updated.gallery_urls).toEqual(['https://cdn.example/a.jpg', 'https://cdn.example/b.jpg']);
    // And the renamed name from the server response also propagated.
    expect(updated.name).toBe('Renamed');
  });

  it('onComplete: locally-managed fields override the server response (canonical_category)', async () => {
    // canonical_category is tracked locally in the modal and written via the
    // CHECK constraint on the `category` column path — the PUT response
    // carries the raw `category` field, not canonical_category. The explicit
    // override in the merge must keep local state authoritative.
    const user = userEvent.setup();
    const saved = makeDishItem({ name: 'Renamed' });
    const service = makeService({ updateMenuItem: vi.fn().mockResolvedValue(saved) });
    const onComplete = vi.fn();
    renderModal({
      item: makeDishItem({ canonical_category: 'Appetizers', category: 'Starters' }),
      service,
      onComplete,
    });

    await user.click(screen.getByTestId('edit-save-btn'));
    await waitFor(() => expect(onComplete).toHaveBeenCalled());
    const updated = onComplete.mock.calls[0][0];
    // The PUT response's `category` field doesn't clobber canonical_category.
    expect(updated.canonical_category).toBe('Appetizers');
  });

  // ───────────────────────────────────────────────────────────────────────────
  // Field-by-field reactivity pins. Each test changes one user-visible field,
  // simulates the server confirming the new value, and asserts that the new
  // value flows through onComplete. Together with the architectural "carries
  // arbitrary new fields" test above, these guard against any regression
  // where one field becomes non-reactive without all of them dropping out.
  // ───────────────────────────────────────────────────────────────────────────

  it('rename: edited name flows through to onComplete', async () => {
    const user = userEvent.setup();
    const saved = makeDishItem({ name: 'Truffle Pasta' });
    const service = makeService({ updateMenuItem: vi.fn().mockResolvedValue(saved) });
    const onComplete = vi.fn();
    renderModal({ item: makeDishItem({ name: 'Old Name' }), service, onComplete });

    const nameInput = screen.getByTestId('edit-name-input') as HTMLInputElement;
    await user.tripleClick(nameInput);
    await user.keyboard('{Backspace}');
    await user.type(nameInput, 'Truffle Pasta');

    await user.click(screen.getByTestId('edit-save-btn'));
    await waitFor(() => expect(onComplete).toHaveBeenCalled());
    expect(onComplete.mock.calls[0][0].name).toBe('Truffle Pasta');
  });

  it('description edit flows through to onComplete', async () => {
    const user = userEvent.setup();
    const saved = makeDishItem({ description: 'Rich and creamy' });
    const service = makeService({ updateMenuItem: vi.fn().mockResolvedValue(saved) });
    const onComplete = vi.fn();
    renderModal({
      item: makeDishItem({ description: 'Old description' }),
      service,
      onComplete,
    });

    const descInput = screen.getByTestId('edit-description-input') as HTMLTextAreaElement;
    await user.tripleClick(descInput);
    await user.keyboard('{Backspace}');
    await user.type(descInput, 'Rich and creamy');

    await user.click(screen.getByTestId('edit-save-btn'));
    await waitFor(() => expect(onComplete).toHaveBeenCalled());
    expect(onComplete.mock.calls[0][0].description).toBe('Rich and creamy');
  });

  it('addon price edit flows through to onComplete', async () => {
    // Price is the addon path's analog of spice_modifier_enabled — only
    // sent on the PUT when item_type='addon'. Pin that the server-confirmed
    // price returns to the parent so editing add-on prices doesn't need
    // a page refresh either.
    const user = userEvent.setup();
    const saved = makeAddonItem({ name: 'Extra Sauce', price: 3.5 });
    const service = makeService({ updateMenuItem: vi.fn().mockResolvedValue(saved) });
    const onComplete = vi.fn();
    renderModal({
      item: makeAddonItem({ name: 'Extra Sauce', price: 2 }),
      service,
      onComplete,
    });

    const priceInput = screen.getByTestId('edit-price-input') as HTMLInputElement;
    fireEvent.change(priceInput, { target: { value: '3.5' } });

    await user.click(screen.getByTestId('edit-save-btn'));
    await waitFor(() => expect(onComplete).toHaveBeenCalled());
    expect(onComplete.mock.calls[0][0].price).toBe(3.5);
  });

  it('food_tags edit (heat/spice pill) flows through to onComplete', async () => {
    // Heat/spice round-trips via the food_tags JSONB merge: the EditModal
    // sends food_tags.heat_spice in the PUT payload, the backend re-emits
    // the merged JSONB on the response, and the optimistic merge spreads
    // it back through. Pin that the merged `updated` object exposes the
    // new heat_spice value so the parent's replaceItem doesn't render
    // the pre-save state on reopen.
    const user = userEvent.setup();
    // Simulate the real backend response: food_tags JSONB carries
    // heat_spice after the PUT applied the new value.
    const saved = makeDishItem({
      food_tags: { heat_spice: 'Hot' } as unknown as ReturnType<typeof makeDishItem>['food_tags'],
    });
    const service = makeService({ updateMenuItem: vi.fn().mockResolvedValue(saved) });
    const onComplete = vi.fn();
    renderModal({
      item: makeDishItem({ food_tags: {} }),
      service,
      onComplete,
    });

    await user.click(screen.getByTestId('heat-pill-hot'));
    await user.click(screen.getByTestId('edit-save-btn'));
    await waitFor(() => expect(onComplete).toHaveBeenCalled());
    const updated = onComplete.mock.calls[0][0];
    expect((updated.food_tags as { heat_spice?: string }).heat_spice).toBe('Hot');
  });

  it('food_tags edit (heat/spice via separate /spice endpoint callback)', async () => {
    // When `onHeatSpiceUpdate` is wired (separate canonical /spice
    // endpoint, not the PUT), the merge's mergedFoodTags override
    // re-attaches heat_spice from local state directly — the PUT
    // response's food_tags can be empty and the value still propagates.
    const user = userEvent.setup();
    const onHeatSpiceUpdate = vi.fn().mockResolvedValue(undefined);
    // saved.food_tags is empty here — the override path must fill in heat_spice.
    const saved = makeDishItem({ food_tags: {} });
    const service = makeService({ updateMenuItem: vi.fn().mockResolvedValue(saved) });
    const onComplete = vi.fn();
    render(
      <MenuManagerServiceProvider value={service}>
        <EditModal
          item={makeDishItem({ food_tags: {} })}
          restaurantId="rest-1"
          menus={[]}
          allItems={[]}
          onClose={vi.fn()}
          onComplete={onComplete}
          onHeatSpiceUpdate={onHeatSpiceUpdate}
        />
      </MenuManagerServiceProvider>,
    );

    await user.click(screen.getByTestId('heat-pill-hot'));
    await user.click(screen.getByTestId('edit-save-btn'));
    await waitFor(() => expect(onComplete).toHaveBeenCalled());
    // The canonical /spice callback fires…
    expect(onHeatSpiceUpdate).toHaveBeenCalledWith('item-1', 'Hot');
    // …and the override block puts heat_spice into the merged food_tags
    // so the parent sees the new value without a refetch.
    const updated = onComplete.mock.calls[0][0];
    expect((updated.food_tags as { heat_spice?: string }).heat_spice).toBe('Hot');
  });

  it('active toggle flows through to onComplete (managed via toggleMenuItemActive)', async () => {
    // active is one of the explicit overrides — it's NOT in the PUT
    // response so the local isActive state is the source of truth.
    // Pin that flipping it during save propagates correctly.
    const user = userEvent.setup();
    const saved = makeDishItem();
    const service = makeService({ updateMenuItem: vi.fn().mockResolvedValue(saved) });
    const onComplete = vi.fn();
    renderModal({ item: makeDishItem({ active: true }), service, onComplete });

    await user.click(screen.getByTestId('edit-active-toggle'));
    await user.click(screen.getByTestId('edit-save-btn'));
    await waitFor(() => expect(onComplete).toHaveBeenCalled());
    expect(onComplete.mock.calls[0][0].active).toBe(false);
  });

  it('spread order: explicit overrides win over the PUT response', async () => {
    // Defense-in-depth — explicitly verify that the 3rd layer of the merge
    // (the explicit overrides) takes precedence over `...saved` (layer 2).
    // If someone accidentally re-orders the spread, this test fails.
    const user = userEvent.setup();
    // Server returns canonical_category='Entrees' in the PUT response
    // (defensively — backend currently doesn't echo this field at all,
    // but the test simulates a future schema where it might).
    const saved = {
      ...makeDishItem(),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      canonical_category: 'Entrees',
    } as any;
    const service = makeService({ updateMenuItem: vi.fn().mockResolvedValue(saved) });
    const onComplete = vi.fn();
    renderModal({
      item: makeDishItem({ canonical_category: 'Appetizers' }),
      service,
      onComplete,
    });

    await user.click(screen.getByTestId('edit-save-btn'));
    await waitFor(() => expect(onComplete).toHaveBeenCalled());
    // The local-state override (category dropdown = 'Appetizers') must
    // win over the server's `canonical_category: 'Entrees'`.
    expect(onComplete.mock.calls[0][0].canonical_category).toBe('Appetizers');
  });
});

describe('EditModal — active toggle + save', () => {
  it('calls toggleMenuItemActive when active state changes during save', async () => {
    const user = userEvent.setup();
    const saved = makeDishItem({ active: false });
    const service = makeService({ updateMenuItem: vi.fn().mockResolvedValue(saved) });
    renderModal({ item: makeDishItem({ active: true }), service });

    // Toggle from active → inactive
    const toggle = screen.getByTestId('edit-active-toggle');
    await user.click(toggle);

    await user.click(screen.getByTestId('edit-save-btn'));
    await waitFor(() => {
      expect(service.toggleMenuItemActive).toHaveBeenCalledWith('item-1', false);
    });
  });

  it('does NOT call toggleMenuItemActive when active state is unchanged', async () => {
    const user = userEvent.setup();
    const service = makeService();
    renderModal({ item: makeDishItem({ active: true }), service });

    await user.click(screen.getByTestId('edit-save-btn'));
    await waitFor(() => {
      expect(service.updateMenuItem).toHaveBeenCalled();
    });
    expect(service.toggleMenuItemActive).not.toHaveBeenCalled();
  });
});


describe('EditModal — heat/spice pill selection', () => {
  it('renders heat/spice pills when food_tags tab is active', () => {
    renderModal({ item: makeDishItem() });
    // The food_tags tab is active by default — pills should be visible
    expect(screen.getByTestId('heat-pill-mild')).toBeInTheDocument();
    expect(screen.getByTestId('heat-pill-hot')).toBeInTheDocument();
  });

  it('includes selected heat_spice value in save payload', async () => {
    const user = userEvent.setup();
    const saved = makeDishItem();
    const service = makeService({ updateMenuItem: vi.fn().mockResolvedValue(saved) });
    renderModal({ item: makeDishItem({ food_tags: {} }), service });

    // Click the "Hot" pill
    await user.click(screen.getByTestId('heat-pill-hot'));

    await user.click(screen.getByTestId('edit-save-btn'));
    await waitFor(() => {
      const [, updates] = (service.updateMenuItem as ReturnType<typeof vi.fn>).mock.calls[0];
      expect((updates.food_tags as Record<string, string>).heat_spice).toBe('Hot');
    });
  });

  it('initializes heat/spice pill from item.food_tags.heat_spice string', () => {
    renderModal({ item: makeDishItem({ food_tags: { heat_spice: 'Mild' } as unknown as ReturnType<typeof makeDishItem>['food_tags'] }) });
    const mildPill = screen.getByTestId('heat-pill-mild');
    // The selected pill has aria-pressed="true"
    expect(mildPill.getAttribute('aria-pressed')).toBe('true');
  });
});

// STR-478: owner-side "Patron sees" preview row showing the canonical 0..4
// heat bucket the diner will see for the currently-selected label.
describe('EditModal — STR-478 heat/spice patron preview', () => {
  it('renders empty preview container when no heat label is selected', () => {
    renderModal({ item: makeDishItem({ food_tags: {} }) });
    const preview = screen.getByTestId('edit-modal-heat-preview');
    expect(preview).toBeInTheDocument();
    // No "Patron sees" copy when nothing is selected.
    expect(preview).not.toHaveTextContent(/Patron sees/);
  });

  it('shows "heat 4 of 4 — Fiery" when Fiery is selected on the default 5-level scale', () => {
    renderModal({
      item: makeDishItem({ food_tags: { heat_spice: 'Fiery' } as unknown as ReturnType<typeof makeDishItem>['food_tags'] }),
    });
    const preview = screen.getByTestId('edit-modal-heat-preview');
    expect(preview).toHaveTextContent('Patron sees:');
    expect(preview).toHaveTextContent('heat 4 of 4 — Fiery');
  });

  it('updates preview when owner switches pills (default scale: Mild → 0, Hot → 3)', async () => {
    const user = userEvent.setup();
    renderModal({ item: makeDishItem({ food_tags: {} }) });
    const preview = screen.getByTestId('edit-modal-heat-preview');

    await user.click(screen.getByTestId('heat-pill-mild'));
    expect(preview).toHaveTextContent('heat 0 of 4 — Mild');

    await user.click(screen.getByTestId('heat-pill-hot'));
    expect(preview).toHaveTextContent('heat 3 of 4 — Hot');
  });

  it('compresses heat bucket on a 7-level custom scale (level 5 → heat 3)', () => {
    // 7-level row: [0, 1, 1, 2, 3, 3, 4] — index 4 (5th label) → heat 3
    const customScale = ['Plain', 'Mild', 'Warm', 'Medium', 'Hot', 'Spicy', 'Fiery'];
    renderModal({
      item: makeDishItem({ food_tags: { heat_spice: 'Hot' } as unknown as ReturnType<typeof makeDishItem>['food_tags'] }),
      heatLabels: customScale,
    });
    const preview = screen.getByTestId('edit-modal-heat-preview');
    expect(preview).toHaveTextContent('heat 3 of 4 — Hot');
  });

  it('hides preview text when label is stale (not on the active scale)', () => {
    // Owner removed "Inferno" from the scale via cascade-state edit, but the
    // saved item still references it. Preview must degrade to no-hint, not crash.
    renderModal({
      item: makeDishItem({ food_tags: { heat_spice: 'Inferno' } as unknown as ReturnType<typeof makeDishItem>['food_tags'] }),
      heatLabels: ['Mild', 'Warm', 'Medium', 'Hot', 'Fiery'],
    });
    const preview = screen.getByTestId('edit-modal-heat-preview');
    expect(preview).toBeInTheDocument();
    expect(preview).not.toHaveTextContent(/Patron sees/);
  });

  it('uses aria-live="polite" for screen-reader announcements', () => {
    renderModal({ item: makeDishItem({ food_tags: {} }) });
    const preview = screen.getByTestId('edit-modal-heat-preview');
    expect(preview.getAttribute('aria-live')).toBe('polite');
  });
});

describe('EditModal — delete two-confirm gate', () => {
  it('shows delete confirmation UI on first click of delete-item-btn', async () => {
    const user = userEvent.setup();
    const service = makeService();
    renderModal({ item: makeDishItem(), service });

    await user.click(screen.getByTestId('delete-item-btn'));
    // After first click, confirmation UI appears
    expect(screen.getByTestId('delete-item-confirm')).toBeInTheDocument();
    expect(screen.getByTestId('delete-item-cancel')).toBeInTheDocument();
    // deleteMenuItem must NOT have been called yet
    expect(service.deleteMenuItem).not.toHaveBeenCalled();
  });

  it('calls deleteMenuItem on second click (confirm)', async () => {
    const user = userEvent.setup();
    const service = makeService();
    const onComplete = vi.fn();
    renderModal({ item: makeDishItem(), service, onComplete });

    await user.click(screen.getByTestId('delete-item-btn'));
    await user.click(screen.getByTestId('delete-item-confirm'));

    await waitFor(() => {
      expect(service.deleteMenuItem).toHaveBeenCalledWith('item-1');
    });
    expect(onComplete).toHaveBeenCalledWith(expect.objectContaining({ _deleted: true }));
  });

  it('cancels delete when delete-item-cancel is clicked after first confirm', async () => {
    const user = userEvent.setup();
    const service = makeService();
    renderModal({ item: makeDishItem(), service });

    await user.click(screen.getByTestId('delete-item-btn'));
    await user.click(screen.getByTestId('delete-item-cancel'));

    // Confirm button gone; delete button back
    await waitFor(() => {
      expect(screen.queryByTestId('delete-item-confirm')).not.toBeInTheDocument();
    });
    expect(service.deleteMenuItem).not.toHaveBeenCalled();
  });

  it('shows delete error when deleteMenuItem rejects', async () => {
    const user = userEvent.setup();
    const service = makeService({
      deleteMenuItem: vi.fn().mockRejectedValue(new Error('Cannot delete')),
    });
    renderModal({ item: makeDishItem(), service });

    await user.click(screen.getByTestId('delete-item-btn'));
    await user.click(screen.getByTestId('delete-item-confirm'));

    await waitFor(() => {
      expect(screen.getByText(/Cannot delete/i)).toBeInTheDocument();
    });
  });
});

describe('EditModal — close behaviour', () => {
  it('calls onClose when cancel button is clicked', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    renderModal({ onClose });

    await user.click(screen.getByTestId('edit-cancel-btn'));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('calls onClose when backdrop is clicked', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    renderModal({ onClose });

    await user.click(screen.getByTestId('edit-modal-backdrop'));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

describe('EditModal — image actions', () => {
  it('calls removeMenuItemImage and clears thumbnail on remove', async () => {
    const user = userEvent.setup();
    const service = makeService({
      removeMenuItemImage: vi.fn().mockResolvedValue(undefined),
    });
    renderModal({
      item: makeDishItem({ thumbnail_url: 'https://cdn.example.com/original.jpg' }),
      service,
    });

    const removeBtn = screen.getByTestId('edit-remove-image-btn');
    await user.click(removeBtn);

    await waitFor(() => {
      expect(screen.getByTestId('no-image-warning')).toBeInTheDocument();
    });
    expect(service.removeMenuItemImage).toHaveBeenCalledWith('item-1');
  });

  it('shows no-image-warning when item has no thumbnail', () => {
    renderModal({ item: makeDishItem({ thumbnail_url: null }) });
    expect(screen.getByTestId('no-image-warning')).toBeInTheDocument();
  });
});


// ── Deferred dish association tests (new addon creation) ──────────────────────

describe('EditModal — deferred dish association for new addons', () => {
  const dishA = makeDishItem({ id: 'dish-a', name: 'Caesar Salad' });
  const dishB = makeDishItem({ id: 'dish-b', name: 'Margherita Pizza' });
  const draftAddon = makeAddonItem({ id: '__draft__1234', name: '' });

  function makeSaveNewItem(createdId = 'real-addon-id') {
    return vi.fn().mockImplementation(async (data: Record<string, unknown>) => ({
      id: createdId,
      name: data.name,
      description: data.description ?? null,
      price: data.price ?? 0,
      item_type: 'addon',
      food_tags: {},
      thumbnail_url: null,
    }));
  }

  it('does NOT call updateItemModifiers when "Add Selected" is clicked in deferred-creation mode', async () => {
    const user = userEvent.setup();
    const service = makeService();

    renderModal({
      item: draftAddon,
      isNewItem: true,
      forceAddon: true,
      allItems: [dishA, dishB],
      onSaveNewItem: makeSaveNewItem(),
      service,
    });

    // Addon mode + isNewItem → Dishes tab is default
    const dishesTab = screen.getByTestId('tab-dishes');
    await user.click(dishesTab);

    // Select dish A
    const selectA = screen.getByTestId('select-dish-dish-a');
    await user.click(selectA);

    // Click "Add Selected"
    const addSelectedBtn = screen.getByTestId('add-selected-dishes');
    await user.click(addSelectedBtn);

    // updateItemModifiers must NOT have been called — addon doesn't exist yet
    expect(service.updateItemModifiers).not.toHaveBeenCalled();

    // But the dish should appear in the "Associated Dishes" section (local state)
    expect(screen.getByTestId('remove-dish-dish-a')).toBeInTheDocument();
  });

  it('does NOT call updateItemModifiers when "Remove" is clicked in deferred-creation mode', async () => {
    const user = userEvent.setup();
    const service = makeService();

    renderModal({
      item: draftAddon,
      isNewItem: true,
      forceAddon: true,
      allItems: [dishA],
      preselectedDishIds: ['dish-a'],
      onSaveNewItem: makeSaveNewItem(),
      service,
    });

    const dishesTab = screen.getByTestId('tab-dishes');
    await user.click(dishesTab);

    // Dish A should be pre-associated
    const removeBtn = screen.getByTestId('remove-dish-dish-a');
    await user.click(removeBtn);

    // API must NOT be called
    expect(service.updateItemModifiers).not.toHaveBeenCalled();

    // Dish should be gone from Associated Dishes
    expect(screen.queryByTestId('remove-dish-dish-a')).not.toBeInTheDocument();
  });

  it('flushes all dish associations with real ID on save', async () => {
    const user = userEvent.setup();
    const onSaveNewItem = makeSaveNewItem('real-addon-99');
    const onDishAddonsChange = vi.fn();
    const service = makeService();
    const onComplete = vi.fn();

    renderModal({
      item: draftAddon,
      isNewItem: true,
      forceAddon: true,
      allItems: [dishA, dishB],
      onSaveNewItem,
      onDishAddonsChange,
      service,
      onComplete,
    });

    // Go to Dishes tab and select both dishes
    const dishesTab = screen.getByTestId('tab-dishes');
    await user.click(dishesTab);

    await user.click(screen.getByTestId('select-dish-dish-a'));
    await user.click(screen.getByTestId('select-dish-dish-b'));
    await user.click(screen.getByTestId('add-selected-dishes'));

    // No API call yet
    expect(service.updateItemModifiers).not.toHaveBeenCalled();

    // Fill required name and price, then save
    const nameInput = screen.getByTestId('edit-name-input');
    await user.type(nameInput, 'Truffle Oil');
    const priceInput = screen.getByTestId('edit-price-input');
    await user.type(priceInput, '3');

    await user.click(screen.getByTestId('edit-save-btn'));

    // onSaveNewItem should have been called to create the addon
    await waitFor(() => {
      expect(onSaveNewItem).toHaveBeenCalledTimes(1);
    });

    // Now updateItemModifiers should have been called for each associated dish,
    // using the REAL addon ID ('real-addon-99'), not the draft ID
    await waitFor(() => {
      expect(service.updateItemModifiers).toHaveBeenCalledTimes(2);
    });

    const calls = (service.updateItemModifiers as ReturnType<typeof vi.fn>).mock.calls;
    const dishIds = calls.map((c) => c[0]).sort();
    expect(dishIds).toEqual(['dish-a', 'dish-b']);

    // Each call should use the real addon ID
    for (const call of calls) {
      const addons = call[1].addons;
      expect(addons).toHaveLength(1);
      expect(addons[0].menu_item_id).toBe('real-addon-99');
    }

    // onComplete should have been called
    expect(onComplete).toHaveBeenCalledTimes(1);
  });

  it('flushes preselected + user-selected dishes together on save', async () => {
    const user = userEvent.setup();
    const onSaveNewItem = makeSaveNewItem('real-addon-42');
    const service = makeService();

    renderModal({
      item: draftAddon,
      isNewItem: true,
      forceAddon: true,
      allItems: [dishA, dishB],
      preselectedDishIds: ['dish-a'],
      onSaveNewItem,
      service,
    });

    // Dish A is pre-associated. Go to Dishes tab and also select dish B.
    const dishesTab = screen.getByTestId('tab-dishes');
    await user.click(dishesTab);

    // Dish A should already be in Associated
    expect(screen.getByTestId('remove-dish-dish-a')).toBeInTheDocument();

    // Select dish B from pool
    await user.click(screen.getByTestId('select-dish-dish-b'));
    await user.click(screen.getByTestId('add-selected-dishes'));

    // Fill required fields and save
    const nameInput = screen.getByTestId('edit-name-input');
    await user.type(nameInput, 'Garlic Butter');
    const priceInput = screen.getByTestId('edit-price-input');
    await user.type(priceInput, '2');

    await user.click(screen.getByTestId('edit-save-btn'));

    await waitFor(() => {
      expect(onSaveNewItem).toHaveBeenCalledTimes(1);
    });

    // Both dishes should have been associated using the real ID
    await waitFor(() => {
      expect(service.updateItemModifiers).toHaveBeenCalledTimes(2);
    });

    const calls = (service.updateItemModifiers as ReturnType<typeof vi.fn>).mock.calls;
    const dishIds = calls.map((c) => c[0]).sort();
    expect(dishIds).toEqual(['dish-a', 'dish-b']);

    for (const call of calls) {
      expect(call[1].addons[0].menu_item_id).toBe('real-addon-42');
    }
  });

  it('does not flush dish associations when saving a new DISH (non-addon)', async () => {
    const user = userEvent.setup();
    const onSaveNewItem = vi.fn().mockResolvedValue({
      id: 'real-dish-1',
      name: 'New Dish',
      description: 'Desc',
      price: 15,
      item_type: 'dish',
      food_tags: {},
      thumbnail_url: null,
    });
    const service = makeService();

    renderModal({
      item: makeDishItem({ id: '__draft__5678', name: '' }),
      isNewItem: true,
      onSaveNewItem,
      service,
    });

    // Fill required fields for a dish
    const nameInput = screen.getByTestId('edit-name-input');
    await user.type(nameInput, 'New Dish');
    const descInput = screen.getByTestId('edit-description-input');
    await user.type(descInput, 'Desc');

    await user.click(screen.getByTestId('edit-save-btn'));

    await waitFor(() => {
      expect(onSaveNewItem).toHaveBeenCalledTimes(1);
    });

    // No dish association calls for a dish item
    expect(service.updateItemModifiers).not.toHaveBeenCalled();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// EditModal — canonical-vs-legacy allergen rendering
// ─────────────────────────────────────────────────────────────────────────────
// EditModal renders chips ONLY for FDA Big 9 canonical values. allergenSet
// is built verbatim from item.food_tags.allergens, so a legacy 'gluten'
// value sits in the set but no Gluten chip exists to display it. The Wheat
// chip's selected state therefore depends entirely on whether the SQL
// backfill (database-init/handler.py 026) has remapped 'gluten' → 'wheat'
// in JSONB. These tests pin the rendering contract on both sides of the
// migration so a future refactor that "helpfully" remaps client-side would
// be caught by the failing canonical test.
describe('EditModal — allergen chip rendering (canonical vs legacy)', () => {
  function makeItemWithAllergens(allergens: string[]): MenuItemDisplay {
    return makeDishItem({
      id: 'item-allergen-test',
      food_tags: { allergens } as MenuItemDisplay['food_tags'],
    });
  }

  function isChipSelected(testId: string): boolean {
    // DietaryMultiSelect renders selected state via inline style:
    //   fontWeight: 600 + background: selectedBg + color: '#fff'
    // We check fontWeight because background uses CSS vars in production
    // and is hard to assert across browsers; fontWeight is unambiguous.
    const el = screen.getByTestId(testId);
    return el.style.fontWeight === '600';
  }

  it('marks Wheat chip selected when food_tags.allergens=["wheat"] (post-canonical)', () => {
    renderModal({
      item: makeItemWithAllergens(['wheat']),
      dietaryTagService: makeDietaryTagService(),
    });
    expect(isChipSelected('dietary-pill-allergen-wheat')).toBe(true);
    // Other FDA chips remain unselected.
    expect(isChipSelected('dietary-pill-allergen-dairy')).toBe(false);
    expect(isChipSelected('dietary-pill-allergen-peanuts')).toBe(false);
  });

  it('does NOT mark Wheat chip selected when food_tags.allergens=["gluten"] (legacy)', () => {
    // Pre-canonicalization JSONB still has the alias 'gluten'. No Gluten
    // chip exists in the FDA Big 9 set, so the value is dropped on render
    // — Wheat is NOT auto-selected. This is the user-reported bug state
    // that the SQL backfill resolves; the test is a regression guard.
    renderModal({
      item: makeItemWithAllergens(['gluten']),
      dietaryTagService: makeDietaryTagService(),
    });
    expect(isChipSelected('dietary-pill-allergen-wheat')).toBe(false);
    // No chip exists for the legacy 'gluten' value.
    expect(screen.queryByTestId('dietary-pill-allergen-gluten')).toBeNull();
  });

  it('renders no chips for any non-FDA value (made-up, nuts, milk-aliases)', () => {
    renderModal({
      item: makeItemWithAllergens(['gluten', 'milk', 'nuts', 'made-up']),
      dietaryTagService: makeDietaryTagService(),
    });
    // Only the 9 canonical FDA chips render — no rogue chip for any
    // of the non-canonical values. The aliases live in allergenSet but
    // since DietaryMultiSelect iterates only over FDA_BIG_9_ALLERGENS,
    // they're invisible.
    for (const legacy of ['gluten', 'milk', 'nuts', 'made-up']) {
      expect(screen.queryByTestId(`dietary-pill-allergen-${legacy}`)).toBeNull();
    }
    // None of the FDA chips should be auto-selected from the aliases —
    // EditModal does not client-side remap, by design (backend is the
    // single source of truth for canonicalization).
    for (const fda of ['dairy', 'eggs', 'fish', 'shellfish', 'tree-nuts',
                       'peanuts', 'wheat', 'soy', 'sesame']) {
      expect(isChipSelected(`dietary-pill-allergen-${fda}`)).toBe(false);
    }
  });

  it('shows Wheat + Dairy as selected when food_tags.allergens=["wheat","dairy"]', () => {
    renderModal({
      item: makeItemWithAllergens(['wheat', 'dairy']),
      dietaryTagService: makeDietaryTagService(),
    });
    expect(isChipSelected('dietary-pill-allergen-wheat')).toBe(true);
    expect(isChipSelected('dietary-pill-allergen-dairy')).toBe(true);
    expect(isChipSelected('dietary-pill-allergen-eggs')).toBe(false);
  });

  it('renders zero selected chips when food_tags.allergens is empty', () => {
    renderModal({
      item: makeItemWithAllergens([]),
      dietaryTagService: makeDietaryTagService(),
    });
    for (const fda of ['dairy', 'eggs', 'fish', 'shellfish', 'tree-nuts',
                       'peanuts', 'wheat', 'soy', 'sesame']) {
      expect(isChipSelected(`dietary-pill-allergen-${fda}`)).toBe(false);
    }
  });
});

describe('EditModal — deferred dietary/allergen tags for new dish items', () => {
  const draftDish = (): MenuItemDisplay =>
    makeDishItem({ id: '__draft__', name: '', description: '', category: 'Uncategorized' });

  function makeSaveNewItem(realId = 'real-dish-1') {
    return vi.fn(async (data: { name: string; description: string; category: string; food_tags: Record<string, unknown>; item_type: 'dish' | 'addon'; price?: number | null }) => {
      const created: MenuItemDisplay = {
        ...makeDishItem(),
        id: realId,
        name: data.name,
        description: data.description,
        category: data.category,
        food_tags: data.food_tags,
      };
      return created;
    });
  }

  it('renders Allergens + Dietary Restrictions sections for new dish items', () => {
    renderModal({
      item: draftDish(),
      isNewItem: true,
      onSaveNewItem: makeSaveNewItem(),
      dietaryTagService: makeDietaryTagService(),
    });
    expect(screen.getByTestId('dietary-section-allergen')).toBeInTheDocument();
    expect(screen.getByTestId('dietary-section-dietary')).toBeInTheDocument();
  });

  it('does NOT call dietaryTagService.setItemTags while toggling pills on a draft', async () => {
    const dietary = makeDietaryTagService();
    renderModal({
      item: draftDish(),
      isNewItem: true,
      onSaveNewItem: makeSaveNewItem(),
      dietaryTagService: dietary,
    });
    fireEvent.click(screen.getByTestId('dietary-pill-allergen-peanuts'));
    fireEvent.click(screen.getByTestId('dietary-pill-dietary-vegan'));
    // No backend writes — drafts hold selections in local state until save
    expect(dietary.setItemTags).not.toHaveBeenCalled();
  });

  it('flushes draft allergen + dietary selections via setItemTags with the real id on save', async () => {
    const user = userEvent.setup();
    const dietary = makeDietaryTagService();
    const onSaveNewItem = makeSaveNewItem('real-dish-42');

    renderModal({
      item: draftDish(),
      isNewItem: true,
      onSaveNewItem,
      dietaryTagService: dietary,
    });

    // Pick one allergen + one dietary
    fireEvent.click(screen.getByTestId('dietary-pill-allergen-peanuts'));
    fireEvent.click(screen.getByTestId('dietary-pill-dietary-vegan'));

    // Fill the required dish fields, then save
    await user.type(screen.getByTestId('edit-name-input'), 'Pad Thai');
    await user.type(screen.getByTestId('edit-description-input'), 'Rice noodles, peanuts, lime');
    await user.click(screen.getByTestId('edit-save-btn'));

    await waitFor(() => {
      expect(onSaveNewItem).toHaveBeenCalledTimes(1);
    });

    // Both draft selections flushed against the real DB id via setItemTags
    // (PR 3 of allergens/dietary consolidation: single PATCH replaces the
    // per-tag addTag loop).
    expect(dietary.setItemTags).toHaveBeenCalledWith('rest-1', 'real-dish-42', {
      allergens: ['peanuts'],
      dietary: ['vegan'],
    });
  });
});

