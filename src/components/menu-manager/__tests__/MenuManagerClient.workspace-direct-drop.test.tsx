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
import { act, render } from '@testing-library/react';
import React from 'react';
import type { MenuItemDisplay, MenuSummary, MenuManagerService } from '../../../types/restaurant';

type BuilderProps = {
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
vi.mock('../../../constants/feature-flags', async (orig) => ({ ...(await orig<object>()), isSubcategoryV2Enabled: () => false }));
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
