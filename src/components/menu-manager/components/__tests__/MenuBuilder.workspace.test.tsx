// @vitest-environment jsdom
/**
 * Menu Builder in owner Menu workspace mode (handoff v3, Menus tab).
 *
 * Pinned:
 *  - the card header drops "Manage sections" and "Select" (count + Expand all stay);
 *    without workspaceMode both are still there (admin / waiter unchanged);
 *  - Expand all opens the courses AND every sub-category; Collapse all closes both;
 *  - an expanded course carries a tri-state select-all (hidden while collapsed);
 *  - an expanded sub-category carries a tri-state select-all over its own items;
 *  - sub-categories reorder by drag only — no ▲▼ buttons, the grip stays.
 */
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import type { MenuItemDisplay, MenuSummary } from '../../../../types/restaurant';
import MenuBuilder from '../MenuBuilder';
import { selectionState } from '../../builderWorkspace';

vi.mock('sonner', () => ({ toast: { success: vi.fn(), warning: vi.fn(), error: vi.fn() } }));

const MENU = {
  id: 'menu-1', name: 'Dinner', slug: 'dinner', display_order: 0, active: true,
  start_time: '17:00', end_time: '22:00', days_of_week: [0, 1, 2, 3, 4, 5, 6],
  is_all_day: false, schedule: null, item_count: 3,
} as unknown as MenuSummary;

function item(id: string, name: string): MenuItemDisplay {
  return {
    id, name, description: null, category: 'Entrees', item_type: 'dish', thumbnail_url: null,
    price: 12, active: true,
    menu_associations: [{ menu_id: 'menu-1', menu_name: 'Dinner', category_name: 'Entrees', canonical_categories: ['Entrees'], raw_categories: [] }],
    food_tags: { allergens: [], dietary: [] }, addons: [], sides: [], sides_and: [], sides_or: [],
    recommendations: [], gallery_urls: [],
  } as unknown as MenuItemDisplay;
}

const ITEMS = [item('a', 'Dal'), item('b', 'Paneer'), item('c', 'Biryani')];
const RAW: Record<string, string[]> = { a: ['Curries'], b: ['Curries'], c: ['Rice'] };

function Harness({ workspaceMode, selected: initial = [] }: { workspaceMode: boolean; selected?: string[] }) {
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [selected, setSelected] = useState(new Set(initial));
  const keys = ['menu-1:Starters', 'menu-1:Mains', 'menu-1:Desserts', 'menu-1:Drinks', 'menu-1:Entrees'];
  return (
    <MenuBuilder
      items={ITEMS}
      menus={[MENU]}
      assignments={{ 'menu-1': { Entrees: ['a', 'b', 'c'] } }}
      junctionSettings={{}}
      activeMenuId="menu-1"
      collapsed={collapsed}
      dragging={null}
      dragOver={null}
      colorMap={() => ({ name: 'blue', tab: '', tabBorder: '', chip: '', chipText: '', bucket: '' }) as never}
      getSettings={(_m, id) => ({ price: null, boost_level: null, chefs_special: false, portion_type: 'single', portion_serves: null, raw_categories: RAW[id] ?? [] }) as never}
      onToggleCollapse={(k) => setCollapsed((c) => ({ ...c, [k]: !(c[k] ?? true) }))}
      onCollapseAll={(collapse) => setCollapsed(Object.fromEntries(keys.map((k) => [k, collapse])))}
      onUpdateSettings={vi.fn().mockResolvedValue(undefined)}
      onDragStart={vi.fn()}
      onDragEnd={vi.fn()}
      onDragEnterBucket={vi.fn()}
      onDragLeaveBucket={vi.fn()}
      onDropBucket={vi.fn()}
      onReorderSubCategory={vi.fn()}
      onCreateMenu={vi.fn().mockResolvedValue(undefined)}
      onEditMenu={vi.fn()}
      onRemoveItemFromMenu={vi.fn()}
      onEditItem={vi.fn()}
      onUpdateModifiers={vi.fn().mockResolvedValue(undefined)}
      bulkSelectionEnabled
      bulkSelection={selected}
      onToggleBulkSelection={(id) => setSelected((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; })}
      onOpenBulkPanel={vi.fn()}
      workspaceMode={workspaceMode}
    />
  );
}

const bucketCheckbox = () => screen.queryByTestId(/^menu-builder-bucket-select-/);
const subToggle = (label: string) => screen.getByTestId(new RegExp(`^subcategory-toggle-.*-${label}$`));
const subSelect = (label: string) => screen.queryByTestId(new RegExp(`^subcategory-select-.*-${label}$`)) as HTMLInputElement | null;
const rowVisible = (id: string) => screen.queryByTestId(`menu-item-row-${id}`) !== null;

describe('selectionState', () => {
  it('none / some / all', () => {
    expect(selectionState(['a', 'b'], new Set())).toBe('none');
    expect(selectionState(['a', 'b'], new Set(['a']))).toBe('some');
    expect(selectionState(['a', 'b'], new Set(['a', 'b', 'z']))).toBe('all');
    expect(selectionState([], new Set(['a']))).toBe('none');
    expect(selectionState(['a'], undefined)).toBe('none');
  });
});

