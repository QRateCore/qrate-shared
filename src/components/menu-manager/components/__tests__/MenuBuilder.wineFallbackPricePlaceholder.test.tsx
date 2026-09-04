// @vitest-environment jsdom
/**
 * MenuItemRow's expanded Glass/Bottle inline price inputs, 2026-09-05.
 *
 * Regression guard (round 2): a wine's real glass/bottle price — whether
 * from serving_options.price_cents or, for a bottle-only wine, the flat
 * item.price — must appear as the input's actual VALUE, not merely a
 * `placeholder` hint (a placeholder disappears the instant the owner clicks
 * into the field and is never part of the saved form state; the owner
 * reported this looked like the price was missing even though it was right
 * there in the collapsed badge). Also guards the no-op save: seeing the
 * real value pre-filled and blurring without editing it must NOT write a
 * redundant serving_price_overrides entry.
 */
import { describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import type { MenuItemDisplay } from '../../../../types/restaurant';
import { _MenuItemRow as MenuItemRow } from '../MenuBuilder';

function makeItem(overrides: Partial<MenuItemDisplay> = {}): MenuItemDisplay {
  return {
    id: 'wine-1',
    name: 'Faust, Cabernet Sauvignon, Napa, California 2022',
    description: null,
    category: 'Beverages',
    item_type: 'dish',
    thumbnail_url: null,
    price: 135,
    active: true,
    menu_associations: [],
    food_tags: { allergens: [], dietary: [], beverage: { beverage_type: 'wine' } },
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

function renderExpandedRow(props: Partial<React.ComponentProps<typeof MenuItemRow>> = {}) {
  const onUpdateSettings = vi.fn().mockResolvedValue(undefined);
  render(
    <MenuItemRow
      item={makeItem()}
      menuId="menu-1"
      cat="Beverages"
      settings={{ price: null, boost_level: null, chefs_special: false, portion_type: 'single', portion_serves: null }}
      itemsById={new Map()}
      onUpdateSettings={onUpdateSettings}
      onUpdateModifiers={vi.fn().mockResolvedValue(undefined)}
      onDragStart={vi.fn()}
      onDragEnd={vi.fn()}
      onRemove={vi.fn()}
      onEdit={vi.fn()}
      {...props}
    />,
  );
  fireEvent.click(screen.getByTestId('menu-item-expand-wine-1'));
  return { onUpdateSettings };
}

describe('MenuItemRow — bottle-only wine Glass/Bottle real value', () => {
  it('shows the item price as the Bottle field VALUE, not just a placeholder', () => {
    renderExpandedRow();
    const bottleInput = screen.getByTestId('serving-price-input-wine-1-bottle') as HTMLInputElement;
    expect(bottleInput.value).toBe('135');
  });

  it('leaves the Glass field empty — no item-level glass price exists for a bottle-only wine', () => {
    renderExpandedRow();
    const glassInput = screen.getByTestId('serving-price-input-wine-1-glass') as HTMLInputElement;
    expect(glassInput.value).toBe('');
    expect(glassInput.placeholder).toBe('—');
  });

  it('an explicit per-menu override still wins over the item-level default', () => {
    renderExpandedRow({
      settings: {
        price: null, boost_level: null, chefs_special: false, portion_type: 'single', portion_serves: null,
        serving_price_overrides: { bottle: 14500 },
      },
    });
    const bottleInput = screen.getByTestId('serving-price-input-wine-1-bottle') as HTMLInputElement;
    expect(bottleInput.value).toBe('145');
  });

  it('blurring the unedited default value does not write a redundant override', () => {
    const { onUpdateSettings } = renderExpandedRow();
    const bottleInput = screen.getByTestId('serving-price-input-wine-1-bottle') as HTMLInputElement;
    fireEvent.blur(bottleInput);
    expect(onUpdateSettings).not.toHaveBeenCalled();
  });

  it('editing the value to something else DOES save a real override', async () => {
    const { onUpdateSettings } = renderExpandedRow();
    const bottleInput = screen.getByTestId('serving-price-input-wine-1-bottle') as HTMLInputElement;
    fireEvent.change(bottleInput, { target: { value: '150' } });
    fireEvent.blur(bottleInput);
    expect(onUpdateSettings).toHaveBeenCalledWith('menu-1', 'wine-1', {
      serving_price_overrides: { bottle: 15000 },
    });
  });
});

describe('MenuItemRow — wine with real serving_options shows real values too', () => {
  it('shows both Glass and Bottle prices as real VALUES, not placeholders', () => {
    renderExpandedRow({
      item: makeItem({
        serving_options: [
          { id: 'glass', label: 'Glass', price_cents: 2200, is_default: true },
          { id: 'bottle', label: 'Bottle', price_cents: 7800, is_default: false },
        ],
      }),
    });
    expect(screen.queryByTestId('wine-prices-wine-1')).not.toBeInTheDocument();
    const glassInput = screen.getByTestId('serving-price-input-wine-1-glass') as HTMLInputElement;
    const bottleInput = screen.getByTestId('serving-price-input-wine-1-bottle') as HTMLInputElement;
    expect(glassInput.value).toBe('22');
    expect(bottleInput.value).toBe('78');
  });

  it('blurring an unedited real serving_options value does not write a redundant override', () => {
    const { onUpdateSettings } = renderExpandedRow({
      item: makeItem({
        serving_options: [
          { id: 'glass', label: 'Glass', price_cents: 2200, is_default: true },
          { id: 'bottle', label: 'Bottle', price_cents: 7800, is_default: false },
        ],
      }),
    });
    fireEvent.blur(screen.getByTestId('serving-price-input-wine-1-glass'));
    fireEvent.blur(screen.getByTestId('serving-price-input-wine-1-bottle'));
    expect(onUpdateSettings).not.toHaveBeenCalled();
  });
});
