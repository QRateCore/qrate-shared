// @vitest-environment jsdom
/**
 * Owner Menu workspace v5.2.1 §3 — the Item library search FILTERS the menu
 * (it used to only highlight). Pinned:
 *  - v5.2.2 (Avi 2026-11-19, "keep the courses visible as drop targets"):
 *    EVERY course stays visible; one with no match is COLLAPSED with a count
 *    of 0, and a library drop onto it still reaches onDropBucket;
 *  - in a course WITH a match, sub-categories with no matching dish are hidden
 *    (an empty owner-made one too) — hidden, NOT unmounted, so a sub-category
 *    the owner had opened is still open when the search clears;
 *  - a no-match course opened by hand lists its sub-categories CLOSED (drop
 *    targets, no dishes);
 *  - courses with a match open, WITHOUT touching the owner's saved open/closed
 *    state — the chevron flips a search-only state, and clearing the search
 *    brings the saved one back;
 *  - course, sub-category and header counts are of matches only;
 *  - nothing on the menu matching shows "No items on this menu match “q”." as
 *    a line ABOVE the (all collapsed) courses;
 *  - reordering is off while a query is set: no sub-category reorder, no dish
 *    reorder, rows not draggable.
 */
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import type { MenuItemDisplay, MenuSummary } from '../../../../types/restaurant';
import MenuBuilder from '../MenuBuilder';
import { BuilderSearchHighlightContext, type BuilderSearchHighlight } from '../../builderSearchHighlight';

vi.mock('sonner', () => ({ toast: { success: vi.fn(), warning: vi.fn(), error: vi.fn() } }));
vi.mock('../../../../hooks/useIsMobile', () => ({ useIsMobile: () => false }));

const MENU = {
  id: 'menu-1', name: 'Dinner', slug: 'dinner', display_order: 0, active: true,
  start_time: '17:00', end_time: '22:00', days_of_week: [0, 1, 2, 3, 4, 5, 6],
  is_all_day: false, schedule: null, item_count: 4,
} as unknown as MenuSummary;

function item(id: string, name: string): MenuItemDisplay {
  return {
    id, name, description: null, category: 'Entrees', item_type: 'dish', thumbnail_url: null,
    price: 12, active: true, menu_associations: [],
    food_tags: { allergens: [], dietary: [] }, addons: [], sides: [], sides_and: [], sides_or: [],
    recommendations: [], gallery_urls: [],
  } as unknown as MenuItemDisplay;
}

const ITEMS = [item('a', 'Dal'), item('b', 'Paneer Tikka'), item('c', 'Paneer Biryani'), item('d', 'Kulfi')];
const RAW: Record<string, string[]> = { a: ['Curries'], b: ['Curries'], c: ['Rice'], d: ['Frozen'] };

function hl(q: string): BuilderSearchHighlight | null {
  const query = q.trim();
  if (!query) return null;
  return { query, matchIds: new Set(ITEMS.filter((i) => i.name.toLowerCase().includes(query.toLowerCase())).map((i) => i.id)) };
}

