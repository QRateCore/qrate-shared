'use client';

import { STATUS_DISPLAY } from '../../utils/order-status-display';

// ─── Time Helpers ─────────────────────────────────────────────────────────────

export function timeSince(dateString: string): string {
  const seconds = Math.floor((Date.now() - new Date(dateString).getTime()) / 1000);
  if (seconds < 60) return 'just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

// ─── Name Helpers ─────────────────────────────────────────────────────────────

export function initials(name: string | null): string {
  if (!name) return '?';
  return name.split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2);
}

// ─── Call Type Labels ─────────────────────────────────────────────────────────

export function callTypeLabel(callType: string): string {
  switch (callType) {
    case 'water_refill_regular': return 'Regular water refill';
    case 'water_refill_bottled': return 'Bottled water';
    case 'water_refill': return 'Water refill';
    case 'cutlery': return 'Needs cutlery';
    case 'napkins': return 'Needs napkins';
    case 'bill': return 'Ready for bill';
    case 'order_status': return 'Asking about order status';
    case 'general': return 'Attend my table';
    default: return 'Needs a waiter';
  }
}

// ─── Avatar Colors ────────────────────────────────────────────────────────────

const AVATAR_COLORS = [
  'bg-blue-500', 'bg-purple-500', 'bg-pink-500', 'bg-amber-500',
  'bg-teal-500', 'bg-indigo-500', 'bg-rose-500', 'bg-cyan-500',
  'bg-emerald-500', 'bg-orange-500',
];

export function avatarColor(name: string | null): string {
  if (!name) return AVATAR_COLORS[0];
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = name.charCodeAt(i) + ((hash << 5) - hash);
  }
  return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length];
}

// ─── Allergen Colors ──────────────────────────────────────────────────────────

export const ALLERGEN_COLORS: Record<string, string> = {
  nuts: '#D97706', peanuts: '#D97706', 'tree nuts': '#D97706',
  shellfish: '#DC2626', fish: '#2563EB',
  dairy: '#7C3AED', milk: '#7C3AED',
  gluten: '#B45309', wheat: '#B45309',
  eggs: '#F59E0B', soy: '#059669', sesame: '#6B7280',
};

export function allergenColor(allergen: string): string {
  return ALLERGEN_COLORS[allergen.toLowerCase()] || '#9CA3AF';
}

// ─── Status Pill ──────────────────────────────────────────────────────────────

export function StatusPill({ status }: { status: string }) {
  const display = STATUS_DISPLAY[status] || { label: status, bg: 'bg-gray-50', text: 'text-gray-600' };
  return (
    <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold ${display.bg} ${display.text}`}>
      {display.label}
    </span>
  );
}
