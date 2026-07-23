// @vitest-environment jsdom
/**
 * MenuManagerClient — Item Info bulk apply (2026-07-23).
 *
 * Regression guard for the bug reported after shipping the Item Info bulk
 * tab: editing price/boost/chef's-special/portion (or, for wine, By Glass /
 * By Bottle) via BulkMenuSidesPanel required a HARD REFRESH to show up on
 * the menu page. Root cause: the menu section's visible values are driven
 * by `junctionSettings` state (keyed `${menuId}:${itemId}`), NOT directly by
 * `items[].menu_associations`. The generic items→junctionSettings sync
 * effect uses a "prev wins" merge for any key that already exists (it
 * protects OTHER optimistic per-category flows), which silently discarded
 * the fresh price/boost/portion values coming back from the Item Info
 * apply. Fix: `onItemInfoApplied` now ALSO force-writes the touched
 * (menuId, itemId) keys into `junctionSettings` directly, bypassing that
 * "prev wins" merge for exactly the rows just edited — no refresh-edge
 * (the `refreshing` prop toggling true→false) required at all.
 *
 * These tests drive the REAL BulkMenuSidesPanel (not mocked) through the
 * captured MenuBuilder mock's bulk-selection props, exactly mirroring the
 * established pattern in MenuManagerClient.refresh-edge.test.tsx.
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import React from 'react';

import MenuManagerClient from '../MenuManagerClient';
import type {
  MenuItemDisplay,
  MenuSummary,
  MenuAssociation,
  MenuManagerService,
  MenuItemJunctionSettings,
} from '../../../types/restaurant';

// ── Factories ─────────────────────────────────────────────────────────────

function makeAssoc(menuId: string, overrides: Partial<MenuAssociation> = {}): MenuAssociation {
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
    ...overrides,
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
    food_tags: {},
    boost_level: null,
    chefs_special: false,
    menu_associations: [makeAssoc('menu-1')],
    ...overrides,
  } as MenuItemDisplay;
}

function makeMenu(id: string, overrides: Partial<MenuSummary> = {}): MenuSummary {
  return {
    id,
    name: `Menu ${id}`,
    active: true,
    schedule: null,
    items: [],
    ...overrides,
  } as MenuSummary;
}

function makeService(overrides: Partial<MenuManagerService> = {}): MenuManagerService {
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
    ...overrides,
  } as MenuManagerService;
}

// ── Mocks — mirrors MenuManagerClient.refresh-edge.test.tsx's harness ──────

type MenuBuilderMockProps = {
  items: MenuItemDisplay[];
  junctionSettings: Record<string, MenuItemJunctionSettings>;
  bulkSelection: Set<string>;
  onToggleBulkSelection: (itemId: string) => void;
  onOpenBulkPanel: () => void;
};

let lastBuilderProps: MenuBuilderMockProps | null = null;

vi.mock('../components/MenuBuilder', () => ({
  default: (props: MenuBuilderMockProps) => {
    lastBuilderProps = props;
    return <div data-testid="menu-builder-mock" />;
  },
  itemHasAttention: () => false,
}));

vi.mock('../components/ItemPool', () => ({
  default: () => <div data-testid="item-pool-mock" />,
}));
vi.mock('../components/MobileMenuManagerLayout', () => ({
  default: () => <div data-testid="mobile-layout-mock" />,
}));
vi.mock('../components/BulkActionsPanel', () => ({
  default: () => null,
  mergeAssociations: (items: MenuItemDisplay[], updates: Array<{ itemId: string; associations: MenuAssociation[] }>) => {
    const map = new Map(updates.map((u) => [u.itemId, u.associations]));
    return items.map((item) => {
      const assoc = map.get(item.id);
      return assoc !== undefined ? { ...item, menu_associations: assoc } : item;
    });
  },
}));
vi.mock('../components/BulkModifierPanel', () => ({
  default: () => null,
}));
vi.mock('../components/EditModal', () => ({
  default: () => null,
}));
vi.mock('../components/MenuEditPanel', () => ({
  default: () => null,
}));
vi.mock('../../../hooks/useIsMobile', () => ({
  useIsMobile: () => false,
}));
vi.mock('../track-action-context', () => ({
  useTrackAction: () => () => {},
  TrackActionProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

describe('MenuManagerClient — Item Info bulk apply updates the menu section immediately', () => {
  it('editing price via Item Info updates junctionSettings WITHOUT a refreshing edge', async () => {
    const A = makeItem('A', { name: 'Burger', menu_associations: [makeAssoc('menu-1', { price: 10 })] });
    const menus = [makeMenu('menu-1')];
    const updatedAssoc = makeAssoc('menu-1', { price: 18 });
    const onBulkItemInfoForMenuItems = vi.fn(async (_menuId: string, _itemIds: string[], _patch: Partial<MenuItemJunctionSettings>) => [updatedAssoc]);

    render(
      <MenuManagerClient
        service={makeService()}
        restaurantId="r1"
        initialItems={[A]}
        initialMenus={menus}
        initialMenuId="menu-1"
        refreshing={false}
        onBulkItemInfoForMenuItems={onBulkItemInfoForMenuItems}
      />,
    );
    await waitFor(() => expect(lastBuilderProps).toBeTruthy());
    // Baseline — junctionSettings starts at the seeded price.
    expect(lastBuilderProps!.junctionSettings['menu-1:A']?.price).toBe(10);

    // Select item A and open the bulk drawer via the mocked MenuBuilder's
    // captured props (the real trigger UI lives inside MenuBuilder, which
    // is mocked here — this exercises MenuManagerClient's own state wiring).
    await act(async () => {
      lastBuilderProps!.onToggleBulkSelection('A');
    });
    await act(async () => {
      lastBuilderProps!.onOpenBulkPanel();
    });

    // BulkMenuSidesPanel is NOT mocked — it renders for real.
    await screen.findByTestId('bulk-menu-sides-panel');
    fireEvent.click(screen.getByTestId('bulk-menu-sides-tab-itemInfo'));
    fireEvent.change(screen.getByTestId('bulk-item-info-price-A'), { target: { value: '18' } });
    await act(async () => {
      fireEvent.click(screen.getByTestId('bulk-menu-sides-apply-btn'));
      // Flush the apply's internal awaits (onBulkItemInfo + onItemInfoApplied).
      await Promise.resolve();
      await Promise.resolve();
    });

    await waitFor(() => expect(onBulkItemInfoForMenuItems).toHaveBeenCalledWith('menu-1', ['A'], { price: 18 }));

    // The load-bearing assertion: junctionSettings reflects the fresh price
    // immediately — no `refreshing` prop toggle occurred anywhere in this
    // test, so this can ONLY pass via the onItemInfoApplied direct-write
    // fix, not the generic items→junctionSettings "prev wins" sync effect.
    await waitFor(() => expect(lastBuilderProps!.junctionSettings['menu-1:A']?.price).toBe(18));
  });

  it('wine glass/bottle edit updates junctionSettings.serving_price_overrides immediately', async () => {
    const WINE = makeItem('wine-1', {
      name: 'Cabernet',
      food_tags: { beverage: { beverage_type: 'wine' } },
      menu_associations: [
        makeAssoc('menu-1', { price: null, serving_price_overrides: { glass: 1200, bottle: 4800 } }),
      ],
    });
    const menus = [makeMenu('menu-1')];
    const updatedAssoc = makeAssoc('menu-1', {
      price: null,
      serving_price_overrides: { glass: 1200, bottle: 5500 },
    });
    const onBulkItemInfoForMenuItems = vi.fn(async () => [updatedAssoc]);

    render(
      <MenuManagerClient
        service={makeService()}
        restaurantId="r1"
        initialItems={[WINE]}
        initialMenus={menus}
        initialMenuId="menu-1"
        refreshing={false}
        onBulkItemInfoForMenuItems={onBulkItemInfoForMenuItems}
      />,
    );
    await waitFor(() => expect(lastBuilderProps).toBeTruthy());

    await act(async () => {
      lastBuilderProps!.onToggleBulkSelection('wine-1');
    });
    await act(async () => {
      lastBuilderProps!.onOpenBulkPanel();
    });

    await screen.findByTestId('bulk-menu-sides-panel');
    fireEvent.click(screen.getByTestId('bulk-menu-sides-tab-itemInfo'));
    fireEvent.change(screen.getByTestId('bulk-item-info-bottle-wine-1'), { target: { value: '55' } });
    await act(async () => {
      fireEvent.click(screen.getByTestId('bulk-menu-sides-apply-btn'));
      await Promise.resolve();
      await Promise.resolve();
    });

    await waitFor(() =>
      expect(onBulkItemInfoForMenuItems).toHaveBeenCalledWith(
        'menu-1',
        ['wine-1'],
        { serving_price_overrides: { glass: 1200, bottle: 5500 } },
      ),
    );
    await waitFor(() =>
      expect(lastBuilderProps!.junctionSettings['menu-1:wine-1']?.serving_price_overrides).toEqual({
        glass: 1200,
        bottle: 5500,
      }),
    );
  });
});
