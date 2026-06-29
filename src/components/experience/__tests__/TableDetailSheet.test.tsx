// @vitest-environment jsdom
/**
 * Unit tests for TableDetailSheet styling changes.
 *
 * Covers:
 *  - "Enter in POS" button: orange filled (bg-orange-500) for ORDER PLACED group
 *  - "Mark Served" button: green filled (bg-[#2a7a3b]) for IN KITCHEN group — not ghost gray
 *  - "ORDER PLACED" label: text-orange-500 class
 *  - "IN KITCHEN" label: text-purple-700 class (unchanged)
 *  - Dietary preferences visible in "All" view (no guest filter required)
 *  - Dietary card hidden in "All" view when guests have no preferences
 *  - Dietary card shown per-guest when a specific guest filter is active
 */
import { describe, it, expect, vi, beforeAll } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import TableDetailSheet from '../TableDetailSheet';
import type { TableActivityEntry, OrderSummary, WaiterCall } from '../../../types/experience';

// ── jsdom polyfills ───────────────────────────────────────────────────────────

beforeAll(() => {
  if (typeof window !== 'undefined' && !window.matchMedia) {
    window.matchMedia = vi.fn().mockImplementation((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }));
  }
});

// ── Factories ─────────────────────────────────────────────────────────────────

function makeTable(guestOverrides: Partial<TableActivityEntry['guests'][0]>[] = []): TableActivityEntry {
  return {
    table_number: 5,
    needs_attention: false,
    has_active_session: true,
    guests: guestOverrides.map((g, i) => ({
      diner_id: String(i + 1),
      name: g.name ?? `Guest ${i + 1}`,
      allergens: g.allergens ?? [],
      dietary_restrictions: g.dietary_restrictions ?? [],
      is_first_timer: false,
      ...g,
    })),
    active_carts: [],
    placed_orders: [
      {
        order_id: 'order-pending',
        status: 'pending',
        diner_id: '1',
        diner_name: 'Alice',
        created_at: new Date().toISOString(),
        item_count: 1,
        total_amount: 20,
        items: [{ name: 'Risotto', quantity: 1, price: 20, item_status: 'pending' }],
      },
      {
        order_id: 'order-confirmed',
        status: 'confirmed',
        diner_id: '2',
        diner_name: 'Bob',
        created_at: new Date().toISOString(),
        item_count: 1,
        total_amount: 14,
        items: [{ name: 'Caesar Salad', quantity: 1, price: 14, item_status: 'confirmed' }],
      },
    ],
  };
}

function makeOrders(): OrderSummary[] {
  return [
    { id: 'order-pending', status: 'pending', subtotal: 20, tax: 2, tip: 0, total_amount: 22, special_instructions: null, table_number: 5, external_order_id: null, pos_status: null, diner_name: 'Alice', item_count: 1, created_at: new Date().toISOString(), updated_at: new Date().toISOString() },
    { id: 'order-confirmed', status: 'confirmed', subtotal: 14, tax: 1.4, tip: 0, total_amount: 15.4, special_instructions: null, table_number: 5, external_order_id: null, pos_status: null, diner_name: 'Bob', item_count: 1, created_at: new Date().toISOString(), updated_at: new Date().toISOString() },
  ];
}

const noopClose = vi.fn();
const noopStatus = vi.fn().mockResolvedValue(undefined);
const noWaiterCalls: WaiterCall[] = [];

// ── Helpers ───────────────────────────────────────────────────────────────────

function renderSheet(guestOverrides: Partial<TableActivityEntry['guests'][0]>[] = []) {
  const table = makeTable(guestOverrides);
  render(
    <TableDetailSheet
      table={table}
      orders={makeOrders()}
      waiterCalls={noWaiterCalls}
      onClose={noopClose}
      onStatusUpdate={noopStatus}
    />
  );
}

// ── Button styling ─────────────────────────────────────────────────────────────

