// @vitest-environment jsdom
/**
 * "Import from POS" on the Tables surface.
 *
 * The button is gated on the service supplying `importPosTables`. That gate
 * is the feature, not a detail: the ADMIN portal supplies it and the OWNER
 * portal does not, because an owner re-importing a floor plan mid-service
 * could renumber tables under their own staff.
 *
 * So the test that matters most here is the one asserting the button is
 * ABSENT when the method is missing.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, cleanup } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import ExperienceManagement from '../ExperienceManagement';
import type { ExperienceService } from '../../../types/experience';

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

const TABLE = {
  id: 't1', table_number: 1, table_label: '1', is_active: true,
  qr_code_url: null, capacity: 4, print_gen: 1,
};

const IMPORTED = {
  created: 25, adopted: 3, updated: 0, skipped: [], provider_tables: 28,
};

describe('Import from POS', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.matchMedia = vi.fn().mockImplementation((q) => ({
      matches: false, media: q, addEventListener: vi.fn(),
      removeEventListener: vi.fn(), addListener: vi.fn(),
      removeListener: vi.fn(),
    })) as unknown as typeof window.matchMedia;
  });

  // Explicit: auto-cleanup is not on here, so without this every render
  // accumulates and a query matches the PREVIOUS test's button too.
  afterEach(cleanup);

  it('is absent when the service does not offer it (the owner portal)', async () => {
    render(<ExperienceManagement restaurantId="r1" service={makeService()} />);
    await waitFor(() => expect(screen.queryByText(/Generate QR/)).toBeTruthy());
    expect(screen.queryByTestId('import-pos-tables-btn')).toBeNull();
  });

  it('is offered when the service supplies it (the admin portal)', async () => {
    const service = makeService({
      importPosTables: vi.fn().mockResolvedValue(IMPORTED),
    });
    render(<ExperienceManagement restaurantId="r1" service={service} />);
    expect(await screen.findByTestId('import-pos-tables-btn')).toBeTruthy();
  });

  it('imports, then generates QR codes for the tables it created', async () => {
    /* A table nobody can scan is not much use on this page. */
    const service = makeService({
      importPosTables: vi.fn().mockResolvedValue(IMPORTED),
    });
    render(<ExperienceManagement restaurantId="r1" service={service} />);
    await userEvent.click(await screen.findByTestId('import-pos-tables-btn'));

    await waitFor(() =>
      expect(service.importPosTables).toHaveBeenCalledWith('r1'));
    await waitFor(() =>
      expect(service.generateQRCodes).toHaveBeenCalledWith('r1'));
  });

  it('does not regenerate QR codes when nothing was created', async () => {
    /* Regenerating rotates printed codes. Doing that on a no-op import
       would invalidate stickers already on tables. */
    const service = makeService({
      importPosTables: vi.fn().mockResolvedValue({
        ...IMPORTED, created: 0, adopted: 28,
      }),
    });
    render(<ExperienceManagement restaurantId="r1" service={service} />);
    await userEvent.click(await screen.findByTestId('import-pos-tables-btn'));

    await waitFor(() =>
      expect(service.importPosTables).toHaveBeenCalled());
    expect(service.generateQRCodes).not.toHaveBeenCalled();
  });

  it('reports the counts rather than a bare success', async () => {
    const service = makeService({
      importPosTables: vi.fn().mockResolvedValue(IMPORTED),
    });
    render(<ExperienceManagement restaurantId="r1" service={service} />);
    await userEvent.click(await screen.findByTestId('import-pos-tables-btn'));
    expect(await screen.findByText(/28 tables in the POS/)).toBeTruthy();
    expect(screen.getByText(/25 added/)).toBeTruthy();
  });

  it('is offered on the empty state, where it is needed most', async () => {
    /*
     * The toolbar carrying this button only renders once at least one table
     * exists — so a restaurant with NO tables, which is exactly the one that
     * wants to import a floor plan, could not see it at all.
     */
    const service = makeService({
      getTables: vi.fn().mockResolvedValue({ tables: [], count: 0 }),
      importPosTables: vi.fn().mockResolvedValue(IMPORTED),
    });
    render(<ExperienceManagement restaurantId="r1" service={service} />);
    await userEvent.click(
      await screen.findByTestId('import-pos-tables-empty-btn'));
    await waitFor(() =>
      expect(service.importPosTables).toHaveBeenCalledWith('r1'));
  });

  it('keeps the empty state clear of it for the owner portal', async () => {
    const service = makeService({
      getTables: vi.fn().mockResolvedValue({ tables: [], count: 0 }),
    });
    render(<ExperienceManagement restaurantId="r1" service={service} />);
    await screen.findByText(/No tables found/);
    expect(screen.queryByTestId('import-pos-tables-empty-btn')).toBeNull();
  });

  it('surfaces a failure instead of looking like it worked', async () => {
    const service = makeService({
      importPosTables: vi.fn().mockRejectedValue(new Error('pos_unreachable')),
    });
    render(<ExperienceManagement restaurantId="r1" service={service} />);
    await userEvent.click(await screen.findByTestId('import-pos-tables-btn'));
    expect(
      await screen.findByText(/Failed to import tables from the POS/),
    ).toBeTruthy();
  });
});
