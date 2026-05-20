/**
 * Canonical currency lookup + formatter for QRate (TypeScript).
 *
 * This is the canonical copy. It is mirrored verbatim to:
 *   - qrate-patron-webapp/src/lib/utils/currency.ts  (patron-webapp does not
 *     consume @qrate/shared since it is a separate repo).
 *
 * A CI sync guard (scripts/check-currency-mirror.sh, invoked from
 * qrate-patron-webapp/.github/workflows/ci.yml) diffs the two copies and
 * fails on divergence — same pattern as qrate-core's db_utils.py 3-copy guard.
 *
 * The 16-entry preset matches the Python SUPPORTED_CURRENCIES in
 * qrate-core/layers/database/python/currencies.py. The two must stay in sync.
 *
 * Always uses Intl.NumberFormat's `currencyDisplay: 'symbol'` — NEVER
 * `'narrowSymbol'`, which throws RangeError on iOS Safari.
 * Ref: https://github.com/mdn/browser-compat-data/issues/8985
 *
 * PDD: .agents/planning/2026-05-19-currency-configuration/
 */

export type CurrencyCode =
  | 'USD' | 'INR' | 'EUR' | 'GBP' | 'CAD' | 'AUD' | 'MXN' | 'JPY'
  | 'CNY' | 'SGD' | 'HKD' | 'AED' | 'BRL' | 'NZD' | 'CHF' | 'THB';

export interface CurrencyConfig {
  /** ISO 4217 three-letter code. */
  code: CurrencyCode;
  /** Human-readable for the admin BrandInfoTab dropdown. */
  label: string;
  /** BCP-47 locale paired with this currency for `Intl.NumberFormat`. */
  defaultLocale: string;
  /** Symbol shown in dropdown previews (the actual display symbol comes
   *  from `Intl.NumberFormat`, which may render slightly differently). */
  symbolPreview: string;
}

export const SUPPORTED_CURRENCIES: readonly CurrencyConfig[] = [
  { code: 'USD', label: 'US Dollar (USD)',         defaultLocale: 'en-US', symbolPreview: '$' },
  { code: 'INR', label: 'Indian Rupee (INR)',      defaultLocale: 'en-IN', symbolPreview: '₹' },
  { code: 'EUR', label: 'Euro (EUR)',              defaultLocale: 'en-IE', symbolPreview: '€' },
  { code: 'GBP', label: 'British Pound (GBP)',     defaultLocale: 'en-GB', symbolPreview: '£' },
  { code: 'CAD', label: 'Canadian Dollar (CAD)',   defaultLocale: 'en-CA', symbolPreview: 'CA$' },
  { code: 'AUD', label: 'Australian Dollar (AUD)', defaultLocale: 'en-AU', symbolPreview: 'A$' },
  { code: 'MXN', label: 'Mexican Peso (MXN)',      defaultLocale: 'es-MX', symbolPreview: 'MX$' },
  { code: 'JPY', label: 'Japanese Yen (JPY)',      defaultLocale: 'ja-JP', symbolPreview: '¥' },
  { code: 'CNY', label: 'Chinese Yuan (CNY)',      defaultLocale: 'zh-CN', symbolPreview: 'CN¥' },
  { code: 'SGD', label: 'Singapore Dollar (SGD)',  defaultLocale: 'en-SG', symbolPreview: 'S$' },
  { code: 'HKD', label: 'Hong Kong Dollar (HKD)',  defaultLocale: 'en-HK', symbolPreview: 'HK$' },
  { code: 'AED', label: 'UAE Dirham (AED)',        defaultLocale: 'en-AE', symbolPreview: 'AED' },
  { code: 'BRL', label: 'Brazilian Real (BRL)',    defaultLocale: 'pt-BR', symbolPreview: 'R$' },
  { code: 'NZD', label: 'New Zealand Dollar (NZD)',defaultLocale: 'en-NZ', symbolPreview: 'NZ$' },
  { code: 'CHF', label: 'Swiss Franc (CHF)',       defaultLocale: 'de-CH', symbolPreview: 'CHF' },
  { code: 'THB', label: 'Thai Baht (THB)',         defaultLocale: 'th-TH', symbolPreview: '฿' },
] as const;

export const DEFAULT_CURRENCY_CODE: CurrencyCode = 'USD';
export const DEFAULT_CURRENCY_LOCALE = 'en-US';

const _BY_CODE: Map<string, CurrencyConfig> = new Map(
  SUPPORTED_CURRENCIES.map((c) => [c.code, c])
);

/** Return the config for `code`, or the USD default for unknown / missing. */
export function getCurrencyConfig(code: string | null | undefined): CurrencyConfig {
  if (code && _BY_CODE.has(code)) return _BY_CODE.get(code)!;
  return _BY_CODE.get(DEFAULT_CURRENCY_CODE)!;
}

export interface FormatMoneyOptions {
  /**
   * `'standard'` (default) → full thousands grouping (`$1,234.56`).
   * `'compact'` → `Intl.NumberFormat`'s compact display (`$1.2K` / `₹1.2L`).
   * Used by HubDashboard KPI tiles to keep the display narrow.
   */
  notation?: 'standard' | 'compact';
}

/**
 * Format a monetary amount as a localized currency string.
 *
 * Accepts numbers, numeric strings (Python `Decimal` serialises as strings),
 * `null`, and `undefined`. Returns the symbol followed by an em-dash for
 * null/NaN inputs so the layout never collapses.
 *
 * Always 2 decimal places (matches `Intl.NumberFormat` default; preserves
 * cents-equivalent precision for taxes, totals, modifier add-ons, splits).
 */
export function formatMoney(
  amount: number | string | null | undefined,
  currencyCode: string = DEFAULT_CURRENCY_CODE,
  locale?: string,
  options: FormatMoneyOptions = {},
): string {
  const cfg = getCurrencyConfig(currencyCode);
  // Treat null/undefined AND empty/whitespace-only strings as "no value" so
  // backend NULLs (which sometimes round-trip as '') don't render as 0.00.
  const isBlankString = typeof amount === 'string' && amount.trim() === '';
  const n = amount == null || isBlankString ? NaN : Number(amount);
  if (!Number.isFinite(n)) return `${cfg.symbolPreview}—`;

  const notation = options.notation ?? 'standard';

  try {
    return new Intl.NumberFormat(locale ?? cfg.defaultLocale, {
      style: 'currency',
      currency: cfg.code,
      minimumFractionDigits: notation === 'compact' ? 0 : 2,
      maximumFractionDigits: notation === 'compact' ? 1 : 2,
      // NEVER 'narrowSymbol' — throws RangeError on iOS Safari.
      currencyDisplay: 'symbol',
      ...(notation === 'compact'
        ? { notation: 'compact' as const, compactDisplay: 'short' as const }
        : {}),
    }).format(n);
  } catch {
    // Defensive fallback: malformed locale on a very old engine.
    return `${cfg.symbolPreview}${n.toFixed(notation === 'compact' ? 0 : 2)}`;
  }
}
