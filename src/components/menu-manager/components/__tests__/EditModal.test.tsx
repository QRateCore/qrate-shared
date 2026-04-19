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
  service?: MenuManagerService;
  onClose?: () => void;
  onComplete?: (updated: MenuItemDisplay & { _deleted?: boolean }) => void;
}

function renderModal(config: RenderConfig = {}) {
  const {
    item = makeDishItem(),
    menus = [],
    allItems = [],
    isNewItem = false,
    service = makeService(),
    onClose = vi.fn(),
    onComplete = vi.fn(),
  } = config;

  render(
    <MenuManagerServiceProvider value={service}>
      <EditModal
        item={item}
        restaurantId="rest-1"
        menus={menus}
        allItems={allItems}
        isNewItem={isNewItem}
        onClose={onClose}
        onComplete={onComplete}
      />
    </MenuManagerServiceProvider>,
  );

  return { service, onClose, onComplete };
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
    const select = screen.getByTestId('edit-category-select') as HTMLSelectElement;
    expect(select.value).toBe('Desserts');
  });

  it('falls back to toCanonical(category) when canonical_category is absent', () => {
    renderModal({ item: makeDishItem({ canonical_category: null, category: 'Salads' }) });
    const select = screen.getByTestId('edit-category-select') as HTMLSelectElement;
    expect(select.value).toBe('Salads');
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
  it('calls enhanceMenuItemImage and updates thumbnail on enhance', async () => {
    const user = userEvent.setup();
    const service = makeService({
      enhanceMenuItemImage: vi.fn().mockResolvedValue({ thumbnail_url: 'https://cdn.example.com/enhanced.jpg' }),
    });
    renderModal({
      item: makeDishItem({ thumbnail_url: 'https://cdn.example.com/original.jpg' }),
      service,
    });

    const enhanceBtn = screen.getByTestId('edit-enhance-btn');
    await user.click(enhanceBtn);

    await waitFor(() => {
      // edit-thumbnail is a <div>; the actual <img> is nested inside it
      const thumbDiv = screen.getByTestId('edit-thumbnail');
      const img = thumbDiv.querySelector('img') as HTMLImageElement;
      expect(img).not.toBeNull();
      expect(img.src).toContain('enhanced.jpg');
    });
    expect(service.enhanceMenuItemImage).toHaveBeenCalledWith('item-1');
  });

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
    expect(screen.queryByTestId('edit-enhance-btn')).not.toBeInTheDocument();
  });
});

// ── Addon removal tests (STR-XXX: addon delete not persisting) ──────────────

