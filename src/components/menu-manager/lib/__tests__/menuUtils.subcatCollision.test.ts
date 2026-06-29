/**
 * Sub-category normalized-key COLLISION handling — regression coverage for the
 * Anant prod bug where "Bread (Kulcha)" would not reorder (always snapped to the
 * bottom of Main/Entrees).
 *
 * Root cause (verified against Anant prod, Lunch → Entrees): TWO first-class
 * `menu_subcategories` rows collapse to the same normalizeSubcatKey "bread
 * kulcha":
 *     "Bread (Kulcha)"  sort_order 5  (3 items)
 *     "Bread Kulcha"    sort_order 10 (1 item)
 * The builder merges them into ONE displayed pill. The OLD code:
 *   1. orderSubcategoryLabels mapped the key with LAST-write-wins → the pill
 *      resolved to whichever colliding row appeared last in the array.
 *   2. the reorder persist resolved the pill to ONE row id and APPENDED the
 *      colliding sibling to the bottom, so after the save the sibling held the
 *      last sort_order — and last-wins resolved the merged pill to the bottom.
 * → the pill snapped back to the bottom on every drag.
 *
 * The fix: orderSubcategoryLabels resolves a merged pill to the MIN sort_order
 * of its colliding rows, and buildReorderedSubcategoryIds keeps ALL rows that
 * share a pill's normalized key CONSECUTIVE at the pill's new position (never
 * orphaning a sibling to the bottom).
 */
import { describe, expect, it } from 'vitest';
import {
  orderSubcategoryLabels,
  buildReorderedSubcategoryIds,
  normalizeSubcatKey,
  UNGROUPED_KEY,
} from '../menuUtils';

// The real Anant Lunch → Entrees rows (names + sort_order), reproduced exactly.
const ANANT_LUNCH_ENTREES = [
  { name: 'Lunch Combo', sort_order: 0 },
  { name: 'Lunch Favorites', sort_order: 1 },
  { name: 'Biryani', sort_order: 2 },
  { name: 'Bread (Naan)', sort_order: 3 },
  { name: 'Bread (Others)', sort_order: 4 },
  { name: 'Bread (Kulcha)', sort_order: 5 }, // ← collides with "Bread Kulcha"
  { name: 'Sides', sort_order: 6 },
  { name: 'Soups', sort_order: 7 },
  { name: 'Salads', sort_order: 8 },
  { name: 'Anant Mocktails', sort_order: 9 },
  { name: 'Bread Kulcha', sort_order: 10 }, // ← collides with "Bread (Kulcha)"
  { name: 'Express Lunch', sort_order: 11 },
  { name: 'Specialty Bread', sort_order: 12 },
  { name: 'Uncategorised', sort_order: 13 },
];

describe('orderSubcategoryLabels — normalized-key collisions (MIN, not last-wins)', () => {
  it('confirms the two Anant rows collide on the same normalized key', () => {
    expect(normalizeSubcatKey('Bread (Kulcha)')).toBe('bread kulcha');
    expect(normalizeSubcatKey('Bread Kulcha')).toBe('bread kulcha');
  });

  it('resolves a merged pill to the EARLIEST (min) sort_order of its colliding rows', () => {
    // Pill "Bread (Kulcha)" is backed by rows at sort_order 5 AND 10. It must
    // sort as if at 5 (between "Bread (Others)"=4 and "Sides"=6), NOT 10.
    const labels = [
      'Lunch Combo', 'Lunch Favorites', 'Biryani', 'Bread (Naan)', 'Bread (Others)',
      'Bread (Kulcha)', 'Sides', 'Soups', 'Salads', 'Anant Mocktails',
      'Express Lunch', 'Specialty Bread', 'Uncategorised',
    ];
    const out = orderSubcategoryLabels(labels, ANANT_LUNCH_ENTREES);
    // Bread (Kulcha) sits at min(5,10)=5 → right after Bread (Others).
    expect(out.indexOf('Bread (Kulcha)')).toBe(out.indexOf('Bread (Others)') + 1);
    expect(out.indexOf('Bread (Kulcha)')).toBeLessThan(out.indexOf('Sides'));
  });

  it('REGRESSION: after a reorder moves the pill to the top while its sibling is orphaned to the bottom, the pill follows the moved row (min), not the orphan', () => {
    // Simulate post-save state where the persist gave "Bread (Kulcha)" the new
    // top position (0) but the sibling "Bread Kulcha" drifted to the bottom (13).
    // OLD last-wins would resolve the pill to 13 → snap to bottom (the bug).
    const movedToTop = [
      { name: 'Bread (Kulcha)', sort_order: 0 },
      { name: 'Lunch Combo', sort_order: 1 },
      { name: 'Lunch Favorites', sort_order: 2 },
      { name: 'Bread Kulcha', sort_order: 13 }, // orphaned sibling, last
    ];
    const out = orderSubcategoryLabels(
      ['Lunch Combo', 'Lunch Favorites', 'Bread (Kulcha)'],
      movedToTop,
    );
    expect(out[0]).toBe('Bread (Kulcha)'); // follows the moved row (min 0), NOT the orphan (13)
  });

  it('still orders distinct (non-colliding) labels purely by sort_order', () => {
    const out = orderSubcategoryLabels(
      ['Sides', 'Biryani', 'Lunch Combo'],
      ANANT_LUNCH_ENTREES,
    );
    expect(out).toEqual(['Lunch Combo', 'Biryani', 'Sides']);
  });

  it('keeps UNGROUPED last even with a collision present', () => {
    const out = orderSubcategoryLabels(
      [UNGROUPED_KEY, 'Bread (Kulcha)', 'Lunch Combo'],
      ANANT_LUNCH_ENTREES,
    );
    expect(out[out.length - 1]).toBe(UNGROUPED_KEY);
    expect(out[0]).toBe('Lunch Combo'); // 0 < 5
  });
});

