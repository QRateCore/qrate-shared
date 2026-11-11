// @vitest-environment jsdom
/**
 * Mobile-branch tests for EditModal (STR-858 → Owner Portal redesign 2026-11-10).
 *
 * The rest of the EditModal suite mocks useIsMobile → false, so it only ever
 * exercises the DESKTOP layout (the 210px section rail). This file mocks
 * useIsMobile → true and locks the phone IA:
 *  - the rail is replaced by a full-width section <select>
 *  - one section renders at a time (Basics by default) — no accordion stack
 *  - the camera "Take photo" affordance only exists on phones
 *  - Delete lives behind More actions → 2-step confirm, same as desktop
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import React from 'react';
import EditModal from '../EditModal';
import { MenuManagerServiceProvider } from '../../context';
import type {
  MenuItemDisplay,
  MenuSummary,
  MenuManagerService,
} from '../../../../types/restaurant';

vi.mock('../../../../utils/imageProcessing', () => ({
  processImageForUpload: vi.fn(async (f: File) => f),
}));

// The whole point of this file: force the mobile branch.
vi.mock('../../../../hooks/useIsMobile', () => ({
  useIsMobile: () => true,
}));

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
    menu_associations: [{ menu_id: 'm1', menu_name: 'Dinner' }],
    food_tags: {},
    addons: [],
    sides: [],
    recommendations: [],
    boost_level: null,
    chefs_special: false,
    ...overrides,
  } as unknown as MenuItemDisplay;
}

function makeService(overrides: Partial<MenuManagerService> = {}): MenuManagerService {
  return {
    getAllMenuItems: vi.fn().mockResolvedValue([]),
    getMenus: vi.fn().mockResolvedValue([]),
    addMenuItem: vi.fn().mockResolvedValue(makeDishItem()),
    updateMenuItem: vi.fn().mockResolvedValue(makeDishItem()),
    deleteMenuItem: vi.fn().mockResolvedValue(undefined),
    toggleMenuItemActive: vi.fn().mockResolvedValue(undefined),
    createMenu: vi.fn(),
    updateMenu: vi.fn(),
    deleteMenu: vi.fn(),
    addItemToMenu: vi.fn().mockResolvedValue([]),
    removeItemFromMenu: vi.fn().mockResolvedValue([]),
    updateMenuItemInMenu: vi.fn().mockResolvedValue([]),
    updateItemModifiers: vi.fn().mockResolvedValue(undefined),
    approveAddonSuggestion: vi.fn().mockResolvedValue(undefined),
    getAddonItems: vi.fn().mockResolvedValue([]),
    bulkAssignModifiers: vi.fn().mockResolvedValue({ created: 0, skipped: 0, total: 0 }),
    getMenuItemImageUploadUrl: vi.fn(),
    confirmMenuItemImageUpload: vi.fn(),
    enhanceMenuItemImage: vi.fn(),
    generateMenuItemImage: vi.fn(),
    removeMenuItemImage: vi.fn().mockResolvedValue(undefined),
    getMenuItemPerformance: vi.fn().mockResolvedValue({
      carousel_views: 10, conversions: 2, card_flips: 5, conversion_rate: 20,
    }),
    ...overrides,
  } as unknown as MenuManagerService;
}

function renderMobile(config: { item?: MenuItemDisplay; service?: MenuManagerService } = {}) {
  const { item = makeDishItem(), service = makeService() } = config;
  return render(
    <MenuManagerServiceProvider value={service}>
      <EditModal
        item={item}
        ownerFoodCategories={[]}
        restaurantId="rest-1"
        menus={[] as MenuSummary[]}
        allItems={[]}
        isNewItem={false}
        onClose={vi.fn()}
        onComplete={vi.fn()}
      />
    </MenuManagerServiceProvider>,
  );
}

describe('EditModal — phone layout (section dropdown)', () => {
  beforeEach(() => vi.clearAllMocks());

  it('replaces the desktop rail with a section <select>', () => {
    renderMobile();
    expect(screen.queryByTestId('edit-section-rail')).toBeNull();
    const select = screen.getByTestId('edit-section-select') as HTMLSelectElement;
    expect(select.tagName).toBe('SELECT');
    // Every section an existing dish has, in rail order.
    const values = Array.from(select.options).map((o) => o.value);
    expect(values).toEqual(['food_tags', 'dietary', 'placements', 'advanced', 'performance']);
    expect(screen.getByTestId('edit-item-modal').getAttribute('data-mobile')).toBe('true');
  });

  it('opens on Basics — name + description visible, other sections not mounted', () => {
    renderMobile();
    expect((screen.getByTestId('edit-section-select') as HTMLSelectElement).value).toBe('food_tags');
    expect(screen.getByTestId('edit-name-input')).toBeTruthy();
    expect(screen.getByTestId('edit-description-input')).toBeTruthy();
    expect(screen.queryByTestId('heat-spice-select')).toBeNull();
    expect(screen.queryByTestId('perf-period-select')).toBeNull();
  });

  it('switches section through the dropdown', () => {
    renderMobile();
    fireEvent.change(screen.getByTestId('edit-section-select'), { target: { value: 'dietary' } });
    expect(screen.getByTestId('dietary-info-card')).toBeTruthy();
    expect(screen.getByTestId('heat-spice-select')).toBeTruthy();
    expect(screen.queryByTestId('edit-name-input')).toBeNull();
    fireEvent.change(screen.getByTestId('edit-section-select'), { target: { value: 'performance' } });
    expect(screen.getByTestId('perf-period-select')).toBeTruthy();
  });

  it('offers the camera capture only on phones', () => {
    renderMobile();
    expect(screen.getByTestId('edit-take-photo-btn')).toBeTruthy();
    expect(screen.getByTestId('edit-image-camera-input')).toBeTruthy();
  });

  it('keeps Delete behind More actions → 2-step confirm', () => {
    renderMobile();
    expect(screen.queryByTestId('delete-item-btn')).toBeNull();
    fireEvent.click(screen.getByTestId('edit-more-actions-btn'));
    const triggers = screen.getAllByTestId('delete-item-btn');
    expect(triggers.length).toBe(1);
    fireEvent.click(triggers[0]);
    expect(screen.getByTestId('delete-item-confirm')).toBeTruthy();
    expect(screen.getByTestId('delete-item-cancel')).toBeTruthy();
    expect(screen.queryByTestId('edit-save-btn')).toBeNull();
  });
});
