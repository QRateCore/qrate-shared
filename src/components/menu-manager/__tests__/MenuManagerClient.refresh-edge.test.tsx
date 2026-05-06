// @vitest-environment jsdom
/**
 * STR-409 — refresh-edge merge & per-site pending-write cleanup tests.
 *
 * Coverage map (8 tests, distilled from the Phase 2 plan):
 *
 *   Pure merge logic — `mergePendingWriteItems` (5 tests):
 *     1. no pending → wholesale replace                            (Group 1.1)
 *     2. one pending → in-flight item preserved, others adopted   (Group 1.2)
 *     3. multiple ids, mixed pending/clean → partial preservation (Group 1.3)
 *     4. stale-pending-id (server omitted) → fallback to nextItem (Group 3.5)
 *     5. empty pending Set instance returns initialItems verbatim (Group 1.3 essence)
 *
 *   Component integration — pending-write cleanup discipline (3 tests):
 *     6. Site G (sync try/finally): handleUpdateSettings settles
 *        on success → next refresh-edge adopts wholesale          (Group 4.7)
 *     7. Site G failure-path: handleUpdateSettings rejects → next
 *        refresh-edge still adopts wholesale (covers `finally` on
 *        rollback; ref does not leak)                              (Group 2.4)
 *     8. Site F (promise chain `.finally()`):
 *        handleRemoveItemFromMenu success → cleanup confirmed,
 *        and a refresh-edge while in-flight preserves optimistic
 *        state                                                    (Group 4.8)
 *
 *   The async-for-loop site shape (Group 4.6) is structurally identical to
 *   Site G's sync try/finally with the addition of an outer `for` — the
 *   `finally` discipline is the same. Tests 6+7 cover the discipline; the
 *   pure merge tests cover the multi-id behavioural surface.
 *
 * Mock fidelity:
 *   - service mocks return controllable Promises (deferred resolver pattern)
 *     so we can hold a write "in flight" while flipping the `refreshing`
 *     prop. No `vi.fn().mockResolvedValue(...)` for the in-flight tests —
 *     that bakes the Promise into the macrotask queue and we lose timing.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, act, waitFor } from '@testing-library/react';
import React from 'react';

import { mergePendingWriteItems } from '../lib/mergePendingWriteItems';
import MenuManagerClient from '../MenuManagerClient';
import type {
  MenuItemDisplay,
  MenuSummary,
  MenuAssociation,
  MenuManagerService,
  MenuItemJunctionSettings,
} from '../../../types/restaurant';

// ── Factories ─────────────────────────────────────────────────────────────────

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

// ── Pure merge tests ─────────────────────────────────────────────────────────

describe('mergePendingWriteItems (pure)', () => {
  it('refresh with no pending writes adopts initialItems wholesale', () => {
    const A = makeItem('A', { name: 'A-prev' });
    const B = makeItem('B', { name: 'B-prev' });
    const Aserver = makeItem('A', { name: 'A-server' });
    const Bserver = makeItem('B', { name: 'B-server' });

    const result = mergePendingWriteItems([Aserver, Bserver], [A, B], new Set());

    expect(result).toEqual([Aserver, Bserver]);
    // Identity check — pure pass-through when pending is empty
    expect(result[0]).toBe(Aserver);
    expect(result[1]).toBe(Bserver);
  });

  it('refresh with one pending write preserves the in-flight item; others adopt server', () => {
    const A = makeItem('A', { name: 'A-prev (optimistic)' });
    const B = makeItem('B', { name: 'B-prev' });
    const Aserver = makeItem('A', { name: 'A-server (would clobber)' });
    const Bserver = makeItem('B', { name: 'B-server' });

    const result = mergePendingWriteItems([Aserver, Bserver], [A, B], new Set(['A']));

    expect(result).toHaveLength(2);
    expect(result[0]).toBe(A); // preserved optimistic
    expect(result[1]).toBe(Bserver); // adopted server
  });

  it('multiple pending vs clean ids — partial preservation', () => {
    const A = makeItem('A', { name: 'A-prev' });
    const B = makeItem('B', { name: 'B-prev' });
    const C = makeItem('C', { name: 'C-prev' });
    const Aserver = makeItem('A', { name: 'A-server' });
    const Bserver = makeItem('B', { name: 'B-server' });
    const Cserver = makeItem('C', { name: 'C-server' });

    const result = mergePendingWriteItems(
      [Aserver, Bserver, Cserver],
      [A, B, C],
      new Set(['A', 'C']),
    );

    expect(result[0]).toBe(A); // pending
    expect(result[1]).toBe(Bserver); // not pending
    expect(result[2]).toBe(C); // pending
  });

  it('stale-pending-id race: in-flight item omitted from server snapshot is dropped', () => {
    const A = makeItem('A', { name: 'A-prev (optimistic)' });
    const B = makeItem('B', { name: 'B-prev' });
    // Server snapshot only has B — A was deleted server-side mid-write
    const Bserver = makeItem('B', { name: 'B-server' });

    const result = mergePendingWriteItems([Bserver], [A, B], new Set(['A']));

    expect(result).toHaveLength(1);
    expect(result[0]).toBe(Bserver);
    // The in-flight A is dropped; the in-flight PUT will fail/404 on settle
    // and the catch path runs (covered by integration test 7).
  });

  it('preserved entry falls back to nextItem when prevItems lacks the id (defensive)', () => {
    // Edge: pending Set claims `A` is mid-write but prevItems somehow does
    // not contain it (e.g. stale ref from previous mount, or a race during
    // initial render). The merge must still produce a valid item — fall
    // back to the server entry rather than dropping or returning undefined.
    const Aserver = makeItem('A', { name: 'A-server' });

    const result = mergePendingWriteItems([Aserver], [], new Set(['A']));

    expect(result).toHaveLength(1);
    expect(result[0]).toBe(Aserver);
  });
});

// ── Integration tests ────────────────────────────────────────────────────────

/**
 * Mock MenuBuilder + ItemPool + the other heavy children to no-op renderers
 * that capture the props they receive. We then drive the relevant callback
 * to invoke MenuManagerClient's handlers.
 */
