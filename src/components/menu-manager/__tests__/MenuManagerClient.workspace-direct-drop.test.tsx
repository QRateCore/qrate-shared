// @vitest-environment jsdom
/**
 * Owner Menu workspace (v5) drops file DIRECTLY — Avi 2026-11-12: "as simple as
 * dragging and dropping". Pinned:
 *  - a library drop on a COURSE files each item under a sub-category named
 *    after its library category (merged case-insensitively into an existing
 *    one); blank / Uncategorized → Ungrouped (no label) — and no chooser opens;
 *  - a drop on a SUB-CATEGORY files into that sub-category, no chooser;
 *  - without workspace mode (admin / waiter) both drops still open the chooser.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { act, render, waitFor } from '@testing-library/react';
import React from 'react';
import type { MenuItemDisplay, MenuSummary, MenuManagerService } from '../../../types/restaurant';

type BuilderProps = {
  orderSubCategoryItems?: (m: string, c: string, l: string, ids: string[]) => string[];
  onReorderSubCategoryItem?: (m: string, c: string, l: string, d: string, t: string, p: 'before' | 'after') => Promise<void> | void;
  canReorderSubCategoryItems?: (m: string, c: string, l: string) => boolean;
  onDropBucket: (e: React.DragEvent, menuId: string, cat: string) => void;
  onDropSubCategory?: (e: React.DragEvent, menuId: string, cat: string, label: string) => void;
};
let last: BuilderProps;
vi.mock('../components/MenuBuilder', async (orig) => {
  const real = await orig<typeof import('../components/MenuBuilder')>();
  return { ...real, default: (p: BuilderProps) => { last = p; return <div />; } };
});
let placementOpen = false;
vi.mock('../components/ItemPlacementModal', () => ({ ItemPlacementModal: (p: { open: boolean; testid?: string }) => { if (p.testid === 'subcategory-pick-modal') placementOpen = p.open; return null; } }));
vi.mock('../components/ItemPool', () => ({ default: () => null }));
vi.mock('../components/MobileMenuManagerLayout', () => ({ default: () => <div /> }));
vi.mock('../components/EditModal', () => ({ default: () => null }));
vi.mock('../../../hooks/useIsMobile', () => ({ useIsMobile: () => false }));
let v2 = false;
vi.mock('../../../constants/feature-flags', async (orig) => ({ ...(await orig<object>()), isSubcategoryV2Enabled: () => v2 }));
vi.mock('../track-action-context', () => ({
  useTrackAction: () => () => {},
  TrackActionProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

const { default: MenuManagerClient } = await import('../MenuManagerClient');

const item = (id: string, category: string, assoc?: { raw: string[] }) => ({
  id, name: id, category, item_type: 'dish', price: 1, active: true,
  menu_associations: assoc ? [{ menu_id: 'm1', menu_name: 'Dinner', canonical_categories: ['Entrees'], raw_categories: assoc.raw }] : [],
} as unknown as MenuItemDisplay);
const menu = { id: 'm1', name: 'Dinner', active: true, items: [] } as unknown as MenuSummary;
const ev = () => ({ preventDefault() {}, stopPropagation() {}, dataTransfer: { setData() {}, setDragImage() {}, effectAllowed: '' } }) as unknown as React.DragEvent;

let service: MenuManagerService;
beforeEach(() => {
  placementOpen = false;
  v2 = false;
  service = {
    addItemToMenu: vi.fn().mockResolvedValue([]),
    updateMenuItemInMenu: vi.fn().mockResolvedValue([]),
  } as unknown as MenuManagerService;
});

function mount(workspace: boolean, items: MenuItemDisplay[]) {
  let actions: { startPoolDrag: (e: React.DragEvent, ids: string[]) => void } | null = null;
  render(<MenuManagerClient service={service} restaurantId="r1" initialItems={items} initialMenus={[menu]}
    builderWorkspaceMode={workspace} onMenuActionsReady={(a) => { actions = a as never; }} />);
  return (ids: string[]) => act(() => actions!.startPoolDrag(ev(), ids));
}

const addCalls = () => (service.addItemToMenu as ReturnType<typeof vi.fn>).mock.calls
  .map((c) => [c[0], (c[4] as { raw_categories: string[] }).raw_categories]);

describe('MenuManagerClient — workspace direct drop', () => {
  it('course drop: one sub-category per library category, merged into an existing one; no chooser', async () => {
    const items = [
      item('dal', 'curries'), item('naan', 'Breads'), item('x', 'Uncategorized'), item('y', ''),
      item('on', 'Curries', { raw: ['Curries'] }),
    ];
    const drag = mount(true, items);
    drag(['dal', 'naan', 'x', 'y']);
    await act(async () => { last.onDropBucket(ev(), 'm1', 'Entrees'); });
    expect(placementOpen).toBe(false);
    expect(addCalls().sort()).toEqual([['dal', ['Curries']], ['naan', ['Breads']], ['x', []], ['y', []]]);
  });

  it('sub-category drop files into that sub-category; no chooser', async () => {
    const drag = mount(true, [item('dal', 'Lentils')]);
    drag(['dal']);
    await act(async () => { last.onDropSubCategory!(ev(), 'm1', 'Entrees', 'Curries'); });
    expect(placementOpen).toBe(false);
    expect(addCalls()).toEqual([['dal', ['Curries']]]);
  });

  it('classic mode (admin / waiter): both drops still open the chooser and write nothing', async () => {
    const drag = mount(false, [item('dal', 'Curries')]);
    drag(['dal']);
    await act(async () => { last.onDropBucket(ev(), 'm1', 'Entrees'); });
    expect(placementOpen).toBe(true);
    expect(service.addItemToMenu).not.toHaveBeenCalled();
  });
});

describe('MenuManagerClient — workspace direct drop, first-class sub-categories (the owner app path)', () => {
  function v2Service() {
    let n = 0;
    return {
      addItemToMenu: vi.fn().mockResolvedValue([{ menu_id: 'm1', canonical_categories: ['Entrees'] }]),
      updateMenuItemInMenu: vi.fn().mockResolvedValue([]),
      getMenuStructure: vi.fn().mockResolvedValue({ courses: { Entrees: [{ subcategory_id: 's-curries', name: 'Curries', count: 2 }] } }),
      createMenuSubcategory: vi.fn().mockImplementation(async () => ({ subcategory_id: `s-new-${++n}` })),
      assignItemToSubcategory: vi.fn().mockResolvedValue(undefined),
      unassignItemFromSubcategory: vi.fn().mockResolvedValue(undefined),
    };
  }

  it('reuses an existing sub-category case-insensitively, creates ONE for case variants, and PLACES Ungrouped dishes', async () => {
    v2 = true;
    const svc = v2Service();
    service = svc as unknown as MenuManagerService;
    const drag = mount(true, [item('dal', 'curries'), item('naan', 'breads'), item('roti', 'Breads'), item('x', 'Uncategorized')]);
    await waitFor(() => expect(svc.getMenuStructure).toHaveBeenCalled());
    await act(async () => { await Promise.resolve(); });
    drag(['dal', 'naan', 'roti', 'x']);
    await act(async () => { last.onDropBucket(ev(), 'm1', 'Entrees'); });
    await waitFor(() => expect(svc.unassignItemFromSubcategory).toHaveBeenCalled());
    expect(placementOpen).toBe(false);
    // existing "Curries" reused — no create for it
    expect(svc.assignItemToSubcategory).toHaveBeenCalledWith('m1', 'dal', 's-curries');
    // "breads" + "Breads" → one new sub-category, first spelling
    expect(svc.createMenuSubcategory).toHaveBeenCalledTimes(1);
    expect(svc.createMenuSubcategory).toHaveBeenCalledWith('m1', { course: 'Entrees', name: 'breads' });
    expect(svc.assignItemToSubcategory).toHaveBeenCalledWith('m1', 'naan', 's-new-1');
    expect(svc.assignItemToSubcategory).toHaveBeenCalledWith('m1', 'roti', 's-new-1');
    // the Uncategorized dish is placed on the menu before it is unassigned
    expect(svc.addItemToMenu).toHaveBeenCalledWith('x', 'm1', 1, 'Entrees', { canonical_categories: ['Entrees'], raw_categories: [] });
    expect(svc.addItemToMenu.mock.invocationCallOrder[0]).toBeLessThan(svc.unassignItemFromSubcategory.mock.invocationCallOrder[0]);
  });

  it('an Ungrouped dish already on the menu in another course gets this course added', async () => {
    v2 = true;
    const svc = v2Service();
    service = svc as unknown as MenuManagerService;
    const onMenu = { ...item('x', ''), menu_associations: [{ menu_id: 'm1', canonical_categories: ['Desserts'], raw_categories: [] }] } as unknown as MenuItemDisplay;
    const drag = mount(true, [onMenu]);
    await waitFor(() => expect(svc.getMenuStructure).toHaveBeenCalled());
    drag(['x']);
    await act(async () => { last.onDropBucket(ev(), 'm1', 'Entrees'); });
    await waitFor(() => expect(svc.unassignItemFromSubcategory).toHaveBeenCalled());
    expect(svc.addItemToMenu).not.toHaveBeenCalled();
    expect(svc.updateMenuItemInMenu).toHaveBeenCalledWith('x', 'm1', { canonical_categories: expect.arrayContaining(['Entrees']) });
  });
});

describe('MenuManagerClient — workspace direct drop on a DRINKS menu', () => {
  const drinksMenu = { id: 'd1', name: 'Bar', active: true, drinks_only: true, items: [] } as unknown as MenuSummary;
  const drink = (id: string, category: string) => ({
    id, name: id, category, canonical_category: 'Beverages', item_type: 'dish', price: 7, active: true, menu_associations: [],
  } as unknown as MenuItemDisplay);
  function svc(typeOk: boolean) {
    return {
      addItemToMenu: vi.fn().mockResolvedValue([{ menu_id: 'd1', canonical_categories: ['Beverages'], raw_categories: [] }]),
      updateMenuItemInMenu: vi.fn().mockResolvedValue([]),
      bulkSetDrinkSubcategory: typeOk ? vi.fn().mockResolvedValue(undefined) : vi.fn().mockRejectedValue(new Error('boom')),
      getMenuStructure: vi.fn().mockResolvedValue({ courses: { beer: [] } }),
      createMenuSubcategory: vi.fn().mockResolvedValue({ subcategory_id: 's-lager' }),
      assignItemToSubcategory: vi.fn().mockResolvedValue(undefined),
      unassignItemFromSubcategory: vi.fn().mockResolvedValue(undefined),
    };
  }
  function mountDrinks(s: ReturnType<typeof svc>, items: MenuItemDisplay[]) {
    v2 = true;
    service = s as unknown as MenuManagerService;
    let actions: { startPoolDrag: (e: React.DragEvent, ids: string[]) => void } | null = null;
    render(<MenuManagerClient service={service} restaurantId="r1" initialItems={items} initialMenus={[drinksMenu]}
      builderWorkspaceMode onMenuActionsReady={(a) => { actions = a as never; }} />);
    return (ids: string[]) => act(() => actions!.startPoolDrag(ev(), ids));
  }

  it('files into the library-category sub-category only AFTER the drink is placed', async () => {
    const s = svc(true);
    const drag = mountDrinks(s, [drink('ipa', 'Lager')]);
    await waitFor(() => expect(s.getMenuStructure).toHaveBeenCalled());
    drag(['ipa']);
    await act(async () => { last.onDropBucket(ev(), 'd1', 'beer'); });
    await waitFor(() => expect(s.assignItemToSubcategory).toHaveBeenCalledWith('d1', 'ipa', 's-lager'));
    expect(placementOpen).toBe(false);
    expect(s.bulkSetDrinkSubcategory.mock.invocationCallOrder[0]).toBeLessThan(s.createMenuSubcategory.mock.invocationCallOrder[0]);
  });

  it('an Uncategorized drink is placed ONCE, as Beverages — never re-placed under the drink type', async () => {
    const s = svc(true);
    const drag = mountDrinks(s, [drink('cola', 'Uncategorized')]);
    await waitFor(() => expect(s.getMenuStructure).toHaveBeenCalled());
    drag(['cola']);
    await act(async () => { last.onDropBucket(ev(), 'd1', 'beer'); });
    await waitFor(() => expect(s.unassignItemFromSubcategory).toHaveBeenCalled());
    expect(s.addItemToMenu).toHaveBeenCalledTimes(1);
    for (const c of s.addItemToMenu.mock.calls) expect(c[4]).toMatchObject({ canonical_categories: ['Beverages'] });
  });

  it('does not file into a sub-category when the drink-type write failed', async () => {
    const s = svc(false);
    const drag = mountDrinks(s, [drink('ipa', 'Lager')]);
    await waitFor(() => expect(s.getMenuStructure).toHaveBeenCalled());
    drag(['ipa']);
    await act(async () => { last.onDropBucket(ev(), 'd1', 'beer'); });
    await waitFor(() => expect(s.bulkSetDrinkSubcategory).toHaveBeenCalled());
    await act(async () => { await new Promise((r) => setTimeout(r, 20)); });
    expect(s.createMenuSubcategory).not.toHaveBeenCalled();
    expect(s.assignItemToSubcategory).not.toHaveBeenCalled();
  });
});

describe('MenuManagerClient — workspace dish order (v5)', () => {
  function svc(fail = false) {
    return {
      addItemToMenu: vi.fn(), updateMenuItemInMenu: vi.fn(),
      getMenuStructure: vi.fn().mockResolvedValue({ courses: { Entrees: [{ subcategory_id: 's1', name: 'Curries', sort_order: 0, item_ids: ['a', 'b', 'c'], count: 3 }] } }),
      assignItemToSubcategory: vi.fn(),
      reorderSubcategoryItems: fail ? vi.fn().mockRejectedValue(new Error('x')) : vi.fn().mockResolvedValue({ reordered: true, count: 3 }),
    };
  }

  it('orders rows by the structure and saves the FULL member list on a move', async () => {
    v2 = true;
    const s = svc();
    service = s as unknown as MenuManagerService;
    mount(true, [item('a', 'Curries'), item('b', 'Curries'), item('c', 'Curries')]);
    await waitFor(() => expect(last.orderSubCategoryItems!('m1', 'Entrees', 'curries', ['c', 'a'])).toEqual(['a', 'c']));
    // Move c before a (b is not on screen — still sent: the endpoint needs every member).
    await act(async () => { await last.onReorderSubCategoryItem!('m1', 'Entrees', 'Curries', 'c', 'a', 'before'); });
    expect(s.reorderSubcategoryItems).toHaveBeenCalledWith('m1', 's1', ['c', 'a', 'b']);
    expect(last.orderSubCategoryItems!('m1', 'Entrees', 'Curries', ['a', 'b', 'c'])).toEqual(['c', 'a', 'b']);
  });

  it('a failed save rolls the order back', async () => {
    v2 = true;
    const s = svc(true);
    service = s as unknown as MenuManagerService;
    mount(true, [item('a', 'Curries')]);
    await waitFor(() => expect(last.orderSubCategoryItems!('m1', 'Entrees', 'Curries', ['c', 'a'])).toEqual(['a', 'c']));
    await act(async () => { await last.onReorderSubCategoryItem!('m1', 'Entrees', 'Curries', 'c', 'a', 'before'); });
    await waitFor(() => expect(last.orderSubCategoryItems!('m1', 'Entrees', 'Curries', ['a', 'b', 'c'])).toEqual(['a', 'b', 'c']));
  });

  it('classic (no v2 / no service method) offers no dish reorder', () => {
    mount(false, [item('a', 'Curries')]);
    expect(last.onReorderSubCategoryItem).toBeUndefined();
  });

  it('only a real (uuid) sub-category row can be reordered — never a synthetic raw-* bucket', async () => {
    v2 = true;
    service = {
      addItemToMenu: vi.fn(), updateMenuItemInMenu: vi.fn(), assignItemToSubcategory: vi.fn(),
      reorderSubcategoryItems: vi.fn(),
      getMenuStructure: vi.fn().mockResolvedValue({ courses: { Entrees: [
        { subcategory_id: '11111111-1111-1111-1111-111111111111', name: 'Curries', sort_order: 0, item_ids: ['a'], count: 1 },
        { subcategory_id: 'raw-Entrees-Rice', name: 'Rice', sort_order: 1, item_ids: ['b'], count: 1 },
      ] } }),
    } as unknown as MenuManagerService;
    mount(true, [item('a', 'Curries')]);
    await waitFor(() => expect(last.canReorderSubCategoryItems!('m1', 'Entrees', 'Curries')).toBe(true));
    expect(last.canReorderSubCategoryItems!('m1', 'Entrees', 'Rice')).toBe(false);
    expect(last.canReorderSubCategoryItems!('m1', 'Entrees', 'Nope')).toBe(false);
  });
});
