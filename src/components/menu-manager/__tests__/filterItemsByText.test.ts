import { describe, it, expect } from 'vitest';
import { matchesItemText, filterItemsByText } from '../filterItemsByText';

const items = [
  { name: 'Grilled Salmon', description: 'With lemon butter' },
  { name: 'Salmon Tartare', description: 'Raw, capers' },
  { name: 'Margherita Pizza', description: 'Basil and mozzarella' },
  { name: 'Sparkling Water', description: null },
  { name: 'House Salad' }, // no description field
];

describe('matchesItemText', () => {
  it('matches on name, case-insensitively', () => {
    expect(matchesItemText({ name: 'Grilled Salmon' }, 'SALMON')).toBe(true);
    expect(matchesItemText({ name: 'Grilled Salmon' }, 'grilled')).toBe(true);
  });

  it('matches on description', () => {
    expect(matchesItemText({ name: 'Pizza', description: 'Basil' }, 'basil')).toBe(true);
  });

  it('returns false when neither name nor description matches', () => {
    expect(matchesItemText({ name: 'Pizza', description: 'Basil' }, 'salmon')).toBe(false);
  });

  it('treats null/missing name/description as empty (no throw)', () => {
    expect(matchesItemText({ name: 'X', description: null }, 'x')).toBe(true);
    expect(matchesItemText({}, 'anything')).toBe(false);
  });

  it('empty / whitespace query matches everything', () => {
    expect(matchesItemText({ name: 'Pizza' }, '')).toBe(true);
    expect(matchesItemText({ name: 'Pizza' }, '   ')).toBe(true);
  });
});

describe('filterItemsByText', () => {
  it('empty query returns a copy of all items (not the same array ref)', () => {
    const out = filterItemsByText(items, '');
    expect(out).toHaveLength(items.length);
    expect(out).not.toBe(items);
  });

  it('whitespace-only query returns all items', () => {
    expect(filterItemsByText(items, '   ')).toHaveLength(items.length);
  });

  it('filters by name substring', () => {
    const out = filterItemsByText(items, 'salmon');
    expect(out.map((i) => i.name)).toEqual(['Grilled Salmon', 'Salmon Tartare']);
  });

  it('filters by description substring', () => {
    const out = filterItemsByText(items, 'mozzarella');
    expect(out.map((i) => i.name)).toEqual(['Margherita Pizza']);
  });

  it('is case-insensitive and trims the query', () => {
    const out = filterItemsByText(items, '  PIZZA ');
    expect(out.map((i) => i.name)).toEqual(['Margherita Pizza']);
  });

  it('returns [] when nothing matches', () => {
    expect(filterItemsByText(items, 'zzzz')).toEqual([]);
  });
});