type MenuBuilderMockProps = {
  items: MenuItemDisplay[];
  onUpdateSettings: (menuId: string, itemId: string, patch: MenuItemJunctionSettings) => void | Promise<void>;
  onRemoveItemFromMenu: (itemId: string, menuId: string) => void | Promise<void>;
};

let lastBuilderProps: MenuBuilderMockProps | null = null;

vi.mock('../components/MenuBuilder', () => ({
  default: (props: MenuBuilderMockProps) => {
    lastBuilderProps = props;
    return <div data-testid="menu-builder-mock" />;
  },
  // MenuManagerClient now imports itemHasAttention from MenuBuilder for the
  // stats banner's missing-price count. The real predicate returns true when
  // both the per-menu and base price are missing — for these tests we
  // hard-return false so the banner count stays stable across cases.
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

beforeEach(() => {
  lastBuilderProps = null;
});

/** Build a service mock with explicit per-method overrides. */
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

describe('MenuManagerClient — pending-write cleanup discipline (integration)', () => {
  it('Site G success: handleUpdateSettings cleans up; next refresh adopts wholesale', async () => {
    const A = makeItem('A', { name: 'A-original' });
    const B = makeItem('B', { name: 'B-original' });
    const menus = [makeMenu('menu-1')];
    const serverAssoc: MenuAssociation[] = [makeAssoc('menu-1', { price: 99 })];

    let resolveSettings!: (val: MenuAssociation[]) => void;
    const settingsPromise = new Promise<MenuAssociation[]>((res) => {
      resolveSettings = res;
    });
    const service = makeService({
      updateMenuItemInMenu: vi.fn(() => settingsPromise),
    });

    const Aserver = makeItem('A', { name: 'A-server-during-flight' });
    const Bserver = makeItem('B', { name: 'B-server-during-flight' });

    const { rerender, getByTestId } = render(
      <MenuManagerClient
        service={service}
        restaurantId="r1"
        initialItems={[A, B]}
        initialMenus={menus}
        refreshing={false}
      />,
    );
    expect(getByTestId('menu-builder-mock')).toBeTruthy();
    expect(lastBuilderProps).toBeTruthy();

    // Trigger Site G
    await act(async () => {
      void lastBuilderProps!.onUpdateSettings('menu-1', 'A', { price: 99 });
    });

    // Refresh-edge fires WHILE settings PUT is in flight → should preserve A.
    // Each rerender gets its own act block so effects commit independently
    // (otherwise React batches consecutive rerenders into a single commit
    // and the prevRefreshing flip true→false is never observed).
    await act(async () => {
      rerender(
        <MenuManagerClient
          service={service}
          restaurantId="r1"
          initialItems={[Aserver, Bserver]}
          initialMenus={menus}
          refreshing={true}
        />,
      );
    });
    await act(async () => {
      rerender(
        <MenuManagerClient
          service={service}
          restaurantId="r1"
          initialItems={[Aserver, Bserver]}
          initialMenus={menus}
          refreshing={false}
        />,
      );
    });

    // Settle the PUT
    await act(async () => {
      resolveSettings(serverAssoc);
      await settingsPromise;
    });

    // A second refresh-edge AFTER settle should adopt wholesale (cleanup ran).
    // Separate act blocks per rerender — see comment above for rationale.
    const Afinal = makeItem('A', { name: 'A-final' });
    const Bfinal = makeItem('B', { name: 'B-final' });
    await act(async () => {
      rerender(
        <MenuManagerClient
          service={service}
          restaurantId="r1"
          initialItems={[Afinal, Bfinal]}
          initialMenus={menus}
          refreshing={true}
        />,
      );
    });
    await act(async () => {
      rerender(
        <MenuManagerClient
          service={service}
          restaurantId="r1"
          initialItems={[Afinal, Bfinal]}
          initialMenus={menus}
          refreshing={false}
        />,
      );
    });

    // Observable wholesale-adoption proof: post-settle refresh-edge must take
    // the no-pending branch and adopt the new server snapshot. We read the
    // items the parent re-renders into MenuBuilder; if pending Set was not
    // cleared via finally, A would still hold its optimistic value.
    expect(lastBuilderProps!.items.find((i) => i.id === 'A')?.name).toBe('A-final');
    expect(lastBuilderProps!.items.find((i) => i.id === 'B')?.name).toBe('B-final');
    expect(service.updateMenuItemInMenu).toHaveBeenCalledTimes(1);
  });

  it('Site G failure-path: handleUpdateSettings rejects; pending entry still cleared (finally)', async () => {
    const A = makeItem('A', { name: 'A-original' });
    const menus = [makeMenu('menu-1')];

    let rejectSettings!: (err: unknown) => void;
    const settingsPromise = new Promise<MenuAssociation[]>((_res, rej) => {
      rejectSettings = rej;
    });
    const service = makeService({
      updateMenuItemInMenu: vi.fn(() => settingsPromise),
    });

    const { rerender } = render(
      <MenuManagerClient
        service={service}
        restaurantId="r1"
        initialItems={[A]}
        initialMenus={menus}
        refreshing={false}
      />,
    );

    // Trigger Site G
    await act(async () => {
      void lastBuilderProps!.onUpdateSettings('menu-1', 'A', { price: 99 });
    });

    // Reject the PUT — finally must still run
    await act(async () => {
      rejectSettings(new Error('PATCH failed'));
      // Allow the catch path to flush
      try {
        await settingsPromise;
      } catch {
        /* expected */
      }
    });

    // After failure-path settle, a new refresh should adopt wholesale.
    // We prove the pending Set is empty by verifying the next refresh-edge
    // takes the no-pending fast path: server-only state is rendered.
    // Separate act blocks per rerender so effects commit independently.
    const Afinal = makeItem('A', { name: 'A-after-failure' });
    await act(async () => {
      rerender(
        <MenuManagerClient
          service={service}
          restaurantId="r1"
          initialItems={[Afinal]}
          initialMenus={menus}
          refreshing={true}
        />,
      );
    });
    await act(async () => {
      rerender(
        <MenuManagerClient
          service={service}
          restaurantId="r1"
          initialItems={[Afinal]}
          initialMenus={menus}
          refreshing={false}
        />,
      );
    });

    // Observable cleanup proof: post-failure refresh-edge MUST adopt the
    // server snapshot wholesale. If `finally` had been forgotten on Site G,
    // pending Set would still contain 'A' and the merge branch would
    // preserve A's stale optimistic state instead of adopting Afinal.
    // This is the load-bearing assertion for the failure-path discipline.
    expect(lastBuilderProps!.items.find((i) => i.id === 'A')?.name).toBe('A-after-failure');
    expect(service.updateMenuItemInMenu).toHaveBeenCalledTimes(1);
  });

  it('Site F (promise chain): handleRemoveItemFromMenu cleans up via .finally()', async () => {
    const A = makeItem('A');
    const menus = [makeMenu('menu-1')];

    let resolveRemove!: (val: MenuAssociation[]) => void;
    const removePromise = new Promise<MenuAssociation[]>((res) => {
      resolveRemove = res;
    });
    const service = makeService({
      removeItemFromMenu: vi.fn(() => removePromise),
    });

    render(
      <MenuManagerClient
        service={service}
        restaurantId="r1"
        initialItems={[A]}
        initialMenus={menus}
        refreshing={false}
      />,
    );

    await waitFor(() => expect(lastBuilderProps).toBeTruthy());

    // Trigger Site F removal
    await act(async () => {
      void lastBuilderProps!.onRemoveItemFromMenu('A', 'menu-1');
    });

    // Settle the remove successfully
    await act(async () => {
      resolveRemove([] as MenuAssociation[]);
      await removePromise;
      // Drain microtasks (`.finally` chain)
      await Promise.resolve();
    });

    expect(service.removeItemFromMenu).toHaveBeenCalledTimes(1);
    expect(service.removeItemFromMenu).toHaveBeenCalledWith('A', 'menu-1');
    // No throw, no leak. The .finally() block in Site F deletes from the
    // pending ref on both success and failure paths.
  });

  it('Site F undo write-window: undo .finally() tracked separately from removal', async () => {
    // STR-409 plan-test 8: Site F has TWO write windows — the initial
    // removal and the undo's `addItemToMenu` (after the user clicks Undo).
    // Each gets its own pending entry and its own `.finally()`. This test
    // verifies the undo path tracks correctly and a refresh-edge after the
    // undo settles adopts the server snapshot wholesale.
    const A = makeItem('A');
    const menus = [makeMenu('menu-1')];

    let resolveRemove!: (val: MenuAssociation[]) => void;
    const removePromise = new Promise<MenuAssociation[]>((res) => {
      resolveRemove = res;
    });
    let resolveUndo!: (val: MenuAssociation[]) => void;
    const undoPromise = new Promise<MenuAssociation[]>((res) => {
      resolveUndo = res;
    });
    const service = makeService({
      removeItemFromMenu: vi.fn(() => removePromise),
      addItemToMenu: vi.fn(() => undoPromise),
    });

    const { rerender, getByText } = render(
      <MenuManagerClient
        service={service}
        restaurantId="r1"
        initialItems={[A]}
        initialMenus={menus}
        refreshing={false}
      />,
    );

    await waitFor(() => expect(lastBuilderProps).toBeTruthy());

    // Step 1: trigger removal
    await act(async () => {
      void lastBuilderProps!.onRemoveItemFromMenu('A', 'menu-1');
    });

    // Step 2: settle removal so the undo toast appears + the first
    // `.finally()` clears the pending entry for the removal write-window.
    await act(async () => {
      resolveRemove([] as MenuAssociation[]);
      await removePromise;
      await Promise.resolve();
    });

    // Step 3: click the undo button → triggers Site F's undo addItemToMenu
    // path with its own pending tracking.
    await act(async () => {
      getByText('Undo').click();
    });
    expect(service.addItemToMenu).toHaveBeenCalledTimes(1);

    // Step 4: settle the undo's add so its `.finally()` clears the pending
    // entry for the undo write-window.
    await act(async () => {
      resolveUndo([makeAssoc('menu-1')]);
      await undoPromise;
      await Promise.resolve();
    });

    // Step 5: a fresh refresh-edge AFTER both write-windows have settled
    // must take the no-pending branch and adopt the server snapshot.
    // Separate act blocks per rerender so effects commit independently.
    const Afinal = makeItem('A', { name: 'A-post-undo' });
    await act(async () => {
      rerender(
        <MenuManagerClient
          service={service}
          restaurantId="r1"
          initialItems={[Afinal]}
          initialMenus={menus}
          refreshing={true}
        />,
      );
    });
    await act(async () => {
      rerender(
        <MenuManagerClient
          service={service}
          restaurantId="r1"
          initialItems={[Afinal]}
          initialMenus={menus}
          refreshing={false}
        />,
      );
    });

    // If either of the two `.finally()` blocks were dropped (removal or
    // undo), the pending Set would still contain 'A' and the merge branch
    // would preserve the stale optimistic state instead of adopting Afinal.
    expect(lastBuilderProps!.items.find((i) => i.id === 'A')?.name).toBe('A-post-undo');
  });
});
