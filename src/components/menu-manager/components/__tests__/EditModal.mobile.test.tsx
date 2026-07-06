// @vitest-environment jsdom
/**
 * Mobile-branch tests for EditModal (STR-858).
 *
 * The rest of the EditModal suite mocks useIsMobile → false, so it only ever
 * exercises the DESKTOP layout. This file mocks useIsMobile → true and locks
 * the mobile accordion IA:
 *  - the desktop horizontal tab strip is replaced by vertical accordion headers
 *  - tab-backed sections are COLLAPSED by default (Basics content stays visible)
 *  - expanding an accordion header reveals its body
 *  - Delete is relocated out of the header to a single bottom control (behind
 *    the same 2-step confirm)
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

describe('EditModal — mobile accordion (STR-858)', () => {
  beforeEach(() => vi.clearAllMocks());

  it('renders vertical accordion headers instead of the desktop tab strip', () => {
    renderMobile();
    // Food tags + Performance are valid for an existing dish → headers present.
    expect(screen.getByTestId('edit-mobile-section-header-food_tags')).toBeTruthy();
    expect(screen.getByTestId('edit-mobile-section-header-performance')).toBeTruthy();
    // Image gets its own collapsible header too.
    expect(screen.getByTestId('edit-mobile-section-header-image')).toBeTruthy();
  });

  it('collapses tab-backed sections by default (aria-expanded=false)', () => {
    renderMobile();
    const foodTags = screen.getByTestId('edit-mobile-section-header-food_tags');
    expect(foodTags.getAttribute('aria-expanded')).toBe('false');
  });

  it('expands a section when its header is tapped', () => {
    renderMobile();
    const foodTags = screen.getByTestId('edit-mobile-section-header-food_tags');
    fireEvent.click(foodTags);
    expect(foodTags.getAttribute('aria-expanded')).toBe('true');
  });

  it('keeps Basics content (description) visible without expanding anything', () => {
    renderMobile();
    // Description input is part of always-visible Basics on mobile.
    expect(screen.getByTestId('edit-description-input')).toBeTruthy();
  });

  it('relocates Delete to a single bottom control behind the 2-step confirm', () => {
    renderMobile();
    // Exactly one delete trigger (the header one is hidden on mobile).
    const triggers = screen.getAllByTestId('delete-item-btn');
    expect(triggers.length).toBe(1);
    fireEvent.click(triggers[0]);
    // 2-step confirm surfaces the destructive confirm button.
    expect(screen.getByTestId('delete-item-confirm')).toBeTruthy();
  });
});