describe('buildReorderedSubcategoryIds — colliding siblings travel together', () => {
  // id-tagged version of the Anant rows for permutation assertions.
  const rows = [
    { subcategory_id: 'combo', name: 'Lunch Combo' },
    { subcategory_id: 'favs', name: 'Lunch Favorites' },
    { subcategory_id: 'naan', name: 'Bread (Naan)' },
    { subcategory_id: 'kulcha-paren', name: 'Bread (Kulcha)' },
    { subcategory_id: 'sides', name: 'Sides' },
    { subcategory_id: 'kulcha-bare', name: 'Bread Kulcha' }, // collides with kulcha-paren
  ];

  it('places BOTH colliding rows consecutively at the pill position (no bottom orphan)', () => {
    // Owner drags the merged "Bread (Kulcha)" pill to the FRONT.
    const ordered = ['Bread (Kulcha)', 'Lunch Combo', 'Lunch Favorites', 'Bread (Naan)', 'Sides'];
    const ids = buildReorderedSubcategoryIds(ordered, rows);
    // Both kulcha rows lead, adjacent — the sibling did NOT drift to the end.
    expect(ids.slice(0, 2).sort()).toEqual(['kulcha-bare', 'kulcha-paren']);
    expect(ids[ids.length - 1]).not.toBe('kulcha-bare');
  });

  it('returns a COMPLETE permutation — every row exactly once', () => {
    const ordered = ['Bread (Kulcha)', 'Lunch Combo', 'Lunch Favorites', 'Bread (Naan)', 'Sides'];
    const ids = buildReorderedSubcategoryIds(ordered, rows);
    expect(ids).toHaveLength(rows.length);
    expect(new Set(ids)).toEqual(new Set(rows.map((r) => r.subcategory_id)));
  });

  it('matches a displayed label to its row by normalized key (punctuation variant)', () => {
    // Displayed pill is the bare variant "Bread Kulcha"; still groups both rows.
    const ids = buildReorderedSubcategoryIds(['Bread Kulcha', 'Lunch Combo'], rows);
    expect(ids.slice(0, 2).sort()).toEqual(['kulcha-bare', 'kulcha-paren']);
  });

  it('appends existing rows whose key matched no displayed label (empty sub-categories)', () => {
    // Only two pills displayed; the rest are not in the displayed set.
    const ids = buildReorderedSubcategoryIds(['Sides', 'Lunch Combo'], rows);
    expect(ids[0]).toBe('sides');
    expect(ids[1]).toBe('combo');
    // remaining rows still present (complete permutation)
    expect(new Set(ids)).toEqual(new Set(rows.map((r) => r.subcategory_id)));
  });

  it('places a created-on-demand row at its label position', () => {
    const created = new Map([['New Pill', 'new-id']]);
    const ids = buildReorderedSubcategoryIds(['New Pill', 'Lunch Combo'], rows, created);
    expect(ids[0]).toBe('new-id');
    expect(ids[1]).toBe('combo');
    expect(ids).toContain('new-id');
  });

  it('never duplicates an id even if a label repeats', () => {
    const ids = buildReorderedSubcategoryIds(['Lunch Combo', 'Lunch Combo'], rows);
    expect(ids.filter((id) => id === 'combo')).toHaveLength(1);
  });

  it('handles empty inputs', () => {
    expect(buildReorderedSubcategoryIds([], [])).toEqual([]);
    expect(buildReorderedSubcategoryIds(['X'], [])).toEqual([]);
  });
});