describe('MenuBuilder — workspace header', () => {
  it('drops Manage sections and Select; keeps the count and Expand all', () => {
    render(<Harness workspaceMode />);
    expect(screen.queryByTestId('menu-manage-sections-btn')).toBeNull();
    expect(screen.queryByTestId('menu-builder-select-toggle')).toBeNull();
    expect(screen.getByTestId('active-menu-item-count')).toHaveTextContent('3 items');
    expect(screen.getByTestId('collapse-expand-all-btn')).toHaveTextContent('Expand all');
  });

  it('without workspaceMode the classic header is unchanged', () => {
    render(<Harness workspaceMode={false} />);
    expect(screen.getByTestId('menu-manage-sections-btn')).toBeTruthy();
    expect(screen.getByTestId('menu-builder-select-toggle')).toBeTruthy();
  });
});

describe('MenuBuilder — workspace Expand all / Collapse all', () => {
  it('Expand all opens the course and every sub-category; Collapse all closes them', () => {
    render(<Harness workspaceMode />);
    expect(rowVisible('a')).toBe(false);
    fireEvent.click(screen.getByTestId('collapse-expand-all-btn'));
    // Every row of every sub-category is on screen.
    expect(rowVisible('a') && rowVisible('b') && rowVisible('c')).toBe(true);
    expect(screen.getByTestId('collapse-expand-all-btn')).toHaveTextContent('Collapse all');
    fireEvent.click(screen.getByTestId('collapse-expand-all-btn'));
    expect(rowVisible('a') || rowVisible('c')).toBe(false);
    // Re-expanding: the sub-categories open again (not left collapsed by their own state).
    fireEvent.click(screen.getByTestId('collapse-expand-all-btn'));
    expect(rowVisible('a') && rowVisible('c')).toBe(true);
  });

  it('classic mode: Expand all opens the course but sub-categories stay collapsed', () => {
    render(<Harness workspaceMode={false} />);
    fireEvent.click(screen.getByTestId('collapse-expand-all-btn'));
    expect(rowVisible('a')).toBe(false);
    fireEvent.click(subToggle('Curries'));
    expect(rowVisible('a')).toBe(true);
  });
});

describe('MenuBuilder — workspace tri-state select-alls', () => {
  it('a course select-all shows only while the course is expanded, and selects / deselects all', () => {
    render(<Harness workspaceMode />);
    expect(bucketCheckbox()).toBeNull(); // collapsed
    fireEvent.click(screen.getByTestId('collapse-expand-all-btn'));
    const box = bucketCheckbox() as HTMLInputElement;
    expect(box.checked).toBe(false);
    expect(box.closest('label')?.getAttribute('title')).toBe('Select all 3 items in Mains');
    fireEvent.click(box);
    expect((bucketCheckbox() as HTMLInputElement).checked).toBe(true);
    expect(subSelect('Curries')!.checked).toBe(true);
    expect(subSelect('Rice')!.checked).toBe(true);
    expect((bucketCheckbox() as HTMLInputElement).closest('label')?.getAttribute('title')).toBe('Deselect all in Mains');
    fireEvent.click(bucketCheckbox()!);
    expect(subSelect('Curries')!.checked).toBe(false);
  });

  it('a sub-category select-all covers only its own items; the course goes partial', () => {
    render(<Harness workspaceMode />);
    fireEvent.click(screen.getByTestId('collapse-expand-all-btn'));
    const curries = subSelect('Curries')!;
    expect(curries.title).toBe('Select all 2 items in Curries');
    fireEvent.click(curries);
    expect(subSelect('Curries')!.checked).toBe(true);
    expect(subSelect('Rice')!.checked).toBe(false);
    const course = bucketCheckbox() as HTMLInputElement;
    expect(course.checked).toBe(false);
    expect(course.indeterminate).toBe(true);
    expect((screen.getByTestId('menu-builder-row-select-a') as HTMLInputElement).checked).toBe(true);
    expect((screen.getByTestId('menu-builder-row-select-c') as HTMLInputElement).checked).toBe(false);
    // Partial within a sub-category reads indeterminate too.
    fireEvent.click(screen.getByTestId('menu-builder-row-select-b'));
    expect(subSelect('Curries')!.indeterminate).toBe(true);
    expect(subSelect('Curries')!.checked).toBe(false);
  });

  it('a collapsed sub-category shows no select-all', () => {
    render(<Harness workspaceMode />);
    fireEvent.click(screen.getByTestId('collapse-expand-all-btn'));
    fireEvent.click(subToggle('Rice'));
    expect(subSelect('Rice')).toBeNull();
    expect(subSelect('Curries')).not.toBeNull();
  });
});

describe('MenuBuilder — workspace sub-category reorder', () => {
  it('drag only: the grip stays, the ▲▼ buttons are gone', () => {
    render(<Harness workspaceMode />);
    fireEvent.click(screen.getByTestId('collapse-expand-all-btn'));
    const bar = screen.getByTestId(/^subcategory-drop-.*-Curries$/);
    expect(bar.getAttribute('draggable')).toBe('true');
    expect(within(bar).getByTestId(/^subcategory-reorder-grip-/)).toBeTruthy();
    expect(screen.queryByTestId(/^subcategory-move-up-/)).toBeNull();
    expect(screen.queryByTestId(/^subcategory-move-down-/)).toBeNull();
  });

  it('classic mode keeps ▲▼', () => {
    render(<Harness workspaceMode={false} />);
    fireEvent.click(screen.getByTestId('collapse-expand-all-btn'));
    expect(screen.getAllByTestId(/^subcategory-move-up-/).length).toBeGreaterThan(0);
  });
});
