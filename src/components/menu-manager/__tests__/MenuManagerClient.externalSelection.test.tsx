// @vitest-environment jsdom
/**
 * Host-owned bulk selection (owner Menu workspace, handoff v3 Phase 4): the
 * builder's row / course / sub-category ticks ARE the host's set (the Item
 * library's ticks) — reads come from `externalBulkSelection`, every toggle goes
 * to `onExternalBulkSelectionChange`, and the header's legacy panel reports
 * open / closed through `onBulkPanelOpenChange`. Without the props the builder
 * keeps its own local selection (admin / waiter unchanged).
 */
import { describe, expect, it, vi } from 'vitest';
import { act, render } from '@testing-library/react';
import React, { useState } from 'react';
import type { MenuItemDisplay, MenuSummary, MenuManagerService } from '../../../types/restaurant';

type BuilderProps = { bulkSelection?: Set<string>; onToggleBulkSelection?: (id: string) => void; onOpenBulkPanel?: () => void; getSettings?: (menuId: string, itemId: string) => Record<string, unknown> };
let last: BuilderProps = {};
vi.mock('../components/MenuBuilder', async (orig) => {
  const real = await orig<typeof import('../components/MenuBuilder')>();
  return { ...real, default: (p: BuilderProps) => { last = p; return <div data-testid="menu-builder-mock" />; } };
});
vi.mock('../components/ItemPool', () => ({ default: () => null }));
vi.mock('../components/MobileMenuManagerLayout', () => ({ default: () => <div /> }));
vi.mock('../components/BulkActionsPanel', () => ({ default: () => null }));
vi.mock('../components/BulkModifierPanel', () => ({ default: () => null }));
vi.mock('../components/MenuEditPanel', () => ({ default: () => null }));
vi.mock('../components/EditModal', () => ({ default: () => null }));
let panelProps: { selectedItems?: Array<{ id: string }> } = {};
vi.mock('../components/BulkMenuSidesPanel', () => ({ default: (p: { selectedItems?: Array<{ id: string }> }) => { panelProps = p; return <div data-testid="legacy-bulk-panel" />; } }));
vi.mock('../../../hooks/useIsMobile', () => ({ useIsMobile: () => false }));
vi.mock('../track-action-context', () => ({
  useTrackAction: () => () => {},
  TrackActionProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

const { default: MenuManagerClient } = await import('../MenuManagerClient');

const item = (id: string) => ({ id, name: id, category: 'Entrees', item_type: 'dish', price: 1, active: true, menu_associations: [] } as unknown as MenuItemDisplay);
const menu = { id: 'm1', name: 'Lunch', active: true, items: [] } as unknown as MenuSummary;
const service = {} as unknown as MenuManagerService;
const bulkProps = { onBulkSetBoostForMenuItems: vi.fn() };

describe('MenuManagerClient — host-owned bulk selection', () => {
  it('reads the host set and sends every toggle to the host', () => {
    const onChange = vi.fn();
    render(<MenuManagerClient service={service} restaurantId="r1" initialItems={[item('a'), item('b')]} initialMenus={[menu]} {...bulkProps}
      externalBulkSelection={new Set(['a'])} onExternalBulkSelectionChange={onChange} />);
    expect([...(last.bulkSelection ?? [])]).toEqual(['a']);
    act(() => last.onToggleBulkSelection!('b'));
    expect([...onChange.mock.calls[0]![0]].sort()).toEqual(['a', 'b']);
    // The host has not re-rendered yet: the next toggle builds on {a, b}.
    act(() => last.onToggleBulkSelection!('a'));
    expect([...onChange.mock.calls[1]![0]]).toEqual(['b']);
  });

  it('without the props the builder keeps its own selection', () => {
    render(<MenuManagerClient service={service} restaurantId="r1" initialItems={[item('a')]} initialMenus={[menu]} {...bulkProps} />);
    expect(last.bulkSelection?.size).toBe(0);
    act(() => last.onToggleBulkSelection!('a'));
    expect([...(last.bulkSelection ?? [])]).toEqual(['a']);
  });

  it('reports the legacy Bulk actions panel opening and closing', () => {
    const onPanel = vi.fn();
    render(<MenuManagerClient service={service} restaurantId="r1" initialItems={[item('a')]} initialMenus={[menu]} {...bulkProps}
      externalBulkSelection={new Set(['a'])} onExternalBulkSelectionChange={vi.fn()} onBulkPanelOpenChange={onPanel} />);
    expect(onPanel).toHaveBeenLastCalledWith(false);
    act(() => last.onOpenBulkPanel!());
    expect(onPanel).toHaveBeenLastCalledWith(true);
  });

  it('applyMenuSettings (host bulk edit) changes what the rows read — past the "prev wins" sync', () => {
    let actions: { applyMenuSettings: (m: string, p: Array<{ itemId: string; patch: Record<string, unknown> }>) => void } | null = null;
    const withAssoc = { ...item('a'), menu_associations: [{ menu_id: 'm1', menu_name: 'Lunch', price: 5, boost_level: null }] } as unknown as MenuItemDisplay;
    render(<MenuManagerClient service={service} restaurantId="r1" initialItems={[withAssoc]} initialMenus={[menu]} {...bulkProps}
      onMenuActionsReady={(a) => { actions = a as never; }} />);
    expect(last.getSettings!('m1', 'a').boost_level ?? null).toBeNull();
    act(() => actions!.applyMenuSettings('m1', [{ itemId: 'a', patch: { boost_level: '3', price: 9 } }]));
    expect(last.getSettings!('m1', 'a')).toMatchObject({ boost_level: '3', price: 9 });
  });

  it('a course / sub-category select-all (N toggles in ONE handler) selects every dish — each update builds on the last (review P1)', () => {
    let hostSet = new Set<string>();
    function Host() {
      const [sel, setSel] = useState<Set<string>>(new Set());
      hostSet = sel;
      return <MenuManagerClient service={service} restaurantId="r1" initialItems={[item('a'), item('b'), item('c')]} initialMenus={[menu]} {...bulkProps}
        externalBulkSelection={sel} onExternalBulkSelectionChange={setSel} />;
    }
    render(<Host />);
    act(() => { for (const id of ['a', 'b', 'c']) last.onToggleBulkSelection!(id); });
    expect([...hostSet].sort()).toEqual(['a', 'b', 'c']);
    act(() => { for (const id of ['a', 'b', 'c']) last.onToggleBulkSelection!(id); });
    expect([...hostSet]).toEqual([]);
  });

  it('the legacy Bulk actions panel only gets the ticked dishes placed on the open menu', () => {
    const on = { ...item('a'), menu_associations: [{ menu_id: 'm1', menu_name: 'Lunch', price: 1 }] } as unknown as MenuItemDisplay;
    const off = { ...item('b'), menu_associations: [{ menu_id: 'm2', menu_name: 'Dinner', price: 1 }] } as unknown as MenuItemDisplay;
    render(<MenuManagerClient service={service} restaurantId="r1" initialItems={[on, off]} initialMenus={[menu]} {...bulkProps}
      externalBulkSelection={new Set(['a', 'b'])} onExternalBulkSelectionChange={vi.fn()} />);
    act(() => last.onOpenBulkPanel!());
    expect(panelProps.selectedItems?.map((i) => i.id)).toEqual(['a']);
  });
});
