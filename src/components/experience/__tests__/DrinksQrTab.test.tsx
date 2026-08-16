// @vitest-environment jsdom
/**
 * DrinksQrTab — card layout pins.
 *
 * Phase B redesign: each table renders as the same border-dashed card shell
 * the Tables tab uses (table name + server name + QR icon row, then a status
 * badge row), instead of the old flat list-button layout. Status badge reads
 * "QR GENERATED" / "NOT GENERATED" — deliberately not AVAILABLE/OCCUPIED,
 * since drinks QR cards track QR-code state, not a live guest session.
 */
import { describe, it, expect, vi, beforeAll } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import DrinksQrTab from '../DrinksQrTab';
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

describe('DrinksQrTab — card layout', () => {
  it('renders a table with no QR yet as a NOT GENERATED card', async () => {
    const service = makeService({
      getTables: vi.fn().mockResolvedValue({
        tables: [{
          id: 't1', restaurant_id: 'rest-1', table_number: 3, table_label: null,
          is_active: true, created_at: '', updated_at: '', assigned_server_id: null,
        }],
        count: 1,
      }),
    });
    render(<DrinksQrTab restaurantId="rest-1" service={service} />);

    const card = await screen.findByTestId('drinks-qr-table-3');
    expect(within(card).getByText('Table 3')).toBeInTheDocument();
    expect(within(card).getByText('NOT GENERATED')).toBeInTheDocument();
    expect(within(card).queryByText('QR GENERATED')).not.toBeInTheDocument();
  });

  it('renders a table with a generated QR as a QR GENERATED card', async () => {
    const service = makeService({
      getTables: vi.fn().mockResolvedValue({
        tables: [{
          id: 't1', restaurant_id: 'rest-1', table_number: 5, table_label: 'Patio 5',
          is_active: true, created_at: '', updated_at: '', drinks_qr_code_url: 'https://example.com/qr.png',
          assigned_server_id: null,
        }],
        count: 1,
      }),
    });
    render(<DrinksQrTab restaurantId="rest-1" service={service} />);

    const card = await screen.findByTestId('drinks-qr-table-5');
    expect(within(card).getByText('Patio 5')).toBeInTheDocument();
    expect(within(card).getByText('QR GENERATED')).toBeInTheDocument();
  });

  it('shows the assigned server name on the card, matching the Tables tab convention', async () => {
    const service = makeService({
      getTables: vi.fn().mockResolvedValue({
        tables: [{
          id: 't1', restaurant_id: 'rest-1', table_number: 7, table_label: null,
          is_active: true, created_at: '', updated_at: '', assigned_server_id: 'staff-1',
        }],
        count: 1,
      }),
      getStaff: vi.fn().mockResolvedValue({
        staff: [{
          id: 'staff-1', name: 'Jordan', email: 'jordan@example.com', role: 'server',
          permissions: [], is_active: true, created_at: '',
        }],
        count: 1,
      }),
    });
    render(<DrinksQrTab restaurantId="rest-1" service={service} />);

    const card = await screen.findByTestId('drinks-qr-table-7');
    expect(within(card).getByText('Server: Jordan')).toBeInTheDocument();
  });

  it('omits the server name when no server is assigned', async () => {
    const service = makeService({
      getTables: vi.fn().mockResolvedValue({
        tables: [{
          id: 't1', restaurant_id: 'rest-1', table_number: 2, table_label: null,
          is_active: true, created_at: '', updated_at: '', assigned_server_id: null,
        }],
        count: 1,
      }),
    });
    render(<DrinksQrTab restaurantId="rest-1" service={service} />);

    const card = await screen.findByTestId('drinks-qr-table-2');
    expect(within(card).queryByText(/^Server:/)).not.toBeInTheDocument();
  });

  it('opens the QR modal when the QR icon button on a card is clicked', async () => {
    const user = userEvent.setup();
    const service = makeService({
      getTables: vi.fn().mockResolvedValue({
        tables: [{
          id: 't1', restaurant_id: 'rest-1', table_number: 4, table_label: null,
          is_active: true, created_at: '', updated_at: '', drinks_qr_code_url: 'https://example.com/qr.png',
          assigned_server_id: null,
        }],
        count: 1,
      }),
    });
    render(<DrinksQrTab restaurantId="rest-1" service={service} />);

    const card = await screen.findByTestId('drinks-qr-table-4');
    await user.click(within(card).getByTitle('Show drinks QR code'));

    expect(screen.getByAltText('Drinks QR code for Table 4')).toBeInTheDocument();
  });
});
