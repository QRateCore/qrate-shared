import { describe, it, expect } from 'vitest';
import {
  STATUS_DISPLAY,
  ACTIVE_STATUSES,
  isActiveStatus,
  getNextStatus,
  getNextStatusLabel,
} from '../order-status-display';
import type { OrderStatus } from '../../types/experience';

/**
 * STR-903 regression guard.
 *
 * `ready` was retired (2026-05-22) then REVIVED by STR-897/901 (the KDS writes
 * `preparing → ready`), but STATUS_DISPLAY and ACTIVE_STATUSES were never updated.
 *
 * Impact, stated precisely: the OWNER board broke — `/owner/orders` has a "Ready" filter
 * tab, and selecting it listed orders with a blank badge and ZERO action buttons, so a
 * plated order could not be advanced at all. The WAITER board did NOT break, because
 * STR-908 had already worked around the shared gap locally (`|| o.status === 'ready'`).
 * Those local workarounds are removed alongside this fix — the shared layer is correct
 * now, so a divergent local copy is exactly the hazard that caused this bug.
 *
 * The asymmetry is the lesson, and it is why these assertions are structural rather than
 * a single `ready` check:
 *   - a status missing from STATUS_DISPLAY  → blank LABEL (annoying, visible)
 *   - a status missing from ACTIVE_STATUSES → the record VANISHES (dangerous, silent)
 */

// NOTE: the real anti-recurrence guard is NOT here — it lives in SOURCE, as the
// `satisfies Record<OrderStatus, ...>` on STATUS_LIFECYCLE in ../order-status-display.ts.
// It cannot live in this file: tsconfig.json excludes `src/**/__tests__/**`, so tsc never
// compiles tests and a compile-time guard here would silently never fire. (We tried it;
// adding a new union member and omitting it left `tsc --noEmit` at exit 0.)
//
// These are the RUNTIME assertions that complement it.
const ALL_STATUSES: OrderStatus[] = [
  'placed', 'pending', 'confirmed', 'preparing', 'ready',
  'delivered', 'completed', 'cancelled', 'issue',
];

// Terminal = the order is done/void; it is correct for these to be excluded from the
// active board. Everything else is IN-FLIGHT and must never silently disappear.
const TERMINAL: OrderStatus[] = ['completed', 'cancelled'];
const IN_FLIGHT = ALL_STATUSES.filter((s) => !TERMINAL.includes(s));

describe('STATUS_DISPLAY', () => {
  it('has an entry for every status in the OrderStatus union', () => {
    for (const status of ALL_STATUSES) {
      expect(STATUS_DISPLAY[status], `no STATUS_DISPLAY entry for '${status}' → blank label`).toBeDefined();
    }
  });
});

describe('ACTIVE_STATUSES — the filter predicate (STR-903)', () => {
  it('contains every IN-FLIGHT status, so no live order can vanish from a filtered board', () => {
    for (const status of IN_FLIGHT) {
      expect(
        isActiveStatus(status),
        `'${status}' is in-flight but NOT in ACTIVE_STATUSES → the order VANISHES from every ` +
          `consumer that filters on isActiveStatus(). This is the STR-903 bug class.`,
      ).toBe(true);
    }
  });

  it("includes 'ready' — the KDS writes it when the kitchen plates a dish", () => {
    expect(ACTIVE_STATUSES).toContain('ready');
    expect(isActiveStatus('ready')).toBe(true);
  });

  it('excludes terminal statuses', () => {
    for (const status of TERMINAL) {
      expect(isActiveStatus(status), `'${status}' is terminal and should not be active`).toBe(false);
    }
  });
});

describe('status advancement', () => {
  it("advances 'ready' to 'delivered' with a Mark Served action", () => {
    expect(getNextStatus('ready')).toBe('delivered');
    expect(getNextStatusLabel('ready')).toBe('Mark Served');
  });

  it("retains 'preparing' → 'delivered' (a server can serve without a KDS bump)", () => {
    expect(getNextStatus('preparing')).toBe('delivered');
  });

  it('gives every in-flight, non-terminal status a way forward', () => {
    // 'delivered' is in-flight for the board but is the end of the serve flow.
    for (const status of IN_FLIGHT.filter((s) => s !== 'delivered')) {
      expect(getNextStatus(status), `'${status}' has no next status — it would be stuck`).not.toBeNull();
      expect(getNextStatusLabel(status), `'${status}' has no action label — no button renders`).not.toBeNull();
    }
  });
});
