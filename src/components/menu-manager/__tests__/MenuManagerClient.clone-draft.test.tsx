// @vitest-environment jsdom
/**
 * MenuManagerClient — Duplicate / cloneMenuItem wiring.
 *
 * Asserts that opting into the clone flow (passing `cloneMenuItem`)
 * mounts a second EditModal in cloneMode when the user clicks Duplicate
 * inside the primary EditModal, and that the clone draft routes Save
 * Copy back through the consumer's clone callback.
 *
 * Coverage:
 *   1. `cloneMenuItem` omitted → primary EditModal does NOT receive an
 *      onCloneRequest prop (Duplicate button hidden downstream).
 *   2. `cloneMenuItem` provided → primary EditModal receives onCloneRequest;
 *      invoking it closes the primary editor and mounts a second EditModal
 *      with cloneMode=true, the source name carried as cloneSourceName, and
 *      the item seeded as `"<source> (Copy)"`.
 *   3. The clone draft's onCloneSave forwards (sourceId, newName) to the
 *      consumer's cloneMenuItem prop.
 *   4. The clone draft's onClose clears the cloneDraft state (no second
 *      EditModal in the tree afterwards).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, act } from '@testing-library/react';
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

function makeItem(id: string, name: string): MenuItemDisplay {
  return {
    id,
    name,
    description: 'desc',
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

// Track every EditModal mount so we can assert how many are in the tree
// at once and inspect the props each one received. The clone wiring is
// "primary editor closes, secondary clone editor mounts" — we need to
// see both lifecycles.
type CapturedEditModalProps = {
  item: MenuItemDisplay;
  cloneMode?: boolean;
  cloneSourceName?: string;
  sourceItemId?: string;
  isNewItem?: boolean;
  onClose: () => void;
  onCloneRequest?: (item: MenuItemDisplay) => void;
  onCloneSave?: (sourceItemId: string, newName: string) => Promise<{
    id: string;
    name: string;
    restaurant_id: string;
    item_type?: string;
    source_id?: string;
  }>;
  onComplete: (updated: MenuItemDisplay & { _deleted?: boolean }) => void;
};

let lastBuilderProps: MenuBuilderMockProps | null = null;
let editModalMounts: CapturedEditModalProps[] = [];

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
  default: (props: CapturedEditModalProps) => {
    editModalMounts.push(props);
    return (
      <div
        data-testid="edit-modal-mock"
        data-clone-mode={props.cloneMode ? 'true' : undefined}
        data-source-item-id={props.sourceItemId}
        data-item-name={props.item.name}
      />
    );
  },
}));
vi.mock('../../../hooks/useIsMobile', () => ({ useIsMobile: () => false }));
vi.mock('../track-action-context', () => ({
  useTrackAction: () => () => {},
  TrackActionProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

beforeEach(() => {
  lastBuilderProps = null;
  editModalMounts = [];
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

describe('MenuManagerClient — clone draft wiring', () => {
  it('without cloneMenuItem prop: EditModal does not receive onCloneRequest', async () => {
    const A = makeItem('A', 'Grilled Chicken');
    render(
      <MenuManagerClient
        service={makeService()}
        restaurantId="r1"
        initialItems={[A]}
        initialMenus={[makeMenu('menu-1')]}
        refreshing={false}
      />,
    );
    await act(async () => {
      lastBuilderProps!.onEditItem('A');
    });
    // One EditModal mount — the primary editor.
    expect(editModalMounts).toHaveLength(1);
    expect(editModalMounts[0].onCloneRequest).toBeUndefined();
  });

  it('with cloneMenuItem prop: EditModal receives an onCloneRequest', async () => {
    const A = makeItem('A', 'Grilled Chicken');
    render(
      <MenuManagerClient
        service={makeService()}
        restaurantId="r1"
        initialItems={[A]}
        initialMenus={[makeMenu('menu-1')]}
        refreshing={false}
        cloneMenuItem={vi.fn()}
      />,
    );
    await act(async () => {
      lastBuilderProps!.onEditItem('A');
    });
    expect(editModalMounts).toHaveLength(1);
    expect(typeof editModalMounts[0].onCloneRequest).toBe('function');
  });

  it('clicking Duplicate closes the primary editor and mounts a clone-mode editor', async () => {
    const A = makeItem('A', 'Grilled Chicken');
    render(
      <MenuManagerClient
        service={makeService()}
        restaurantId="r1"
        initialItems={[A]}
        initialMenus={[makeMenu('menu-1')]}
        refreshing={false}
        cloneMenuItem={vi.fn()}
      />,
    );
    await act(async () => {
      lastBuilderProps!.onEditItem('A');
    });
    const primary = editModalMounts[0];
    expect(primary.cloneMode).toBeFalsy();

    // Fire the Duplicate callback the EditModal would call when the
    // owner clicks the button. The shared component closes editItemId
    // and sets cloneDraftSource — the next render replaces the primary
    // mount with the clone draft.
    await act(async () => {
      primary.onCloneRequest!(A);
    });

    // After the click, the most recent mount must be the clone draft
    // with: cloneMode=true, the source name carried as cloneSourceName,
    // sourceItemId pointing at the source row, and the item.name pre-
    // filled as "<source> (Copy)" so the rename gate has something to
    // gate against.
    const clone = editModalMounts[editModalMounts.length - 1];
    expect(clone.cloneMode).toBe(true);
    expect(clone.cloneSourceName).toBe('Grilled Chicken');
    expect(clone.sourceItemId).toBe('A');
    expect(clone.item.name).toBe('Grilled Chicken (Copy)');
    expect(clone.isNewItem).toBe(false);
  });

  it('clone draft forwards onCloneSave to the consumer cloneMenuItem callback', async () => {
    const A = makeItem('A', 'Grilled Chicken');
    const cloneMenuItem = vi.fn().mockResolvedValue({
      id: 'new-1',
      name: 'Spicy Chicken',
      restaurant_id: 'r1',
      item_type: 'dish',
      source_id: 'A',
    });
    render(
      <MenuManagerClient
        service={makeService()}
        restaurantId="r1"
        initialItems={[A]}
        initialMenus={[makeMenu('menu-1')]}
        refreshing={false}
        cloneMenuItem={cloneMenuItem}
      />,
    );
    await act(async () => {
      lastBuilderProps!.onEditItem('A');
    });
    await act(async () => {
      editModalMounts[0].onCloneRequest!(A);
    });
    const clone = editModalMounts[editModalMounts.length - 1];

    await act(async () => {
      await clone.onCloneSave!('A', 'Spicy Chicken');
    });

    expect(cloneMenuItem).toHaveBeenCalledTimes(1);
    expect(cloneMenuItem).toHaveBeenCalledWith('A', 'Spicy Chicken');
  });

  it('clone draft onClose clears the cloneDraft state (no EditModal left)', async () => {
    const A = makeItem('A', 'Grilled Chicken');
    const { queryByTestId } = render(
      <MenuManagerClient
        service={makeService()}
        restaurantId="r1"
        initialItems={[A]}
        initialMenus={[makeMenu('menu-1')]}
        refreshing={false}
        cloneMenuItem={vi.fn()}
      />,
    );
    await act(async () => {
      lastBuilderProps!.onEditItem('A');
    });
    await act(async () => {
      editModalMounts[0].onCloneRequest!(A);
    });
    expect(queryByTestId('edit-modal-mock')).toBeTruthy();

    // Owner dismisses the clone draft without saving.
    await act(async () => {
      editModalMounts[editModalMounts.length - 1].onClose();
    });

    expect(queryByTestId('edit-modal-mock')).toBeNull();
  });
});
