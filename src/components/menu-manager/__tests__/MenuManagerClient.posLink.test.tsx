// @vitest-environment jsdom
/**
 * MenuManagerClient — POS product linkage in the Menu Builder's item editor.
 *
 * The Food Items drawer has offered "POS product · Link" inside EditModal
 * since 2026-08-31. The Menu Builder mounts the SAME EditModal and simply
 * never passed the props, so an owner who created a dish here had no way to
 * link it to a POS product and no way to see it was unlinked — and on a POS
 * restaurant an unlinked dish is not orderable at all. Reported on Indian
 * Aroma dev, 2026-09-07.
 *
 * What matters here is the CONTRACT, since the row itself is EditModal's:
 *   1. Opening an item's editor tells the host which item to read linkage for.
 *   2. Once read, EditModal gets a working opener + the linkage to render.
 *   3. Before it is read, the opener is withheld — the row has no "unknown"
 *      state, so rendering early would tell the owner "Not linked" about a
 *      dish that is linked.
 *   4. Consumers that pass no `posLink` at all (waiter / admin) get exactly
 *      the previous behaviour: no POS surface, no host callbacks.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, act } from '@testing-library/react';
import React from 'react';

import MenuManagerClient from '../MenuManagerClient';
import type {
  MenuItemDisplay,
  MenuSummary,
  MenuManagerService,
} from '../../../types/restaurant';

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
    menu_associations: [],
  } as unknown as MenuItemDisplay;
}

function makeMenu(id: string): MenuSummary {
  return { id, name: `Menu ${id}`, active: true, schedule: null, items: [] } as unknown as MenuSummary;
}

type MenuBuilderMockProps = { onEditItem: (itemId: string) => void };

interface EditModalMockProps {
  onOpenPosLink?: () => void;
  posLinkStatus?: string | null;
  posLinkName?: string | null;
  posLinkPrice?: number | null;
  posSellable?: boolean;
}

let lastBuilderProps: MenuBuilderMockProps | null = null;
let lastEditModalProps: EditModalMockProps | null = null;

vi.mock('../components/MenuBuilder', () => ({
  default: (props: MenuBuilderMockProps) => {
    lastBuilderProps = props;
    return <div data-testid="menu-builder-mock" />;
  },
  itemHasAttention: () => false,
}));
vi.mock('../components/ItemPool', () => ({ default: () => <div data-testid="item-pool-mock" /> }));
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
  } as unknown as MenuManagerService;
}

const LINKED = {
  status: 'confirmed' as const,
  name: 'Liquor Draft',
  price: 9,
  sellable: false,
};

function renderClient(posLink?: Parameters<typeof MenuManagerClient>[0]['posLink']) {
  return render(
    <MenuManagerClient
      service={makeService()}
      restaurantId="r1"
      initialItems={[makeItem('A'), makeItem('B')]}
      initialMenus={[makeMenu('menu-1')]}
      refreshing={false}
      editItemDrawerMode
      posLink={posLink}
    />,
  );
}

describe('MenuManagerClient — posLink', () => {
  it('tells the host which item to read linkage for when the editor opens', async () => {
    const onEditorOpen = vi.fn();
    renderClient({ onEditorOpen, onOpen: vi.fn(), state: undefined });

    await act(async () => { lastBuilderProps!.onEditItem('B'); });

    expect(onEditorOpen).toHaveBeenCalledTimes(1);
    expect(onEditorOpen.mock.calls[0][0].id).toBe('B');
  });

  it('hands EditModal a working opener and the linkage once it is read', async () => {
    const onOpen = vi.fn();
    renderClient({ onEditorOpen: vi.fn(), onOpen, state: LINKED });

    // Deliberately NOT the first item in the list: an opener that ignores
    // which item is open would still look correct against items[0].
    await act(async () => { lastBuilderProps!.onEditItem('B'); });

    expect(lastEditModalProps?.posLinkStatus).toBe('confirmed');
    expect(lastEditModalProps?.posLinkName).toBe('Liquor Draft');
    expect(lastEditModalProps?.posLinkPrice).toBe(9);
    // Confirmed but gated — the dish's required modifier group is unlinked.
    expect(lastEditModalProps?.posSellable).toBe(false);

    expect(typeof lastEditModalProps?.onOpenPosLink).toBe('function');
    act(() => { lastEditModalProps!.onOpenPosLink!(); });
    expect(onOpen).toHaveBeenCalledTimes(1);
    expect(onOpen.mock.calls[0][0].id).toBe('B');
  });

  it('withholds the row until the linkage has actually been read', async () => {
    renderClient({ onEditorOpen: vi.fn(), onOpen: vi.fn(), state: undefined });

    await act(async () => { lastBuilderProps!.onEditItem('A'); });

    expect(lastEditModalProps?.onOpenPosLink).toBeUndefined();
  });

  it('is inert for consumers that pass no posLink (waiter / admin)', async () => {
    renderClient(undefined);

    await act(async () => { lastBuilderProps!.onEditItem('A'); });

    expect(lastEditModalProps).not.toBeNull();
    expect(lastEditModalProps?.onOpenPosLink).toBeUndefined();
    expect(lastEditModalProps?.posLinkStatus).toBeNull();
    // Defaults to sellable: absence of POS wiring must not mark a dish blocked.
    expect(lastEditModalProps?.posSellable).toBe(true);
  });
});
