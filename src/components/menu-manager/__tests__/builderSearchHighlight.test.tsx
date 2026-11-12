// @vitest-environment jsdom
/**
 * Builder search HIGHLIGHT mode (owner Menu workspace, handoff v2): the Item
 * library's search marks matching rows instead of filtering. Pinned:
 *  - markMatches wraps every case-insensitive hit in <mark>;
 *  - MenuManagerClient provides the matches (name / description) only while a
 *    highlight query is set, and leaves the header search's filter alone;
 *  - a row is "match" / "dim" under a search and unmarked without one, and the
 *    row chrome gets the query only for a match;
 *  - a sub-category holding a match is shown open, and the owner's own
 *    collapsed state comes back when the search clears.
 */
import { describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import React from 'react';
import { BuilderSearchHighlightContext, markMatches, useBuilderSearchHighlight, type BuilderSearchHighlight } from '../builderSearchHighlight';
import { _MenuItemRow as MenuItemRow, type MenuRowChromeProps } from '../components/MenuBuilder';
import { SubCategoryGroup } from '../components/SubCategoryGroup';
import type { MenuItemDisplay, MenuSummary, MenuManagerService } from '../../../types/restaurant';

let seen: BuilderSearchHighlight | null | undefined;
let lastBuilderQuery: string | undefined;
vi.mock('../components/MenuBuilder', async (orig) => {
  const real = await orig<typeof import('../components/MenuBuilder')>();
  return {
    ...real,
    default: (props: { builderSearchQuery?: string }) => {
      seen = useBuilderSearchHighlight();
      lastBuilderQuery = props.builderSearchQuery;
      return <div data-testid="menu-builder-mock" />;
    },
  };
});
vi.mock('../components/ItemPool', () => ({ default: () => null }));
vi.mock('../components/MobileMenuManagerLayout', () => ({ default: () => <div /> }));
vi.mock('../components/BulkActionsPanel', () => ({ default: () => null }));
vi.mock('../components/BulkModifierPanel', () => ({ default: () => null }));
vi.mock('../components/MenuEditPanel', () => ({ default: () => null }));
vi.mock('../components/EditModal', () => ({ default: () => null }));
vi.mock('../../../hooks/useIsMobile', () => ({ useIsMobile: () => false }));
vi.mock('../track-action-context', () => ({
  useTrackAction: () => () => {},
  TrackActionProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

// Imported after the mocks.
const { default: MenuManagerClient } = await import('../MenuManagerClient');

function makeItem(id: string, name: string, description: string | null = null): MenuItemDisplay {
  return {
    id, name, description, category: 'Entrees', canonical_category: 'Entrees', item_type: 'dish',
    thumbnail_url: null, price: 12, active: true, menu_associations: [],
    food_tags: { allergens: [], dietary: [] }, display_allergens: [], display_dietary: [],
    addons: [], sides: [], sides_and: [], sides_or: [], recommendations: [], gallery_urls: [],
  } as unknown as MenuItemDisplay;
}

describe('markMatches', () => {
  it('marks every case-insensitive hit and keeps the rest of the text', () => {
    render(<span data-testid="t">{markMatches('Paneer pakora with paneer', 'PANEER')}</span>);
    const marks = screen.getAllByTestId('builder-search-mark');
    expect(marks.map((m) => m.textContent)).toEqual(['Paneer', 'paneer']);
    expect(screen.getByTestId('t').textContent).toBe('Paneer pakora with paneer');
  });

  it('returns the plain text for an empty query or no hit', () => {
    expect(markMatches('Dal', '')).toBe('Dal');
    expect(markMatches('Dal', '  ')).toBe('Dal');
    expect(markMatches('Dal', undefined)).toBe('Dal');
    expect(markMatches('Dal', 'xyz')).toBe('Dal');
  });
});

describe('MenuManagerClient builderHighlightQuery', () => {
  const service = {} as unknown as MenuManagerService;
  const menu = { id: 'menu-1', name: 'Menu 1', active: true, schedule: null, items: [] } as unknown as MenuSummary;
  const items = [makeItem('a', 'Paneer Tikka'), makeItem('b', 'Dal', 'slow-cooked with paneer'), makeItem('c', 'Naan')];

  it('provides the matches (name or description) while a highlight query is set', () => {
    render(<MenuManagerClient service={service} restaurantId="r1" initialItems={items} initialMenus={[menu]} builderHighlightQuery="  paneer " />);
    expect(seen?.query).toBe('paneer');
    expect([...(seen?.matchIds ?? [])].sort()).toEqual(['a', 'b']);
    // The header search (filter mode) is untouched.
    expect(lastBuilderQuery).toBeUndefined();
  });

  it('provides nothing without a query', () => {
    render(<MenuManagerClient service={service} restaurantId="r1" initialItems={items} initialMenus={[menu]} builderHighlightQuery="" />);
    expect(seen).toBeNull();
  });
});

function renderRow(highlight: BuilderSearchHighlight | null, id = 'itm-1') {
  let last: MenuRowChromeProps | null = null;
  const row = (
    <MenuItemRow
      item={makeItem(id, 'Grilled Chicken')}
      menuId="menu-1"
      cat="Entrees"
      settings={{ price: null }}
      itemsById={new Map()}
      onUpdateSettings={vi.fn().mockResolvedValue(undefined)}
      onUpdateModifiers={vi.fn().mockResolvedValue(undefined)}
      onDragStart={vi.fn()}
      onDragEnd={vi.fn()}
      onRemove={vi.fn()}
      onEdit={vi.fn()}
      rowChrome={(p) => { last = p; return <div data-testid="chrome" />; }}
    />
  );
  render(highlight ? <BuilderSearchHighlightContext.Provider value={highlight}>{row}</BuilderSearchHighlightContext.Provider> : row);
  return { chrome: () => last!, row: () => screen.getByTestId(`menu-item-row-${id}`) };
}

describe('MenuItemRow under a highlight search', () => {
  it('a match is marked and its chrome gets the query', () => {
    const { chrome, row } = renderRow({ query: 'chick', matchIds: new Set(['itm-1']) });
    expect(row()).toHaveAttribute('data-search', 'match');
    expect(row().className).toContain('shadow-[inset_3px_0_0_var(--accent)]');
    expect(chrome().searchQuery).toBe('chick');
  });

  it('a non-match is dimmed and its chrome gets no query', () => {
    const { chrome, row } = renderRow({ query: 'dal', matchIds: new Set(['other']) });
    expect(row()).toHaveAttribute('data-search', 'dim');
    expect(row().className).toContain('opacity-45');
    expect(chrome().searchQuery).toBeUndefined();
  });

  it('no search: no attribute, no styling, no query', () => {
    const { chrome, row } = renderRow(null);
    expect(row()).not.toHaveAttribute('data-search');
    expect(row().className).not.toContain('opacity-45');
    expect(chrome().searchQuery).toBeUndefined();
  });
});

describe('SubCategoryGroup forceOpen', () => {
  const group = (forceOpen: boolean) => (
    <SubCategoryGroup label="Curries" category="Entrees" menuId="menu-1" itemCount={1} color="#000" forceOpen={forceOpen}>
      <div data-testid="sub-child">Dal</div>
    </SubCategoryGroup>
  );

  it('opens while a match sits inside, and the owner’s own state returns on clear', () => {
    const { rerender } = render(group(false));
    expect(screen.queryByTestId('sub-child')).toBeNull(); // starts collapsed
    rerender(group(true));
    expect(screen.getByTestId('sub-child')).toBeInTheDocument();
    rerender(group(false));
    expect(screen.queryByTestId('sub-child')).toBeNull(); // back to the owner's collapsed state
  });

  it('a sub-category the owner opened stays open after the search clears', () => {
    const { rerender } = render(group(false));
    fireEvent.click(screen.getAllByRole('button', { name: 'Expand Curries' })[0]!);
    expect(screen.getByTestId('sub-child')).toBeInTheDocument();
    rerender(group(true));
    rerender(group(false));
    expect(screen.getByTestId('sub-child')).toBeInTheDocument();
  });
});
