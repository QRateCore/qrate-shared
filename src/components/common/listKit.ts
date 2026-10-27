import type { HTMLAttributes, ReactNode } from 'react';

/**
 * The host app's own list + modal primitives, injected so a shared surface can
 * render in that app's house style without this package re-implementing it.
 *
 * The owner portal passes its Kar `DataTable` / `Drawer` / `ModalFooter` /
 * `StatusPill` (apps/owner/src/components/shared/kar) — the Devices table and
 * the right-hand drawer the Food Item editor uses — so Tables and Staff look
 * like every other owner list instead of a near-copy that drifts. Waiter and admin pass nothing and keep
 * the card layouts. The shapes below are the SUBSET of those components' props
 * that shared code relies on; the owner's components satisfy them structurally.
 */
export interface ListKitColumn<T> {
  key: string;
  header: ReactNode;
  /** CSS grid track, e.g. `minmax(200px,1.4fr)` or `110px`. */
  width: string;
  render: (row: T) => ReactNode;
  align?: 'left' | 'right' | 'center';
}

export interface ListKitTableProps<T> {
  columns: ListKitColumn<T>[];
  rows: T[];
  rowKey: (row: T) => string;
  onRowClick?: (row: T) => void;
  rowLabel?: (row: T) => string;
  rowProps?: (row: T) => HTMLAttributes<HTMLDivElement> & { [key: `data-${string}`]: string | undefined };
  isProblem?: (row: T) => boolean;
  minWidth?: number;
  empty?: ReactNode;
  testId?: string;
  ariaLabel?: string;
}

/** The detail surface a row opens — the owner passes a right-hand drawer. */
export interface ListKitDrawerProps {
  open: boolean;
  onClose: () => void;
  eyebrow?: ReactNode;
  title: ReactNode;
  titleAdornment?: ReactNode;
  sub?: ReactNode;
  children?: ReactNode;
  footer?: ReactNode;
  width?: number;
  testId?: string;
}

export interface ListKitDrawerFooterProps {
  dangerAction?: ReactNode;
  note?: ReactNode;
  children?: ReactNode;
}

export type ListKitTone = 'ok' | 'live' | 'warn' | 'bad' | 'tag';

export interface ListKitPillProps {
  tone?: ListKitTone;
  children: ReactNode;
  dot?: boolean;
  icon?: ReactNode;
  title?: string;
  testId?: string;
}

export interface ListKit {
  DataTable: <T>(props: ListKitTableProps<T>) => ReactNode;
  Drawer: (props: ListKitDrawerProps) => ReactNode;
  DrawerFooter: (props: ListKitDrawerFooterProps) => ReactNode;
  StatusPill: (props: ListKitPillProps) => ReactNode;
}
