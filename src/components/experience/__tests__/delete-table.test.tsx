// @vitest-environment jsdom
/**
 * Unit tests for the delete-table feature in ExperienceManagement.
 *
 * Covers:
 *  - Delete button visibility: shown for available tables, hidden for occupied
 *  - Delete button has correct data-testid
 *  - Clicking delete opens confirmation modal with table number
 *  - Cancel dismisses the modal without calling the service
 *  - Confirm calls service.deleteTable and removes the table from the grid
 *  - Error from service shows error feedback
 *  - Delete button not rendered when service.deleteTable is undefined
 */
import { describe, it, expect, vi, beforeEach, beforeAll } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
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

describe('ExperienceManagement — delete table', () => {
  let user: ReturnType<typeof userEvent.setup>;

  beforeEach(() => {
    user = userEvent.setup();
    vi.clearAllMocks();
  });

  it('shows delete button for an available (non-occupied) table', async () => {
    const service = makeService();
    render(
      <ExperienceManagement initialTab="tables" restaurantId="rest-1" service={service} />,
    );

    const deleteBtn = await screen.findByTestId('table-delete-5');
    expect(deleteBtn).toBeVisible();
    expect(deleteBtn).toHaveTextContent(/delete table/i);
  });

  it('hides delete button when table is occupied', async () => {
    const service = makeService({
      getTableActivity: vi.fn().mockResolvedValue(
        makeTableActivity([{ table_number: 5, has_active_session: true }]),
      ),
    });

    render(
      <ExperienceManagement initialTab="tables" restaurantId="rest-1" service={service} />,
    );

    // Wait for tables to load
    await screen.findByText('Table 5');

    // Delete button should not be present for occupied table
    expect(screen.queryByTestId('table-delete-5')).not.toBeInTheDocument();
  });

  it('does not render delete button when service.deleteTable is undefined', async () => {
    const service = makeService({ deleteTable: undefined });

    render(
      <ExperienceManagement initialTab="tables" restaurantId="rest-1" service={service} />,
    );

    await screen.findByText('Table 5');
    expect(screen.queryByTestId('table-delete-5')).not.toBeInTheDocument();
  });

  it('opens confirmation modal when delete button is clicked', async () => {
    const service = makeService();
    render(
      <ExperienceManagement initialTab="tables" restaurantId="rest-1" service={service} />,
    );

    const deleteBtn = await screen.findByTestId('table-delete-5');
    await user.click(deleteBtn);

    // Modal should show the table number
    expect(screen.getByText(/Delete Table 5/)).toBeVisible();
    expect(screen.getByText(/permanently remove/i)).toBeVisible();
  });

  it('dismisses modal on Cancel without calling deleteTable', async () => {
    const service = makeService();
    render(
      <ExperienceManagement initialTab="tables" restaurantId="rest-1" service={service} />,
    );

    const deleteBtn = await screen.findByTestId('table-delete-5');
    await user.click(deleteBtn);

    // Click Cancel
    const cancelBtn = screen.getByRole('button', { name: /cancel/i });
    await user.click(cancelBtn);

    // Modal should close
    await waitFor(() => {
      expect(screen.queryByText(/Delete Table 5/)).not.toBeInTheDocument();
    });

    // Service should not have been called
    expect(service.deleteTable).not.toHaveBeenCalled();
  });

  it('calls service.deleteTable and removes table from grid on confirm', async () => {
    const service = makeService();
    render(
      <ExperienceManagement initialTab="tables" restaurantId="rest-1" service={service} />,
    );

    const deleteBtn = await screen.findByTestId('table-delete-5');
    await user.click(deleteBtn);

    // Click Delete in the modal
    const confirmBtn = screen.getByRole('button', { name: /^Delete$/i });
    await user.click(confirmBtn);

    // Service should be called with correct args
    await waitFor(() => {
      expect(service.deleteTable).toHaveBeenCalledWith('rest-1', 'table-1');
    });

    // Table should be removed from the grid
    await waitFor(() => {
      expect(screen.queryByText('Table 5')).not.toBeInTheDocument();
    });
  });

  it('shows error feedback when deleteTable fails', async () => {
    const service = makeService({
      deleteTable: vi.fn().mockRejectedValue(new Error('Network error')),
    });
    render(
      <ExperienceManagement initialTab="tables" restaurantId="rest-1" service={service} />,
    );

    const deleteBtn = await screen.findByTestId('table-delete-5');
    await user.click(deleteBtn);

    const confirmBtn = screen.getByRole('button', { name: /^Delete$/i });
    await user.click(confirmBtn);

    // Error feedback should appear
    await waitFor(() => {
      expect(screen.getByText(/failed to delete table/i)).toBeVisible();
    });

    // Table should still be in the grid (not removed on error)
    expect(screen.getByText('Table 5')).toBeVisible();
  });

  it('deletes the correct table when multiple tables exist', async () => {
    const tables = [
      makeTable({ id: 'table-1', table_number: 1 }),
      makeTable({ id: 'table-2', table_number: 2 }),
      makeTable({ id: 'table-3', table_number: 3 }),
    ];
    const service = makeService({
      getTables: vi.fn().mockResolvedValue({ tables, count: 3 }),
      getTableActivity: vi.fn().mockResolvedValue(
        makeTableActivity([
          { table_number: 1, has_active_session: false },
          { table_number: 2, has_active_session: false },
          { table_number: 3, has_active_session: false },
        ]),
      ),
    });

    render(
      <ExperienceManagement initialTab="tables" restaurantId="rest-1" service={service} />,
    );

    // Wait for all tables
    await screen.findByText('Table 2');

    // Delete table 2
    const deleteBtn = screen.getByTestId('table-delete-2');
    await user.click(deleteBtn);

    const confirmBtn = screen.getByRole('button', { name: /^Delete$/i });
    await user.click(confirmBtn);

    await waitFor(() => {
      expect(service.deleteTable).toHaveBeenCalledWith('rest-1', 'table-2');
    });

    // Table 2 gone, others remain
    await waitFor(() => {
      expect(screen.queryByText('Table 2')).not.toBeInTheDocument();
    });
    expect(screen.getByText('Table 1')).toBeVisible();
    expect(screen.getByText('Table 3')).toBeVisible();
  });
});
