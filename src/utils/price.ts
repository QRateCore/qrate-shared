/**
 * Parsing for owner-entered price fields.
 *
 * The problem this solves: a bare `Number(text)` turns "1,200" into NaN, and
 * every call site then mapped the non-finite result to `null` and carried on —
 * PATCHing the price away while the UI reported success. `parseFloat` is worse
 * still: it reads "1,200" as **1**, so the dish silently costs one rupee
 * instead of twelve hundred. An Indian menu invites exactly that input.
 *
 * Rules:
 * - An empty field is the ONLY input that yields `null`. Null means "no price
 *   set" — on a per-menu placement it means "charge the dish's own price".
 * - Commas are digit GROUPING separators and must form a valid group pattern:
 *   en-US "1,200" / "12,345,678" and en-IN "1,20,000" are accepted.
 * - "12,50" is REJECTED rather than guessed. It is either a typo or the
 *   European decimal comma; reading it as 1250 is a 100x overcharge and
 *   reading it as 12.5 is wrong for the 15 of 16 supported locales that use a
 *   dot decimal. A visible error is the only safe answer.
 * - A leading currency symbol and surrounding spaces are ignored.
 * - Anything else that is not a non-negative number is an error the owner must
 *   SEE. Never fall back to null — that is how a price disappears.
 *
 * Deliberately NOT enforced here: an upper bound. A 10,000 cap exists on the
 * food-items backend route and in one branch of EditModal, but it is
 * currency-blind — ₹10,000 is roughly $120, so capping here would reject
 * ordinary Indian prices. That is tracked as its own defect (STR-1277) and
 * must be fixed per-currency, not by hardcoding a limit into the parser.
 */

export type PriceParse =
  | { ok: true; value: number | null }
  | { ok: false; error: string };

const CURRENCY_PREFIX = /^[$₹€£¥]\s*/;

/** A plain, ungrouped number: 1200, 12.50, .5 */
const PLAIN_NUMBER = /^\d+(\.\d+)?$|^\.\d+$/;

/**
 * A validly grouped integer part, optionally followed by a dot decimal.
 *   en-US  1,200 · 12,345,678
 *   en-IN  1,20,000 · 12,34,567
 * Rejects 12,50 · 1,20 · 10,00 · 1,2345 — the shapes that are a typo or a
 * European decimal comma rather than grouping.
 */
const GROUPED_NUMBER =
  /^(?:\d{1,3}(?:,\d{3})+|\d{1,2}(?:,\d{2})*,\d{3})(?:\.\d+)?$/;

export const PRICE_FORMAT_ERROR =
  'Enter the price as a number, like 1200 or 1,200.50.';
export const PRICE_NEGATIVE_ERROR = 'Price cannot be negative.';
export const PRICE_REQUIRED_ERROR = 'Enter a price.';

export function parsePriceInput(
  raw: string,
  opts?: { required?: boolean },
): PriceParse {
  const trimmed = (raw ?? '').trim();

  if (trimmed === '') {
    return opts?.required
      ? { ok: false, error: PRICE_REQUIRED_ERROR }
      : { ok: true, value: null };
  }

  const withoutSymbol = trimmed.replace(CURRENCY_PREFIX, '').replace(/\s/g, '');

  if (withoutSymbol.startsWith('-')) {
    return { ok: false, error: PRICE_NEGATIVE_ERROR };
  }

  let normalized: string;
  if (PLAIN_NUMBER.test(withoutSymbol)) {
    normalized = withoutSymbol;
  } else if (GROUPED_NUMBER.test(withoutSymbol)) {
    normalized = withoutSymbol.replace(/,/g, '');
  } else {
    return { ok: false, error: PRICE_FORMAT_ERROR };
  }

  const value = Number(normalized);
  if (!Number.isFinite(value)) {
    return { ok: false, error: PRICE_FORMAT_ERROR };
  }
  return { ok: true, value };
}
