// @vitest-environment jsdom
/**
 * ExperienceManagement — showDrinksTab prop.
 *
 * The Drinks QR tab (standalone drinks-ordering QR, gated on the admin-only
 * `drinks_qr_enabled` deluxe flag) is OFF by default — the opposite polarity
 * of showKitchenTab, since most restaurants won't have the flag on. The
 * owner app fetches the flag and passes showDrinksTab={true} only when it's
 * enabled for that restaurant. Pins:
 *  - default (prop omitted) → Drinks tab is absent; Staff + Tables render
 *  - showDrinksTab={true} → Drinks tab appears alongside Staff + Tables
 *  - showDrinksTab={false} + initialTab="drinks" → falls back to Tables
 *    (no crash, Drinks content never mounts)
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
    generateDrinksQRCodes: vi.fn().mockResolvedValue({ tables: [], message: 'ok' }),
    downloadDrinksQRCodesZip: vi.fn().mockResolvedValue({ download_url: '', filename: '', table_count: 0 }),
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
const drinksTab = () => screen.queryByRole('button', { name: /^Drinks/ });
const tablesTab = () => screen.queryByRole('button', { name: /^Tables/ });
const staffTab = () => screen.queryByRole('button', { name: /^Staff/ });

describe('ExperienceManagement — showDrinksTab', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('hides the Drinks tab by default — most restaurants have drinks_qr_enabled off', async () => {
    render(<ExperienceManagement initialTab="tables" restaurantId="rest-1" service={makeService()} />);
    await waitFor(() => expect(tablesTab()).toBeInTheDocument());
    expect(staffTab()).toBeInTheDocument();
    expect(drinksTab()).not.toBeInTheDocument();
  });

  it('shows the Drinks tab when showDrinksTab={true} (flag on for this restaurant)', async () => {
    render(<ExperienceManagement initialTab="tables" restaurantId="rest-1" service={makeService()} showDrinksTab={true} />);
    await waitFor(() => expect(tablesTab()).toBeInTheDocument());
    expect(staffTab()).toBeInTheDocument();
    expect(drinksTab()).toBeInTheDocument();
  });

  it('falls back to Tables when hidden but initialTab="drinks" (deep-link coercion)', async () => {
    render(<ExperienceManagement initialTab="drinks" restaurantId="rest-1" service={makeService()} showDrinksTab={false} />);
    await waitFor(() => expect(tablesTab()).toBeInTheDocument());
    expect(drinksTab()).not.toBeInTheDocument();
    expect(tablesTab()!.className).toContain('text-orange-600');
  });

  it('renders the Drinks tab content when active', async () => {
    const service = makeService({
      getTables: vi.fn().mockResolvedValue({
        tables: [{
          id: 't1', restaurant_id: 'rest-1', table_number: 1, table_label: 'Patio 1',
          is_active: true, created_at: '', updated_at: '', drinks_qr_code_url: 'https://example.com/qr.png',
        }],
        count: 1,
      }),
    });
    render(<ExperienceManagement initialTab="drinks" restaurantId="rest-1" service={service} showDrinksTab={true} />);
    await waitFor(() => expect(screen.getByTestId('drinks-qr-table-1')).toBeInTheDocument());
  });

  it('showKitchenTab and showDrinksTab can both be true — Staff, Tables, Kitchen, Drinks all render', async () => {
    render(
      <ExperienceManagement
        initialTab="tables" restaurantId="rest-1" service={makeService()}
        showKitchenTab={true} showDrinksTab={true}
      />,
    );
    await waitFor(() => expect(tablesTab()).toBeInTheDocument());
    expect(screen.queryByRole('button', { name: /^Kitchen/ })).toBeInTheDocument();
    expect(drinksTab()).toBeInTheDocument();
  });
});
