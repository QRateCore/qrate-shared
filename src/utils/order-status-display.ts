import type { OrderStatus } from '../types/experience';

export const STATUS_DISPLAY: Record<string, { label: string; bg: string; text: string; ringColor: string }> = {
  placed:    { label: 'Order Placed',   bg: 'bg-blue-50',    text: 'text-blue-800',   ringColor: 'ring-blue-200' },
  pending:   { label: 'Order Placed',   bg: 'bg-blue-50',    text: 'text-blue-800',   ringColor: 'ring-blue-200' },
  confirmed: { label: 'Entered in POS', bg: 'bg-purple-50',  text: 'text-purple-800', ringColor: 'ring-purple-200' },
  preparing: { label: 'Entered in POS', bg: 'bg-purple-50',  text: 'text-purple-800', ringColor: 'ring-purple-200' },
  ready:     { label: 'Ready to Serve', bg: 'bg-amber-50',   text: 'text-amber-800',  ringColor: 'ring-amber-200' },
  delivered: { label: 'Served',         bg: 'bg-emerald-50', text: 'text-emerald-800', ringColor: 'ring-emerald-200' },
  issue:     { label: 'Issue',          bg: 'bg-red-50',     text: 'text-red-800',     ringColor: 'ring-red-200' },
  completed: { label: 'Completed',      bg: 'bg-gray-50',    text: 'text-gray-600',    ringColor: 'ring-gray-200' },
  cancelled: { label: 'Cancelled',      bg: 'bg-gray-50',    text: 'text-gray-600',    ringColor: 'ring-gray-200' },
};

// Waiter app status flow: pending → confirmed → ready → delivered
// (skips preparing, collapses confirmed+preparing into "Entered in POS")
export function getNextStatus(status: string): OrderStatus | null {
  switch (status) {
    case 'placed':    return 'confirmed';
    case 'pending':   return 'confirmed';
    case 'confirmed': return 'ready';
    case 'preparing': return 'ready';
    case 'ready':     return 'delivered';
    case 'issue':     return 'confirmed';
    default:          return null;
  }
}

export function getNextStatusLabel(status: string): string | null {
  switch (status) {
    case 'placed':    return 'Enter in POS';
    case 'pending':   return 'Enter in POS';
    case 'confirmed': return 'Ready to Serve';
    case 'preparing': return 'Ready to Serve';
    case 'ready':     return 'Mark Served';
    case 'issue':     return 'Re-enter in POS';
    default:          return null;
  }
}

// Statuses considered "active" (shown in the waiter app orders list)
export const ACTIVE_STATUSES = ['placed', 'pending', 'confirmed', 'preparing', 'ready', 'delivered'];

export function isActiveStatus(status: string): boolean {
  return ACTIVE_STATUSES.includes(status);
}
