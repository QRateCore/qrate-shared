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
import { describe, expect, it, vi, afterEach } from 'vitest';
import { act, render, screen, fireEvent, within } from '@testing-library/react';
import type { MenuItemDisplay, MenuSummary } from '../../../../types/restaurant';
import MenuBuilder from '../MenuBuilder';
import { selectionState } from '../../builderWorkspace';

vi.mock('sonner', () => ({ toast: { success: vi.fn(), warning: vi.fn(), error: vi.fn() } }));
let mobile = false;
vi.mock('../../../../hooks/useIsMobile', () => ({ useIsMobile: () => mobile }));
const reorder = vi.fn();

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

function Harness({ workspaceMode, selected: initial = [], dragOver = null, enter = vi.fn(), order, onReorderItem, canReorder }: { workspaceMode: boolean; selected?: string[]; dragOver?: { menuId: string; cat: string } | null; enter?: ReturnType<typeof vi.fn>; order?: (m: string, c: string, l: string, ids: string[]) => string[]; onReorderItem?: ReturnType<typeof vi.fn>; canReorder?: (m: string, c: string, l: string) => boolean }) {
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
      dragging={dragOver ? { itemIds: ['x'], fromMenuId: null, fromCat: null } : null}
      dragOver={dragOver}
      colorMap={() => ({ name: 'blue', tab: '', tabBorder: '', chip: '', chipText: '', bucket: '' }) as never}
      getSettings={(_m, id) => ({ price: null, boost_level: null, chefs_special: false, portion_type: 'single', portion_serves: null, raw_categories: RAW[id] ?? [] }) as never}
      onToggleCollapse={(k) => setCollapsed((c) => ({ ...c, [k]: !(c[k] ?? true) }))}
      onCollapseAll={(collapse) => setCollapsed(Object.fromEntries(keys.map((k) => [k, collapse])))}
      onUpdateSettings={vi.fn().mockResolvedValue(undefined)}
      onDragStart={vi.fn()}
      onDragEnd={vi.fn()}
      onDragEnterBucket={enter}
      onDragLeaveBucket={vi.fn()}
      onDropBucket={vi.fn()}
      onReorderSubCategory={reorder}
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
      orderSubCategoryItems={order}
      onReorderSubCategoryItem={onReorderItem}
      canReorderSubCategoryItems={canReorder}
      rowChrome={onReorderItem ? (p) => (
        <div data-testid={`chrome-${p.item.id}`}>
          {p.item.name}
          {p.reorderHandle && (
            <span draggable data-testid={`grip-${p.item.id}`} onDragStart={p.reorderHandle.onDragStart} onDragEnd={p.reorderHandle.onDragEnd} />
          )}
        </div>
      ) : undefined}
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

describe('MenuBuilder — workspace reorder without a mouse', () => {
  it('desktop keyboard: Alt+↑ on a focused sub-category bar moves it up', () => {
    mobile = false;
    reorder.mockClear();
    render(<Harness workspaceMode />);
    fireEvent.click(screen.getByTestId('collapse-expand-all-btn'));
    const bars = screen.getAllByTestId(/^subcategory-drop-/);
    const second = bars[1]!;
    const label = second.getAttribute('data-testid')!.replace(/^subcategory-drop-[^-]+-/, '');
    expect(second.getAttribute('aria-keyshortcuts')).toBe('Alt+ArrowUp Alt+ArrowDown');
    fireEvent.keyDown(second, { key: 'ArrowUp', altKey: true });
    expect(reorder).toHaveBeenCalledTimes(1);
    expect(reorder.mock.calls[0]![2][0]).toBe(label);
    // Plain ↑ (no Alt) does not reorder.
    fireEvent.keyDown(second, { key: 'ArrowUp' });
    expect(reorder).toHaveBeenCalledTimes(1);
  });

  it('phone: ▲▼ stay as the touch reorder control in workspace mode', () => {
    mobile = true;
    try {
      render(<Harness workspaceMode />);
      fireEvent.click(screen.getByTestId('collapse-expand-all-btn'));
      expect(screen.getAllByTestId(/^subcategory-move-up-/).length).toBeGreaterThan(0);
    } finally {
      mobile = false;
    }
  });
});

describe('MenuBuilder — workspace direct drop (v5)', () => {
  afterEach(() => vi.useRealTimers());
  const over = { menuId: 'menu-1', cat: 'Entrees' };

  it('a hovered course wears the red ring — no green dashed zone, no "pick a sub-category" hint', () => {
    render(<Harness workspaceMode dragOver={over} />);
    fireEvent.click(screen.getByTestId('collapse-bucket-Entrees'));
    expect(screen.getByTestId('category-bucket-Entrees')).toHaveAttribute('data-drop-over', 'true');
    expect(screen.queryByTestId('bucket-drop-hint-Entrees')).toBeNull();
    expect(screen.queryByText(/pick a sub-category next/)).toBeNull();
  });

  it('classic mode keeps the green hint', () => {
    render(<Harness workspaceMode={false} dragOver={over} />);
    fireEvent.click(screen.getByTestId('collapse-bucket-Entrees'));
    expect(screen.getByTestId('bucket-drop-hint-Entrees')).toBeInTheDocument();
    expect(screen.getByTestId('category-bucket-Entrees')).not.toHaveAttribute('data-drop-over');
  });

  it('the whole course card (header too) takes the drag in workspace mode', () => {
    const enter = vi.fn();
    render(<Harness workspaceMode enter={enter} />);
    fireEvent.dragEnter(screen.getByTestId('collapse-bucket-Entrees'));
    expect(enter).toHaveBeenCalled();
  });

  it('holding a drag over a collapsed course opens it', () => {
    vi.useFakeTimers();
    render(<Harness workspaceMode dragOver={over} />);
    expect(screen.queryByTestId('bucket-drop-Entrees')).toBeNull();
    act(() => { vi.advanceTimersByTime(500); });
    expect(screen.getByTestId('bucket-drop-Entrees')).toBeInTheDocument();
  });
});

describe('MenuBuilder — workspace dish order (v5)', () => {
  const curriesOrder = () => [...document.querySelectorAll('[data-testid^="chrome-"]')]
    .map((el) => el.getAttribute('data-testid')!.replace('chrome-', ''));

  it('rows inside a sub-category follow orderSubCategoryItems', () => {
    // Curries holds a, b; the owner put b first.
    const order = (_m: string, _c: string, l: string, ids: string[]) => (l === 'Curries' ? ['b', 'a'].filter((id) => ids.includes(id)) : ids);
    render(<Harness workspaceMode order={order} onReorderItem={vi.fn()} />);
    fireEvent.click(screen.getByTestId('collapse-expand-all-btn'));
    expect(curriesOrder().filter((id) => id !== 'c')).toEqual(['b', 'a']);
  });

  it('grip-drag a dish onto another in the same sub-category reorders it (red line on hover)', () => {
    const onReorderItem = vi.fn();
    render(<Harness workspaceMode onReorderItem={onReorderItem} />);
    fireEvent.click(screen.getByTestId('collapse-expand-all-btn'));
    const dt = { setData: vi.fn(), effectAllowed: '', dropEffect: '' };
    fireEvent.dragStart(screen.getByTestId('grip-b'), { dataTransfer: dt });
    const slot = screen.getByTestId('dish-reorder-slot-a');
    fireEvent.dragOver(slot, { dataTransfer: dt });
    // jsdom carries no pointer position on drag events, so the side is whichever
    // the slot computed — the drop must use the same one the line showed.
    const side = slot.getAttribute('data-drop-line');
    expect(side === 'before' || side === 'after').toBe(true);
    fireEvent.drop(slot, { dataTransfer: dt });
    expect(onReorderItem).toHaveBeenCalledWith('menu-1', 'Entrees', 'Curries', 'b', 'a', side);
  });

  it('a single-dish sub-category and Ungrouped have no grip', () => {
    render(<Harness workspaceMode onReorderItem={vi.fn()} />);
    fireEvent.click(screen.getByTestId('collapse-expand-all-btn'));
    expect(screen.queryByTestId('grip-c')).toBeNull(); // Rice has one dish
    expect(screen.getByTestId('grip-a')).toBeInTheDocument();
  });

  it('no grip on a group that is not a real sub-category (raw fallback)', () => {
    render(<Harness workspaceMode onReorderItem={vi.fn()} canReorder={(_m, _c, l) => l !== 'Curries'} />);
    fireEvent.click(screen.getByTestId('collapse-expand-all-btn'));
    expect(screen.queryByTestId('grip-a')).toBeNull();
  });

  it('without onReorderSubCategoryItem (admin / waiter) there is no grip', () => {
    render(<Harness workspaceMode={false} />);
    expect(screen.queryByTestId(/^grip-/)).toBeNull();
  });
});
