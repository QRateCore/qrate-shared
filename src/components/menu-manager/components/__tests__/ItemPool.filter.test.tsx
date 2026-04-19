// @vitest-environment jsdom
/**
 * Unit tests for ItemPool — item-type filter toggle (Dishes / Add-ons / Included).
 *
 * Covers:
 *  - All three toggle buttons render with correct labels
 *  - Active state styling matches the selected filter
 *  - Clicking a tab calls onItemTypeFilterChange with the correct value
 *  - data-testid attributes are present for E2E selectors
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
