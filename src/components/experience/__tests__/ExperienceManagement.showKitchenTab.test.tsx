// @vitest-environment jsdom
/**
 * ExperienceManagement — showKitchenTab prop (STR-950).
 *
 * The owner app hides the Kitchen (KDS pairing) tab by passing showKitchenTab={false};
 * waiter/admin omit the prop and keep it (default true). Pins:
 *  - default (prop omitted) → Staff + Tables + Kitchen tabs all render
 *  - showKitchenTab={false} → Kitchen tab is gone; Staff + Tables remain
 *  - showKitchenTab={false} + initialTab="kitchen" → falls back to Tables (no crash,
 *    Kitchen content never mounts)
 *
 * Desktop viewport (matchMedia matches:false → useIsMobile() === false).
 */
import { describe, it, expect, vi, beforeEach, beforeAll } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import React from 'react';
import ExperienceManagement from '../ExperienceManagement';
import type { ExperienceService } from '../../../types/experience';

beforeAll(() => {
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    matches: false, // desktop
    media: query, onchange: null,
    addListener: vi.fn(), removeListener: vi.fn(),
    addEventListener: vi.fn(), removeEventListener: vi.fn(), dispatchEvent: vi.fn(),
  }));
});

function makeService(overrides: Partial<ExperienceService> = {}): ExperienceService {
  return {
    getTables: vi.fn().mockResolvedValue({ tables: [], count: 0 }),
    createTables: vi.fn().mockResolvedValue({ tables: [], message: 'ok' }),
    updateTable: vi.fn().mockResolvedValue({ table: {} }),
    generateQRCodes: vi.fn().mockResolvedValue({ tables: [], message: 'ok' }),
    downloadQRCodesZip: vi.fn().mockResolvedValue({ download_url: '', filename: '', table_count: 0 }),
    deleteTable: vi.fn().mockResolvedValue(undefined),
    getStaff: vi.fn().mockResolvedValue({ staff: [], count: 0 }),
    createStaff: vi.fn().mockResolvedValue({ staff: {} }),
    updateStaff: vi.fn().mockResolvedValue({ staff: {} }),
    deleteStaff: vi.fn().mockResolvedValue(undefined),
    getWaiterCalls: vi.fn().mockResolvedValue([]),
    acknowledgeWaiterCall: vi.fn().mockResolvedValue(undefined),
    getTableActivity: vi.fn().mockResolvedValue({
      tables: [], summary: { total_tables: 0, occupied_tables: 0, available_tables: 0, total_guests: 0 },
    }),
    getOrders: vi.fn().mockResolvedValue({ orders: [], total: 0 }),
    getMenuBoosts: vi.fn().mockResolvedValue({ items: [] }),
    updateMenuBoosts: vi.fn().mockResolvedValue({ updated_count: 0 }),
    ...overrides,
  } as ExperienceService;
}

// The Tables tab button also renders a count badge once getTables resolves
// (accessible name becomes e.g. "Tables 0"), so match by name prefix, not exact.
const kitchenTab = () => screen.queryByRole('button', { name: /^Kitchen/ });
const tablesTab = () => screen.queryByRole('button', { name: /^Tables/ });
const staffTab = () => screen.queryByRole('button', { name: /^Staff/ });

describe('ExperienceManagement — showKitchenTab', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('shows the Kitchen tab by default (waiter/admin behaviour)', async () => {
    render(<ExperienceManagement initialTab="tables" restaurantId="rest-1" service={makeService()} />);
    await waitFor(() => expect(tablesTab()).toBeInTheDocument());
    expect(staffTab()).toBeInTheDocument();
    expect(kitchenTab()).toBeInTheDocument();
  });

  it('hides the Kitchen tab when showKitchenTab={false} (owner app); Staff + Tables remain', async () => {
    render(<ExperienceManagement initialTab="tables" restaurantId="rest-1" service={makeService()} showKitchenTab={false} />);
    await waitFor(() => expect(tablesTab()).toBeInTheDocument());
    expect(staffTab()).toBeInTheDocument();
    expect(kitchenTab()).not.toBeInTheDocument();
  });

  it('falls back to Tables when hidden but initialTab="kitchen" (deep-link coercion)', async () => {
    render(<ExperienceManagement initialTab="kitchen" restaurantId="rest-1" service={makeService()} showKitchenTab={false} />);
    await waitFor(() => expect(tablesTab()).toBeInTheDocument());
    expect(kitchenTab()).not.toBeInTheDocument();
    // Active tab is Tables — its tab button carries the active styling (orange text)
    expect(tablesTab()!.className).toContain('text-orange-600');
  });
});
