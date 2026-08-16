// @vitest-environment jsdom
/**
 * DrinksQrTab — full Tables-tab parity.
 *
 * Each table card now matches the Tables tab's card exactly: AVAILABLE/
 * OCCUPIED badge driven by a LIVE drinks-surface session (getDrinksTableActivity),
 * not merely whether a QR has been generated; guest pills + Orders/Service
 * toggle when occupied; seats display/edit, server assignment, delete table
 * (gated on !occupied); an Add Table header action. All of this is
 * independent of ExperienceManagement's Tables tab — no shared state, no
 * refactor of that component.
 */
import { describe, it, expect, vi, beforeAll } from 'vitest';
import { render, screen, within, waitFor } from '@testing-library/react';
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
    getDrinksTableActivity: vi.fn().mockResolvedValue({ tables: [] }),
    getStaff: vi.fn().mockResolvedValue({ staff: [], count: 0 }),
    createStaff: vi.fn().mockResolvedValue({ staff: {} }),
    updateStaff: vi.fn().mockResolvedValue({ staff: {} }),
    deleteStaff: vi.fn().mockResolvedValue(undefined),
    getWaiterCalls: vi.fn().mockResolvedValue([]),
    acknowledgeWaiterCall: vi.fn().mockResolvedValue(undefined),
    getTableActivity: vi.fn().mockResolvedValue({ tables: [] }),
    getOrders: vi.fn().mockResolvedValue({ orders: [], total: 0 }),
    getMenuBoosts: vi.fn().mockResolvedValue({ items: [] }),
    updateMenuBoosts: vi.fn().mockResolvedValue({ updated_count: 0 }),
    ...overrides,
  } as ExperienceService;
}

function oneTable(overrides: Record<string, any> = {}) {
  return {
    id: 't1', restaurant_id: 'rest-1', table_number: 3, table_label: null,
    is_active: true, created_at: '', updated_at: '', assigned_server_id: null,
    capacity: 4,
    ...overrides,
  };
}

describe('DrinksQrTab — occupancy badge (live drinks session, not QR-generated state)', () => {
  it('renders AVAILABLE when no live drinks session exists, even if a QR is generated', async () => {
    const service = makeService({
      getTables: vi.fn().mockResolvedValue({ tables: [oneTable({ drinks_qr_code_url: 'https://x/qr.png' })], count: 1 }),
      getDrinksTableActivity: vi.fn().mockResolvedValue({ tables: [] }),
    });
    render(<DrinksQrTab restaurantId="rest-1" service={service} />);

    const card = await screen.findByTestId('drinks-qr-table-3');
    await waitFor(() => expect(within(card).getByText('AVAILABLE')).toBeInTheDocument());
    expect(within(card).queryByText('OCCUPIED')).not.toBeInTheDocument();
  });

  it('renders OCCUPIED when a live drinks session is active for that table', async () => {
    const service = makeService({
      getTables: vi.fn().mockResolvedValue({ tables: [oneTable()], count: 1 }),
      getDrinksTableActivity: vi.fn().mockResolvedValue({
        tables: [{
          table_number: 3, has_active_session: true,
          guests: [{ diner_id: null, name: 'Happy Fox', connected: true, idle: false, order_ids: [] }],
          placed_orders: [],
        }],
      }),
    });
    render(<DrinksQrTab restaurantId="rest-1" service={service} />);

    const card = await screen.findByTestId('drinks-qr-table-3');
    await waitFor(() => expect(within(card).getByText('OCCUPIED')).toBeInTheDocument());
    expect(within(card).getByText('Happy Fox')).toBeInTheDocument();
  });

  it('shows the seats count from table.capacity', async () => {
    const service = makeService({
      getTables: vi.fn().mockResolvedValue({ tables: [oneTable({ capacity: 6 })], count: 1 }),
    });
    render(<DrinksQrTab restaurantId="rest-1" service={service} />);
    const card = await screen.findByTestId('drinks-qr-table-3');
    expect(within(card).getByText('6 seats')).toBeInTheDocument();
  });
});

