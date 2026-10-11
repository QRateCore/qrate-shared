// @vitest-environment jsdom
/**
 * Tables numbered 9900+ are E2E fixtures and are HIDDEN from the grid.
 *
 * The workspace rule is that every mutation spec must use that range, so a
 * test can never touch a real owner's table 1-15 (the 2026-03-24 image
 * deletion incident). Hiding them keeps a real owner's grid clean, including
 * whatever a crashed run left behind.
 *
 * But the E2E suite has to SEE its own tables, and since /owner/tables was
 * retired on 2026-10-10 this page is the only thing that lists them. Pointing
 * the suite here without an opt-in is what broke occupied-available (table
 * 9901), create-tables (9960+) and delete-table: they waited on cards the
 * grid had filtered out, so no selector fix could ever have made them pass.
 *
 * Hence showTestTables, default OFF. Both directions are pinned below —
 * a default that silently flipped to ON would show every owner the test
 * tables, which is the thing the filter exists to prevent.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import React from 'react';
import ExperienceManagement from '../ExperienceManagement';
import type { ExperienceService } from '../../../types/experience';

const real = {
  id: 't1', table_number: 7, table_label: null, is_active: true,
  qr_code_url: null, capacity: 4, print_gen: 1,
};
const fixture = {
  id: 't2', table_number: 9901, table_label: null, is_active: true,
  qr_code_url: null, capacity: 2, print_gen: 1,
};

function service() {
  return {
    getTables: vi.fn().mockResolvedValue({ tables: [real, fixture], count: 2 }),
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
  } as unknown as ExperienceService;
}

beforeEach(() => vi.clearAllMocks());
afterEach(() => cleanup());

describe('tables 9900+', () => {
  it('are hidden by default — what a real owner sees', async () => {
    render(<ExperienceManagement restaurantId="r1" service={service()} />);
    await screen.findByTestId('table-card-7');
    expect(screen.queryByTestId('table-card-9901')).toBeNull();
  });

  it('are shown when the caller opts in', async () => {
    render(<ExperienceManagement restaurantId="r1" service={service()} showTestTables />);
    await screen.findByTestId('table-card-9901');
    // The real table is still there — this widens the set, never replaces it.
    expect(screen.queryByTestId('table-card-7')).not.toBeNull();
  });

  it('defaults to hidden when the prop is passed explicitly false', async () => {
    render(<ExperienceManagement restaurantId="r1" service={service()} showTestTables={false} />);
    await screen.findByTestId('table-card-7');
    expect(screen.queryByTestId('table-card-9901')).toBeNull();
  });
});
