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
import TableCard from '../TableCard';

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

const props = {
  activity: null,
  onSelect: vi.fn(),
} as never;

describe('POS origin on a table', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.matchMedia = vi.fn().mockImplementation((q) => ({
      matches: false, media: q, addEventListener: vi.fn(),
      removeEventListener: vi.fn(), addListener: vi.fn(), removeListener: vi.fn(),
    })) as unknown as typeof window.matchMedia;
  });
  afterEach(cleanup);

  it('marks a table that came from the POS', () => {
    render(<TableCard {...props} table={table({ pos_linked: true })} />);
    expect(screen.queryByTestId('table-pos-badge-14')).not.toBeNull();
  });

  it('leaves a manually created table unmarked', () => {
    /* The absence IS the signal — a badge on everything says nothing. */
    render(<TableCard {...props} table={table({ pos_linked: false })} />);
    expect(screen.queryByTestId('table-pos-badge-14')).toBeNull();
  });

  it('treats a table with no POS field as manual', () => {
    // Older payloads, and every restaurant that never imported.
    render(<TableCard {...props} table={table()} />);
    expect(screen.queryByTestId('table-pos-badge-14')).toBeNull();
  });

  it('shows the POS name, which is not always the number', () => {
    /*
     * "Bar 1" is stored under a synthetic number because table_number is an
     * INTEGER. Showing 901 alone would name a table the restaurant does not
     * have.
     */
    render(<TableCard {...props} table={table({
      table_number: 901, pos_linked: true, pos_table_name: 'Bar 1',
    })} />);
    expect(screen.getByText('Bar 1')).toBeTruthy();
  });

  it('explains what the badge means rather than just colouring it', () => {
    render(<TableCard {...props} table={table({
      pos_linked: true, pos_table_name: 'Bar 1',
    })} />);
    const badge = screen.getByTestId('table-pos-badge-14');
    expect(badge.getAttribute('title')).toMatch(/managed there, not here/);
    expect(badge.getAttribute('title')).toMatch(/Bar 1/);
  });

  it('still shows a manual label when there is no POS name', () => {
    render(<TableCard {...props} table={table({ table_label: 'Window seat' })} />);
    expect(screen.getByText('Window seat')).toBeTruthy();
  });
});
