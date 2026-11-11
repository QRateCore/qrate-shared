// @vitest-environment jsdom
/**
 * Menu Builder item-row chrome (Owner Portal redesign, 2026-11-10).
 *
 * The desktop row is grip · initials tile · name · price · Visible/Hidden
 * pill · ⋯. Pinned here:
 *   1. The WHOLE row body is the edit target (`edit-menu-item-<id>` opens the
 *      editor drawer) — no pencil.
 *   2. The chevron (`menu-item-expand-<id>`) still expands the per-menu
 *      settings (the E2E item-settings specs drive it).
 *   3. The ⋯ menu (`menu-row-menu-<id>`) holds Edit price & promotion,
 *      Hide/Show to guests, Includes & choose-one and the scoped
 *      Remove-from-menu (`remove-from-menu-<id>` keeps its title/aria contract,
 *      rendered in the destructive `text-bad` tone).
 *   4. The tile shows initials when the dish has no photo.
 *   5. The Visible/Hidden pill reads the item's global availability.
 */
import { describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import type { MenuItemDisplay } from '../../../../types/restaurant';
import { _MenuItemRow as MenuItemRow, initialsOf } from '../MenuBuilder';

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
  const onToggleActive = vi.fn();
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
      onToggleActive={onToggleActive}
      {...props}
    />,
  );
  return { onRemove, onEdit, onToggleActive };
}

const editTarget = () => screen.getByTestId('edit-menu-item-itm-1');
const openMenu = () => fireEvent.click(screen.getByTestId('menu-row-menu-itm-1'));

describe('initialsOf', () => {
  it('takes the first letter of the first two words', () => {
    expect(initialsOf('Butter Chicken')).toBe('BC');
    expect(initialsOf('lamb rogan josh')).toBe('LR');
  });
  it('takes two letters of a single word, and a dot for nothing', () => {
    expect(initialsOf('Kulfi')).toBe('KU');
    expect(initialsOf('')).toBe('·');
  });
});

describe('MenuItemRow — redesigned row chrome', () => {
  it('the whole row body is the edit target and fires onEdit', () => {
    const { onEdit } = renderRow();
    const body = editTarget();
    expect(body.tagName).toBe('BUTTON');
    expect(body.textContent).toContain('Grilled Chicken');
    fireEvent.click(body);
    expect(onEdit).toHaveBeenCalledTimes(1);
  });

  it('shows an initials tile when the dish has no photo, the photo when it has one', () => {
    renderRow();
    expect(screen.getByTestId('menu-item-tile-itm-1').textContent).toBe('GC');
  });

  it('the chevron expands the per-menu settings without opening the editor', () => {
    const { onEdit } = renderRow();
    fireEvent.click(screen.getByTestId('menu-item-expand-itm-1'));
    expect(screen.getByTestId('menu-item-settings-itm-1')).toBeTruthy();
    expect(onEdit).not.toHaveBeenCalled();
  });

  it('reads Visible for an active item and Hidden for an 86d one', () => {
    renderRow();
    expect(screen.getByTestId('menu-item-visibility-itm-1').textContent).toBe('Visible');
  });

  it('reads Hidden for an inactive item', () => {
    renderRow({ item: makeItem({ active: false }) });
    expect(screen.getByTestId('menu-item-visibility-itm-1').textContent).toBe('Hidden');
  });

  it('the ⋯ menu is closed until clicked, then lists the four actions', () => {
    renderRow();
    expect(screen.queryByTestId('remove-from-menu-itm-1')).toBeNull();
    openMenu();
    // App-Doc execution.ts names the open list `menu-row-menu-list-<id>`.
    expect(screen.getByTestId('menu-row-menu-list-itm-1').getAttribute('role')).toBe('menu');
    expect(screen.getByTestId('menu-row-edit-itm-1')).toBeTruthy();
    expect(screen.getByTestId('menu-row-visibility-itm-1').textContent).toContain('Hide from guests');
    expect(screen.getByTestId('menu-row-sides-itm-1')).toBeTruthy();
    expect(screen.getByTestId('remove-from-menu-itm-1')).toBeTruthy();
  });

  it('"Edit price & promotion" opens the editor', () => {
    const { onEdit } = renderRow();
    openMenu();
    fireEvent.click(screen.getByTestId('menu-row-edit-itm-1'));
    expect(onEdit).toHaveBeenCalledTimes(1);
  });

  it('"Hide from guests" toggles the global availability; "Show to guests" for a hidden item', () => {
    const { onToggleActive } = renderRow();
    openMenu();
    fireEvent.click(screen.getByTestId('menu-row-visibility-itm-1'));
    expect(onToggleActive).toHaveBeenCalledTimes(1);
  });

  it('"Show to guests" is offered for a hidden item', () => {
    renderRow({ item: makeItem({ active: false }) });
    openMenu();
    expect(screen.getByTestId('menu-row-visibility-itm-1').textContent).toContain('Show to guests');
  });

  it('"Includes & choose-one" expands the row (where the per-menu zones live) and is gated on showIncludeZones', () => {
    renderRow({ showIncludeZones: true });
    openMenu();
    fireEvent.click(screen.getByTestId('menu-row-sides-itm-1'));
    expect(screen.getByTestId('menu-item-settings-itm-1')).toBeTruthy();
  });

  it('omits "Includes & choose-one" when the include zones are gated off', () => {
    renderRow({ showIncludeZones: false });
    openMenu();
    expect(screen.queryByTestId('menu-row-sides-itm-1')).toBeNull();
  });

  it('the remove entry is destructive, fires onRemove, and reads "Remove from menu" when unscoped', () => {
    const { onRemove } = renderRow();
    openMenu();
    const del = screen.getByTestId('remove-from-menu-itm-1');
    expect(del.className).toContain('text-bad');
    expect(del.getAttribute('title')).toBe('Remove from menu');
    expect(del.getAttribute('aria-label')).toBe('Remove Grilled Chicken from menu');
    fireEvent.click(del);
    expect(onRemove).toHaveBeenCalledTimes(1);
  });

  it('the remove entry is scoped to the sub-category the row sits under', () => {
    renderRow({ subLabel: 'Curries' });
    openMenu();
    const del = screen.getByTestId('remove-from-menu-itm-1');
    expect(del.getAttribute('title')).toBe('Remove from “Curries”');
    expect(del.getAttribute('aria-label')).toBe('Remove Grilled Chicken from sub-category Curries');
  });

  it('clicking the ⋯ button does not open the editor', () => {
    const { onEdit } = renderRow();
    openMenu();
    expect(onEdit).not.toHaveBeenCalled();
  });
});
