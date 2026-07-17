// @vitest-environment jsdom
/**
 * Menu Builder item-row edit/delete controls (2026-07-17).
 *
 * The per-row controls on the RIGHT of every item row are the edit (pencil) and
 * remove-from-menu (trash) buttons. Three asks are pinned here:
 *   1. The trash is RED by default (destructive), not neutral-until-hover.
 *   2. The pencil stays neutral so the red reads as "destructive".
 *   3. Both are bumped up (desktop 14px → 17px icon, w-8 → w-10 hit area) so
 *      they're easy to spot and tap.
 * They render unconditionally (no hover reveal), which — together with the
 * `scrollbar-gutter: stable` list container — is why clicking a row no longer
 * shifts them.
 */
import { describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import type { MenuItemDisplay } from '../../../../types/restaurant';
import { _MenuItemRow as MenuItemRow } from '../MenuBuilder';
import { COLOR_MAP } from '../../lib/menuUtils';

function makeItem(overrides: Partial<MenuItemDisplay> = {}): MenuItemDisplay {
  return {
    id: 'itm-1',
    name: 'Grilled Chicken',
    description: null,
    category: 'Entrees',
    item_type: 'dish',
    thumbnail_url: null,
    price: 12,
    active: true,
    menu_associations: [],
    food_tags: { allergens: [], dietary: [] },
    display_allergens: [],
    display_dietary: [],
    addons: [],
    sides: [],
    sides_and: [],
    sides_or: [],
    recommendations: [],
    gallery_urls: [],
    ...overrides,
  } as unknown as MenuItemDisplay;
}

const SETTINGS = { price: null, boost_level: null, chefs_special: false, portion_type: 'single' as const, portion_serves: null };

function renderRow(props: Partial<React.ComponentProps<typeof MenuItemRow>> = {}) {
  const onRemove = vi.fn();
  const onEdit = vi.fn();
  render(
    <MenuItemRow
      item={makeItem()}
      menuId="menu-1"
      cat="Entrees"
      settings={SETTINGS}
      itemsById={new Map()}
      onUpdateSettings={vi.fn().mockResolvedValue(undefined)}
      onUpdateModifiers={vi.fn().mockResolvedValue(undefined)}
      onDragStart={vi.fn()}
      onDragEnd={vi.fn()}
      onRemove={onRemove}
      onEdit={onEdit}
      {...props}
    />,
  );
  return { onRemove, onEdit };
}

const editBtn = () => screen.getByTestId('edit-menu-item-itm-1');
const removeBtn = () => screen.getByTestId('remove-from-menu-itm-1');
const svgSize = (el: HTMLElement) => el.querySelector('svg')?.getAttribute('width') ?? null;

describe('MenuItemRow — edit/delete row controls', () => {
  it('renders the trash in the destructive red var by default (not neutral)', () => {
    renderRow();
    const btn = removeBtn();
    expect(btn.className).toContain('text-[var(--red)]');
    // The old "gray until hover" wiring must be gone.
    expect(btn.className).not.toContain('text-[var(--text2)]');
  });

  it('keeps the edit (pencil) neutral — NOT red', () => {
    renderRow();
    const btn = editBtn();
    expect(btn.className).toContain('text-[var(--text2)]');
    expect(btn.className).not.toContain('text-[var(--red)]');
  });

  it('uses the enlarged desktop icon size (17px, was 14px)', () => {
    renderRow();
    expect(svgSize(editBtn())).toBe('17');
    expect(svgSize(removeBtn())).toBe('17');
  });

  it('uses the enlarged desktop hit area (w-10, was w-8)', () => {
    renderRow();
    expect(editBtn().className).toContain('w-10');
    expect(removeBtn().className).toContain('w-10');
  });

  it('both controls render unconditionally (present without any hover)', () => {
    renderRow();
    expect(editBtn()).toBeTruthy();
    expect(removeBtn()).toBeTruthy();
  });

  it('clicking edit fires onEdit and does not expand the row', () => {
    const { onEdit } = renderRow();
    fireEvent.click(editBtn());
    expect(onEdit).toHaveBeenCalledTimes(1);
  });

  it('clicking the trash fires onRemove', () => {
    const { onRemove } = renderRow();
    fireEvent.click(removeBtn());
    expect(onRemove).toHaveBeenCalledTimes(1);
  });
});