describe('TableDetailSheet — button styling', () => {
  it('"Enter in POS" button has orange filled style (bg-orange-500, white text)', () => {
    renderSheet();
    const btn = screen.getByRole('button', { name: 'Enter in POS' });
    expect(btn.className).toContain('bg-orange-500');
    expect(btn.className).toContain('text-white');
    expect(btn.className).toContain('font-medium');
  });

  it('"Enter in POS" button does NOT have the old ghost gray style', () => {
    renderSheet();
    const btn = screen.getByRole('button', { name: 'Enter in POS' });
    expect(btn.className).not.toContain('bg-gray-100');
    expect(btn.className).not.toContain('text-gray-700');
    expect(btn.className).not.toContain('font-semibold');
  });

  it('"Mark Served" button has green filled style (bg-[#2a7a3b], white text)', () => {
    renderSheet();
    const btn = screen.getByRole('button', { name: 'Mark Served' });
    expect(btn.className).toContain('bg-[#2a7a3b]');
    expect(btn.className).toContain('text-white');
    expect(btn.className).toContain('font-medium');
  });

  it('"Mark Served" button does NOT have the old ghost gray style', () => {
    renderSheet();
    const btn = screen.getByRole('button', { name: 'Mark Served' });
    expect(btn.className).not.toContain('bg-gray-100');
    expect(btn.className).not.toContain('text-gray-700');
    expect(btn.className).not.toContain('font-semibold');
  });

  it('both buttons share the same base size classes', () => {
    renderSheet();
    const enterBtn = screen.getByRole('button', { name: 'Enter in POS' });
    const servedBtn = screen.getByRole('button', { name: 'Mark Served' });
    // Same text-xs, padding, and border-radius
    expect(enterBtn.className).toContain('text-xs');
    expect(enterBtn.className).toContain('px-2.5');
    expect(enterBtn.className).toContain('py-1');
    expect(enterBtn.className).toContain('rounded-full');
    expect(servedBtn.className).toContain('text-xs');
    expect(servedBtn.className).toContain('px-2.5');
    expect(servedBtn.className).toContain('py-1');
    expect(servedBtn.className).toContain('rounded-full');
  });
});

// ── Label styling ─────────────────────────────────────────────────────────────

describe('TableDetailSheet — label styling', () => {
  it('"ORDER PLACED" section header has orange text class', () => {
    renderSheet();
    // The label "ORDER PLACED · N ITEMS" is rendered as a <span>
    const label = screen.getByText(/ORDER PLACED/i);
    expect(label.className).toContain('text-orange-500');
    expect(label.className).not.toContain('text-blue-700');
  });

  it('"IN KITCHEN" section header retains purple text class (unchanged)', () => {
    renderSheet();
    const label = screen.getByText(/IN KITCHEN/i);
    expect(label.className).toContain('text-purple-700');
  });
});

// ── Dietary preferences — "All" view ─────────────────────────────────────────

describe('TableDetailSheet — dietary preferences visibility', () => {
  it('shows dietary card in "All" view when guests have dietary data', () => {
    renderSheet([
      { name: 'Alice', allergens: ['gluten'], dietary_restrictions: ['vegetarian'] },
      { name: 'Bob', allergens: [], dietary_restrictions: [] },
    ]);
    // In the "All" view (default), the dietary card for Alice should be present
    // without clicking any guest pill
    expect(screen.getByText('Gluten')).toBeInTheDocument();
    expect(screen.getByText('Vegetarian')).toBeInTheDocument();
  });

  it('shows guest name header in "All" view dietary card', () => {
    renderSheet([
      { name: 'Alice', allergens: ['shellfish'], dietary_restrictions: [] },
    ]);
    // Guest name appears in multiple places (pill, order row, dietary header).
    // Assert the section-header <p> specifically contains the name.
    const headers = screen.getAllByText('Alice');
    const sectionHeader = headers.find(el => el.className.includes('section-header'));
    expect(sectionHeader).toBeDefined();
    expect(screen.getByText('Shellfish')).toBeInTheDocument();
  });

  it('hides dietary card in "All" view when all guests have no preferences', () => {
    renderSheet([
      { name: 'Alice', allergens: [], dietary_restrictions: [] },
      { name: 'Bob', allergens: [], dietary_restrictions: [] },
    ]);
    // No dietary card should appear
    expect(screen.queryByText('Allergens')).not.toBeInTheDocument();
    expect(screen.queryByText('Dietary Preferences')).not.toBeInTheDocument();
  });

  it('shows detailed allergen/dietary headers when a specific guest pill is clicked', async () => {
    const user = userEvent.setup();
    renderSheet([
      { name: 'Alice', allergens: ['gluten'], dietary_restrictions: ['vegetarian'] },
    ]);
    // Click Alice's pill
    const alicePill = screen.getByRole('button', { name: /Alice/i });
    await user.click(alicePill);
    // In per-guest mode, the section headers should be shown
    expect(screen.getByText('Allergens')).toBeInTheDocument();
    expect(screen.getByText('Dietary Preferences')).toBeInTheDocument();
  });

  it('shows only clicked guest dietary data, not all guests', async () => {
    const user = userEvent.setup();
    renderSheet([
      { name: 'Alice', allergens: ['gluten'], dietary_restrictions: [] },
      { name: 'Bob', allergens: [], dietary_restrictions: ['vegan'] },
    ]);
    // Click Bob's pill
    const bobPill = screen.getByRole('button', { name: /Bob/i });
    await user.click(bobPill);
    // Bob's data shows
    expect(screen.getByText('Vegan')).toBeInTheDocument();
    // Alice's allergen is NOT shown when Bob is selected
    expect(screen.queryByText('Gluten')).not.toBeInTheDocument();
  });
});
