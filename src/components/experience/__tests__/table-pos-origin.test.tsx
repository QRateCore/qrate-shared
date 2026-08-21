// @vitest-environment jsdom
/**
 * Telling a POS-imported table from a manually created one.
 *
 * The distinction has consequences an operator should see BEFORE acting:
 * an imported table's name belongs to the POS, so renaming it here does not
 * rename it there and the next import restores the POS name; and its POS
 * identity is what lets a diner's order join that table's tab, which a
 * manual table can never do.
 *
 * The badge is therefore on the table itself, not in a legend somewhere.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import React from 'react';
import ExperienceManagement from '../ExperienceManagement';

function table(overrides = {}) {
  return {
    id: 't1',
    restaurant_id: 'r1',
    table_number: 14,
    table_label: null,
    qr_code_url: null,
    is_active: true,
    capacity: 4,
    print_gen: 1,
    ...overrides,
  } as never;
}

/**
 * Rendered through ExperienceManagement, NOT TableCard.
 *
 * The first version of this test drove TableCard directly. It passed, and the
 * badge never appeared on the page — because ExperienceManagement builds its
 * table cards inline and does not use TableCard at all. Testing the component
 * a page does not render proves nothing about the page.
 */
function makeService(tables) {
  return {
    getTables: vi.fn().mockResolvedValue({ tables, count: tables.length }),
    createTables: vi.fn(),
    updateTable: vi.fn(),
    generateQRCodes: vi.fn().mockResolvedValue({ tables: [], message: 'ok' }),
    downloadQRCodesZip: vi.fn(),
    getStaff: vi.fn().mockResolvedValue({ staff: [], count: 0 }),
    createStaff: vi.fn(),
    updateStaff: vi.fn(),
    getWaiterCalls: vi.fn().mockResolvedValue([]),
    acknowledgeWaiterCall: vi.fn(),
    getTableActivity: vi.fn().mockResolvedValue({ tables: [] }),
    getOrders: vi.fn().mockResolvedValue({ orders: [], total: 0 }),
    getMenuBoosts: vi.fn().mockResolvedValue({ items: [] }),
    updateMenuBoosts: vi.fn(),
  } as never;
}

const renderTables = (tables) =>
  render(<ExperienceManagement restaurantId="r1" service={makeService(tables)} />);

describe('POS origin on a table', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.matchMedia = vi.fn().mockImplementation((q) => ({
      matches: false, media: q, addEventListener: vi.fn(),
      removeEventListener: vi.fn(), addListener: vi.fn(), removeListener: vi.fn(),
    })) as unknown as typeof window.matchMedia;
  });
  afterEach(cleanup);

  it('marks a table that came from the POS', async () => {
    renderTables([table({ pos_linked: true })]);
    await screen.findByText('Table 14');
    expect(screen.queryByTestId('table-pos-badge-14')).not.toBeNull();
  });

  it('leaves a manually created table unmarked', async () => {
    /* The absence IS the signal — a badge on everything says nothing. */
    renderTables([table({ pos_linked: false })]);
    await screen.findByText('Table 14');
    expect(screen.queryByTestId('table-pos-badge-14')).toBeNull();
  });

  it('treats a table with no POS field as manual', async () => {
    // Older payloads, and every restaurant that never imported.
    renderTables([table()]);
    await screen.findByText('Table 14');
    expect(screen.queryByTestId('table-pos-badge-14')).toBeNull();
  });

  it('shows the POS name, which is not always the number', async () => {
    /*
     * "Bar 1" is stored under a synthetic number because table_number is an
     * INTEGER. Showing 901 alone would name a table the restaurant does not
     * have.
     */
    renderTables([table({
      table_number: 901, pos_linked: true, pos_table_name: 'Bar 1',
    })]);
    await screen.findByText('Table 901');
    expect(screen.getByText('Bar 1')).toBeTruthy();
  });

  it('explains what the badge means rather than just colouring it', async () => {
    renderTables([table({ pos_linked: true, pos_table_name: 'Bar 1' })]);
    await screen.findByText('Table 14');
    const badge = screen.getByTestId('table-pos-badge-14');
    expect(badge.getAttribute('title')).toMatch(/managed there, not here/);
    expect(badge.getAttribute('title')).toMatch(/Bar 1/);
  });

  it('does not invent a name for a manual table', async () => {
    /*
     * The page shows "Table N" and nothing else for a manual table — it has
     * never rendered `table_label`. Asserting otherwise was a leftover from
     * testing TableCard, which does. Recorded here so the difference is
     * deliberate rather than rediscovered.
     */
    renderTables([table({ table_label: 'Window seat' })]);
    await screen.findByText('Table 14');
    expect(screen.queryByTestId('table-pos-badge-14')).toBeNull();
  });
});
