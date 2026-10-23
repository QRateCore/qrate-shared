// @vitest-environment jsdom
/**
 * Service calls on a table with NOBODY seated.
 *
 * The on-table device raises calls on tables that have no diner session.
 * Every call surface on the card was gated on `has_active_session`, so the
 * owner's Tables & Staff page showed those tables as AVAILABLE with no call,
 * although GET /waiter-calls returned it (dev Anant tables 3 and 4,
 * 2026-10-22).
 */
import { describe, it, expect, vi, beforeEach, beforeAll } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import ExperienceManagement from '../ExperienceManagement';
import type { ExperienceService, RestaurantTable, TableActivity } from '../../../types/experience';

// ── Polyfills for jsdom ──────────────────────────────────────────────────────

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

// ── Factories ────────────────────────────────────────────────────────────────

function makeTable(overrides: Partial<RestaurantTable> = {}): RestaurantTable {
  return {
    id: 'table-1',
    restaurant_id: 'rest-1',
    table_number: 5,
    is_active: true,
    capacity: 4,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    assigned_server_id: null,
    ...overrides,
  };
}

function makeTableActivity(tables: Array<{ table_number: number; has_active_session: boolean }>): TableActivity {
  return {
    tables: tables.map(t => ({
      table_number: t.table_number,
      has_active_session: t.has_active_session,
      needs_attention: false,
      guests: [],
      active_carts: [],
      placed_orders: [],
    })),
    summary: { total_tables: tables.length, occupied_tables: 0, available_tables: tables.length, total_guests: 0 },
  };
}

function makeService(overrides: Partial<ExperienceService> = {}): ExperienceService {
  return {
    getTables: vi.fn().mockResolvedValue({ tables: [makeTable()], count: 1 }),
    createTables: vi.fn().mockResolvedValue({ tables: [], message: 'ok' }),
    updateTable: vi.fn().mockResolvedValue({ table: makeTable() }),
    generateQRCodes: vi.fn().mockResolvedValue({ tables: [], message: 'ok' }),
    downloadQRCodesZip: vi.fn().mockResolvedValue({ download_url: '', filename: '', table_count: 0 }),
    deleteTable: vi.fn().mockResolvedValue(undefined),
    getStaff: vi.fn().mockResolvedValue({ staff: [], count: 0 }),
    createStaff: vi.fn().mockResolvedValue({ staff: {} }),
    updateStaff: vi.fn().mockResolvedValue({ staff: {} }),
    getWaiterCalls: vi.fn().mockResolvedValue([]),
    acknowledgeWaiterCall: vi.fn().mockResolvedValue(undefined),
    getTableActivity: vi.fn().mockResolvedValue(makeTableActivity([{ table_number: 5, has_active_session: false }])),
    getOrders: vi.fn().mockResolvedValue({ orders: [], total: 0 }),
    getMenuBoosts: vi.fn().mockResolvedValue({ items: [] }),
    updateMenuBoosts: vi.fn().mockResolvedValue({ updated_count: 0 }),
    ...overrides,
  };
}

// ── Tests ────────────────────────────────────────────────────────────────────

const deviceCall = {
  id: 'call-1',
  table_number: 5,
  call_type: 'general',
  status: 'active',
  created_at: new Date().toISOString(),
  acknowledged_at: null,
  minutes_old: 0,
  diner_name: null,
};

describe('ExperienceManagement — calls on an unseated table', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('shows the call and its Done button when nobody is seated', async () => {
    const service = makeService({ getWaiterCalls: vi.fn().mockResolvedValue([deviceCall]) });
    render(<ExperienceManagement initialTab="tables" restaurantId="rest-1" service={service} />);

    const calls = await screen.findByTestId('table-calls-unseated-5');
    expect(within(calls).getByTestId('table-ack-call-5')).toBeVisible();
  });

  it('acknowledges the call from the unseated card', async () => {
    const user = userEvent.setup();
    const service = makeService({ getWaiterCalls: vi.fn().mockResolvedValue([deviceCall]) });
    render(<ExperienceManagement initialTab="tables" restaurantId="rest-1" service={service} />);

    await user.click(await screen.findByTestId('table-ack-call-5'));
    expect(service.acknowledgeWaiterCall).toHaveBeenCalledWith('call-1');
  });

  it('does not duplicate the list on an occupied table (it lives in the Service tab)', async () => {
    const service = makeService({
      getWaiterCalls: vi.fn().mockResolvedValue([deviceCall]),
      getTableActivity: vi.fn().mockResolvedValue(makeTableActivity([{ table_number: 5, has_active_session: true }])),
    });
    render(<ExperienceManagement initialTab="tables" restaurantId="rest-1" service={service} />);

    await screen.findByText('Table 5');
    expect(screen.queryByTestId('table-calls-unseated-5')).not.toBeInTheDocument();
  });

  it('renders nothing extra on an unseated table with no calls', async () => {
    const service = makeService();
    render(<ExperienceManagement initialTab="tables" restaurantId="rest-1" service={service} />);

    await screen.findByText('Table 5');
    expect(screen.queryByTestId('table-calls-unseated-5')).not.toBeInTheDocument();
  });
});