function Harness({ query, header, chrome = false, reorderItem, orderSubs, onDropBucket = vi.fn(), onDropSubCategory, onToggle }: {
  query: string;
  /** The Menus header search (builderSearchQuery), separate from the library query. */
  header?: string;
  chrome?: boolean;
  reorderItem?: ReturnType<typeof vi.fn>;
  orderSubs?: (m: string, c: string, labels: string[]) => string[];
  onDropBucket?: ReturnType<typeof vi.fn>;
  onDropSubCategory?: ReturnType<typeof vi.fn>;
  onToggle?: ReturnType<typeof vi.fn>;
}) {
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  return (
    <BuilderSearchHighlightContext.Provider value={hl(query)}>
      <MenuBuilder
        items={ITEMS}
        menus={[MENU]}
        assignments={{ 'menu-1': { Entrees: ['a', 'b', 'c'], Desserts: ['d'] } }}
        junctionSettings={{}}
        activeMenuId="menu-1"
        collapsed={collapsed}
        dragging={null}
        dragOver={null}
        colorMap={() => ({ name: 'blue', tab: '', tabBorder: '', chip: '', chipText: '', bucket: '' }) as never}
        getSettings={(_m, id) => ({ price: 10, boost_level: null, chefs_special: false, portion_type: 'single', portion_serves: null, raw_categories: RAW[id] ?? [] }) as never}
        onToggleCollapse={(k) => { onToggle?.(k); setCollapsed((c) => ({ ...c, [k]: !(c[k] ?? true) })); }}
        onCollapseAll={vi.fn()}
        onUpdateSettings={vi.fn().mockResolvedValue(undefined)}
        onDragStart={vi.fn()}
        onDragEnd={vi.fn()}
        onDragEnterBucket={vi.fn()}
        onDragLeaveBucket={vi.fn()}
        onDropBucket={onDropBucket}
        onDropSubCategory={onDropSubCategory}
        onReorderSubCategory={vi.fn()}
        orderSubCategories={orderSubs}
        onReorderSubCategoryItem={reorderItem}
        onCreateMenu={vi.fn().mockResolvedValue(undefined)}
        onEditMenu={vi.fn()}
        onRemoveItemFromMenu={vi.fn()}
        onEditItem={vi.fn()}
        onUpdateModifiers={vi.fn().mockResolvedValue(undefined)}
        workspaceMode
        builderSearchQuery={header}
        rowChrome={chrome ? (p) => (
          <div data-testid={`chrome-${p.item.id}`}>
            {p.item.name}
            {p.reorderHandle && <span draggable data-testid={`grip-${p.item.id}`} />}
          </div>
        ) : undefined}
      />
    </BuilderSearchHighlightContext.Provider>
  );
}

const rowShown = (id: string) => screen.queryByTestId(`menu-item-row-${id}`) !== null;

