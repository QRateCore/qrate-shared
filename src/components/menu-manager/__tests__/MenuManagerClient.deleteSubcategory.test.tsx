// @vitest-environment jsdom
/**
 * handleDeleteSubCategory — delete a sub-category REMOVES its members from the
 * menu (2026-07-17).
 *
 * Product change: deleting a sub-category used to just drop the group and let
 * its items fall to "Ungrouped" (they stayed on the menu). Now it ALSO removes
 * every member item from THIS menu — the items remain in the Food Library and
 * on any other menus they're on (reversible by re-adding), but they leave this
 * menu along with the group.
 *
 * We capture the `onDeleteSubCategory` prop MenuManagerClient hands to
 * MenuBuilder (the same capture technique the subcatV2-pill-display bundle uses
 * for `getSettings`) and invoke it directly, then assert the exact service
 * calls: one removeItemFromMenu per member, THEN deleteMenuSubcategory for the
 * (now-empty) group.
 */
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, act } from '@testing-library/react';
import React from 'react';

import MenuManagerClient from '../MenuManagerClient';
import type {
  MenuItemDisplay,
  MenuSummary,
  MenuAssociation,
  MenuManagerService,
  MenuStructure,
} from '../../../types/restaurant';

const MENU_ID = 'menu-1';
const COURSE = 'Entrees';
const SUB_ID = 'sub-tandoor';
const SUB_NAME = 'Tandoor Specials';

function assoc(): MenuAssociation {
  return {
    menu_id: MENU_ID,
    menu_name: `Menu ${MENU_ID}`,
    price: 10,
    category_name: COURSE,
    canonical_categories: [COURSE],
    raw_categories: [SUB_NAME],
    boost_level: null,
    chefs_special: false,
    portion_type: 'single',
    portion_serves: null,
  } as MenuAssociation;
}

function makeItem(id: string): MenuItemDisplay {
  return {
    id,
    name: `Item ${id}`,
    description: null,
    category: COURSE,
    canonical_category: COURSE,
    price: 10,
    active: true,
    item_type: 'dish',
    thumbnail_url: null,
    addons: [],
    sides: [],
    recommendations: [],
    food_tags: {},
    menu_associations: [assoc()],
  } as unknown as MenuItemDisplay;
}

function makeMenu(): MenuSummary {
  return { id: MENU_ID, name: `Menu ${MENU_ID}`, active: true, schedule: null, items: [] } as unknown as MenuSummary;
}

// Structure: two members (A, B) sit under the Tandoor Specials sub in Entrees.
function makeStructure(itemIds: string[] = ['A', 'B']): MenuStructure {
  return {
    menu_id: MENU_ID,
    courses: {
      Beverages: [],
      Appetizers: [],
      Entrees: [{ subcategory_id: SUB_ID, name: SUB_NAME, sort_order: 0, item_ids: itemIds, count: itemIds.length }],
      Desserts: [],
    },
  } as unknown as MenuStructure;
}

type BuilderProps = {
  onDeleteSubCategory?: (menuId: string, label: string) => void | Promise<void>;
};
let lastBuilderProps: BuilderProps | null = null;

