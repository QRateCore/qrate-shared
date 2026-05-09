// @vitest-environment jsdom
/**
 * Unit tests for ItemPool.
 *
 * Covers:
 *  - Item-type filter toggle is no longer rendered (menu manager pool is
 *    dish + included; addons live on the Food Items page).
 *  - Category-row count badge: single bare-integer total covering every
 *    non-addon item in the category. Singular/plural grammar; badge is
 *    hidden when count is zero. The legacy cyan "included" badge has
 *    been removed.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import React from 'react';
import ItemPool from '../ItemPool';
import type { MenuItemDisplay, MenuSummary } from '../../../../types/restaurant';

// ── Factories ─────────────────────────────────────────────────────────────────

function makeItem(id: string, name: string, itemType: 'dish' | 'addon' | 'included' = 'dish'): MenuItemDisplay {
  return {
    id,
    name,
    description: null,
    price: 10,
    food_tags: {},
    thumbnail_url: null,
    active: true,
    item_type: itemType,
    category: 'Entrees',
    menu_associations: [],
  } as MenuItemDisplay;
}

const dishes = [makeItem('d1', 'Grilled Chicken'), makeItem('d2', 'Caesar Salad')];
const addons = [makeItem('a1', 'Extra Cheese', 'addon'), makeItem('a2', 'Side Sauce', 'addon')];
const included = [makeItem('i1', 'House Bread', 'included'), makeItem('i2', 'Water', 'included')];
const allItems = [...dishes, ...addons, ...included];

// ── Default props builder ─────────────────────────────────────────────────────

function defaultProps(overrides: Partial<React.ComponentProps<typeof ItemPool>> = {}) {
  return {
    items: allItems,
    menus: [] as MenuSummary[],
    filtered: dishes,
    selected: new Set<string>(),
    search: '',
    filterTags: [],
    canonicalCategories: ['Entrees'],
    dragOver: null as 'pool' | null,
    dragging: null,
    editItemId: null,
    onSearchChange: vi.fn(),
    onFilterChange: vi.fn(),
    onSelectClick: vi.fn(),
    onSelectAll: vi.fn(),
    onClearSelect: vi.fn(),
    onEditItem: vi.fn(),
    visibilityFilter: 'All' as const,
    onVisibilityFilterChange: vi.fn(),
    itemTypeFilter: 'dishes' as const,
    onItemTypeFilterChange: vi.fn(),
    onOpenBulk: vi.fn(),
    onOpenBulkModifiers: vi.fn(),
    onDragStart: vi.fn(),
    onDragEnd: vi.fn(),
    onDragEnterPool: vi.fn(),
    onDragLeavePool: vi.fn(),
    onDropPool: vi.fn(),
    colorMap: () => ({ bg: '#fff', fg: '#000', name: 'white' }) as any,
    ...overrides,
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('ItemPool — item-type filter toggle removed', () => {
  it('does not render the dishes/included/addons tabs', () => {
    render(<ItemPool {...defaultProps()} />);

    expect(screen.queryByTestId('item-type-filter-dishes')).not.toBeInTheDocument();
    expect(screen.queryByTestId('item-type-filter-addons')).not.toBeInTheDocument();
    expect(screen.queryByTestId('item-type-filter-included')).not.toBeInTheDocument();
  });
});

describe('ItemPool — category count badge', () => {
  it('renders a single bare-integer total covering dishes + included', () => {
    // Default factory data: 2 dishes + 2 addons + 2 included, all in Entrees.
    // Badge counts every non-addon item → 4.
    render(<ItemPool {...defaultProps()} />);

    const pill = screen.getByLabelText('4 items');
    expect(pill).toHaveTextContent(/^4$/);
  });

  it('sets matching title attribute on the badge', () => {
    render(<ItemPool {...defaultProps()} />);
    expect(screen.getByLabelText('4 items')).toHaveAttribute('title', '4 items');
  });

  it('uses singular grammar when the category holds exactly one item', () => {
    const lone = [makeItem('d-solo', 'Lone Dish')];
    render(
      <ItemPool
        {...defaultProps({
          items: lone,
          filtered: lone,
        })}
      />,
    );

    const pill = screen.getByLabelText('1 item');
    expect(pill).toHaveTextContent(/^1$/);
    expect(pill).toHaveAttribute('title', '1 item');
  });

  it('does not render the legacy "included" cyan badge', () => {
    render(<ItemPool {...defaultProps()} />);
    expect(screen.queryByLabelText(/included items?/)).not.toBeInTheDocument();
  });

  it('renders item-card rows for items with item_type="included"', async () => {
    // The pool must surface items flipped to item_type='included' by the
    // sides flow. Pass them through `filtered` so the parent's dish-pool
    // filter doesn't accidentally drop them. Categories auto-collapse on
    // first data load — expand "Entrees" before asserting on the rows.
    const dish = makeItem('d-keep', 'Visible Dish');
    const inc = makeItem('i-keep', 'Garlic Bread', 'included');
    const { default: userEvent } = await import('@testing-library/user-event');
    const user = userEvent.setup();
    render(
      <ItemPool
        {...defaultProps({
          items: [dish, inc],
          filtered: [dish, inc],
        })}
      />,
    );

    // Expand Entrees so the cards render in the DOM (collapsed sections
    // omit their children entirely — they're not just hidden).
    await user.click(screen.getByLabelText('Expand Entrees'));

    expect(screen.getByTestId('item-card-d-keep')).toBeInTheDocument();
    expect(screen.getByTestId('item-card-i-keep')).toBeInTheDocument();
  });

  it('renders a bare integer for large counts (no locale formatting leak)', () => {
    const big = Array.from({ length: 47 }, (_, i) => makeItem(`d-${i}`, `Dish ${i}`));
    render(
      <ItemPool
        {...defaultProps({
          items: big,
          filtered: big,
        })}
      />,
    );

    const pill = screen.getByLabelText('47 items');
    expect(pill).toHaveTextContent(/^47$/);
    expect(pill).toHaveAttribute('title', '47 items');
  });
});
