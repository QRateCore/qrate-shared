// @vitest-environment jsdom
/**
 * MenuManagerClient — handleEditComplete triggers structure refetch AND
 * onRefresh so the menu builder is real-time after a save.
 *
 * Root cause for the pre-fix bug: converting a dish to an add-on (or
 * deleting an item) via EditModal updated local `items` state but did
 * NOT refetch `structureByMenu` or invalidate the page-level TanStack
 * cache. The rendered menu — driven by `structureByMenu` — kept showing
 * the item until a full browser refresh.
 *
 * These tests lock in the two-lever fix:
 *   1. `getMenuStructure(activeMenuId)` is called AGAIN after onComplete
 *      (structureRefreshKey bump).
 *   2. `onRefresh` prop is invoked (TanStack cache invalidation upstream).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, act } from '@testing-library/react';
import React from 'react';

// Enable the first-class sub-category loader so setStructureRefreshKey has
// an effect. Must be set BEFORE MenuManagerClient's module is evaluated.
process.env.NEXT_PUBLIC_SUBCATEGORY_V2 = 'true';

import MenuManagerClient from '../MenuManagerClient';
import type {
  MenuItemDisplay,
  MenuSummary,
  MenuAssociation,
  MenuManagerService,
  MenuStructure,
} from '../../../types/restaurant';

function makeAssoc(menuId: string): MenuAssociation {
  return {
    menu_id: menuId,
    menu_name: `Menu ${menuId}`,
    price: 10,
    category_name: 'Entrees',
    canonical_categories: ['Entrees'],
    boost_level: null,
    chefs_special: false,
    portion_type: 'single',
    portion_serves: null,
  } as MenuAssociation;
}

function makeItem(id: string, overrides: Partial<MenuItemDisplay> = {}): MenuItemDisplay {
  return {
    id,
    name: `Item ${id}`,
    description: null,
    category: 'Entrees',
    canonical_category: 'Entrees',
    price: 10,
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
    menu_associations: [makeAssoc('menu-1')],
    ...overrides,
  } as MenuItemDisplay;
}

function makeMenu(id: string): MenuSummary {
  return {
    id,
    name: `Menu ${id}`,
    active: true,
    schedule: null,
    items: [],
  } as MenuSummary;
}

function makeStructure(): MenuStructure {
  return {
    menu_id: 'menu-1',
    courses: { Entrees: [], Appetizers: [], Sides: [], Desserts: [], Beverages: [], Breads: [], Salads: [], Soups: [] },
  } as unknown as MenuStructure;
}

// ── Mocks ────────────────────────────────────────────────────────────────────

type MenuBuilderMockProps = { onEditItem: (itemId: string) => void };
type EditModalMockProps = {
  onComplete: (updated: MenuItemDisplay & { _deleted?: boolean }) => void;
  onClose: () => void;
};

let lastBuilderProps: MenuBuilderMockProps | null = null;
let lastEditModalProps: EditModalMockProps | null = null;

vi.mock('../components/MenuBuilder', () => ({
  default: (props: MenuBuilderMockProps) => {
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
vi.mock('../components/EditModal', () => ({
  default: (props: EditModalMockProps) => {
    lastEditModalProps = props;
    return <div data-testid="edit-modal-mock" />;
  },
}));
vi.mock('../../../hooks/useIsMobile', () => ({ useIsMobile: () => false }));
vi.mock('../track-action-context', () => ({
  useTrackAction: () => () => {},
  TrackActionProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

beforeEach(() => {
  lastBuilderProps = null;
  lastEditModalProps = null;
});

function makeService(getMenuStructure: ReturnType<typeof vi.fn>): MenuManagerService {
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
    addItemToMenu: vi.fn(),
    removeItemFromMenu: vi.fn(),
    updateMenuItemInMenu: vi.fn(),
    updateItemModifiers: vi.fn(),
    getMenuStructure,
    // Required for subcatV2 to evaluate true (see MenuManagerClient.tsx:466).
    assignItemToSubcategory: vi.fn().mockResolvedValue(undefined),
  } as unknown as MenuManagerService;
}

async function openModalAndSettle(A: MenuItemDisplay, onRefresh: () => void) {
  const getMenuStructure = vi.fn().mockResolvedValue(makeStructure());
  const service = makeService(getMenuStructure);
  render(
    <MenuManagerClient
      service={service}
      restaurantId="r1"
      initialItems={[A]}
      initialMenus={[makeMenu('menu-1')]}
      refreshing={false}
      onRefresh={onRefresh}
    />,
  );

  // Let the initial structure fetch settle.
  await act(async () => { await Promise.resolve(); });
  const initialCalls = getMenuStructure.mock.calls.length;

  // Open the EditModal.
  await act(async () => {
    lastBuilderProps!.onEditItem('A');
  });
  expect(lastEditModalProps).not.toBeNull();

  return { service, getMenuStructure, initialCalls };
}

describe('MenuManagerClient — handleEditComplete: real-time menu refresh', () => {
  it('convert dish→addon: refetches menu-structure and fires onRefresh', async () => {
    const onRefresh = vi.fn();
    const A = makeItem('A');
    const { getMenuStructure, initialCalls } = await openModalAndSettle(A, onRefresh);

    // Simulate the EditModal reporting a converted-to-addon save.
    await act(async () => {
      lastEditModalProps!.onComplete({
        ...A,
        item_type: 'addon',
        menu_associations: [],
      });
    });
    // Structure refetch has to run under the effect flush.
    await act(async () => { await Promise.resolve(); });

    expect(onRefresh).toHaveBeenCalledTimes(1);
    expect(getMenuStructure.mock.calls.length).toBeGreaterThan(initialCalls);
  });

  it('delete item: refetches menu-structure and fires onRefresh', async () => {
    const onRefresh = vi.fn();
    const A = makeItem('A');
    const { getMenuStructure, initialCalls } = await openModalAndSettle(A, onRefresh);

    await act(async () => {
      lastEditModalProps!.onComplete({ ...A, _deleted: true });
    });
    await act(async () => { await Promise.resolve(); });

    expect(onRefresh).toHaveBeenCalledTimes(1);
    expect(getMenuStructure.mock.calls.length).toBeGreaterThan(initialCalls);
  });

  it('plain field save (name change): still fires onRefresh and refetches structure', async () => {
    // A plain save is cheap to re-sync; the trade-off is favouring
    // freshness over saving one GET. This test locks that in — if you
    // ever narrow the refresh to placement-only changes, delete this test.
    const onRefresh = vi.fn();
    const A = makeItem('A');
    const { getMenuStructure, initialCalls } = await openModalAndSettle(A, onRefresh);

    await act(async () => {
      lastEditModalProps!.onComplete({ ...A, name: 'Item A renamed' });
    });
    await act(async () => { await Promise.resolve(); });

    expect(onRefresh).toHaveBeenCalledTimes(1);
    expect(getMenuStructure.mock.calls.length).toBeGreaterThan(initialCalls);
  });
});
