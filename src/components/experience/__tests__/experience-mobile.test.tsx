// @vitest-environment jsdom
/**
 * Mobile (portrait) behaviour tests for the Tables & Staff surface — STR-858.
 *
 * These assert the mobile-only branches added by the responsive overhaul,
 * driven by useIsMobile() (matchMedia mocked to matches:true here). Desktop
 * behaviour is covered by delete-table.test.tsx (matches:false).
 *
 * Covers:
 *  - Config (server assign / delete) collapses behind a "Manage" toggle on mobile
 *  - Occupied table with an active call auto-opens its Service view (large "Done"
 *    ack visible without tapping the Service segment)
 *  - "N tables need service" banner + optional Open Host Station link
 *  - Acknowledge is OPTIMISTIC (call disappears before the request resolves)
 *  - StaffManagement activate/deactivate is optimistic (no full-list refetch)
 */
import { describe, it, expect, vi, beforeEach, beforeAll } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import ExperienceManagement from '../ExperienceManagement';
import StaffManagement from '../../staff/StaffManagement';
import type { ExperienceService, RestaurantTable, TableActivity, WaiterCall, StaffMember } from '../../../types/experience';

// ── Mobile viewport: matchMedia matches the mobile query ──────────────────────
beforeAll(() => {
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    matches: true, // ≤1023px → useIsMobile() === true
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  }));
});

// ── Factories ────────────────────────────────────────────────────────────────
function makeTable(overrides: Partial<RestaurantTable> = {}): RestaurantTable {
  return {
    id: 'table-1', restaurant_id: 'rest-1', table_number: 5, is_active: true,
    capacity: 4, created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z',
    assigned_server_id: null, ...overrides,
  };
}

function makeActivity(tables: Array<{ table_number: number; has_active_session: boolean }>): TableActivity {
  return {
    tables: tables.map(t => ({
      table_number: t.table_number, has_active_session: t.has_active_session,
      needs_attention: false, guests: [], active_carts: [], placed_orders: [],
    })),
    summary: { total_tables: tables.length, occupied_tables: 0, available_tables: tables.length, total_guests: 0 },
  };
}

function makeCall(overrides: Partial<WaiterCall> = {}): WaiterCall {
  return { id: 'call-1', table_number: 5, status: 'active', created_at: '2026-01-01T00:00:00Z', call_type: 'water', acknowledged_at: null, ...overrides };
}

function makeStaff(overrides: Partial<StaffMember> = {}): StaffMember {
  return { id: 'staff-1', name: 'Alex Rivera', email: 'alex@rest.test', role: 'server', permissions: [], is_active: true, created_at: '2026-01-01T00:00:00Z', ...overrides };
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
    getTableActivity: vi.fn().mockResolvedValue(makeActivity([{ table_number: 5, has_active_session: false }])),
    getOrders: vi.fn().mockResolvedValue({ orders: [], total: 0 }),
    getMenuBoosts: vi.fn().mockResolvedValue({ items: [] }),
    updateMenuBoosts: vi.fn().mockResolvedValue({ updated_count: 0 }),
    ...overrides,
  };
}

describe('ExperienceManagement — mobile Tables tab', () => {
  let user: ReturnType<typeof userEvent.setup>;
  beforeEach(() => { user = userEvent.setup(); vi.clearAllMocks(); });

  it('collapses config (delete) behind a Manage toggle until expanded', async () => {
    render(<ExperienceManagement initialTab="tables" restaurantId="rest-1" service={makeService()} />);
    // Manage toggle is present; the delete button is hidden until it is expanded
    const manage = await screen.findByTestId('table-manage-toggle-5');
    expect(manage).toBeVisible();
    expect(screen.queryByTestId('table-delete-5')).not.toBeInTheDocument();
    await user.click(manage);
    expect(await screen.findByTestId('table-delete-5')).toBeVisible();
  });

  it('auto-opens the Service view + shows the banner when a table has an active call', async () => {
    const service = makeService({
      getTableActivity: vi.fn().mockResolvedValue(makeActivity([{ table_number: 5, has_active_session: true }])),
      getWaiterCalls: vi.fn().mockResolvedValue([makeCall()]),
    });
    render(<ExperienceManagement initialTab="tables" restaurantId="rest-1" service={service} hostStationHref="/owner/host-station" />);
    // "Done" ack is reachable without tapping the Service segment (auto-defaulted)
    expect(await screen.findByTestId('table-ack-call-5')).toBeVisible();
    // banner + host-station affordance
    expect(screen.getByText(/1 table needs service/i)).toBeVisible();
    expect(screen.getByRole('link', { name: /open host station/i })).toHaveAttribute('href', '/owner/host-station');
  });

  it('acknowledges a call optimistically (removed before the request resolves)', async () => {
    const service = makeService({
      getTableActivity: vi.fn().mockResolvedValue(makeActivity([{ table_number: 5, has_active_session: true }])),
      getWaiterCalls: vi.fn().mockResolvedValue([makeCall()]),
      acknowledgeWaiterCall: vi.fn().mockReturnValue(new Promise<void>(() => { /* never resolves */ })),
    });
    render(<ExperienceManagement initialTab="tables" restaurantId="rest-1" service={service} />);
    const done = await screen.findByTestId('table-ack-call-5');
    await user.click(done);
    // optimistic: the ack disappears even though the request is still pending
    await waitFor(() => expect(screen.queryByTestId('table-ack-call-5')).not.toBeInTheDocument());
    expect(service.acknowledgeWaiterCall).toHaveBeenCalledWith('call-1');
  });
});

describe('StaffManagement — mobile', () => {
  let user: ReturnType<typeof userEvent.setup>;
  beforeEach(() => { user = userEvent.setup(); vi.clearAllMocks(); });

  it('toggles active state optimistically without a full-list refetch', async () => {
    const service = makeService({ getStaff: vi.fn().mockResolvedValue({ staff: [makeStaff()], count: 1 }) });
    render(<StaffManagement restaurantId="rest-1" service={service} />);
    const deactivate = await screen.findByRole('button', { name: /deactivate/i });
    await user.click(deactivate);
    // flips to Activate (optimistic is_active=false) and shows the Inactive badge…
    expect(await screen.findByRole('button', { name: /activate/i })).toBeVisible();
    expect(screen.getByText(/inactive/i)).toBeVisible();
    expect(service.updateStaff).toHaveBeenCalledWith('rest-1', 'staff-1', { is_active: false });
    // …with NO second getStaff (the old code refetched the whole list after every toggle)
    expect(service.getStaff).toHaveBeenCalledTimes(1);
  });
});
