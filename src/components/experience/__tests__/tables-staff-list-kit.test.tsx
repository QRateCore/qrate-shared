// @vitest-environment jsdom
/**
 * Tables / Staff in the host app's list kit (owner desktop, 2026-10-27).
 *
 * With a `listKit`, both tabs render as one-line rows in the host's house table
 * and a row opens a modal holding the controls the card carried. What these
 * pin:
 *   - the CANARY contract survives: `table-card-N` is the row, and
 *     `table-device-paired-N` sits INSIDE it, only on the paired table
 *     (table-device-onboarding tdo-05 asserts exactly that pair);
 *   - the edits still reach the service from the modal;
 *   - waiter / admin (no kit) and phones (kit, but mobile) keep the cards.
 *
 * The kit here is a deliberately dumb stand-in: plain elements, no styling.
 * It proves shared code drives the kit correctly, not how the owner's Kar
 * components look.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, within, cleanup } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import ExperienceManagement from '../ExperienceManagement';
import StaffManagement from '../../staff/StaffManagement';
import type { ListKit, ListKitTableProps, ListKitModalProps, ListKitModalFooterProps, ListKitPillProps } from '../../common/listKit';
import type { ExperienceService, StaffMember } from '../../../types/experience';

function FakeTable<T>({ columns, rows, rowKey, onRowClick, rowProps, testId }: ListKitTableProps<T>) {
  return (
    <div data-testid={testId} role="table">
      {rows.map(r => {
        const extra = rowProps?.(r) ?? {};
        return (
          <div key={rowKey(r)} role="row" {...extra} onClick={() => onRowClick?.(r)}>
            {columns.map(c => <span key={c.key} role="cell">{c.render(r)}</span>)}
          </div>
        );
      })}
    </div>
  );
}
const FakeModal = ({ open, title, children, footer, testId, onClose }: ListKitModalProps) =>
  open ? (
    <div role="dialog" data-testid={testId}>
      <h2>{title}</h2>
      <button type="button" onClick={onClose}>Close dialog</button>
      {children}
      {footer}
    </div>
  ) : null;
const FakeFooter = ({ dangerAction, children }: ListKitModalFooterProps) => <div>{dangerAction}{children}</div>;
const FakePill = ({ children, testId }: ListKitPillProps) => <span data-testid={testId}>{children}</span>;

const kit: ListKit = { DataTable: FakeTable, Modal: FakeModal, ModalFooter: FakeFooter, StatusPill: FakePill };

function setViewport(mobile: boolean) {
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    matches: mobile, media: query, onchange: null,
    addListener: vi.fn(), removeListener: vi.fn(),
    addEventListener: vi.fn(), removeEventListener: vi.fn(), dispatchEvent: vi.fn(),
  }));
}

const T = (over: Record<string, unknown> = {}) => ({
  id: 't1', table_number: 1, is_active: true, qr_code_url: 'https://x/qr.png', capacity: 4, print_gen: 1, ...over,
});

function makeService(tables: unknown[], overrides: Partial<ExperienceService> = {}) {
  return {
    getTables: vi.fn().mockResolvedValue({ tables, count: tables.length }),
    createTables: vi.fn(),
    updateTable: vi.fn().mockResolvedValue({ table: tables[0] }),
    generateQRCodes: vi.fn().mockResolvedValue({ tables: [], message: 'ok' }),
    downloadQRCodesZip: vi.fn(),
    deleteTable: vi.fn().mockResolvedValue(undefined),
    getStaff: vi.fn().mockResolvedValue({ staff: [], count: 0 }),
    createStaff: vi.fn(), updateStaff: vi.fn().mockResolvedValue({}),
    getWaiterCalls: vi.fn().mockResolvedValue([]),
    acknowledgeWaiterCall: vi.fn(),
    getTableActivity: vi.fn().mockResolvedValue({}),
    getOrders: vi.fn().mockResolvedValue({ orders: [], total: 0 }),
    getMenuBoosts: vi.fn().mockResolvedValue({ items: [] }),
    updateMenuBoosts: vi.fn(),
    ...overrides,
  } as unknown as ExperienceService;
}

beforeEach(() => { vi.clearAllMocks(); setViewport(false); });
afterEach(() => cleanup());

describe('Tables with a list kit (desktop)', () => {
  it('renders rows, not cards, and keeps the canary testids on the row', async () => {
    const svc = makeService([T(), T({ id: 't2', table_number: 2 })], {
      listTableDevices: vi.fn().mockResolvedValue({
        devices: [{ deviceId: 'd1', name: 'Puck', tableId: 't1', tableNumber: 1, tableLabel: null, pairedAt: '2026-10-27T00:00:00Z', lastSeenAt: new Date().toISOString() }],
      }),
    } as Partial<ExperienceService>);
    render(<ExperienceManagement restaurantId="r1" service={svc} listKit={kit} />);

    const row1 = await screen.findByTestId('table-card-1');
    expect(screen.getByTestId('tables-list')).toBeTruthy();
    // No card heading: the row is the only place the table is named.
    expect(screen.queryByRole('heading', { name: 'Table 1' })).toBeNull();
    expect(within(row1).getByTestId('table-status-1').textContent).toBe('Available');
    await waitFor(() => expect(within(row1).getByTestId('table-device-paired-1')).toBeTruthy());
    expect(within(screen.getByTestId('table-card-2')).queryByTestId('table-device-paired-2')).toBeNull();
  });

  it('opens the table modal from the row and saves a label through the service', async () => {
    const svc = makeService([T()]);
    render(<ExperienceManagement restaurantId="r1" service={svc} listKit={kit} />);
    await userEvent.click(await screen.findByTestId('table-card-1'));
    const modal = await screen.findByTestId('table-modal-1');

    // No Save until the draft differs.
    expect(within(modal).queryByTestId('table-label-save-1')).toBeNull();
    await userEvent.type(within(modal).getByTestId('table-label-input-1'), 'Window');
    await userEvent.click(within(modal).getByTestId('table-label-save-1'));
    await waitFor(() => expect(svc.updateTable).toHaveBeenCalledWith('r1', 't1', { table_label: 'Window' }));
  });

  it('deletes from the modal through the existing confirm', async () => {
    const svc = makeService([T()]);
    render(<ExperienceManagement restaurantId="r1" service={svc} listKit={kit} />);
    await userEvent.click(await screen.findByTestId('table-card-1'));
    await userEvent.click(await screen.findByTestId('table-delete-1'));
    // The modal closes so the confirm is not stacked under it.
    expect(screen.queryByTestId('table-modal-1')).toBeNull();
    await userEvent.click(await screen.findByTestId('delete-table-confirm-btn'));
    await waitFor(() => expect(svc.deleteTable).toHaveBeenCalledWith('r1', 't1'));
  });

  it('toggles active from the modal footer', async () => {
    const svc = makeService([T()]);
    render(<ExperienceManagement restaurantId="r1" service={svc} listKit={kit} />);
    await userEvent.click(await screen.findByTestId('table-card-1'));
    await userEvent.click(await screen.findByTestId('table-toggle-1'));
    await waitFor(() => expect(svc.updateTable).toHaveBeenCalledWith('r1', 't1', { is_active: false }));
  });
});

describe('Cards stay where there is no kit or no room', () => {
  it('waiter / admin (no kit) get the card grid', async () => {
    render(<ExperienceManagement restaurantId="r1" service={makeService([T()])} />);
    await screen.findByRole('heading', { name: 'Table 1' });
    expect(screen.queryByTestId('tables-list')).toBeNull();
  });

  it('a phone gets the cards even when the host passes a kit', async () => {
    setViewport(true);
    render(<ExperienceManagement restaurantId="r1" service={makeService([T()])} listKit={kit} />);
    await screen.findByRole('heading', { name: 'Table 1' });
    expect(screen.queryByTestId('tables-list')).toBeNull();
  });
});

describe('Staff with a list kit', () => {
  const member = (over: Partial<StaffMember> = {}): StaffMember => ({
    id: 's1', name: 'Daniel', email: 'daniel@x.test', role: 'server', is_active: true, ...over,
  } as StaffMember);

  it('lists staff as rows and deactivates from the row modal', async () => {
    const svc = makeService([], { getStaff: vi.fn().mockResolvedValue({ staff: [member()], count: 1 }) });
    render(<StaffManagement restaurantId="r1" service={svc} listKit={kit} />);
    await userEvent.click(await screen.findByTestId('staff-row-s1'));
    const modal = await screen.findByTestId('staff-modal');
    await userEvent.click(within(modal).getByTestId('staff-toggle-active'));
    await waitFor(() => expect(svc.updateStaff).toHaveBeenCalledWith('r1', 's1', { is_active: false }));
    expect(screen.getByTestId('staff-status-s1').textContent).toBe('Inactive');
  });

  it('opens Add Staff as a modal form', async () => {
    const svc = makeService([]);
    render(<StaffManagement restaurantId="r1" service={svc} listKit={kit} />);
    await userEvent.click(await screen.findByTestId('add-staff-btn'));
    const modal = await screen.findByTestId('add-staff-modal');
    expect(within(modal).getByPlaceholderText(/full name/i)).toBeTruthy();
    // The trigger never flips to "Cancel" underneath the modal.
    expect(screen.getByTestId('add-staff-btn').textContent).toMatch(/add staff/i);
  });
});

describe('a slow table read never undoes a local write', () => {
  it('keeps a deleted table gone when an older read resolves after the delete', async () => {
    // Mount reads resolve normally. Then Regenerate QR starts a TABLES re-read
    // (the Tables tab's own fetch, not the tab-count one), which we hold until
    // after the delete — the old list it returns must not put table 1 back.
    let release!: (v: unknown) => void;
    const held = new Promise(r => { release = r; });
    const rows = [T(), T({ id: 't2', table_number: 2 })];
    let holdNext = false;
    const getTables = vi.fn().mockImplementation(() => {
      if (holdNext) { holdNext = false; return held; }
      return Promise.resolve({ tables: rows, count: 2 });
    });
    const svc = makeService(rows, { getTables } as Partial<ExperienceService>);
    render(<ExperienceManagement restaurantId="r1" service={svc} listKit={kit} />);
    await screen.findByTestId('table-card-1');

    holdNext = true;
    await userEvent.click(screen.getByTestId('generate-qr-btn'));
    await waitFor(() => expect(holdNext).toBe(false)); // the held read has started

    await userEvent.click(screen.getByTestId('table-card-1'));
    await userEvent.click(await screen.findByTestId('table-delete-1'));
    await userEvent.click(await screen.findByTestId('delete-table-confirm-btn'));
    await waitFor(() => expect(screen.queryByTestId('table-card-1')).toBeNull());

    release({ tables: rows, count: 2 });
    await new Promise(r => setTimeout(r, 0));
    await new Promise(r => setTimeout(r, 0));
    expect(screen.queryByTestId('table-card-1')).toBeNull();
    expect(screen.getByTestId('table-card-2')).toBeTruthy();
  });
});
