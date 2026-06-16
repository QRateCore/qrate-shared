import { describe, it, expect } from 'vitest';

import { buildBulkServingOptions, type ServingBulkRow } from '../BulkActionsPanel';

/**
 * Bulk wine serving sizes (PDD 2026-06-15). buildBulkServingOptions converts
 * the bulk editor rows into the serving_options payload applied to every
 * selected wine. Mirrors the backend normalize_serving_options contract.
 */

const row = (p: Partial<ServingBulkRow>): ServingBulkRow => ({ label: '', volume_ml: '', price: '', is_default: false, ...p });

describe('buildBulkServingOptions', () => {
  it('converts dollars to price_cents and keeps order', () => {
    const out = buildBulkServingOptions([
      row({ label: 'Glass', volume_ml: '175', price: '12', is_default: true }),
      row({ label: 'Bottle', volume_ml: '750', price: '50' }),
    ]);
    expect(out).toEqual([
      { id: 'glass', label: 'Glass', price_cents: 1200, is_default: true, volume_ml: 175 },
      { id: 'bottle', label: 'Bottle', price_cents: 5000, is_default: false, volume_ml: 750 },
    ]);
  });

  it('handles cents correctly (12.50 → 1250)', () => {
    expect(buildBulkServingOptions([row({ label: 'Glass', price: '12.50' })])[0].price_cents).toBe(1250);
  });

  it('forces exactly one default — first flagged wins', () => {
    const out = buildBulkServingOptions([
      row({ label: 'Glass', price: '12', is_default: true }),
      row({ label: 'Bottle', price: '50', is_default: true }),
    ]);
    expect(out.map((o) => o.is_default)).toEqual([true, false]);
  });

  it('defaults the first row when none flagged', () => {
    const out = buildBulkServingOptions([row({ label: 'Glass', price: '12' }), row({ label: 'Bottle', price: '50' })]);
    expect(out[0].is_default).toBe(true);
  });

  it('drops rows missing a label or with a bad price', () => {
    const out = buildBulkServingOptions([
      row({ label: 'Glass', price: '12' }),
      row({ label: '', price: '8' }),       // no label
      row({ label: 'Free', price: '-1' }),  // negative
      row({ label: 'NaN', price: 'abc' }),  // non-numeric
    ]);
    expect(out.map((o) => o.label)).toEqual(['Glass']);
  });

  it('slug-dedupes colliding labels', () => {
    const out = buildBulkServingOptions([row({ label: 'Glass', price: '12' }), row({ label: 'Glass', price: '14' })]);
    expect(out.map((o) => o.id)).toEqual(['glass', 'glass-2']);
  });

  it('all-empty editor clears serving sizes ([])', () => {
    expect(buildBulkServingOptions([row({}), row({})])).toEqual([]);
  });

  it('throws when rows have input but none are valid (avoids accidental clear)', () => {
    expect(() => buildBulkServingOptions([row({ label: 'Glass', price: '' })])).toThrow();
  });

  it('omits volume_ml when not a positive int', () => {
    expect(buildBulkServingOptions([row({ label: 'Glass', price: '12', volume_ml: '0' })])[0]).not.toHaveProperty('volume_ml');
  });
});
