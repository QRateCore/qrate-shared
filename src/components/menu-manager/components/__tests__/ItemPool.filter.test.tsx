// @vitest-environment jsdom
/**
 * Unit tests for ItemPool.
 *
 * Covers:
 *  - Item-type filter toggle (Dishes / Add-ons / Included)
 *  - Active state styling matches the selected filter
 *  - Clicking a tab calls onItemTypeFilterChange with the correct value
 *  - data-testid attributes are present for E2E selectors
 *  - Category-row count badges (STR-401): bare-integer text, aria-label and title
 *    with singular/plural grammar; pill is hidden when count is zero.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
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
    onAddItem: vi.fn(),
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

describe('ItemPool — item-type filter toggle', () => {
  it('renders all three filter buttons with correct labels', () => {
    render(<ItemPool {...defaultProps()} />);

    expect(screen.getByTestId('item-type-filter-dishes')).toHaveTextContent('Dishes');
    expect(screen.getByTestId('item-type-filter-addons')).toHaveTextContent('Add-ons');
    expect(screen.getByTestId('item-type-filter-included')).toHaveTextContent('Included');
  });

  it('clicking "Add-ons" calls onItemTypeFilterChange with "addons"', () => {
    const onChange = vi.fn();
    render(<ItemPool {...defaultProps({ onItemTypeFilterChange: onChange })} />);

    fireEvent.click(screen.getByTestId('item-type-filter-addons'));
    expect(onChange).toHaveBeenCalledWith('addons');
  });

  it('clicking "Included" calls onItemTypeFilterChange with "included"', () => {
    const onChange = vi.fn();
    render(<ItemPool {...defaultProps({ onItemTypeFilterChange: onChange })} />);

    fireEvent.click(screen.getByTestId('item-type-filter-included'));
    expect(onChange).toHaveBeenCalledWith('included');
  });

  it('clicking "Dishes" calls onItemTypeFilterChange with "dishes"', () => {
    const onChange = vi.fn();
    render(<ItemPool {...defaultProps({ itemTypeFilter: 'addons', onItemTypeFilterChange: onChange })} />);

    fireEvent.click(screen.getByTestId('item-type-filter-dishes'));
    expect(onChange).toHaveBeenCalledWith('dishes');
  });

  it('active tab has white text color', () => {
    const { rerender } = render(<ItemPool {...defaultProps({ itemTypeFilter: 'dishes' })} />);

    expect(screen.getByTestId('item-type-filter-dishes').style.color).toBe('white');
    expect(screen.getByTestId('item-type-filter-addons').style.color).not.toBe('white');
    expect(screen.getByTestId('item-type-filter-included').style.color).not.toBe('white');

    rerender(<ItemPool {...defaultProps({ itemTypeFilter: 'included' })} />);

    expect(screen.getByTestId('item-type-filter-included').style.color).toBe('white');
    expect(screen.getByTestId('item-type-filter-dishes').style.color).not.toBe('white');
    expect(screen.getByTestId('item-type-filter-addons').style.color).not.toBe('white');
  });
});

describe('ItemPool — category count badges (STR-401)', () => {
  it('renders bare integer text (no "d" or "i" suffix)', () => {
    render(<ItemPool {...defaultProps()} />);

    const dishPill = screen.getByLabelText('2 dishes');
    expect(dishPill).toHaveTextContent(/^2$/);
    expect(dishPill).not.toHaveTextContent(/d/);

    const includedPill = screen.getByLabelText('2 included items');
    expect(includedPill).toHaveTextContent(/^2$/);
    expect(includedPill).not.toHaveTextContent(/i/);
  });

  it('sets matching title attribute on each pill', () => {
    render(<ItemPool {...defaultProps()} />);

    expect(screen.getByLabelText('2 dishes')).toHaveAttribute('title', '2 dishes');
    expect(screen.getByLabelText('2 included items')).toHaveAttribute('title', '2 included items');
  });

  it('uses singular grammar when count is exactly 1', () => {
    const oneDish = [makeItem('d-solo', 'Lone Dish')];
    const oneIncluded = [makeItem('i-solo', 'Solo Bread', 'included')];
    render(
      <ItemPool
        {...defaultProps({
          items: [...oneDish, ...oneIncluded],
          filtered: oneDish,
          itemTypeFilter: 'dishes',
        })}
      />,
    );

    const dishPill = screen.getByLabelText('1 dish');
    expect(dishPill).toHaveTextContent(/^1$/);
    expect(dishPill).toHaveAttribute('title', '1 dish');

    const includedPill = screen.getByLabelText('1 included item');
    expect(includedPill).toHaveTextContent(/^1$/);
    expect(includedPill).toHaveAttribute('title', '1 included item');
  });

  it('hides the dish pill when dishCount is zero', () => {
    // Only included items — no dishes — dish pill MUST NOT render
    const includedOnly = [makeItem('i1', 'Bread', 'included'), makeItem('i2', 'Water', 'included')];
    render(
      <ItemPool
        {...defaultProps({
          items: includedOnly,
          filtered: includedOnly,
          itemTypeFilter: 'included',
        })}
      />,
    );

    expect(screen.queryByLabelText(/dishes?$/)).not.toBeInTheDocument();
    expect(screen.getByLabelText('2 included items')).toBeInTheDocument();
  });

  it('hides the included pill when includedCount is zero', () => {
    // Only dishes — no included — included pill MUST NOT render
    const dishesOnly = [makeItem('d1', 'A'), makeItem('d2', 'B')];
    render(
      <ItemPool
        {...defaultProps({
          items: dishesOnly,
          filtered: dishesOnly,
          itemTypeFilter: 'dishes',
        })}
      />,
    );

    expect(screen.queryByLabelText(/included item/)).not.toBeInTheDocument();
    expect(screen.getByLabelText('2 dishes')).toBeInTheDocument();
  });

  it('renders bare integer for large counts (no locale formatting leak)', () => {
    const big = Array.from({ length: 47 }, (_, i) => makeItem(`d-${i}`, `Dish ${i}`));
    render(
      <ItemPool
        {...defaultProps({
          items: big,
          filtered: big,
          itemTypeFilter: 'dishes',
        })}
      />,
    );

    const pill = screen.getByLabelText('47 dishes');
    expect(pill).toHaveTextContent(/^47$/);
    expect(pill).toHaveAttribute('title', '47 dishes');
  });

  it('both pills render simultaneously with distinct accessible names', () => {
    render(<ItemPool {...defaultProps()} />);

    const dishPill = screen.getByLabelText('2 dishes');
    const includedPill = screen.getByLabelText('2 included items');

    expect(dishPill).toBeInTheDocument();
    expect(includedPill).toBeInTheDocument();
    expect(dishPill).not.toBe(includedPill);
  });
});
