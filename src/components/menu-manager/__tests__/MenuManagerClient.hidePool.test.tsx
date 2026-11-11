// @vitest-environment jsdom
/**
 * MenuManagerClient `hidePool` + MenuManagerActions.startPoolDrag (owner Menu
 * workspace, 2026-11-11): the owner draws its own Item library panel, so the
 * built-in ItemPool is left out on desktop; a drag from that panel is staged
 * through startPoolDrag and reaches the builder exactly like a pool drag.
 * Consumers that leave hidePool unset (admin / waiter) keep the pool.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, act } from '@testing-library/react';
import React from 'react';

import MenuManagerClient, { type MenuManagerActions } from '../MenuManagerClient';
import type { MenuItemDisplay, MenuSummary, MenuManagerService } from '../../../types/restaurant';

type BuilderProps = { dragging: { itemIds: string[]; fromMenuId: string | null } | null };
let lastBuilder: BuilderProps | null = null;

vi.mock('../components/MenuBuilder', () => ({
  default: (props: BuilderProps) => { lastBuilder = props; return <div data-testid="menu-builder-mock" />; },
  itemHasAttention: () => false,
}));
vi.mock('../components/ItemPool', () => ({ default: () => <div data-testid="item-pool-mock" /> }));
vi.mock('../components/MobileMenuManagerLayout', () => ({ default: () => <div /> }));
vi.mock('../components/BulkActionsPanel', () => ({ default: () => null }));
vi.mock('../components/BulkModifierPanel', () => ({ default: () => null }));
vi.mock('../components/MenuEditPanel', () => ({ default: () => null }));
vi.mock('../components/EditModal', () => ({ default: () => null }));
vi.mock('../../../hooks/useIsMobile', () => ({ useIsMobile: () => false }));
vi.mock('../track-action-context', () => ({
  useTrackAction: () => () => {},
  TrackActionProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

const item = (id: string) => ({
  id, name: `Item ${id}`, description: null, category: 'Entrees', canonical_category: 'Entrees', price: 10, active: true,
  item_type: 'dish', thumbnail_url: null, food_tags: {}, addons: [], sides: [], recommendations: [], menu_associations: [],
}) as unknown as MenuItemDisplay;
const menu = { id: 'menu-1', name: 'Menu 1', active: true, schedule: null, items: [] } as unknown as MenuSummary;
const service = {
  getAllMenuItems: vi.fn(), getMenus: vi.fn(), addMenuItem: vi.fn(), updateMenuItem: vi.fn(), deleteMenuItem: vi.fn(),
  toggleMenuItemActive: vi.fn(), createMenu: vi.fn(), updateMenu: vi.fn(), deleteMenu: vi.fn(), addItemToMenu: vi.fn(),
  removeItemFromMenu: vi.fn(), updateMenuItemInMenu: vi.fn(), updateItemModifiers: vi.fn(),
} as unknown as MenuManagerService;

function renderClient(hidePool?: boolean) {
  let actions: MenuManagerActions | null = null;
  const utils = render(
    <MenuManagerClient
      service={service}
      restaurantId="r1"
      initialItems={[item('A'), item('B')]}
      initialMenus={[menu]}
      hidePool={hidePool}
      onMenuActionsReady={(a) => { actions = a; }}
    />,
  );
  return { ...utils, actions: () => actions! };
}

beforeEach(() => { lastBuilder = null; });

describe('MenuManagerClient hidePool', () => {
  it('keeps the ItemPool when unset (admin / waiter)', () => {
    const { queryByTestId } = renderClient();
    expect(queryByTestId('item-pool-mock')).not.toBeNull();
  });

  it('leaves the ItemPool out when set; startPoolDrag stages a pool-source drag for the builder', () => {
    const { queryByTestId, actions } = renderClient(true);
    expect(queryByTestId('item-pool-mock')).toBeNull();
    expect(queryByTestId('menu-builder-mock')).not.toBeNull();
    const setData = vi.fn();
    const e = { dataTransfer: { setData, effectAllowed: '', setDragImage: vi.fn() } } as unknown as React.DragEvent;
    act(() => actions().startPoolDrag(e, ['A', 'B']));
    expect(setData).toHaveBeenCalledWith('text/plain', JSON.stringify(['A', 'B']));
    expect(lastBuilder?.dragging).toEqual(expect.objectContaining({ itemIds: ['A', 'B'], fromMenuId: null }));
    act(() => actions().endPoolDrag());
    expect(lastBuilder?.dragging).toBeNull();
  });
});
