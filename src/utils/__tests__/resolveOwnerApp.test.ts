import { describe, it, expect } from 'vitest';
import {
  resolveOwnerApp,
  MICRO_KITCHEN_SERVICE_MODEL,
  type RoutableInstitution,
} from '../resolveOwnerApp';

/**
 * MK-9 — exhaustive coverage of the single shared routing decision.
 *
 * The load-bearing invariant is the FAIL-SAFE bias: owner-app serves every
 * institution type and is always a safe home, so ONLY an active institution
 * whose service_model is EXACTLY `micro_kitchen` may resolve to 'owner-lite'.
 * Every other case — empty, ambiguous, unknown, missing field — must stay in
 * 'owner-app'. A split or over-eager implementation is what traps an owner in
 * a redirect loop between the two apps.
 *
 * Cases below span the acceptance matrix: 0 / 1 / N institutions ×
 * all-restaurant / all-microkitchen / mixed × selected vs unselected, plus the
 * defensive undefined/null/unknown service_model paths.
 */

const restaurant = (id: string): RoutableInstitution => ({
  id,
  service_model: 'full_service',
});
const microKitchen = (id: string): RoutableInstitution => ({
  id,
  service_model: MICRO_KITCHEN_SERVICE_MODEL,
});

describe('resolveOwnerApp', () => {
  describe('0 institutions', () => {
    it('empty list → owner-app (safe default)', () => {
      expect(resolveOwnerApp([])).toBe('owner-app');
    });
    it('null input → owner-app', () => {
      expect(resolveOwnerApp(null)).toBe('owner-app');
    });
    it('undefined input → owner-app', () => {
      expect(resolveOwnerApp(undefined)).toBe('owner-app');
    });
  });

  describe('1 institution (routes by that one, no selection needed)', () => {
    it('single restaurant → owner-app', () => {
      expect(resolveOwnerApp([restaurant('r1')])).toBe('owner-app');
    });
    it('single micro-kitchen → owner-lite', () => {
      expect(resolveOwnerApp([microKitchen('m1')])).toBe('owner-lite');
    });
    it('single micro-kitchen with matching explicit selection → owner-lite', () => {
      expect(resolveOwnerApp([microKitchen('m1')], 'm1')).toBe('owner-lite');
    });
    it('single restaurant with matching explicit selection → owner-app', () => {
      expect(resolveOwnerApp([restaurant('r1')], 'r1')).toBe('owner-app');
    });
  });

  describe('N institutions, no selection → always owner-app', () => {
    it('all restaurants, unselected → owner-app', () => {
      expect(resolveOwnerApp([restaurant('r1'), restaurant('r2')])).toBe('owner-app');
    });
    it('all micro-kitchens, unselected → owner-app (needs explicit choice)', () => {
      expect(resolveOwnerApp([microKitchen('m1'), microKitchen('m2')])).toBe('owner-app');
    });
    it('mixed, unselected → owner-app', () => {
      expect(resolveOwnerApp([restaurant('r1'), microKitchen('m1')])).toBe('owner-app');
    });
  });

  describe('N institutions, explicit selection → routes by the selected one', () => {
    const mixed = [restaurant('r1'), microKitchen('m1'), restaurant('r2')];

    it('micro-kitchen selected → owner-lite', () => {
      expect(resolveOwnerApp(mixed, 'm1')).toBe('owner-lite');
    });
    it('restaurant selected → owner-app', () => {
      expect(resolveOwnerApp(mixed, 'r2')).toBe('owner-app');
    });
    it('selection matches nothing → owner-app (defensive)', () => {
      expect(resolveOwnerApp(mixed, 'does-not-exist')).toBe('owner-app');
    });
    it('all-restaurant list, a restaurant selected → owner-app', () => {
      expect(resolveOwnerApp([restaurant('r1'), restaurant('r2')], 'r2')).toBe('owner-app');
    });
    it('all-micro-kitchen list, a micro-kitchen selected → owner-lite', () => {
      expect(resolveOwnerApp([microKitchen('m1'), microKitchen('m2')], 'm2')).toBe('owner-lite');
    });
  });

  describe('empty-string selection is treated as "no selection"', () => {
    it("single micro-kitchen + '' → owner-lite (falls back to the single venue)", () => {
      expect(resolveOwnerApp([microKitchen('m1')], '')).toBe('owner-lite');
    });
    it("N micro-kitchens + '' → owner-app (still no explicit choice)", () => {
      expect(resolveOwnerApp([microKitchen('m1'), microKitchen('m2')], '')).toBe('owner-app');
    });
  });

  describe('defensive service_model handling — only exact micro_kitchen routes to lite', () => {
    it('undefined service_model → owner-app', () => {
      expect(resolveOwnerApp([{ id: 'x' }])).toBe('owner-app');
    });
    it('null service_model → owner-app', () => {
      expect(resolveOwnerApp([{ id: 'x', service_model: null }])).toBe('owner-app');
    });
    it('unknown service_model value → owner-app', () => {
      expect(resolveOwnerApp([{ id: 'x', service_model: 'ghost_kitchen' }])).toBe('owner-app');
    });
    it('wrong-case value is NOT micro_kitchen → owner-app', () => {
      expect(resolveOwnerApp([{ id: 'x', service_model: 'MICRO_KITCHEN' }])).toBe('owner-app');
    });
    it('selected micro-kitchen among venues with missing models → owner-lite', () => {
      const list: RoutableInstitution[] = [
        { id: 'a' },
        microKitchen('m1'),
        { id: 'b', service_model: null },
      ];
      expect(resolveOwnerApp(list, 'm1')).toBe('owner-lite');
    });
  });

  describe('purity — no mutation of inputs', () => {
    it('does not mutate the institutions array', () => {
      const list = [restaurant('r1'), microKitchen('m1')];
      const snapshot = JSON.parse(JSON.stringify(list));
      resolveOwnerApp(list, 'm1');
      expect(list).toEqual(snapshot);
    });
  });
});
