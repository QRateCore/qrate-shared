import { describe, it, expect } from 'vitest';
import { buildRawCategoryOptions } from '../RawCategorySelect';
import type { MenuItemDisplay } from '../../../../types/restaurant';

const item = (id: string, category: string | null): MenuItemDisplay =>
  ({ id, name: id, category } as unknown as MenuItemDisplay);

describe('buildRawCategoryOptions — unified Raw Category dropdown source', () => {
  it('unions item categories, owner-created categories, and the current value', () => {
    const opts = buildRawCategoryOptions({
      items: [item('1', 'Tacos'), item('2', 'Sides')],
      ownerFoodCategories: ['House Specials'], // item-less, freshly created
      currentValue: 'Drinks',
    });
    const labels = opts.map((o) => o.label);
    expect(labels).toContain('Tacos');
    expect(labels).toContain('Sides');
    expect(labels).toContain('House Specials'); // the bug fix: appears with no backing item
    expect(labels).toContain('Drinks');
  });

  it('puts Uncategorized first and never duplicates the literal "Uncategorized"', () => {
    const opts = buildRawCategoryOptions({
      items: [item('1', 'Uncategorized'), item('2', 'Tacos')],
    });
    expect(opts[0]).toEqual({ value: '', label: 'Uncategorized' });
    expect(opts.filter((o) => o.label === 'Uncategorized')).toHaveLength(1);
  });

  it('de-dupes case-insensitively (first-seen casing wins) and sorts the rest', () => {
    const opts = buildRawCategoryOptions({
      items: [item('1', 'tacos'), item('2', 'Tacos'), item('3', 'Apps')],
    });
    const cats = opts.slice(1).map((o) => o.label);
    expect(cats).toEqual(['Apps', 'tacos']); // sorted; only one casing of tacos
  });

  it('honors a custom uncategorizedValue sentinel (bulk drawer use)', () => {
    const opts = buildRawCategoryOptions({
      items: [item('1', 'Tacos')],
      uncategorizedValue: '__uncat__',
    });
    expect(opts[0]).toEqual({ value: '__uncat__', label: 'Uncategorized' });
  });

  it('ignores blank/whitespace categories', () => {
    const opts = buildRawCategoryOptions({
      items: [item('1', '   '), item('2', null), item('3', 'Tacos')],
    });
    expect(opts.map((o) => o.label)).toEqual(['Uncategorized', 'Tacos']);
  });
});
