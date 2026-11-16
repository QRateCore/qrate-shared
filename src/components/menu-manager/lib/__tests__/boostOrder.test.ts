import { describe, it, expect } from 'vitest';
import { boostRank, sortByBoost } from '../boostOrder';

describe('boostRank', () => {
  it('maps the stored level to H=3 > M=2 > L=1 > none=0', () => {
    expect(boostRank({ boost_level: '3' }, 'Entrees')).toBe(3);
    expect(boostRank({ boost_level: '2' }, 'Entrees')).toBe(2);
    expect(boostRank({ boost_level: '1' }, 'Entrees')).toBe(1);
    expect(boostRank({ boost_level: null }, 'Entrees')).toBe(0);
    expect(boostRank(undefined, 'Entrees')).toBe(0);
  });
  it('a per-course override wins over the shared boost', () => {
    expect(boostRank({ boost_level: '1', category_boost_levels: { Entrees: '3' } }, 'Entrees')).toBe(3);
    expect(boostRank({ boost_level: '1', category_boost_levels: { Entrees: '3' } }, 'Appetizers')).toBe(1);
  });
  it('ignores junk values', () => {
    expect(boostRank({ boost_level: '7' }, 'x')).toBe(0);
    expect(boostRank({ boost_level: 'High' }, 'x')).toBe(0);
  });
});

describe('sortByBoost', () => {
  const rank: Record<string, number> = { a: 0, b: 3, c: 1, d: 3, e: 2, f: 0 };
  it('orders High > Moderate > Low > none and keeps the manual order inside a tier', () => {
    expect(sortByBoost(['a', 'b', 'c', 'd', 'e', 'f'], (x) => rank[x])).toEqual(['b', 'd', 'e', 'c', 'a', 'f']);
    // Swapping two same-tier dishes in the manual order swaps them in the result.
    expect(sortByBoost(['a', 'd', 'c', 'b', 'e', 'f'], (x) => rank[x])).toEqual(['d', 'b', 'e', 'c', 'a', 'f']);
  });
  it('does not mutate its input', () => {
    const input = ['a', 'b'];
    sortByBoost(input, (x) => rank[x]);
    expect(input).toEqual(['a', 'b']);
  });
});