vi.mock('../components/MenuBuilder', () => ({
  default: (props: BuilderProps) => {
    lastBuilderProps = props;
    return <div data-testid="menu-builder-mock" />;
  },
  itemHasAttention: () => false,
}));
vi.mock('../components/ItemPool', () => ({ default: () => <div /> }));
vi.mock('../components/MobileMenuManagerLayout', () => ({ default: () => <div /> }));
vi.mock('../components/BulkActionsPanel', () => ({ default: () => null }));
vi.mock('../components/BulkModifierPanel', () => ({ default: () => null }));
vi.mock('../components/MenuEditPanel', () => ({ default: () => null }));
vi.mock('../components/EditModal', () => ({ default: () => <div data-testid="edit-modal-mock" /> }));
vi.mock('../../../hooks/useIsMobile', () => ({ useIsMobile: () => false }));
vi.mock('../track-action-context', () => ({
  useTrackAction: () => () => {},
  TrackActionProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

function makeService(structure: MenuStructure = makeStructure()): MenuManagerService {
  return {
    getAllMenuItems: vi.fn(),
    getMenus: vi.fn(),
    addMenuItem: vi.fn(),
    updateMenuItem: vi.fn(),
    deleteMenuItem: vi.fn(),
    toggleMenuItemActive: vi.fn(),
    createMenu: vi.fn(),
    updateMenu: vi.fn(),
    deleteMenu: vi.fn(),
    addItemToMenu: vi.fn().mockResolvedValue([]),
    removeItemFromMenu: vi.fn().mockResolvedValue([]),
    updateMenuItemInMenu: vi.fn(),
    updateItemModifiers: vi.fn(),
    getMenuStructure: vi.fn().mockResolvedValue(structure),
    assignItemToSubcategory: vi.fn().mockResolvedValue(undefined),
    deleteMenuSubcategory: vi.fn().mockResolvedValue(undefined),
  } as unknown as MenuManagerService;
}

async function renderAndSettle(service: MenuManagerService, items: MenuItemDisplay[]) {
  lastBuilderProps = null;
  render(
    <MenuManagerClient
      service={service}
      restaurantId="r1"
      initialItems={items}
      initialMenus={[makeMenu()]}
      refreshing={false}
      onRefresh={vi.fn()}
    />,
  );
  // Flush the structure fetch + its setState so structureByMenu[MENU_ID] is populated.
  await act(async () => { await Promise.resolve(); await Promise.resolve(); });
  expect(lastBuilderProps).not.toBeNull();
}

const call = (fn: unknown) => fn as ReturnType<typeof vi.fn>;

afterEach(() => vi.clearAllMocks());
beforeEach(() => { lastBuilderProps = null; });

describe('handleDeleteSubCategory removes members from the menu', () => {
  it('removes every member from this menu, THEN deletes the (now-empty) sub-category', async () => {
    const service = makeService(makeStructure(['A', 'B']));
    await renderAndSettle(service, [makeItem('A'), makeItem('B')]);

    await act(async () => {
      await lastBuilderProps!.onDeleteSubCategory!(MENU_ID, SUB_NAME);
    });

    // One removeItemFromMenu per member of the sub-category, scoped to THIS menu.
    expect(call(service.removeItemFromMenu)).toHaveBeenCalledTimes(2);
    expect(call(service.removeItemFromMenu)).toHaveBeenCalledWith('A', MENU_ID);
    expect(call(service.removeItemFromMenu)).toHaveBeenCalledWith('B', MENU_ID);
    // The sub-category itself is deleted by id after its members are gone.
    expect(call(service.deleteMenuSubcategory)).toHaveBeenCalledWith(MENU_ID, SUB_ID);
  });

  it('deletes an EMPTY sub-category without any member removals', async () => {
    const service = makeService(makeStructure([]));
    await renderAndSettle(service, [makeItem('A'), makeItem('B')]);

    await act(async () => {
      await lastBuilderProps!.onDeleteSubCategory!(MENU_ID, SUB_NAME);
    });

    expect(call(service.removeItemFromMenu)).not.toHaveBeenCalled();
    expect(call(service.deleteMenuSubcategory)).toHaveBeenCalledWith(MENU_ID, SUB_ID);
  });

  it('never permanently deletes the underlying food items (Library-safe)', async () => {
    const service = makeService(makeStructure(['A', 'B']));
    await renderAndSettle(service, [makeItem('A'), makeItem('B')]);

    await act(async () => {
      await lastBuilderProps!.onDeleteSubCategory!(MENU_ID, SUB_NAME);
    });

    // The destructive whole-catalog delete must NOT be used — items stay in the
    // Food Library and on other menus.
    expect(call(service.deleteMenuItem)).not.toHaveBeenCalled();
  });

  it('is a no-op (with a toast, no throw) when the label is not found in the structure', async () => {
    const service = makeService(makeStructure(['A']));
    await renderAndSettle(service, [makeItem('A')]);

    await act(async () => {
      await lastBuilderProps!.onDeleteSubCategory!(MENU_ID, 'Nonexistent Group');
    });

    expect(call(service.removeItemFromMenu)).not.toHaveBeenCalled();
    expect(call(service.deleteMenuSubcategory)).not.toHaveBeenCalled();
  });
});
