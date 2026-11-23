// @vitest-environment jsdom
/**
 * MenuManagerClient — `onEditItem` (the host opens the item editor itself).
 *
 * Owner Menu workspace (2026-11-22, Avi: "the edit modal has to be consistent
 * wherever it is opened up from"): every builder / pool edit and the
 * `openItemId` deep link go to the host's editor, and this client's own
 * EditModal never mounts, and a host refresh re-reads the active menu's
 * structure. Without the prop (admin, waiter) nothing changes.
 *
 * (Factories / mocks copied from MenuManagerClient.edit-drawer.test.tsx.)
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
type PoolMockProps = { onEditItem: (itemId: string) => void };
let lastPoolProps: PoolMockProps | null = null;

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
  default: (props: PoolMockProps) => {
    lastPoolProps = props;
    return <div data-testid="item-pool-mock" />;
  },
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
  lastPoolProps = null;
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

function renderClient(extra: Partial<React.ComponentProps<typeof MenuManagerClient>> = {}) {
  return render(
    <MenuManagerClient
      service={makeService()}
      restaurantId="r1"
      initialItems={[makeItem('A'), makeItem('B')]}
      initialMenus={[makeMenu('menu-1')]}
      refreshing={false}
      editItemDrawerMode
      {...extra}
    />,
  );
}

describe('MenuManagerClient — onEditItem (host editor)', () => {
  it('a builder row edit goes to the host editor; the built-in EditModal never mounts', async () => {
    const onEditItem = vi.fn();
    const { queryByTestId } = renderClient({ onEditItem });
    await act(async () => { lastBuilderProps!.onEditItem('A'); });
    expect(onEditItem).toHaveBeenCalledWith('A');
    expect(queryByTestId('edit-modal-mock')).toBeNull();
    expect(queryByTestId('food-item-edit-drawer')).toBeNull();
    expect(lastEditModalProps).toBeNull();
  });

  it('a pool card edit goes to the host editor too', async () => {
    const onEditItem = vi.fn();
    const { queryByTestId } = renderClient({ onEditItem });
    expect(lastPoolProps).not.toBeNull();
    await act(async () => { lastPoolProps!.onEditItem('B'); });
    expect(onEditItem).toHaveBeenCalledWith('B');
    expect(queryByTestId('edit-modal-mock')).toBeNull();
  });

  it('the openItemId deep link opens the host editor ONCE, not again on an items refresh', async () => {
    const onEditItem = vi.fn();
    const { rerender, queryByTestId } = renderClient({ onEditItem, openItemId: 'A' });
    expect(onEditItem).toHaveBeenCalledTimes(1);
    expect(onEditItem).toHaveBeenCalledWith('A');
    // A refresh hands the client a new items list (the effect re-runs).
    await act(async () => {
      rerender(
        <MenuManagerClient
          service={makeService()}
          restaurantId="r1"
          initialItems={[makeItem('A'), makeItem('B')]}
          initialMenus={[makeMenu('menu-1')]}
          refreshing
          editItemDrawerMode
          onEditItem={onEditItem}
          openItemId="A"
        />,
      );
    });
    await act(async () => {
      rerender(
        <MenuManagerClient
          service={makeService()}
          restaurantId="r1"
          initialItems={[makeItem('A'), makeItem('B'), makeItem('C')]}
          initialMenus={[makeMenu('menu-1')]}
          refreshing={false}
          editItemDrawerMode
          onEditItem={onEditItem}
          openItemId="A"
        />,
      );
    });
    expect(onEditItem).toHaveBeenCalledTimes(1);
    expect(queryByTestId('edit-modal-mock')).toBeNull();
  });

  it('without onEditItem (admin / waiter) the built-in EditModal still opens', async () => {
    const { getByTestId } = renderClient();
    await act(async () => { lastBuilderProps!.onEditItem('A'); });
    expect(getByTestId('edit-modal-mock')).toBeTruthy();
  });

  it('without onEditItem the openItemId deep link still opens the built-in EditModal', async () => {
    const { getByTestId } = renderClient({ openItemId: 'B' });
    expect(getByTestId('edit-modal-mock')).toBeTruthy();
  });
  it('a host refresh (refreshing true → false) re-reads the active menu structure, so an edit made in the host editor shows in the tree', async () => {
    const svc = { ...makeService(), getMenuStructure: vi.fn().mockResolvedValue({ menu_id: 'menu-1', courses: [] }), assignItemToSubcategory: vi.fn() } as MenuManagerService;
    const props = { service: svc, restaurantId: 'r1', initialMenus: [makeMenu('menu-1')], editItemDrawerMode: true } as const;
    const { rerender } = render(<MenuManagerClient {...props} initialItems={[makeItem('A')]} refreshing={false} onEditItem={vi.fn()} />);
    await act(async () => {});
    const before = (svc.getMenuStructure as ReturnType<typeof vi.fn>).mock.calls.length;
    expect(before).toBeGreaterThan(0);
    await act(async () => { rerender(<MenuManagerClient {...props} initialItems={[makeItem('A')]} refreshing onEditItem={vi.fn()} />); });
    await act(async () => { rerender(<MenuManagerClient {...props} initialItems={[makeItem('A')]} refreshing={false} onEditItem={vi.fn()} />); });
    expect((svc.getMenuStructure as ReturnType<typeof vi.fn>).mock.calls.length).toBeGreaterThan(before);
  });

  it('without onEditItem a refresh edge does not re-read the structure (admin / waiter unchanged)', async () => {
    const svc = { ...makeService(), getMenuStructure: vi.fn().mockResolvedValue({ menu_id: 'menu-1', courses: [] }), assignItemToSubcategory: vi.fn() } as MenuManagerService;
    const props = { service: svc, restaurantId: 'r1', initialMenus: [makeMenu('menu-1')], editItemDrawerMode: true } as const;
    const { rerender } = render(<MenuManagerClient {...props} initialItems={[makeItem('A')]} refreshing={false} />);
    await act(async () => {});
    const before = (svc.getMenuStructure as ReturnType<typeof vi.fn>).mock.calls.length;
    await act(async () => { rerender(<MenuManagerClient {...props} initialItems={[makeItem('A')]} refreshing />); });
    await act(async () => { rerender(<MenuManagerClient {...props} initialItems={[makeItem('A')]} refreshing={false} />); });
    expect((svc.getMenuStructure as ReturnType<typeof vi.fn>).mock.calls.length).toBe(before);
  });
});
