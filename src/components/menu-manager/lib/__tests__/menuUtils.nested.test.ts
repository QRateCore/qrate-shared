import { describe, it, expect } from 'vitest';
import {
  buildNestedAssignments,
  sortedSubCategoryLabels,
  UNGROUPED_KEY,
} from '../menuUtils';
import type { MenuItemDisplay, MenuSummary } from '../../../../types/restaurant';

const menus = [{ id: 'menu-1', name: 'Dinner' }] as unknown as MenuSummary[];

function item(id: string, assoc: Partial<MenuItemDisplay['menu_associations'][number]>): MenuItemDisplay {
  return {
    id,
    name: id,
    category: 'Entrees',
    menu_associations: [
      {
        menu_id: 'menu-1',
        menu_name: 'Dinner',
        price: 1,
        canonical_categories: ['Entrees'],
        ...assoc,
      },
    ],
  } as unknown as MenuItemDisplay;
}

describe('buildNestedAssignments', () => {
  it('groups items by raw label within a canonical bucket', () => {
    const items = [
      item('a', { raw_categories: ['Tacos'] }),
      item('b', { raw_categories: ['Tacos'] }),
      item('c', { raw_categories: ['Burritos'] }),
    ];
    const nested = buildNestedAssignments(items, menus);
    expect(nested['menu-1']['Entrees']['Tacos']).toEqual(['a', 'b']);
    expect(nested['menu-1']['Entrees']['Burritos']).toEqual(['c']);
  });

  it('fans a multi-label item under each of its labels', () => {
    const nested = buildNestedAssignments([item('a', { raw_categories: ['Tacos', 'Specials'] })], menus);
    expect(nested['menu-1']['Entrees']['Tacos']).toEqual(['a']);
    expect(nested['menu-1']['Entrees']['Specials']).toEqual(['a']);
  });

  it('places unlabeled items under UNGROUPED_KEY', () => {
    const nested = buildNestedAssignments([item('a', { raw_categories: [] })], menus);
    expect(nested['menu-1']['Entrees'][UNGROUPED_KEY]).toEqual(['a']);
  });

  it('an item in two canonical buckets shows the same label under both', () => {
    const it = item('a', { canonical_categories: ['Entrees', 'Sides'], raw_categories: ['Tacos'] });
    const nested = buildNestedAssignments([it], menus);
    expect(nested['menu-1']['Entrees']['Tacos']).toEqual(['a']);
    expect(nested['menu-1']['Sides']['Tacos']).toEqual(['a']);
  });

  it('dedupes an item id within a (bucket, label)', () => {
    // Two associations for the same item+menu both carrying Tacos under Entrees.
    const dup = {
      id: 'a',
      name: 'a',
      category: 'Entrees',
      menu_associations: [
        { menu_id: 'menu-1', menu_name: 'Dinner', price: 1, canonical_categories: ['Entrees'], raw_categories: ['Tacos'] },
        { menu_id: 'menu-1', menu_name: 'Dinner', price: 1, canonical_categories: ['Entrees'], raw_categories: ['Tacos'] },
      ],
    } as unknown as MenuItemDisplay;
    const nested = buildNestedAssignments([dup], menus);
    expect(nested['menu-1']['Entrees']['Tacos']).toEqual(['a']);
  });
});

describe('sortedSubCategoryLabels', () => {
  it('sorts alphabetically (case-insensitive) with Ungrouped last', () => {
    expect(sortedSubCategoryLabels(['Tacos', UNGROUPED_KEY, 'burritos', 'Apps'])).toEqual([
      'Apps',
      'burritos',
      'Tacos',
      UNGROUPED_KEY,
    ]);
  });

  it('keeps Ungrouped last even when alone-with-one-label', () => {
    expect(sortedSubCategoryLabels([UNGROUPED_KEY, 'Zeta'])).toEqual(['Zeta', UNGROUPED_KEY]);
  });
});
