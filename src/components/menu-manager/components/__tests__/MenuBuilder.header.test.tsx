// @vitest-environment jsdom
/**
 * Menu Builder card header (Owner Portal redesign, 2026-11-10).
 *
 * App-Doc execution.ts publishes two header controls; this pins that they
 * are mounted on the real MenuBuilder (checklist G6):
 *   - `menu-manage-sections-btn` opens the Manage sections modal.
 *   - `menu-builder-select-toggle` exists ONLY when the host enables bulk
 *     selection, and reports its state through `aria-pressed`.
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

describe('MenuBuilder — card header controls', () => {
  it('"Manage sections" is mounted and opens the Manage sections modal', () => {
    renderBuilder();
    const btn = screen.getByTestId('menu-manage-sections-btn');
    expect(btn.tagName).toBe('BUTTON');
    expect(screen.queryByTestId('menu-manage-sections-modal')).toBeNull();
    fireEvent.click(btn);
    expect(screen.getByTestId('menu-manage-sections-modal')).toBeTruthy();
  });

  it('"Select" is absent until the host enables bulk selection', () => {
    renderBuilder();
    expect(screen.queryByTestId('menu-builder-select-toggle')).toBeNull();
  });

  it('"Select" toggles aria-pressed when bulk selection is enabled', () => {
    renderBuilder({ bulkSelectionEnabled: true, bulkSelection: new Set(), onToggleBulkSelection: vi.fn(), onOpenBulkPanel: vi.fn() });
    const toggle = screen.getByTestId('menu-builder-select-toggle');
    expect(toggle.getAttribute('aria-pressed')).toBe('false');
    fireEvent.click(toggle);
    expect(toggle.getAttribute('aria-pressed')).toBe('true');
    // The bulk action button is mounted beside it and gated on a selection.
    expect((screen.getByTestId('menu-builder-bulk-action') as HTMLButtonElement).disabled).toBe(true);
  });
});