describe('DrinksQrTab — server name display (unchanged from Phase B)', () => {
  it('shows the assigned server name on the card', async () => {
    const service = makeService({
      getTables: vi.fn().mockResolvedValue({ tables: [oneTable({ table_number: 7, assigned_server_id: 'staff-1' })], count: 1 }),
      getStaff: vi.fn().mockResolvedValue({
        staff: [{ id: 'staff-1', name: 'Jordan', email: 'j@x.com', role: 'server', permissions: [], is_active: true, created_at: '' }],
        count: 1,
      }),
    });
    render(<DrinksQrTab restaurantId="rest-1" service={service} />);
    const card = await screen.findByTestId('drinks-qr-table-7');
    expect(within(card).getByText('Server: Jordan')).toBeInTheDocument();
  });

  it('omits the server name when no server is assigned', async () => {
    const service = makeService({
      getTables: vi.fn().mockResolvedValue({ tables: [oneTable({ table_number: 2 })], count: 1 }),
    });
    render(<DrinksQrTab restaurantId="rest-1" service={service} />);
    const card = await screen.findByTestId('drinks-qr-table-2');
    expect(within(card).queryByText(/^Server:/)).not.toBeInTheDocument();
  });
});

describe('DrinksQrTab — QR modal (unchanged from Phase B)', () => {
  it('opens the QR modal when the QR icon button on a card is clicked', async () => {
    const user = userEvent.setup();
    const service = makeService({
      getTables: vi.fn().mockResolvedValue({
        tables: [oneTable({ table_number: 4, drinks_qr_code_url: 'https://example.com/qr.png' })],
        count: 1,
      }),
    });
    render(<DrinksQrTab restaurantId="rest-1" service={service} />);
    const card = await screen.findByTestId('drinks-qr-table-4');
    await user.click(within(card).getByTitle('Show drinks QR code'));
    expect(screen.getByAltText('Drinks QR code for Table 4')).toBeInTheDocument();
  });
});

describe('DrinksQrTab — seats editing', () => {
  it('shows a Save button only once the seats value changes, and calls updateTable with the new capacity', async () => {
    const user = userEvent.setup();
    const updateTable = vi.fn().mockResolvedValue({ table: {} });
    const service = makeService({
      getTables: vi.fn().mockResolvedValue({ tables: [oneTable({ capacity: 4 })], count: 1 }),
      updateTable,
    });
    render(<DrinksQrTab restaurantId="rest-1" service={service} />);
    const card = await screen.findByTestId('drinks-qr-table-3');

    expect(within(card).queryByText('Save')).not.toBeInTheDocument();

    const seatsInput = within(card).getByTestId('drinks-table-seats-3') as HTMLInputElement;
    await user.clear(seatsInput);
    await user.type(seatsInput, '8');

    const saveBtn = await within(card).findByText('Save');
    await user.click(saveBtn);

    await waitFor(() => expect(updateTable).toHaveBeenCalledWith('rest-1', 't1', { capacity: 8 }));
  });
});

describe('DrinksQrTab — server assignment', () => {
  it('calls updateTable with assigned_server_id when a server is picked from the dropdown', async () => {
    const user = userEvent.setup();
    const updateTable = vi.fn().mockResolvedValue({ table: {} });
    const service = makeService({
      getTables: vi.fn().mockResolvedValue({ tables: [oneTable()], count: 1 }),
      getStaff: vi.fn().mockResolvedValue({
        staff: [{ id: 'staff-1', name: 'Jordan', email: 'j@x.com', role: 'server', permissions: [], is_active: true, created_at: '' }],
        count: 1,
      }),
      updateTable,
    });
    render(<DrinksQrTab restaurantId="rest-1" service={service} />);
    await screen.findByTestId('drinks-qr-table-3');

    await user.click(await screen.findByRole('option', { name: 'Jordan' }));

    await waitFor(() => expect(updateTable).toHaveBeenCalledWith('rest-1', 't1', { assigned_server_id: 'staff-1' }));
  });
});

describe('DrinksQrTab — delete table', () => {
  it('shows the delete button when the table is not occupied, and deletes after confirmation', async () => {
    const user = userEvent.setup();
    const deleteTable = vi.fn().mockResolvedValue(undefined);
    const service = makeService({
      getTables: vi.fn().mockResolvedValue({ tables: [oneTable()], count: 1 }),
      deleteTable,
    });
    render(<DrinksQrTab restaurantId="rest-1" service={service} />);
    const card = await screen.findByTestId('drinks-qr-table-3');

    await user.click(within(card).getByTestId('drinks-table-delete-3'));
    await user.click(await screen.findByTestId('drinks-table-delete-confirm'));

    await waitFor(() => expect(deleteTable).toHaveBeenCalledWith('rest-1', 't1'));
  });

  it('hides the delete button when the table is occupied', async () => {
    const service = makeService({
      getTables: vi.fn().mockResolvedValue({ tables: [oneTable()], count: 1 }),
      getDrinksTableActivity: vi.fn().mockResolvedValue({
        tables: [{ table_number: 3, has_active_session: true, guests: [], placed_orders: [] }],
      }),
    });
    render(<DrinksQrTab restaurantId="rest-1" service={service} />);
    const card = await screen.findByTestId('drinks-qr-table-3');
    await waitFor(() => expect(within(card).getByText('OCCUPIED')).toBeInTheDocument());
    expect(within(card).queryByTestId('drinks-table-delete-3')).not.toBeInTheDocument();
  });
});

