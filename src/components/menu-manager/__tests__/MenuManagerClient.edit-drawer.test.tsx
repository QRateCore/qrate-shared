// @vitest-environment jsdom
/**
 * MenuManagerClient — `editItemDrawerMode` chrome.
 *
 * Asserts that opting into drawer mode wraps the EditModal in the same
 * `food-library-drawer` chrome the Food Item Library uses, and switches
 * EditModal into `displayMode='inline'`. Default behaviour (legacy modal
 * with no chrome) is preserved when the prop is off.
 *
 * Coverage:
 *   1. Default: no drawer chrome; EditModal receives `displayMode='modal'`.
 *   2. Drawer mode: chrome wraps EditModal; EditModal receives `displayMode='inline'`.
 *   3. Overlay click closes the drawer (clears editItemId).
 *   4. Escape on the drawer closes the drawer.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, act, fireEvent } from '@testing-library/react';
import React from 'react';

import MenuManagerClient from '../MenuManagerClient';
import type {
  MenuItemDisplay,
  MenuSummary,
  MenuAssociation,
  MenuManagerService,
} from '../../../types/restaurant';

// ── Factories ────────────────────────────────────────────────────────────────

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

function makeItem(id: string): MenuItemDisplay {
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

// ── Mocks ────────────────────────────────────────────────────────────────────

type MenuBuilderMockProps = {
  onEditItem: (itemId: string) => void;
};

let lastBuilderProps: MenuBuilderMockProps | null = null;
let lastEditModalProps: { displayMode?: string; onClose: () => void } | null = null;

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
vi.mock('../components/BulkActionsPanel', () => ({ default: () => null }));
vi.mock('../components/BulkModifierPanel', () => ({ default: () => null }));
vi.mock('../components/MenuEditPanel', () => ({ default: () => null }));
vi.mock('../components/EditModal', () => ({
  default: (props: { displayMode?: string; onClose: () => void }) => {
    lastEditModalProps = props;
    return <div data-testid="edit-modal-mock" data-display-mode={props.displayMode} />;
  },
}));
vi.mock('../../../hooks/useIsMobile', () => ({
  useIsMobile: () => false,
}));
vi.mock('../track-action-context', () => ({
  useTrackAction: () => () => {},
  TrackActionProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

beforeEach(() => {
  lastBuilderProps = null;
  lastEditModalProps = null;
});

function makeService(): MenuManagerService {
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
  } as MenuManagerService;
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe('MenuManagerClient — editItemDrawerMode', () => {
  it('default (off): no drawer chrome; EditModal receives displayMode=modal', async () => {
    const A = makeItem('A');
    const { getByTestId, queryByTestId } = render(
      <MenuManagerClient
        service={makeService()}
        restaurantId="r1"
        initialItems={[A]}
        initialMenus={[makeMenu('menu-1')]}
        refreshing={false}
      />,
    );
    expect(getByTestId('menu-builder-mock')).toBeTruthy();

    await act(async () => {
      lastBuilderProps!.onEditItem('A');
    });

    expect(getByTestId('edit-modal-mock')).toBeTruthy();
    expect(getByTestId('edit-modal-mock').getAttribute('data-display-mode')).toBe('modal');
    expect(queryByTestId('food-item-edit-drawer')).toBeNull();
    expect(queryByTestId('food-item-edit-drawer-overlay')).toBeNull();
    expect(lastEditModalProps?.displayMode).toBe('modal');
  });

  it('drawer mode on: chrome wraps EditModal; displayMode=inline', async () => {
    const A = makeItem('A');
    const { getByTestId } = render(
      <MenuManagerClient
        service={makeService()}
        restaurantId="r1"
        initialItems={[A]}
        initialMenus={[makeMenu('menu-1')]}
        refreshing={false}
        editItemDrawerMode
      />,
    );

    await act(async () => {
      lastBuilderProps!.onEditItem('A');
    });

    expect(getByTestId('food-item-edit-drawer-overlay')).toBeTruthy();
    const drawer = getByTestId('food-item-edit-drawer');
    expect(drawer).toBeTruthy();
    expect(drawer.getAttribute('role')).toBe('dialog');
    expect(drawer.getAttribute('aria-modal')).toBe('true');
    expect(getByTestId('food-item-profile')).toBeTruthy();
    expect(getByTestId('edit-modal-mock').getAttribute('data-display-mode')).toBe('inline');
    expect(lastEditModalProps?.displayMode).toBe('inline');
  });

  it('drawer mode: clicking the overlay closes the drawer', async () => {
    const A = makeItem('A');
    const { getByTestId, queryByTestId } = render(
      <MenuManagerClient
        service={makeService()}
        restaurantId="r1"
        initialItems={[A]}
        initialMenus={[makeMenu('menu-1')]}
        refreshing={false}
        editItemDrawerMode
      />,
    );

    await act(async () => {
      lastBuilderProps!.onEditItem('A');
    });
    expect(getByTestId('food-item-edit-drawer')).toBeTruthy();

    await act(async () => {
      fireEvent.click(getByTestId('food-item-edit-drawer-overlay'));
    });

    expect(queryByTestId('food-item-edit-drawer')).toBeNull();
    expect(queryByTestId('food-item-edit-drawer-overlay')).toBeNull();
    expect(queryByTestId('edit-modal-mock')).toBeNull();
  });

  it('drawer mode: pressing Escape on the drawer closes it', async () => {
    const A = makeItem('A');
    const { getByTestId, queryByTestId } = render(
      <MenuManagerClient
        service={makeService()}
        restaurantId="r1"
        initialItems={[A]}
        initialMenus={[makeMenu('menu-1')]}
        refreshing={false}
        editItemDrawerMode
      />,
    );

    await act(async () => {
      lastBuilderProps!.onEditItem('A');
    });
    const drawer = getByTestId('food-item-edit-drawer');

    await act(async () => {
      fireEvent.keyDown(drawer, { key: 'Escape' });
    });

    expect(queryByTestId('food-item-edit-drawer')).toBeNull();
    expect(queryByTestId('edit-modal-mock')).toBeNull();
  });
});
