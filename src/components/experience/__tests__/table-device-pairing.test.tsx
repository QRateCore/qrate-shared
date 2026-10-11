// @vitest-environment jsdom
/**
 * Pairing an on-table service puck.
 *
 * ONE PERMANENT CODE PER RESTAURANT, at the top of the tab. A device enters it
 * and then picks its own table on-screen.
 *
 * Per-table codes were retired 2026-10-11. A code carrying a tableId assigned
 * the device as it paired, so the puck never showed its table picker — which
 * made "I entered the code and got no table choice" the EXPECTED behaviour and
 * confused everyone who tried it. `no per-table code` below is the regression
 * guard against reintroducing that.
 *
 * Gated on the service supplying `createTableDeviceCode` / `listTableDevices`,
 * exactly like "Import from POS" above it. That gate IS the feature: the OWNER
 * portal wires them, the admin and waiter apps do not, and this component has
 * to keep rendering for them untouched. So the first test here — the one
 * asserting the strip is ABSENT — matters more than the rest.
 *
 * The other thing pinned here is that none of this renders a table's NAME.
 * The Tables E2E finds cards by text (`getByText(/table\s+\d+/i).first()`,
 * `getByText(TEST_LABEL).first()`), so a badge or code block that named its
 * table would become a second match and break four specs. That has already
 * happened twice.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, cleanup } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import ExperienceManagement from '../ExperienceManagement';
import type { ExperienceService } from '../../../types/experience';

const TABLE = {
  id: 't1', table_number: 1, table_label: '1', is_active: true,
  qr_code_url: null, capacity: 4, print_gen: 1,
};

function makeService(overrides: Partial<ExperienceService> = {}) {
  return {
    getTables: vi.fn().mockResolvedValue({ tables: [TABLE], count: 1 }),
    createTables: vi.fn(),
    updateTable: vi.fn(),
    generateQRCodes: vi.fn().mockResolvedValue({ tables: [], message: 'ok' }),
    downloadQRCodesZip: vi.fn(),
    getStaff: vi.fn().mockResolvedValue({ staff: [], count: 0 }),
    createStaff: vi.fn(),
    updateStaff: vi.fn(),
    getWaiterCalls: vi.fn().mockResolvedValue([]),
    acknowledgeWaiterCall: vi.fn(),
    getTableActivity: vi.fn().mockResolvedValue({}),
    getOrders: vi.fn().mockResolvedValue({ orders: [], total: 0 }),
    getMenuBoosts: vi.fn().mockResolvedValue({ items: [] }),
    updateMenuBoosts: vi.fn(),
    ...overrides,
  } as unknown as ExperienceService;
}

const device = (over: Record<string, unknown> = {}) => ({
  deviceId: 'd1', name: 'Table device A1B2', tableId: 't1', tableNumber: 1,
  tableLabel: null, pairedAt: new Date().toISOString(),
  lastSeenAt: new Date().toISOString(), ...over,
});

function withDevices(devices: unknown[] = [], code = '04837261') {
  return makeService({
    listTableDevices: vi.fn().mockResolvedValue({ devices }),
    // The backend provisions on read, so this is the call that normally
    // supplies the code — no button press required.
    getCurrentTableDeviceCode: vi.fn().mockResolvedValue({
      code, expiresAt: null, neverExpires: true,
    }),
    createTableDeviceCode: vi.fn().mockResolvedValue({
      code: '55556666', expiresAt: null, neverExpires: true, tableId: null,
    }),
  } as Partial<ExperienceService>);
}

beforeEach(() => vi.clearAllMocks());
afterEach(() => cleanup());

describe('the gate', () => {
  it('renders nothing about devices when the service does not wire them', async () => {
    render(<ExperienceManagement restaurantId="r1" service={makeService()} />);
    await screen.findByRole('heading', { name: 'Table 1' });
    expect(screen.queryByTestId('room-pairing-code')).toBeNull();
    expect(screen.queryByTestId('table-device-paired-1')).toBeNull();
  });

  it('shows the strip once the service wires it', async () => {
    render(<ExperienceManagement restaurantId="r1" service={withDevices()} />);
    await screen.findByTestId('room-pairing-code');
  });
});

describe('the restaurant pairing code', () => {
  it('is on screen without anyone pressing a button', async () => {
    // It used to read "None yet" until Generate was pressed, because the owner
    // page never wired getCurrentTableDeviceCode at all — the code existed
    // server-side and nothing asked for it.
    const service = withDevices();
    render(<ExperienceManagement restaurantId="r1" service={service} />);
    await waitFor(() =>
      expect(screen.getByTestId('room-pairing-code-value').textContent).toContain('04837261'),
    );
    expect(service.getCurrentTableDeviceCode).toHaveBeenCalledWith('r1');
    expect(service.createTableDeviceCode).not.toHaveBeenCalled();
  });

  it('says it never expires and that the device picks its table', async () => {
    render(<ExperienceManagement restaurantId="r1" service={withDevices()} />);
    await screen.findByTestId('room-pairing-code-permanent');
    expect(screen.getByText(/does not expire/i)).toBeTruthy();
    expect(screen.getByText(/asks which table it is on/i)).toBeTruthy();
  });

  it('does NOT claim permanence for a legacy code that really expires', async () => {
    // Room codes minted before 2026-10-11 lapse in 24h. dev Anant had exactly
    // one of these live when the change deployed, and the first version of
    // this strip told the owner it "does not expire" the day before it died.
    const service = makeService({
      listTableDevices: vi.fn().mockResolvedValue({ devices: [] }),
      getCurrentTableDeviceCode: vi.fn().mockResolvedValue({
        code: '04837261', expiresAt: '2026-10-12T22:06:45Z', neverExpires: false,
      }),
      createTableDeviceCode: vi.fn(),
    } as Partial<ExperienceService>);
    render(<ExperienceManagement restaurantId="r1" service={service} />);
    await screen.findByTestId('room-pairing-code-expiry');
    expect(screen.queryByTestId('room-pairing-code-permanent')).toBeNull();
    expect(screen.getByText(/press Replace code once/i)).toBeTruthy();
  });

  it('replaces the code restaurant-wide, with no table scope', async () => {
    const service = withDevices();
    render(<ExperienceManagement restaurantId="r1" service={service} />);
    await screen.findByTestId('room-pairing-code-value');
    await userEvent.click(screen.getByTestId('room-pairing-code-generate'));
    await waitFor(() =>
      expect(screen.getByTestId('room-pairing-code-value').textContent).toContain('55556666'),
    );
    // Exactly one argument. A second one would be a tableId, i.e. the retired
    // per-table code sneaking back in.
    expect(service.createTableDeviceCode).toHaveBeenCalledWith('r1');
    expect((service.createTableDeviceCode as ReturnType<typeof vi.fn>).mock.calls[0])
      .toHaveLength(1);
  });

  it('promises that replacing it does not disconnect paired devices', async () => {
    // STR-890 invariant, stated where the operator makes the decision.
    render(<ExperienceManagement restaurantId="r1" service={withDevices()} />);
    await screen.findByTestId('room-pairing-code');
    expect(screen.getByText(/never disconnects a device that is already paired/i)).toBeTruthy();
  });
});

describe('no per-table code', () => {
  it('offers no per-table pair button or code block', async () => {
    // Retired 2026-10-11: a table-scoped code suppressed the device's table
    // picker. If these testids ever come back, the confusion comes with them.
    render(<ExperienceManagement restaurantId="r1" service={withDevices([device()])} />);
    await screen.findByRole('heading', { name: 'Table 1' });
    expect(screen.queryByTestId('table-pair-device-1')).toBeNull();
    expect(screen.queryByTestId('table-pair-code-1')).toBeNull();
  });
});

describe('the paired badge', () => {
  it('appears only on a table that has a device', async () => {
    render(<ExperienceManagement restaurantId="r1" service={withDevices([device()])} />);
    await screen.findByTestId('table-device-paired-1');
  });

  it('is absent when the device belongs to another table', async () => {
    render(<ExperienceManagement restaurantId="r1"
      service={withDevices([device({ tableId: 't2', tableNumber: 2 })])} />);
    await screen.findByRole('heading', { name: 'Table 1' });
    expect(screen.queryByTestId('table-device-paired-1')).toBeNull();
  });

  it('reads "paired" when fresh', async () => {
    render(<ExperienceManagement restaurantId="r1" service={withDevices([device()])} />);
    expect((await screen.findByTestId('table-device-paired-1')).getAttribute('title'))
      .toMatch(/^Device paired —/);
  });

  it('reads "not seen recently" when the puck has gone quiet', async () => {
    // A puck that paired and then died must not look identical to a healthy
    // one. Separate render rather than rerender: cleanup() unmounts the tree a
    // rerender would target.
    const stale = new Date(Date.now() - 20 * 60 * 1000).toISOString();
    render(<ExperienceManagement restaurantId="r1"
      service={withDevices([device({ lastSeenAt: stale })])} />);
    expect((await screen.findByTestId('table-device-paired-1')).getAttribute('title'))
      .toMatch(/not seen recently/);
  });

  it('survives the device read failing — the tables are the point', async () => {
    const service = makeService({
      listTableDevices: vi.fn().mockRejectedValue(new Error('500')),
      createTableDeviceCode: vi.fn(),
    } as Partial<ExperienceService>);
    render(<ExperienceManagement restaurantId="r1" service={service} />);
    await screen.findByRole('heading', { name: 'Table 1' });
    expect(screen.queryByTestId('table-device-paired-1')).toBeNull();
  });
});

describe('not naming the table', () => {
  it('adds no "Table <n>" text beyond the card heading the grid already has', async () => {
    render(<ExperienceManagement restaurantId="r1" service={withDevices([device()])} />);
    await screen.findByRole('heading', { name: 'Table 1' });
    await screen.findByTestId('room-pairing-code-value');
    // Read the document, not one render's container: the tab content is
    // portalled, so the container misses most of the tree.
    // Count ELEMENTS whose own text is the table's name, not occurrences in
    // document.textContent — that concatenates siblings ("Table 1" + "4 seats"
    // reads as "Table 14 seats") and would never match. Elements are also what
    // Playwright's getByText resolves, which is the thing being protected.
    expect(screen.getAllByText('Table 1')).toHaveLength(1);
  });
});
