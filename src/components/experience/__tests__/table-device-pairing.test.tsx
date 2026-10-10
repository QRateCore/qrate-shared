// @vitest-environment jsdom
/**
 * Pairing an on-table service puck, from the table's own card.
 *
 * Gated on the service supplying `createTableDeviceCode` / `listTableDevices`,
 * exactly like "Import from POS" above it. That gate IS the feature: the OWNER
 * portal wires them, the admin and waiter apps do not, and this component has
 * to keep rendering for them untouched. So the first test here — the one
 * asserting the button is ABSENT — matters more than the rest.
 *
 * The second thing being pinned is that none of this renders a table's NAME.
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
    createTableDeviceCode: vi.fn().mockResolvedValue({
      code, expiresAt: new Date(Date.now() + 3600_000).toISOString(), tableId: 't1',
    }),
  } as Partial<ExperienceService>);
}

beforeEach(() => vi.clearAllMocks());
afterEach(() => cleanup());

describe('the gate', () => {
  it('renders nothing about devices when the service does not wire them', async () => {
    render(<ExperienceManagement restaurantId="r1" service={makeService()} />);
    await screen.findByRole('heading', { name: 'Table 1' });
    expect(screen.queryByTestId('table-pair-device-1')).toBeNull();
    expect(screen.queryByTestId('table-device-paired-1')).toBeNull();
  });

  it('offers Pair device once the service wires it', async () => {
    render(<ExperienceManagement restaurantId="r1" service={withDevices()} />);
    await screen.findByTestId('table-pair-device-1');
  });
});

describe('pairing from the card', () => {
  it('mints a code for THAT table and shows it on the card', async () => {
    const service = withDevices();
    render(<ExperienceManagement restaurantId="r1" service={service} />);
    await userEvent.click(await screen.findByTestId('table-pair-device-1'));
    await waitFor(() =>
      expect(screen.getByTestId('table-pair-code-1').textContent).toContain('04837261'),
    );
    // The tableId is what makes it a TABLE code — without it the device would
    // pair to the restaurant and still have to be told which table it is on.
    expect(service.createTableDeviceCode).toHaveBeenCalledWith('r1', 't1');
  });

  it('says so on the card when minting fails, rather than going quiet', async () => {
    const service = makeService({
      listTableDevices: vi.fn().mockResolvedValue({ devices: [] }),
      createTableDeviceCode: vi.fn().mockRejectedValue(new Error('500')),
    } as Partial<ExperienceService>);
    render(<ExperienceManagement restaurantId="r1" service={service} />);
    await userEvent.click(await screen.findByTestId('table-pair-device-1'));
    await screen.findByText(/could not generate a code/i);
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
    await userEvent.click(await screen.findByTestId('table-pair-device-1'));
    await screen.findByTestId('table-pair-code-1');
    // Read the document, not one render's container: the tab content is
    // portalled, so the container misses most of the tree.
    // Count ELEMENTS whose own text is the table's name, not occurrences in
    // document.textContent — that concatenates siblings ("Table 1" + "4 seats"
    // reads as "Table 14 seats") and would never match. Elements are also what
    // Playwright's getByText resolves, which is the thing being protected.
    expect(screen.getAllByText('Table 1')).toHaveLength(1);
  });
});
