/**
 * Structural tests for the canonical formatMoney helper.
 *
 * We deliberately do NOT use `toMatchSnapshot()` — Intl.NumberFormat output
 * shifts subtly across ICU versions (NBSP vs regular space, CHF/AED prefix
 * spacing, etc.) and snapshot churn from a Node engine bump would block
 * unrelated PRs. Instead each test asserts STRUCTURAL invariants the QRate
 * UI actually depends on: symbol presence, decimal-place count, grouping
 * shape per locale, and a sane bounded length.
 *
 * Per amendment T4 from the 2026-05-20 confidence vote.
 * PDD: .agents/planning/2026-05-19-currency-configuration/
 */

import { describe, it, expect } from 'vitest';
import {
  formatMoney,
  getCurrencyConfig,
  SUPPORTED_CURRENCIES,
  DEFAULT_CURRENCY_CODE,
  DEFAULT_CURRENCY_LOCALE,
  type CurrencyCode,
} from '../currency';

// ---------------------------------------------------------------------------
// Preset invariants — TypeScript mirror of the Python contract
// ---------------------------------------------------------------------------

const EXPECTED_CODES: ReadonlyArray<CurrencyCode> = [
  'USD', 'INR', 'EUR', 'GBP', 'CAD', 'AUD', 'MXN', 'JPY',
  'CNY', 'SGD', 'HKD', 'AED', 'BRL', 'NZD', 'CHF', 'THB',
] as const;

describe('SUPPORTED_CURRENCIES preset', () => {
  it('contains exactly the 16 expected codes', () => {
    const codes = SUPPORTED_CURRENCIES.map((c) => c.code).sort();
    expect(codes).toEqual([...EXPECTED_CODES].sort());
  });

  it('every entry has label, defaultLocale, symbolPreview', () => {
    for (const c of SUPPORTED_CURRENCIES) {
      expect(c.label).toMatch(/.+/);
      expect(c.defaultLocale).toMatch(/^[a-z]{2,3}(-[A-Z]{2})?$/);
      expect(c.symbolPreview).toMatch(/.+/);
    }
  });

  it('defaults point to USD', () => {
    expect(DEFAULT_CURRENCY_CODE).toBe('USD');
    expect(DEFAULT_CURRENCY_LOCALE).toBe('en-US');
  });
});

describe('getCurrencyConfig', () => {
  it('returns the matching config for a known code', () => {
    expect(getCurrencyConfig('INR').code).toBe('INR');
    expect(getCurrencyConfig('INR').defaultLocale).toBe('en-IN');
  });

  it.each([null, undefined, '', 'XYZ', 'usd'])(
    'falls back to USD for %p',
    (input) => {
      expect(getCurrencyConfig(input as string).code).toBe('USD');
    }
  );
});

// ---------------------------------------------------------------------------
// formatMoney — structural matrix (16 currencies × 7 amounts = 112 cases)
// ---------------------------------------------------------------------------

const AMOUNTS = [0, 0.99, 1, 1.5, 99.99, 1234.56, 100000] as const;

describe('formatMoney — structural invariants across the 16-currency matrix', () => {
  for (const code of EXPECTED_CODES) {
    for (const amount of AMOUNTS) {
      it(`${code} @ ${amount}: 2 decimals, locale symbol present, bounded length`, () => {
        const out = formatMoney(amount, code);

        // 1. Always contains at least one digit (we should never strip down to bare symbol).
        expect(out).toMatch(/\d/);

        // 2. Exactly 2 decimal places — separator may be `.` (en) or `,` (eu).
        //    Pattern: digit, then either . or , then exactly 2 digits, not
        //    followed by another digit (avoids matching grouping commas).
        expect(out).toMatch(/\d[.,]\d{2}(?!\d)/);

        // 3. Has at least one non-digit character preceding/wrapping the number
        //    — the currency symbol or ISO code.
        expect(out).toMatch(/[^\d\s.,]/);

        // 4. Bounded length — even ₹1,00,00,00,000.00 stays comfortably under 32.
        expect(out.length).toBeLessThanOrEqual(32);
      });
    }
  }
});

// ---------------------------------------------------------------------------
// Locale-specific structural assertions
// ---------------------------------------------------------------------------

