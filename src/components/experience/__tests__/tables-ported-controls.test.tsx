// @vitest-environment jsdom
/**
 * The four capabilities ported here when /owner/tables was retired (2026-10-10).
 *
 * That page was not a duplicate — it was the ONLY home for the QR killswitch,
 * label editing, the active/inactive toggle and the room pairing code. Deleting
 * it without these would have removed all four, one of them the security
 * control that kills a printed QR after a sticker swap.
 *
 * Two of these tests exist because of specific ways the port could go wrong:
 *   - inactive tables must still RENDER. This grid used to filter to
 *     `is_active`, which was safe only while another page could reach them;
 *     with the toggle on the card, filtering would make a table vanish the
 *     instant it was deactivated, and nothing could bring it back.
 *   - rotating must be CONFIRMED. It invalidates a code that may already be
 *     printed and stuck to a table.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, cleanup } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import ExperienceManagement from '../ExperienceManagement';
import type { ExperienceService } from '../../../types/experience';

const T = (over: Record<string, unknown> = {}) => ({
  id: 't1', table_number: 1, table_label: '1', is_active: true,
  qr_code_url: null, capacity: 4, print_gen: 1, ...over,
});

function makeService(tables: unknown[], overrides: Partial<ExperienceService> = {}) {
  return {
    getTables: vi.fn().mockResolvedValue({ tables, count: tables.length }),
    createTables: vi.fn(),
    updateTable: vi.fn().mockResolvedValue({ table: tables[0] }),
    generateQRCodes: vi.fn().mockResolvedValue({ tables: [], message: 'ok' }),
    downloadQRCodesZip: vi.fn(),
    getStaff: vi.fn().mockResolvedValue({ staff: [], count: 0 }),
    createStaff: vi.fn(), updateStaff: vi.fn(),
    getWaiterCalls: vi.fn().mockResolvedValue([]),
    acknowledgeWaiterCall: vi.fn(),
    getTableActivity: vi.fn().mockResolvedValue({}),
    getOrders: vi.fn().mockResolvedValue({ orders: [], total: 0 }),
    getMenuBoosts: vi.fn().mockResolvedValue({ items: [] }),
    updateMenuBoosts: vi.fn(),
    ...overrides,
  } as unknown as ExperienceService;
}

beforeEach(() => vi.clearAllMocks());
afterEach(() => cleanup());

describe('the QR killswitch', () => {
  it('is absent unless the service supplies rotateTableQR', async () => {
    render(<ExperienceManagement restaurantId="r1" service={makeService([T()])} />);
    await screen.findByRole('heading', { name: 'Table 1' });
    expect(screen.queryByTestId('table-rotate-qr-1')).toBeNull();
  });

  it('asks before invalidating a code that may already be printed', async () => {
    const rotateTableQR = vi.fn().mockResolvedValue({
      slug: 'abc', sig: 'def', print_gen: 2, scan_path: '/s/abc?v=def',
    });
    render(<ExperienceManagement restaurantId="r1"
      service={makeService([T()], { rotateTableQR } as Partial<ExperienceService>)} />);
    await userEvent.click(await screen.findByTestId('table-rotate-qr-1'));
    // Nothing has fired yet — the dialog stands between the tap and the bump.
    expect(rotateTableQR).not.toHaveBeenCalled();
    await screen.findByTestId('rotate-qr-confirm');
    await userEvent.click(screen.getByTestId('rotate-qr-confirm-btn'));
    await waitFor(() => expect(rotateTableQR).toHaveBeenCalledWith('r1', 't1'));
  });

  it('does nothing when the confirmation is dismissed', async () => {
    const rotateTableQR = vi.fn();
    render(<ExperienceManagement restaurantId="r1"
      service={makeService([T()], { rotateTableQR } as Partial<ExperienceService>)} />);
    await userEvent.click(await screen.findByTestId('table-rotate-qr-1'));
    await userEvent.click(await screen.findByTestId('rotate-qr-cancel'));
    expect(rotateTableQR).not.toHaveBeenCalled();
  });
});

describe('active / inactive', () => {
  it('still shows an inactive table, so it can be brought back', async () => {
    render(<ExperienceManagement restaurantId="r1"
      service={makeService([T({ is_active: false })])} />);
    // The grid used to filter these out entirely.
    await screen.findByRole('heading', { name: 'Table 1' });
    expect(screen.getByTestId('table-toggle-1').textContent).toContain('Reactivate');
  });

  it('deactivates through updateTable', async () => {
    const service = makeService([T()]);
    render(<ExperienceManagement restaurantId="r1" service={service} />);
    await userEvent.click(await screen.findByTestId('table-toggle-1'));
    await waitFor(() =>
      expect(service.updateTable).toHaveBeenCalledWith('r1', 't1', { is_active: false }));
  });
});

describe('the table label', () => {
  it('offers Save only once the value actually changes', async () => {
    const service = makeService([T({ table_label: 'Bay 7' })]);
    render(<ExperienceManagement restaurantId="r1" service={service} />);
    const input = await screen.findByTestId('table-label-input-1');
    expect(screen.queryByTestId('table-label-save-1')).toBeNull();
    await userEvent.type(input, '!');
    await userEvent.click(await screen.findByTestId('table-label-save-1'));
    await waitFor(() =>
      expect(service.updateTable).toHaveBeenCalledWith('r1', 't1', { table_label: 'Bay 7!' }));
  });

  it('clears the label with null rather than an empty string', async () => {
    const service = makeService([T({ table_label: 'Bay 7' })]);
    render(<ExperienceManagement restaurantId="r1" service={service} />);
    await userEvent.clear(await screen.findByTestId('table-label-input-1'));
    await userEvent.click(await screen.findByTestId('table-label-save-1'));
    await waitFor(() =>
      expect(service.updateTable).toHaveBeenCalledWith('r1', 't1', { table_label: null }));
  });
});

describe('the room pairing code', () => {
  const withCodes = (code: string | null) => makeService([T()], {
    getCurrentTableDeviceCode: vi.fn().mockResolvedValue({ code, expiresAt: null }),
    createTableDeviceCode: vi.fn().mockResolvedValue({
      code: '99998888', expiresAt: null, tableId: null,
    }),
    listTableDevices: vi.fn().mockResolvedValue({ devices: [] }),
  } as Partial<ExperienceService>);

  it('is absent unless the service wires pairing', async () => {
    render(<ExperienceManagement restaurantId="r1" service={makeService([T()])} />);
    await screen.findByRole('heading', { name: 'Table 1' });
    expect(screen.queryByTestId('room-pairing-code')).toBeNull();
  });

  it('shows the live room code', async () => {
    render(<ExperienceManagement restaurantId="r1" service={withCodes('04837261')} />);
    expect((await screen.findByTestId('room-pairing-code-value')).textContent).toBe('04837261');
  });

  it('mints WITHOUT a tableId — that is what makes it a room code', async () => {
    const service = withCodes(null);
    render(<ExperienceManagement restaurantId="r1" service={service} />);
    await userEvent.click(await screen.findByTestId('room-pairing-code-generate'));
    await waitFor(() => expect(service.createTableDeviceCode).toHaveBeenCalledWith('r1'));
  });
});