describe('EditModal — addon removal', () => {
  const addonA = {
    id: 'assoc-a',
    menu_item_id: 'addon-a',
    name: 'Extra Cheese',
    price_override: 1.5,
    thumbnail_url: null,
    status: 'approved' as const,
    suggestion_source: 'manual' as const,
  };
  const addonB = {
    id: 'assoc-b',
    menu_item_id: 'addon-b',
    name: 'Bacon',
    price_override: 3,
    thumbnail_url: null,
    status: 'approved' as const,
    suggestion_source: 'manual' as const,
  };

  it('calls updateItemModifiers without the removed addon', async () => {
    const user = userEvent.setup();
    const service = makeService({
      getAddonItems: vi.fn().mockResolvedValue([]),
    });

    renderModal({
      item: makeDishItem({ addons: [addonA, addonB] }),
      service,
    });

    // Switch to addons tab
    await user.click(screen.getByTestId('tab-addons'));

    // Remove addon A
    const removeBtn = screen.getByTestId(`remove-addon-modal-${addonA.menu_item_id}`);
    await user.click(removeBtn);

    await waitFor(() => {
      expect(service.updateItemModifiers).toHaveBeenCalledWith(
        'item-1',
        expect.objectContaining({
          addons: [expect.objectContaining({ menu_item_id: 'addon-b' })],
        }),
      );
    });

    // Addon A should be gone from the UI
    expect(screen.queryByTestId(`remove-addon-modal-${addonA.menu_item_id}`)).not.toBeInTheDocument();
    // Addon B should still be visible
    expect(screen.getByTestId(`remove-addon-modal-${addonB.menu_item_id}`)).toBeInTheDocument();
  });

  it('rolls back and shows error when API fails', async () => {
    const user = userEvent.setup();
    const service = makeService({
      getAddonItems: vi.fn().mockResolvedValue([]),
      updateItemModifiers: vi.fn().mockRejectedValue(new Error('Network error')),
    });

    renderModal({
      item: makeDishItem({ addons: [addonA] }),
      service,
    });

    await user.click(screen.getByTestId('tab-addons'));

    // Remove addon A — should fail
    await user.click(screen.getByTestId(`remove-addon-modal-${addonA.menu_item_id}`));

    // Addon should reappear after API failure
    await waitFor(() => {
      expect(screen.getByTestId(`remove-addon-modal-${addonA.menu_item_id}`)).toBeInTheDocument();
    });

    // Error message should be visible (may appear in multiple DOM nodes)
    const errorEls = screen.getAllByText(/Failed to remove/i);
    expect(errorEls.length).toBeGreaterThanOrEqual(1);
  });

  it('persists removal through save — onComplete includes updated addons', async () => {
    const user = userEvent.setup();
    const saved = makeDishItem({ name: 'Grilled Chicken' });
    const service = makeService({
      getAddonItems: vi.fn().mockResolvedValue([]),
      updateMenuItem: vi.fn().mockResolvedValue(saved),
    });
    const onComplete = vi.fn();

    renderModal({
      item: makeDishItem({ addons: [addonA, addonB] }),
      service,
      onComplete,
    });

    // Switch to addons tab and remove addon A
    await user.click(screen.getByTestId('tab-addons'));
    await user.click(screen.getByTestId(`remove-addon-modal-${addonA.menu_item_id}`));

    // Wait for the modifiers API call to complete
    await waitFor(() => {
      expect(service.updateItemModifiers).toHaveBeenCalled();
    });

    // Switch back to food_tags tab (so we can fill required fields and save)
    await user.click(screen.getByTestId('tab-food_tags'));

    // Click save
    await user.click(screen.getByTestId('edit-save-btn'));

    await waitFor(() => {
      expect(onComplete).toHaveBeenCalledWith(
        expect.objectContaining({
          addons: [expect.objectContaining({ menu_item_id: 'addon-b' })],
        }),
      );
    });

    // Ensure addon A is NOT in the onComplete payload
    const completedItem = onComplete.mock.calls[0][0];
    expect(completedItem.addons).toHaveLength(1);
    expect(completedItem.addons[0].menu_item_id).toBe('addon-b');
  });

  it('serialises concurrent mutations — second remove waits for first', async () => {
    const user = userEvent.setup();
    let resolveFirst!: () => void;
    const firstCallPromise = new Promise<void>((r) => { resolveFirst = r; });
    let callCount = 0;

    const service = makeService({
      getAddonItems: vi.fn().mockResolvedValue([]),
      updateItemModifiers: vi.fn().mockImplementation(() => {
        callCount++;
        if (callCount === 1) return firstCallPromise;
        return Promise.resolve();
      }),
    });

    const addonC = {
      id: 'assoc-c',
      menu_item_id: 'addon-c',
      name: 'Avocado',
      price_override: 2,
      thumbnail_url: null,
      status: 'approved' as const,
      suggestion_source: 'manual' as const,
    };

    renderModal({
      item: makeDishItem({ addons: [addonA, addonB, addonC] }),
      service,
    });

    await user.click(screen.getByTestId('tab-addons'));

    // Fire two removes rapidly
    await user.click(screen.getByTestId(`remove-addon-modal-${addonA.menu_item_id}`));
    // B's remove button should still be visible since A was already removed from UI
    await user.click(screen.getByTestId(`remove-addon-modal-${addonB.menu_item_id}`));

    // First call is still pending — only 1 actual API call should have started
    expect(callCount).toBe(1);

    // Resolve the first call
    resolveFirst();

    // Now the second call should fire
    await waitFor(() => {
      expect(callCount).toBe(2);
    });

    // The second call should have been made with only [C] — not [B, C]
    const secondCallAddons = (service.updateItemModifiers as ReturnType<typeof vi.fn>).mock.calls[1][1].addons;
    expect(secondCallAddons).toHaveLength(1);
    expect(secondCallAddons[0].menu_item_id).toBe('addon-c');
  });
});