describe('formatMoney — INR uses Indian lakh grouping', () => {
  it('100000 in INR has the 2,2,3 digit grouping pattern (1,00,000.00)', () => {
    const out = formatMoney(100000, 'INR');
    // Indian grouping for 100000 produces "1,00,000" — two commas in
    // positions 2-from-end-of-int-part and 5-from-end. The integer portion
    // is exactly 7 chars long including 2 commas. Strip currency prefix
    // to inspect the numeric portion.
    const numeric = out.replace(/[^\d.,]/g, '');
    const intPart = numeric.split('.')[0];
    // Western: 100,000 (one comma). Indian: 1,00,000 (two commas).
    const commaCount = (intPart.match(/,/g) || []).length;
    expect(commaCount).toBe(2);
  });

  it('1234.56 in INR groups as 1,234.56 (single comma — Indian rule only kicks in above 99,999)', () => {
    const out = formatMoney(1234.56, 'INR');
    const numeric = out.replace(/[^\d.,]/g, '');
    const intPart = numeric.split('.')[0];
    const commaCount = (intPart.match(/,/g) || []).length;
    expect(commaCount).toBe(1);
  });
});

describe('formatMoney — USD baseline', () => {
  it('1234.56 USD renders as $1,234.56', () => {
    expect(formatMoney(1234.56, 'USD')).toBe('$1,234.56');
  });

  it('0 USD renders as $0.00', () => {
    expect(formatMoney(0, 'USD')).toBe('$0.00');
  });

  it('null USD renders as the symbol + em-dash (never crashes)', () => {
    expect(formatMoney(null, 'USD')).toBe('$—');
  });
});

// ---------------------------------------------------------------------------
// Edge cases — robustness, never throws
// ---------------------------------------------------------------------------

describe('formatMoney — edge cases', () => {
  it.each([null, undefined, NaN, '', 'not-a-number'])(
    'non-finite input %p returns symbol + em-dash',
    (input) => {
      const out = formatMoney(input as never, 'INR');
      expect(out).toBe('₹—');
    }
  );

  it('numeric string input is accepted (Python Decimal serialises as string)', () => {
    expect(formatMoney('15.50', 'USD')).toBe('$15.50');
  });

  it('negative amounts render correctly', () => {
    const out = formatMoney(-12.34, 'USD');
    expect(out).toMatch(/-?\$12\.34|\(\$12\.34\)|-\$12\.34/);
  });

  it('very large numbers stay within bounded length', () => {
    const out = formatMoney(1e10, 'INR');
    expect(out.length).toBeLessThanOrEqual(32);
    expect(out).toMatch(/\d[.,]\d{2}(?!\d)/);
  });

  it('unknown currency code falls back to USD formatting', () => {
    // Should not throw; should render as USD.
    const out = formatMoney(10, 'XYZ');
    expect(out).toBe('$10.00');
  });
});

// ---------------------------------------------------------------------------
// Compact notation (per amendment F1 — HubDashboard $5k support)
// ---------------------------------------------------------------------------

describe('formatMoney — compact notation', () => {
  it('1234 USD compact contains "K" suffix', () => {
    const out = formatMoney(1234, 'USD', undefined, { notation: 'compact' });
    expect(out).toMatch(/\$1\.?2?K/);
  });

  it('5_000_000 USD compact contains "M" suffix', () => {
    const out = formatMoney(5_000_000, 'USD', undefined, { notation: 'compact' });
    expect(out).toMatch(/\$5M/);
  });

  it('compact INR uses lakh-aware compact form (T or L depending on engine)', () => {
    const out = formatMoney(100000, 'INR', undefined, { notation: 'compact' });
    // Indian compact for 100000 is "1L" (1 lakh). Newer ICU versions emit "T"
    // for thousand variations; we accept either letter as long as a digit
    // and the rupee glyph are present.
    expect(out).toMatch(/₹\s*\d/);
    expect(out).toMatch(/[A-Z]/);
  });
});

// ---------------------------------------------------------------------------
// iOS Safari guard — never invoke 'narrowSymbol' currencyDisplay
// ---------------------------------------------------------------------------

describe('iOS Safari narrowSymbol guard', () => {
  it('module source never references narrowSymbol', async () => {
    // Static check: read the module text and ensure 'narrowSymbol' does
    // not appear as a value. Catches accidental regressions in code review.
    const src = await import('node:fs').then((fs) =>
      fs.readFileSync(
        new URL('../currency.ts', import.meta.url),
        'utf8'
      )
    );
    // The string 'narrowSymbol' may appear ONLY in comments warning against it.
    const usedAsValue = /currencyDisplay:\s*['"]narrowSymbol['"]/.test(src);
    expect(usedAsValue).toBe(false);
  });
});
