/**
 * STR-775 — pure ordering + complete-permutation logic for sub-category reorder
 * (the load-bearing reconciliation extracted from MenuManagerClient so it is
 * unit-testable, per Phase-6 QA condition). Covers label→row mapping, sort_order
 * ordering, unknown-after-known, UNGROUPED-last, and the complete-set payload.
 */
import { describe, expect, it } from 'vitest';
import { orderSubcategoryLabels, buildReorderedIds, UNGROUPED_KEY } from '../menuUtils';

describe('orderSubcategoryLabels', () => {
  const subs = [
    { name: 'Beer (Bottle)', sort_order: 1 },
    { name: 'Beer (Draft)', sort_order: 0 },
    { name: 'Lassi', sort_order: 2 },
  ];

  it('orders labels by the structure sort_order', () => {
    const out = orderSubcategoryLabels(['Beer (Bottle)', 'Beer (Draft)', 'Lassi'], subs);
    expect(out).toEqual(['Beer (Draft)', 'Beer (Bottle)', 'Lassi']);
  });

  it('matches labels to rows via normalized key (casing/punctuation variants)', () => {
    // Displayed label is a casing variant of the stored row name — still maps.
    const out = orderSubcategoryLabels(['beer (bottle)', 'BEER (DRAFT)'], subs);
    expect(out).toEqual(['BEER (DRAFT)', 'beer (bottle)']);
  });

  it('puts labels with no structure row (just-scraped) after ordered ones, alphabetically', () => {
    const out = orderSubcategoryLabels(['Soda', 'Lassi', 'Beer (Draft)', 'Mocktails'], subs);
    // known (by sort_order): Beer (Draft)=0, Lassi=2 → then unknown alpha: Mocktails, Soda
    expect(out).toEqual(['Beer (Draft)', 'Lassi', 'Mocktails', 'Soda']);
  });

  it('always sorts UNGROUPED_KEY last', () => {
    const out = orderSubcategoryLabels([UNGROUPED_KEY, 'Lassi', 'Beer (Draft)'], subs);
    expect(out[out.length - 1]).toBe(UNGROUPED_KEY);
    expect(out.slice(0, 2)).toEqual(['Beer (Draft)', 'Lassi']);
  });

  it('falls back gracefully when a row has null sort_order (uses array index)', () => {
    const nullSubs = [
      { name: 'A', sort_order: null },
      { name: 'B', sort_order: null },
    ];
    expect(orderSubcategoryLabels(['B', 'A'], nullSubs)).toEqual(['A', 'B']); // index 0=A,1=B
  });
});

describe('buildReorderedIds', () => {
  const resolve = (m: Record<string, string>) => (label: string) => m[label];

  it('builds ids in the displayed order', () => {
    const ids = buildReorderedIds(['Draft', 'Bottle'], resolve({ Draft: 'd', Bottle: 'b' }), ['b', 'd']);
    expect(ids).toEqual(['d', 'b']);
  });

  it('appends existing rows NOT displayed (e.g. empty sub-categories) — complete permutation', () => {
    // Displayed: Draft, Bottle. Existing also has an empty row "e" not displayed.
    const ids = buildReorderedIds(['Draft', 'Bottle'], resolve({ Draft: 'd', Bottle: 'b' }), ['b', 'd', 'e']);
    expect(ids).toEqual(['d', 'b', 'e']);
    expect(new Set(ids)).toEqual(new Set(['b', 'd', 'e'])); // complete set the API requires
  });

  it('includes a just-created row (resolves to a new id not yet in existing) and de-dupes', () => {
    // "New" was create-on-demanded → resolves to id "n"; existing has only b,d.
    const ids = buildReorderedIds(['New', 'Draft', 'Bottle'], resolve({ New: 'n', Draft: 'd', Bottle: 'b' }), ['b', 'd']);
    expect(ids).toEqual(['n', 'd', 'b']);
  });

  it('skips labels that resolve to no id (defensive)', () => {
    const ids = buildReorderedIds(['Draft', 'Ghost'], resolve({ Draft: 'd' }), ['d']);
    expect(ids).toEqual(['d']);
  });
});
