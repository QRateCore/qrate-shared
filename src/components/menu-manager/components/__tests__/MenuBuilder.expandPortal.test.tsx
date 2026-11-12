// @vitest-environment jsdom
/**
 * v5 Menu page (2026-11-12): `expandAllPortalTarget`. With a target, MenuBuilder
 * portals "Expand all / Collapse all" (`collapse-expand-all-btn`) into it and
 * renders NO card header row (no `active-menu-item-count`); with null the
 * header row and its own Expand all render as before (admin / mobile hosts).
 */
import { describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import type { MenuItemDisplay, MenuSummary } from '../../../../types/restaurant';
import MenuBuilder from '../MenuBuilder';

vi.mock('sonner', () => ({ toast: { success: vi.fn(), warning: vi.fn(), error: vi.fn() } }));

const MENU: MenuSummary = {
  id: 'menu-1',
  name: 'Dinner',
  slug: 'dinner',
  display_order: 0,
  active: true,
  start_time: '17:00',
  end_time: '22:00',
  days_of_week: [0, 1, 2, 3, 4, 5, 6],
  is_all_day: false,
  schedule: null,
  item_count: 1,
};

const ITEM = {
  id: 'itm-1',
  name: 'Grilled Chicken',
  description: null,
  category: 'Entrees',
  item_type: 'dish',
  thumbnail_url: null,
  price: 12,
  active: true,
  menu_associations: [{ menu_id: 'menu-1', menu_name: 'Dinner', category_name: 'Entrees', canonical_categories: ['Entrees'], raw_categories: [] }],
  food_tags: { allergens: [], dietary: [] },
  addons: [],
  sides: [],
  sides_and: [],
  sides_or: [],
  recommendations: [],
  gallery_urls: [],
} as unknown as MenuItemDisplay;

const SETTINGS = { price: null, boost_level: null, chefs_special: false, portion_type: 'single' as const, portion_serves: null };

function renderBuilder(props: Partial<React.ComponentProps<typeof MenuBuilder>> = {}) {
  render(
    <MenuBuilder
      items={[ITEM]}
      menus={[MENU]}
      assignments={{ 'menu-1': { Entrees: ['itm-1'] } }}
      junctionSettings={{}}
      activeMenuId="menu-1"
      collapsed={{}}
      dragging={null}
      dragOver={null}
      colorMap={() => ({ name: 'blue', tab: '', tabBorder: '', chip: '', chipText: '', bucket: '' }) as never}
      getSettings={() => SETTINGS}
      onToggleCollapse={vi.fn()}
      onUpdateSettings={vi.fn().mockResolvedValue(undefined)}
      onDragStart={vi.fn()}
      onDragEnd={vi.fn()}
      onDragEnterBucket={vi.fn()}
      onDragLeaveBucket={vi.fn()}
      onDropBucket={vi.fn()}
      onCreateMenu={vi.fn().mockResolvedValue(undefined)}
      onEditMenu={vi.fn()}
      onRemoveItemFromMenu={vi.fn()}
      onEditItem={vi.fn()}
      onUpdateModifiers={vi.fn().mockResolvedValue(undefined)}
      {...props}
    />,
  );
}

describe('MenuBuilder — expandAllPortalTarget (v5)', () => {
  it('portals Expand all into the target and drops the header row', () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const onCollapseAll = vi.fn();
    renderBuilder({ expandAllPortalTarget: host, onCollapseAll });
    const btn = screen.getByTestId('collapse-expand-all-btn');
    expect(host.contains(btn)).toBe(true);
    expect(screen.queryByTestId('active-menu-item-count')).toBeNull();
    expect(screen.queryByTestId('menu-manage-sections-btn')).toBeNull();
    fireEvent.click(btn);
    expect(onCollapseAll).toHaveBeenCalledTimes(1);
    host.remove();
  });

  it('without a target the header row keeps its own Expand all', () => {
    renderBuilder({ expandAllPortalTarget: null, onCollapseAll: vi.fn() });
    const btn = screen.getByTestId('collapse-expand-all-btn');
    expect(screen.getByTestId('menu-builder-panel').contains(btn)).toBe(true);
    expect(screen.getByTestId('menu-manage-sections-btn')).toBeTruthy();
  });
});
