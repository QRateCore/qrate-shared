'use client';

/**
 * Currency for shared components.
 *
 * The problem: shared components render money, but `packages/shared` has no
 * notion of the current restaurant — `currency_code` appears nowhere in
 * src/types. So every price in MenuBuilder and EditModal was written with a
 * hardcoded '$'. An INR restaurant reconciles rupees against a dollar sign.
 *
 * The consumer mounts <CurrencyProvider> once, high enough to cover the shared
 * tree, and feeds it the restaurant's currency_code / currency_locale.
 *
 * DEFAULTS TO USD ON PURPOSE. qrate-admin-webapp renders the same
 * MenuManagerClient and does not mount this provider; without a default it
 * would crash, and with a USD default it behaves exactly as it does today.
 * A missing provider is a silent no-op, never an error — this is presentation,
 * and a thrown error here would take out the whole menu editor.
 *
 * Deliberately NOT added to utils/currency.ts: that file is mirrored verbatim
 * into qrate-patron-webapp and a CI guard (scripts/check-currency-mirror.sh)
 * fails patron's build on any divergence. A .tsx file with a React import
 * could not live there regardless.
 */

import { createContext, useContext, useMemo, type ReactNode } from 'react';
import {
  DEFAULT_CURRENCY_CODE,
  getCurrencyConfig,
  formatMoney,
  type FormatMoneyOptions,
} from '../utils/currency';

interface CurrencyContextValue {
  /** ISO code, e.g. 'INR'. */
  code: string;
  /** BCP-47 locale, e.g. 'en-IN'. Null → the code's default locale. */
  locale: string | null;
}

const CurrencyContext = createContext<CurrencyContextValue>({
  code: DEFAULT_CURRENCY_CODE,
  locale: null,
});

export function CurrencyProvider({
  code,
  locale,
  children,
}: {
  code: string | null | undefined;
  locale?: string | null;
  children: ReactNode;
}) {
  const value = useMemo<CurrencyContextValue>(
    () => ({ code: code || DEFAULT_CURRENCY_CODE, locale: locale ?? null }),
    [code, locale],
  );
  return <CurrencyContext.Provider value={value}>{children}</CurrencyContext.Provider>;
}

/**
 * The bare symbol, for an input PREFIX or any place a formatted string is
 * wrong — e.g. the `<span>` sitting beside a price `<input>`. Returns '₹',
 * '$', 'CHF' and so on.
 */
export function useCurrencySymbol(): string {
  const { code } = useContext(CurrencyContext);
  return getCurrencyConfig(code).symbolPreview;
}

/**
 * Format a major-unit amount for display. Mirrors the owner app's
 * useFormatMoney so the two surfaces cannot drift.
 */
export function useFormatMoney(): (
  amount: number | string | null | undefined,
  options?: FormatMoneyOptions,
) => string {
  const { code, locale } = useContext(CurrencyContext);
  return useMemo(
    () => (amount, options) => formatMoney(amount, code, locale ?? undefined, options),
    [code, locale],
  );
}

/** The raw pair, for the rare component that needs to pass them onward. */
export function useCurrency(): CurrencyContextValue {
  return useContext(CurrencyContext);
}