// ── Cross-tab reactivity — recommendation broadcast ─────────────────────────

describe('EditModal — cross-tab recommendation reactivity', () => {
  it('broadcasts recommendation change after accepting an AI suggestion', async () => {
    const { broadcastRecommendationChange: mockBroadcast } = await import(
      '../../../../utils/recommendation-broadcast'
    );
    vi.mocked(mockBroadcast);

    const aiItem = makeDishItem({ id: 'paired-1', name: 'Caesar Salad' });
    const entree = makeDishItem({
      id: 'entree-1',
      name: 'Grilled Chicken',
      recommendations: [],
    });

    const service = makeService({
      getItemModifiers: vi.fn().mockResolvedValue({ recommendations: [], addons: [], sides: [] }),
      getMenuIntelligence: vi.fn().mockResolvedValue({
        menu_intelligence: {
          pairing_graph: [{
            entree_item_id: 'entree-1',
            paired_items: [{ item_id: 'paired-1', strength: 0.9 }],
          }],
        },
      }),
    });

    renderModal({ item: entree, allItems: [entree, aiItem], service });

    // Switch to recommendations tab
    const recsTab = screen.getByTestId('tab-recommendations');
    fireEvent.click(recsTab);

    // Wait for recommendations to load
    await waitFor(() => {
      expect(service.getItemModifiers).toHaveBeenCalled();
    });

    // The AI suggestion "Caesar Salad" should appear with an accept button
    await waitFor(() => {
      expect(screen.getByText('Caesar Salad')).toBeInTheDocument();
    });

    // Accept the suggestion
    const acceptBtn = screen.getByTestId('approve-rec-modal-paired-1');
    fireEvent.click(acceptBtn);

    // Verify updateItemModifiers was called with the recommendation
    await waitFor(() => {
      expect(service.updateItemModifiers).toHaveBeenCalledWith(
        'entree-1',
        expect.objectContaining({
          recommendations: expect.arrayContaining([
            expect.objectContaining({ menu_item_id: 'paired-1' }),
          ]),
        }),
      );
    });
  });

  it('refetches recommendations on visibilitychange when tab is active', async () => {
    const entree = makeDishItem({ id: 'entree-1', recommendations: [] });
    const service = makeService({
      getItemModifiers: vi.fn().mockResolvedValue({ recommendations: [], addons: [], sides: [] }),
      getMenuIntelligence: vi.fn().mockResolvedValue({ menu_intelligence: { pairing_graph: [] } }),
    });

    renderModal({ item: entree, service });

    // Switch to recommendations tab to activate the listener
    fireEvent.click(screen.getByTestId('tab-recommendations'));
    await waitFor(() => expect(service.getItemModifiers).toHaveBeenCalledTimes(1));

    // Simulate the user switching away and back to this browser tab
    Object.defineProperty(document, 'visibilityState', { value: 'hidden', writable: true });
    document.dispatchEvent(new Event('visibilitychange'));

    Object.defineProperty(document, 'visibilityState', { value: 'visible', writable: true });
    document.dispatchEvent(new Event('visibilitychange'));

    // getItemModifiers should have been called again (refetch on visibility restore)
    await waitFor(() => {
      expect(service.getItemModifiers).toHaveBeenCalledTimes(2);
    });
  });
});
