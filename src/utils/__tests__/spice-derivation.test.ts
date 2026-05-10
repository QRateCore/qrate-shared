import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  deriveHeat,
  deriveHeatFromLabel,
  HEAT_FROM_SPICE_LEVEL,
} from '../spice-derivation';
import { MIN_SPICE_SCALE_LEVELS, MAX_SPICE_SCALE_LEVELS } from '../../constants/food-tags';

// Full 33-tuple fixture mirrors the canonical Python table at
// qrate-core/backend/lambdas/api/src/routes/spice_derivation.py:20.
// Format: [scaleLength, spiceLevel, expectedHeat]
const VALID_TUPLES: ReadonlyArray<readonly [number, number, number]> = [
  // scaleLength 3
  [3, 1, 0], [3, 2, 2], [3, 3, 4],
  // scaleLength 4
  [4, 1, 0], [4, 2, 1], [4, 3, 3], [4, 4, 4],
  // scaleLength 5 — identity (default scale)
  [5, 1, 0], [5, 2, 1], [5, 3, 2], [5, 4, 3], [5, 5, 4],
  // scaleLength 6
  [6, 1, 0], [6, 2, 1], [6, 3, 2], [6, 4, 2], [6, 5, 3], [6, 6, 4],
  // scaleLength 7
  [7, 1, 0], [7, 2, 1], [7, 3, 1], [7, 4, 2], [7, 5, 3], [7, 6, 3], [7, 7, 4],
  // scaleLength 8
  [8, 1, 0], [8, 2, 1], [8, 3, 1], [8, 4, 2], [8, 5, 2], [8, 6, 3], [8, 7, 3], [8, 8, 4],
];

describe('deriveHeat — full 33-tuple coverage', () => {
  it.each(VALID_TUPLES)(
    'scaleLength=%i spiceLevel=%i → heat=%i',
    (scaleLength, spiceLevel, expectedHeat) => {
      expect(deriveHeat(spiceLevel, scaleLength)).toBe(expectedHeat);
    },
  );

  it('returns exactly 33 valid tuples (lengths 3..8 sum check)', () => {
    let count = 0;
    for (let len = MIN_SPICE_SCALE_LEVELS; len <= MAX_SPICE_SCALE_LEVELS; len++) {
      for (let lvl = 1; lvl <= len; lvl++) {
        if (deriveHeat(lvl, len) !== null) count++;
      }
    }
    expect(count).toBe(33);
  });
});

describe('deriveHeat — invalid input returns null (warns in dev)', () => {
  beforeEach(() => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  it.each([
    ['scaleLength below min', 1, 2],
    ['scaleLength above max', 1, 9],
    ['spiceLevel below 1', 0, 5],
    ['spiceLevel above scaleLength', 6, 5],
    ['non-integer spiceLevel', 1.5, 5],
    ['non-integer scaleLength', 1, 5.5],
    ['NaN spiceLevel', NaN, 5],
    ['NaN scaleLength', 1, NaN],
  ] as const)('%s → null', (_label, spiceLevel, scaleLength) => {
    expect(deriveHeat(spiceLevel, scaleLength)).toBeNull();
  });
});

// Property tests (Plan v2 Amendment 6): structural invariants the table
// must satisfy. Catches table-edit drift before review.
describe('deriveHeat — structural properties', () => {
  it('monotonicity: heat is non-decreasing in spiceLevel for every valid scaleLength', () => {
    for (let len = MIN_SPICE_SCALE_LEVELS; len <= MAX_SPICE_SCALE_LEVELS; len++) {
      let prev = -1;
      for (let lvl = 1; lvl <= len; lvl++) {
        const heat = deriveHeat(lvl, len) as number;
        expect(heat).toBeGreaterThanOrEqual(prev);
        prev = heat;
      }
    }
  });

  it('endpoint-pinning: every valid scale starts at 0 and ends at 4', () => {
    for (let len = MIN_SPICE_SCALE_LEVELS; len <= MAX_SPICE_SCALE_LEVELS; len++) {
      expect(deriveHeat(1, len)).toBe(0);
      expect(deriveHeat(len, len)).toBe(4);
    }
  });

  it('heat values stay within 0..4 for every valid tuple', () => {
    for (let len = MIN_SPICE_SCALE_LEVELS; len <= MAX_SPICE_SCALE_LEVELS; len++) {
      for (let lvl = 1; lvl <= len; lvl++) {
        const heat = deriveHeat(lvl, len) as number;
        expect(heat).toBeGreaterThanOrEqual(0);
        expect(heat).toBeLessThanOrEqual(4);
      }
    }
  });

  it('table dictionary has exactly the expected 6 keys', () => {
    expect(Object.keys(HEAT_FROM_SPICE_LEVEL).map(Number).sort((a, b) => a - b))
      .toEqual([3, 4, 5, 6, 7, 8]);
  });
});

describe('deriveHeatFromLabel', () => {
  it('resolves label to heat via index lookup (default 5-level scale)', () => {
    const scale = ['Mild', 'Warm', 'Medium', 'Hot', 'Fiery'];
    expect(deriveHeatFromLabel('Mild', scale)).toBe(0);
    expect(deriveHeatFromLabel('Warm', scale)).toBe(1);
    expect(deriveHeatFromLabel('Medium', scale)).toBe(2);
    expect(deriveHeatFromLabel('Hot', scale)).toBe(3);
    expect(deriveHeatFromLabel('Fiery', scale)).toBe(4);
  });

  it('resolves label on a 7-level custom scale (compressed mapping)', () => {
    const scale = ['Plain', 'Mild', 'Warm', 'Medium', 'Hot', 'Spicy', 'Fiery'];
    // 7-level row: [0, 1, 1, 2, 3, 3, 4]
    expect(deriveHeatFromLabel('Plain', scale)).toBe(0);
    expect(deriveHeatFromLabel('Mild', scale)).toBe(1);
    expect(deriveHeatFromLabel('Warm', scale)).toBe(1);
    expect(deriveHeatFromLabel('Medium', scale)).toBe(2);
    expect(deriveHeatFromLabel('Hot', scale)).toBe(3);
    expect(deriveHeatFromLabel('Spicy', scale)).toBe(3);
    expect(deriveHeatFromLabel('Fiery', scale)).toBe(4);
  });

  it('returns null for label not on the scale (stale label)', () => {
    const scale = ['Mild', 'Warm', 'Medium', 'Hot', 'Fiery'];
    expect(deriveHeatFromLabel('Inferno', scale)).toBeNull();
  });

  it('returns null for empty scale', () => {
    expect(deriveHeatFromLabel('Anything', [])).toBeNull();
  });

  it('returns null when scale length is below MIN (e.g. 2)', () => {
    expect(deriveHeatFromLabel('Mild', ['Mild', 'Hot'])).toBeNull();
  });
});