describe('MenuBuilder — the Item library search filters the menu', () => {
  it('keeps every course visible: a no-match course is collapsed with 0, a matching one opens; counts are of matches', () => {
    render(<Harness query="paneer" />);
    // Desserts has no paneer → still listed, collapsed, count 0. Mains holds both matches → open.
    expect(screen.getByTestId('category-bucket-Desserts')).toBeVisible();
    expect(screen.getByTestId('category-bucket-Desserts')).toHaveAttribute('data-search-nomatch', 'true');
    expect(screen.getByTestId('bucket-drop-Desserts')).not.toBeVisible();
    expect(screen.getByTestId('bucket-count-Desserts')).toHaveTextContent('0');
    expect(rowShown('d')).toBe(false);
    expect(screen.getByTestId('category-bucket-Entrees')).toBeVisible();
    expect(screen.getByTestId('category-bucket-Entrees')).not.toHaveAttribute('data-search-nomatch');
    expect(rowShown('b') && rowShown('c')).toBe(true);
    // Dal (no match) is filtered out, not faded.
    expect(rowShown('a')).toBe(false);
    expect(screen.getByTestId('menu-item-row-b')).toHaveAttribute('data-search', 'match');
    // Counts are of matches.
    expect(screen.getByTestId('bucket-count-Entrees')).toHaveTextContent('2');
    expect(screen.getByTestId('subcategory-count-Entrees-Curries')).toHaveTextContent('1');
    expect(screen.getByTestId('active-menu-item-count')).toHaveTextContent('2 items');
  });

  it('a sub-category with no match hides', () => {
    render(<Harness query="tikka" />);
    expect(screen.getByTestId('subcategory-group-Entrees-Curries')).toBeVisible();
    expect(screen.getByTestId('subcategory-group-Entrees-Rice')).not.toBeVisible();
    expect(rowShown('c')).toBe(false);
  });

  it('an EMPTY owner-made sub-category shows without a query and hides under one', () => {
    const orderSubs = (_m: string, c: string, labels: string[]) => (c === 'Entrees' ? [...labels, 'Breads'] : labels);
    const { rerender } = render(<Harness query="" orderSubs={orderSubs} />);
    fireEvent.click(screen.getByTestId('collapse-bucket-Entrees'));
    expect(screen.getByTestId('subcategory-group-Entrees-Breads')).toBeVisible();
    rerender(<Harness query="paneer" orderSubs={orderSubs} />);
    expect(screen.getByTestId('subcategory-group-Entrees-Breads')).not.toBeVisible();
  });

  it('opens without overwriting the owner’s saved state; the chevron flips a search-only state; clearing restores the saved one', () => {
    const onToggle = vi.fn();
    const { rerender } = render(<Harness query="" onToggle={onToggle} />);
    // Saved state: every course collapsed (the default).
    expect(rowShown('b')).toBe(false);
    rerender(<Harness query="paneer" onToggle={onToggle} />);
    expect(rowShown('b')).toBe(true);
    // The chevron closes the matching course for this search only…
    fireEvent.click(screen.getByTestId('collapse-bucket-Entrees'));
    expect(screen.getByTestId('menu-item-row-b')).not.toBeVisible();
    fireEvent.click(screen.getByTestId('collapse-bucket-Entrees'));
    expect(screen.getByTestId('menu-item-row-b')).toBeVisible();
    // …and opens a no-match one; neither writes the owner's saved state.
    fireEvent.click(screen.getByTestId('collapse-bucket-Desserts'));
    expect(screen.getByTestId('bucket-drop-Desserts')).toBeVisible();
    expect(onToggle).not.toHaveBeenCalled();
    rerender(<Harness query="" onToggle={onToggle} />);
    // Back to the owner's collapsed course, with every course listed again.
    expect(rowShown('b')).toBe(false);
    expect(screen.getByTestId('category-bucket-Desserts')).toBeVisible();
    expect(screen.getByTestId('bucket-count-Entrees')).toHaveTextContent('3');
  });

  it('a course + sub-category the owner had open (then hidden by the search) are still open after it clears', () => {
    const { rerender } = render(<Harness query="" />);
    fireEvent.click(screen.getByTestId('collapse-bucket-Desserts'));
    fireEvent.click(screen.getAllByTestId('subcategory-toggle-Desserts-Frozen')[0]!);
    expect(rowShown('d')).toBe(true);
    rerender(<Harness query="paneer" />);
    // No match → still listed, but collapsed for the search.
    expect(screen.getByTestId('category-bucket-Desserts')).toBeVisible();
    expect(screen.getByTestId('bucket-drop-Desserts')).not.toBeVisible();
    expect(rowShown('d')).toBe(false);
    rerender(<Harness query="" />);
    expect(rowShown('d')).toBe(true);
  });

  it('a no-match course opened by hand lists its sub-categories closed (drop targets, no dishes)', () => {
    const { rerender } = render(<Harness query="" />);
    // The owner had Desserts › Frozen open before searching.
    fireEvent.click(screen.getByTestId('collapse-bucket-Desserts'));
    fireEvent.click(screen.getAllByTestId('subcategory-toggle-Desserts-Frozen')[0]!);
    expect(rowShown('d')).toBe(true);
    rerender(<Harness query="paneer" />);
    fireEvent.click(screen.getByTestId('collapse-bucket-Desserts'));
    expect(screen.getByTestId('subcategory-group-Desserts-Frozen')).toBeVisible();
    expect(screen.getByTestId('subcategory-count-Desserts-Frozen')).toHaveTextContent('0');
    expect(rowShown('d')).toBe(false);
    expect(screen.getByTestId('category-search-nomatch-Desserts')).toBeVisible();
    // Its chevron is inert under the search (the owner's open state is kept).
    fireEvent.click(screen.getAllByTestId('subcategory-toggle-Desserts-Frozen')[0]!);
    expect(rowShown('d')).toBe(false);
    rerender(<Harness query="" />);
    expect(rowShown('d')).toBe(true);
  });

  it('a library dish dropped on a COLLAPSED no-match course (or its sub-category) during a search reaches the drop handlers', () => {
    const onDropBucket = vi.fn();
    const onDropSubCategory = vi.fn();
    render(<Harness query="paneer" onDropBucket={onDropBucket} onDropSubCategory={onDropSubCategory} />);
    expect(screen.getByTestId('bucket-drop-Desserts')).not.toBeVisible(); // collapsed
    fireEvent.drop(screen.getByTestId('collapse-bucket-Desserts'));
    expect(onDropBucket).toHaveBeenCalledTimes(1);
    expect(onDropBucket.mock.calls[0]!.slice(1)).toEqual(['menu-1', 'Desserts']);
    // Opened by hand, its sub-category band takes the drop too.
    fireEvent.click(screen.getByTestId('collapse-bucket-Desserts'));
    fireEvent.drop(screen.getByTestId('subcategory-drop-Desserts-Frozen'));
    expect(onDropSubCategory.mock.calls.some((c) => c[2] === 'Desserts' && c[3] === 'Frozen')).toBe(true);
  });

  it('a sub-category the owner had open but the search hid comes back open', () => {
    const { rerender } = render(<Harness query="" />);
    fireEvent.click(screen.getByTestId('collapse-bucket-Entrees'));
    fireEvent.click(screen.getAllByTestId('subcategory-toggle-Entrees-Curries')[0]!);
    expect(rowShown('a')).toBe(true);
    rerender(<Harness query="biryani" />);
    expect(screen.getByTestId('subcategory-group-Entrees-Curries')).not.toBeVisible();
    rerender(<Harness query="" />);
    expect(rowShown('a')).toBe(true);
    // …and Rice, opened only by the search, is closed again.
    expect(rowShown('c')).toBe(false);
  });

  it('nothing on the menu matching shows the empty-state line ABOVE every course, all collapsed', () => {
    render(<Harness query="zzz" />);
    const line = screen.getByTestId('menu-builder-library-search-empty');
    expect(line).toHaveTextContent('No items on this menu match “zzz”.');
    const courses = screen.getAllByTestId(/^category-bucket-/);
    expect(courses.length).toBe(4);
    for (const el of courses) {
      expect(el).toBeVisible();
      // eslint-disable-next-line no-bitwise
      expect(line.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    }
    for (const el of screen.queryAllByTestId(/^bucket-drop-/)) expect(el).not.toBeVisible();
  });

  it('the HEADER search follows the same rule: its empty line (menu-builder-search-empty) sits above every visible course', () => {
    render(<Harness query="" header="zzz" />);
    const line = screen.getByTestId('menu-builder-search-empty');
    const courses = screen.getAllByTestId(/^category-bucket-/);
    expect(courses.length).toBe(4);
    for (const el of courses) {
      expect(el).toBeVisible();
      // eslint-disable-next-line no-bitwise
      expect(line.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    }
  });

  it('a collapsed course shows no whole-course sub-category chips during a search (counts are matches only)', () => {
    const { rerender } = render(<Harness query="" />);
    expect(screen.queryByTestId('bucket-rawcat-chip-Desserts-Frozen')).not.toBeNull();
    rerender(<Harness query="paneer" />);
    expect(screen.getByTestId('category-bucket-Desserts')).toHaveAttribute('data-search-nomatch', 'true');
    expect(screen.queryByTestId('bucket-rawcat-chip-Desserts-Frozen')).toBeNull();
  });

  it('no empty state without a query or with a match', () => {
    const { rerender } = render(<Harness query="" />);
    expect(screen.queryByTestId('menu-builder-library-search-empty')).toBeNull();
    rerender(<Harness query="kulfi" />);
    expect(screen.queryByTestId('menu-builder-library-search-empty')).toBeNull();
  });
});

describe('MenuBuilder — drag is off while the library search is set', () => {
  it('no sub-category reorder grip and no dish reorder (slots, grips) under a query', () => {
    const { rerender } = render(<Harness query="" chrome reorderItem={vi.fn()} />);
    fireEvent.click(screen.getByTestId('collapse-bucket-Entrees'));
    fireEvent.click(screen.getAllByTestId('subcategory-toggle-Entrees-Curries')[0]!);
    // Baseline: the sub-category grip and the dish reorder are there.
    expect(screen.getAllByTestId(/^subcategory-reorder-grip-/).length).toBeGreaterThan(0);
    expect(screen.getByTestId('grip-a')).toBeInTheDocument();
    expect(screen.getByTestId('dish-reorder-slot-a')).toBeInTheDocument();

    rerender(<Harness query="a" chrome reorderItem={vi.fn()} />);
    expect(rowShown('a') && rowShown('b')).toBe(true);
    expect(screen.queryByTestId(/^subcategory-reorder-grip-/)).toBeNull();
    expect(screen.queryByTestId(/^dish-reorder-slot-/)).toBeNull();
    expect(screen.queryByTestId(/^grip-/)).toBeNull();
  });

  it('a row is not draggable under a query (and is without one)', () => {
    const { rerender } = render(<Harness query="" />);
    fireEvent.click(screen.getByTestId('collapse-bucket-Entrees'));
    fireEvent.click(screen.getAllByTestId('subcategory-toggle-Entrees-Curries')[0]!);
    expect(screen.getByTestId('menu-item-row-b').getAttribute('draggable')).toBe('true');
    rerender(<Harness query="paneer" />);
    expect(screen.getByTestId('menu-item-row-b').getAttribute('draggable')).toBe('false');
  });
});