describe('DrinksQrTab — add table', () => {
  it('creates tables and regenerates drinks QR codes on confirm', async () => {
    const user = userEvent.setup();
    const createTables = vi.fn().mockResolvedValue({ tables: [], message: 'ok' });
    const generateDrinksQRCodes = vi.fn().mockResolvedValue({ tables: [], message: 'ok' });
    const service = makeService({
      getTables: vi.fn().mockResolvedValue({ tables: [oneTable()], count: 1 }),
      createTables,
      generateDrinksQRCodes,
    });
    render(<DrinksQrTab restaurantId="rest-1" service={service} />);
    await screen.findByTestId('drinks-qr-table-3');

    await user.click(screen.getByTestId('drinks-add-table-btn'));
    await user.click(screen.getByTestId('drinks-add-table-confirm'));

    await waitFor(() => expect(createTables).toHaveBeenCalledWith('rest-1', { table_count: 1, start_number: 1 }));
    await waitFor(() => expect(generateDrinksQRCodes).toHaveBeenCalledWith('rest-1'));
  });

  it('shows the Add Table button and empty-state CTA when there are no tables at all', async () => {
    const user = userEvent.setup();
    const createTables = vi.fn().mockResolvedValue({ tables: [], message: 'ok' });
    const service = makeService({
      getTables: vi.fn().mockResolvedValue({ tables: [], count: 0 }),
      createTables,
    });
    render(<DrinksQrTab restaurantId="rest-1" service={service} />);

    const btn = await screen.findByTestId('drinks-add-table-btn');
    await user.click(btn);
    await user.click(screen.getByTestId('drinks-add-table-confirm'));
    await waitFor(() => expect(createTables).toHaveBeenCalled());
  });
});

describe('DrinksQrTab — Orders/Service toggle', () => {
  it('shows placed drinks orders under the Orders tab when occupied', async () => {
    const service = makeService({
      getTables: vi.fn().mockResolvedValue({ tables: [oneTable()], count: 1 }),
      getDrinksTableActivity: vi.fn().mockResolvedValue({
        tables: [{
          table_number: 3, has_active_session: true,
          guests: [{ diner_id: null, name: 'Sam', connected: true, idle: false, order_ids: ['o1'] }],
          placed_orders: [{
            order_id: 'o1', status: 'confirmed', diner_id: null, diner_name: 'Sam',
            created_at: '2026-08-16T19:00:00Z', total_amount: 12.5, active_total: 12.5,
            items: [{ id: 'i1', name: 'Mojito', quantity: 1, price: 12.5, patron_display_name: 'Sam', item_status: 'active' }],
          }],
        }],
      }),
    });
    render(<DrinksQrTab restaurantId="rest-1" service={service} />);
    const card = await screen.findByTestId('drinks-qr-table-3');
    await waitFor(() => expect(within(card).getByText('OCCUPIED')).toBeInTheDocument());
    expect(within(card).getByText('Mojito')).toBeInTheDocument();
    expect(within(card).getByText('$12.50')).toBeInTheDocument();
  });

  it('shows waiter calls under the Service tab and acknowledges on click', async () => {
    const user = userEvent.setup();
    const acknowledgeWaiterCall = vi.fn().mockResolvedValue(undefined);
    const service = makeService({
      getTables: vi.fn().mockResolvedValue({ tables: [oneTable()], count: 1 }),
      getDrinksTableActivity: vi.fn().mockResolvedValue({
        tables: [{ table_number: 3, has_active_session: true, guests: [], placed_orders: [] }],
      }),
      getWaiterCalls: vi.fn().mockResolvedValue([
        { id: 'call-1', table_number: 3, status: 'active', created_at: new Date().toISOString(), call_type: 'general' },
      ]),
      acknowledgeWaiterCall,
    });
    render(<DrinksQrTab restaurantId="rest-1" service={service} />);
    const card = await screen.findByTestId('drinks-qr-table-3');
    await waitFor(() => expect(within(card).getByText('OCCUPIED')).toBeInTheDocument());

    await user.click(within(card).getByText('Service'));
    await user.click(within(card).getByTestId('drinks-table-ack-call-3'));

    await waitFor(() => expect(acknowledgeWaiterCall).toHaveBeenCalledWith('call-1'));
  });
});
