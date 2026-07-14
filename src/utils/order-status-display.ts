import type { OrderStatus } from '../types/experience';

// `ready` was REVIVED by STR-897/STR-901 (2026-07): the KDS writes
// `preparing → ready` when the kitchen plates a dish. It is a real persisted
// `orders.status` again — the 2026-05-22 Step 6c retirement no longer holds.
// Workflow: Order Placed → Entered in POS → [Ready] → Served.
export const STATUS_DISPLAY: Record<string, { label: string; bg: string; text: string; ringColor: string }> = {
  placed:    { label: 'Order Placed',   bg: 'bg-blue-50',    text: 'text-blue-800',   ringColor: 'ring-blue-200' },
  pending:   { label: 'Order Placed',   bg: 'bg-blue-50',    text: 'text-blue-800',   ringColor: 'ring-blue-200' },
  confirmed: { label: 'Entered in POS', bg: 'bg-purple-50',  text: 'text-purple-800', ringColor: 'ring-purple-200' },
  preparing: { label: 'Entered in POS', bg: 'bg-purple-50',  text: 'text-purple-800', ringColor: 'ring-purple-200' },
  ready:     { label: 'Ready',          bg: 'bg-amber-50',   text: 'text-amber-900',  ringColor: 'ring-amber-300' },
  delivered: { label: 'Served',         bg: 'bg-emerald-50', text: 'text-emerald-800', ringColor: 'ring-emerald-200' },
  issue:     { label: 'Issue',          bg: 'bg-red-50',     text: 'text-red-800',     ringColor: 'ring-red-200' },
  completed: { label: 'Completed',      bg: 'bg-gray-50',    text: 'text-gray-600',    ringColor: 'ring-gray-200' },
  cancelled: { label: 'Cancelled',      bg: 'bg-gray-50',    text: 'text-gray-600',    ringColor: 'ring-gray-200' },
};

// Waiter app status flow: pending → confirmed/preparing → [ready] → delivered.
// `preparing → delivered` is retained: a server can serve a dish directly without
// the kitchen ever bumping it Ready (not every restaurant runs a KDS).
export function getNextStatus(status: string): OrderStatus | null {
  switch (status) {
    case 'placed':    return 'confirmed';
    case 'pending':   return 'confirmed';
    case 'confirmed': return 'delivered';
    case 'preparing': return 'delivered';
    case 'ready':     return 'delivered';
    case 'issue':     return 'confirmed';
    default:          return null;
  }
}

export function getNextStatusLabel(status: string): string | null {
  switch (status) {
    case 'placed':    return 'Enter in POS';
    case 'pending':   return 'Enter in POS';
    case 'confirmed': return 'Mark Served';
    case 'preparing': return 'Mark Served';
    case 'ready':     return 'Mark Served';
    case 'issue':     return 'Re-enter in POS';
    default:          return null;
  }
}

// Statuses considered "active" (shown in the waiter app orders list).
//
// ─── Lifecycle registry — the anti-recurrence guard (STR-903) ────────────────
//
// ⚠️ ACTIVE_STATUSES is a FILTER PREDICATE, not a display map. A status missing from
// STATUS_DISPLAY renders a blank label; a status missing from the filter makes the order
// VANISH from every consumer that filters on it. `ready` was dropped at the 2026-05-22
// retirement and never re-added when STR-897/901 revived it, so the owner's Ready tab
// listed orders with no badge and no actions. `issue` was missing for the same reason,
// despite being real and ACTIONABLE (owner_orders.py `valid_statuses`;
// `issue → confirmed`, "Re-enter in POS").
//
// So ACTIVE_STATUSES is no longer hand-maintained — it is DERIVED from this registry, and
// `satisfies Record<OrderStatus, ...>` makes the registry EXHAUSTIVE at compile time: add
// a value to `OrderStatus` and fail to classify it here, and the build breaks.
//
// This guard lives in SOURCE, deliberately. A `satisfies` check in a test file would be
// dead code — `tsconfig.json` excludes `src/**/__tests__/**`, so tsc never compiles tests
// and the guard could never fire. (Verified: it didn't.)
const STATUS_LIFECYCLE = {
  placed:    'active',
  pending:   'active',
  confirmed: 'active',
  preparing: 'active',
  ready:     'active',   // kitchen plated it — in-flight, NOT served
  delivered: 'active',
  issue:     'active',   // actionable: the server must re-enter it
  completed: 'terminal',
  cancelled: 'terminal',
} satisfies Record<OrderStatus, 'active' | 'terminal'>;

// Statuses considered "active" (shown in the waiter/owner order lists).
export const ACTIVE_STATUSES: string[] = Object.entries(STATUS_LIFECYCLE)
  .filter(([, phase]) => phase === 'active')
  .map(([status]) => status);

export function isActiveStatus(status: string): boolean {
  return ACTIVE_STATUSES.includes(status);
}
