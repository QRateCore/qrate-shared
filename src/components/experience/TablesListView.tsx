'use client';

import { useEffect, useState, type ReactNode } from 'react';
import { BellRing, AlertTriangle, Check, Cylinder, Loader2, RefreshCw, ScanLine } from 'lucide-react';
import type {
  RestaurantTable, StaffMember, TableActivity, TableActivityEntry, TablePlacedOrder, WaiterCall, ExperienceTableDevice,
} from '../../types/experience';
import type { ListKit, ListKitColumn, ListKitTone } from '../common/listKit';
import Select from '../common/Select';
import { STATUS_DISPLAY } from '../../utils/order-status-display';
import { timeSince, callTypeLabel, shortCallLabel } from './table-utils';

/**
 * Tables as one-line rows in the host app's house table (owner: the Kar
 * DataTable the Devices page uses). A row opens that table's right-hand
 * drawer (owner: the Food Item editor's drawer geometry), which holds the live
 * orders and calls plus every control the card carried — server, seats,
 * section, label, activate, QR, delete / reset.
 *
 * The row itself carries the at-a-glance signals: when someone last SCANNED
 * the table, and a bubble per open service call.
 *
 * Testids are the card's, on purpose: `table-card-N` is the ROW and
 * `table-device-paired-N` / `table-status-N` / `table-pos-badge-N` sit inside
 * it (the table-device-onboarding canary asserts exactly that pair), and the
 * edit controls keep theirs inside the drawer.
 */

/** null CLEARS a field server-side (label, section, server). */
export interface TableUpdate {
  capacity?: number;
  assigned_server_id?: string | null;
  table_section?: string | null;
  table_label?: string | null;
}

export interface TablesListViewProps {
  kit: ListKit;
  tables: RestaurantTable[];
  staff: StaffMember[];
  tableActivity: TableActivity | null;
  waiterCalls: WaiterCall[];
  devicesByTable: Record<string, ExperienceTableDevice>;
  deviceIsFresh: (d: ExperienceTableDevice) => boolean;
  /** Persist one field; resolves true when saved. */
  onUpdate: (table: RestaurantTable, patch: TableUpdate) => Promise<boolean>;
  onAcknowledgeCall: (callId: string) => void;
  onToggleActive: (table: RestaurantTable) => void;
  togglingActive: Record<string, boolean>;
  /** Present only when the consumer can do it; each opens the existing confirm. */
  onAskRotateQr?: (table: RestaurantTable) => void;
  rotatingQrId?: string | null;
  onAskDelete?: (table: RestaurantTable) => void;
  onResetTable?: (table: RestaurantTable) => void;
  /** Told when a drawer opens / closes, so the host can poll faster while one is open. */
  onDrawerOpenChange?: (open: boolean) => void;
}

const LIVE = (c: WaiterCall) => c.status === 'active' || c.status === 'overdue';

/** A scan this recent shows as a live "Just scanned" pill rather than a time. */
export const FRESH_SCAN_MS = 2 * 60 * 1000;

/** Newest guest scan / join on the table, or null. */
export function lastScanAt(a: TableActivityEntry | null): string | null {
  if (!a) return null;
  let best: string | null = null;
  for (const g of a.guests) {
    if (g.joined_at && (!best || new Date(g.joined_at).getTime() > new Date(best).getTime())) best = g.joined_at;
  }
  return best;
}

const ORDER_TONE: Record<string, ListKitTone> = {
  placed: 'warn', pending: 'warn',
  confirmed: 'live', preparing: 'live',
  ready: 'ok',
  delivered: 'tag', completed: 'tag',
  cancelled: 'bad', issue: 'bad',
};
const orderLabel = (status: string) => STATUS_DISPLAY[status]?.label ?? status;
const money = (n: number) => `$${(Number(n) || 0).toFixed(2)}`;
const orderTotal = (o: TablePlacedOrder) => o.active_total ?? o.total_amount;

export default function TablesListView(props: TablesListViewProps) {
  const { kit, tables, staff, tableActivity, waiterCalls, devicesByTable, deviceIsFresh, onDrawerOpenChange } = props;
  const { DataTable, StatusPill } = kit;
  const [openId, setOpenId] = useState<string | null>(null);
  // Re-render the relative times ("2m ago", "Just scanned") between polls.
  const [, setNow] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setNow(n => n + 1), 30_000);
    return () => clearInterval(t);
  }, []);
  useEffect(() => { onDrawerOpenChange?.(openId !== null); }, [openId, onDrawerOpenChange]);

  const activityOf = (t: RestaurantTable) =>
    tableActivity?.tables?.find(a => a.table_number === t.table_number) ?? null;
  const callsOf = (t: RestaurantTable) =>
    waiterCalls.filter(c => c.table_number === t.table_number && LIVE(c));
  const serverOf = (t: RestaurantTable) =>
    t.assigned_server_id ? staff.find(s => s.id === t.assigned_server_id)?.name ?? null : null;
  const dash = <span className="text-ink-faint">—</span>;

  const columns: ListKitColumn<RestaurantTable>[] = [
    {
      key: 'table',
      header: 'Table',
      width: 'minmax(150px,1.2fr)',
      render: (t) => (
        <span className="flex items-baseline gap-2 min-w-0 overflow-hidden">
          <span className="font-semibold flex-shrink-0">Table {t.table_number}</span>
          {t.pos_linked && (
            <span
              data-testid={`table-pos-badge-${t.table_number}`}
              title={`From the POS floor plan${t.pos_table_name ? ` — "${t.pos_table_name}"` : ''}. Its name is managed there, not here.`}
              className="self-center text-[10px] font-semibold uppercase tracking-wide text-ink-soft border border-line rounded px-1 leading-4 flex-shrink-0"
            >
              POS
            </span>
          )}
          {(t.table_label || (t.pos_table_name && t.pos_table_name !== String(t.table_number))) && (
            <span className="text-[13px] text-ink-soft overflow-hidden text-ellipsis">
              {t.table_label || t.pos_table_name}
            </span>
          )}
        </span>
      ),
    },
    {
      key: 'status',
      header: 'Status',
      width: '112px',
      render: (t) => {
        const occupied = activityOf(t)?.has_active_session === true;
        if (!t.is_active) return <StatusPill tone="tag" testId={`table-status-${t.table_number}`}>Inactive</StatusPill>;
        return occupied
          ? <StatusPill tone="live" dot testId={`table-status-${t.table_number}`}>Occupied</StatusPill>
          : <StatusPill tone="ok" dot testId={`table-status-${t.table_number}`}>Available</StatusPill>;
      },
    },
    {
      key: 'scan',
      header: 'Last scan',
      width: '124px',
      render: (t) => {
        const at = lastScanAt(activityOf(t));
        if (!at) return dash;
        const fresh = Date.now() - new Date(at).getTime() < FRESH_SCAN_MS;
        const when = new Date(at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
        return fresh ? (
          <StatusPill tone="live" icon={<ScanLine size={12} aria-hidden="true" />} title={`Scanned at ${when}`}
            testId={`table-scan-${t.table_number}`}>
            Just scanned
          </StatusPill>
        ) : (
          <span className="inline-flex items-center gap-1.5 text-ink-soft" title={`Scanned at ${when}`}
            data-testid={`table-scan-${t.table_number}`}>
            <ScanLine size={13} aria-hidden="true" />{timeSince(at)}
          </span>
        );
      },
    },
    {
      key: 'calls',
      header: 'Service calls',
      width: 'minmax(170px,1.3fr)',
      render: (t) => {
        const calls = callsOf(t);
        if (calls.length === 0) return dash;
        const shown = calls.slice(0, 2);
        return (
          <span className="flex items-center gap-1 min-w-0 overflow-hidden" data-testid={`table-calls-${t.table_number}`}>
            {shown.map(c => (
              <StatusPill key={c.id} tone={c.status === 'overdue' ? 'bad' : 'warn'}
                icon={c.status === 'overdue' ? <AlertTriangle size={12} aria-hidden="true" /> : <BellRing size={12} aria-hidden="true" />}
                title={`${callTypeLabel(c.call_type ?? '')} · ${timeSince(c.created_at)}`}
                testId={`table-call-bubble-${t.table_number}`}>
                {shortCallLabel(c.call_type ?? '')}
              </StatusPill>
            ))}
            {calls.length > shown.length && (
              <span className="text-xs font-semibold text-ink-soft">+{calls.length - shown.length}</span>
            )}
          </span>
        );
      },
    },
    {
      key: 'guests',
      header: 'Guests',
      width: '68px',
      align: 'center',
      render: (t) => {
        const a = activityOf(t);
        return a?.has_active_session ? <span className="tabular-nums">{a.guests.length}</span> : dash;
      },
    },
    {
      key: 'orders',
      header: 'Orders',
      width: '110px',
      render: (t) => {
        const orders = (activityOf(t)?.placed_orders ?? []).filter(o => o.status !== 'cancelled');
        if (orders.length === 0) return dash;
        const total = orders.reduce((s, o) => s + orderTotal(o), 0);
        return (
          <span className="tabular-nums" data-testid={`table-orders-${t.table_number}`}>
            {orders.length} · <span className="text-ink-soft">{money(total)}</span>
          </span>
        );
      },
    },
    { key: 'server', header: 'Server', width: 'minmax(100px,0.9fr)', render: (t) => serverOf(t) ?? dash },
    {
      key: 'seats',
      header: 'Seats',
      width: '60px',
      align: 'center',
      render: (t) => (t.capacity ? <span className="tabular-nums">{t.capacity}</span> : dash),
    },
    { key: 'section', header: 'Section', width: 'minmax(80px,0.7fr)', render: (t) => t.table_section || dash },
    {
      key: 'device',
      header: 'Device',
      width: '64px',
      render: (t) => {
        const d = devicesByTable[t.id];
        if (!d) return dash;
        const fresh = deviceIsFresh(d);
        return (
          <span
            data-testid={`table-device-paired-${t.table_number}`}
            title={fresh ? `Device paired — ${d.name}` : `Device paired but not seen recently — ${d.name}`}
            className={`inline-flex items-center ${fresh ? 'text-ok' : 'text-warn'}`}
          >
            <Cylinder size={14} aria-label={fresh ? 'Device online' : 'Device not seen recently'} />
          </span>
        );
      },
    },
  ];

  const open = tables.find(t => t.id === openId) ?? null;

  return (
    <>
      <DataTable
        columns={columns}
        rows={tables}
        rowKey={(t) => t.id}
        onRowClick={(t) => setOpenId(t.id)}
        rowLabel={(t) => `Table ${t.table_number}`}
        rowProps={(t) => ({
          'data-testid': `table-card-${t.table_number}`,
          className: t.is_active ? undefined : 'opacity-60',
        })}
        isProblem={(t) => callsOf(t).length > 0}
        minWidth={1000}
        testId="tables-list"
        ariaLabel="Tables"
      />
      {open && (
        <TableDrawer
          {...props}
          table={open}
          activity={activityOf(open)}
          calls={callsOf(open)}
          onClose={() => setOpenId(null)}
        />
      )}
    </>
  );
}

function TableDrawer({
  kit, table, staff, tables, activity, calls, onClose, onUpdate, onAcknowledgeCall, onToggleActive,
  togglingActive, onAskRotateQr, rotatingQrId, onAskDelete, onResetTable,
}: TablesListViewProps & {
  table: RestaurantTable;
  activity: TableActivityEntry | null;
  calls: WaiterCall[];
  onClose: () => void;
}) {
  const { Drawer, DrawerFooter, StatusPill } = kit;
  const n = table.table_number;
  const occupied = activity?.has_active_session === true;

  // Drafts are local to the open drawer and re-seed when the row changes
  // underneath (a poll, or a save landing).
  const [seats, setSeats] = useState(String(table.capacity ?? 0));
  const [section, setSection] = useState(table.table_section || '');
  const [label, setLabel] = useState(table.table_label || '');
  const [saving, setSaving] = useState<string | null>(null);
  useEffect(() => { setSeats(String(table.capacity ?? 0)); }, [table.capacity]);
  useEffect(() => { setSection(table.table_section || ''); }, [table.table_section]);
  useEffect(() => { setLabel(table.table_label || ''); }, [table.table_label]);

  const save = async (field: string, patch: TableUpdate) => {
    setSaving(field);
    try { await onUpdate(table, patch); } finally { setSaving(null); }
  };

  const seatsNum = parseInt(seats, 10);
  const seatsDirty = !isNaN(seatsNum) && seatsNum >= 0 && seatsNum !== (table.capacity ?? 0);
  const sectionDirty = section !== (table.table_section || '');
  const labelDirty = label !== (table.table_label || '');
  const sections = Array.from(new Set(tables.map(t => t.table_section).filter(Boolean))) as string[];

  const btn = 'inline-flex items-center justify-center gap-1.5 min-h-10 px-4 rounded-ctl text-sm font-semibold whitespace-nowrap disabled:opacity-40 disabled:cursor-not-allowed';
  const primary = `${btn} bg-ink text-on-ink border border-ink hover:bg-ink-hover`;
  const secondary = `${btn} bg-surface text-ink border border-ink hover:bg-surface2`;
  const input = 'min-w-0 flex-1 h-10 px-3 rounded-field border border-line-input bg-surface text-sm text-ink focus:outline-none focus:border-ink';
  const saveBtn = (field: string, testId: string | undefined, onClick: () => void) => (
    <button type="button" onClick={onClick} disabled={saving === field} data-testid={testId}
      className={`${primary} min-h-10 px-3`}>
      {saving === field ? <Loader2 size={14} className="animate-spin" /> : 'Save'}
    </button>
  );

  const field = (title: string, control: ReactNode) => (
    <div className="grid grid-cols-[110px_1fr] items-center gap-3 py-2">
      <span className="text-[13px] font-semibold text-ink-label">{title}</span>
      <div className="flex items-center gap-2 min-w-0">{control}</div>
    </div>
  );

  const sectionHead = (title: ReactNode, right?: ReactNode) => (
    <div className="mt-5 mb-1 flex items-center justify-between gap-3">
      <h3 className="m-0 text-[11px] font-semibold uppercase tracking-[.06em] text-ink-soft">{title}</h3>
      {right}
    </div>
  );

  // Newest first — the owner opens a busy table to see what just came in.
  const orders = [...(activity?.placed_orders ?? [])]
    .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
  const carts = (activity?.active_carts ?? []).filter(c => c.items.length > 0);
  const liveTotal = orders.filter(o => o.status !== 'cancelled').reduce((s, o) => s + orderTotal(o), 0);
  const scannedAt = lastScanAt(activity);

  return (
    <Drawer
      open
      onClose={onClose}
      eyebrow="Table"
      title={`Table ${n}`}
      titleAdornment={!table.is_active
        ? <StatusPill tone="tag">Inactive</StatusPill>
        : occupied ? <StatusPill tone="live" dot>Occupied</StatusPill> : <StatusPill tone="ok" dot>Available</StatusPill>}
      sub={[
        table.table_label,
        table.pos_linked ? `POS: ${table.pos_table_name ?? n}` : null,
        scannedAt ? `Last scan ${timeSince(scannedAt)}` : null,
      ].filter(Boolean).join(' · ') || undefined}
      width={720}
      testId={`table-modal-${n}`}
      footer={
        <DrawerFooter
          dangerAction={occupied
            ? (onResetTable && (
              <button type="button" onClick={() => onResetTable(table)} data-testid={`table-reset-${n}`}
                className="text-sm font-semibold text-bad hover:underline">Reset table</button>))
            : (onAskDelete && (
              <button type="button" onClick={() => { onClose(); onAskDelete(table); }} data-testid={`table-delete-${n}`}
                className="text-sm font-semibold text-bad hover:underline">Delete table</button>))}
        >
          <button
            type="button"
            onClick={() => onToggleActive(table)}
            disabled={togglingActive[table.id]}
            data-testid={`table-toggle-${n}`}
            aria-label={`${table.is_active ? 'Deactivate' : 'Reactivate'} table ${n}`}
            className={secondary}
          >
            {togglingActive[table.id] ? <Loader2 size={14} className="animate-spin" /> : table.is_active ? 'Deactivate' : 'Reactivate'}
          </button>
          <button type="button" onClick={onClose} className={primary}>Done</button>
        </DrawerFooter>
      }
    >
      {calls.length > 0 && (
        <>
          {sectionHead('Service calls')}
          <div className="divide-y divide-line-row" data-testid={occupied ? undefined : `table-calls-unseated-${n}`}>
            {calls.map(call => (
              <div key={call.id} className="flex items-center gap-3 py-2">
                {call.status === 'overdue'
                  ? <AlertTriangle size={16} className="text-bad flex-none" aria-hidden="true" />
                  : <BellRing size={16} className="text-warn flex-none" aria-hidden="true" />}
                <span className="flex-1 min-w-0 text-sm text-ink">{callTypeLabel(call.call_type ?? '')}</span>
                <span className="text-[13px] text-ink-soft">{timeSince(call.created_at)}</span>
                <button type="button" onClick={() => onAcknowledgeCall(call.id)} data-testid={`table-ack-call-${n}`}
                  className={`${primary} min-h-8 px-3 text-[13px]`}>
                  <Check size={14} aria-hidden="true" /> Done
                </button>
              </div>
            ))}
          </div>
        </>
      )}

      {sectionHead(
        <span className="inline-flex items-center gap-2">
          Live orders
          <span className="inline-flex items-center gap-1 normal-case tracking-normal font-medium text-live">
            <span className="w-1.5 h-1.5 rounded-full bg-current animate-pulse" aria-hidden="true" />live
          </span>
        </span>,
        orders.length > 0 ? <span className="text-[13px] font-semibold tabular-nums">{money(liveTotal)}</span> : undefined,
      )}
      <div data-testid={`table-live-orders-${n}`}>
        {orders.length === 0 && carts.length === 0 && (
          <p className="text-sm text-ink-soft py-1">{occupied ? 'No orders yet' : 'Nobody is seated'}</p>
        )}
        {orders.map(o => (
          <div key={o.order_id} className="py-2.5 border-b border-line-row last:border-b-0" data-testid={`table-order-${o.order_id}`}>
            <div className="flex items-center gap-2">
              <span className="text-sm font-semibold text-ink truncate">{o.diner_name || 'Guest'}</span>
              <StatusPill tone={ORDER_TONE[o.status] ?? 'tag'}>{orderLabel(o.status)}</StatusPill>
              <span className="text-[13px] text-ink-soft">{timeSince(o.created_at)}</span>
              <span className="ml-auto text-sm font-semibold tabular-nums">{money(orderTotal(o))}</span>
            </div>
            {(o.items ?? []).map((it, i) => {
              const cancelled = it.item_status === 'cancelled';
              return (
                <div key={it.id ?? i} className={`flex items-center gap-3 pl-1 pt-1 text-sm ${cancelled ? 'line-through text-ink-faint' : ''}`}>
                  <span className="tabular-nums w-7 flex-none">{it.quantity}×</span>
                  <span className="flex-1 min-w-0 truncate">{it.name}</span>
                  {it.item_status && it.item_status !== 'cancelled' && (
                    <span className="text-[12px] text-ink-soft">{orderLabel(it.item_status)}</span>
                  )}
                  <span className="tabular-nums text-ink-soft">{money(it.price * it.quantity)}</span>
                </div>
              );
            })}
          </div>
        ))}
        {carts.map(c => (
          <div key={c.order_id} className="py-2.5 border-b border-line-row last:border-b-0" data-testid={`table-cart-${c.order_id}`}>
            <div className="flex items-center gap-2">
              <span className="text-sm font-semibold text-ink truncate">{c.diner_name || 'Guest'}</span>
              <StatusPill tone="tag">In cart · not placed</StatusPill>
              <span className="text-[13px] text-ink-soft">browsing {c.minutes_browsing}m</span>
            </div>
            {c.items.map((it, i) => (
              <div key={i} className="flex items-center gap-3 pl-1 pt-1 text-sm text-ink-soft">
                <span className="tabular-nums w-7 flex-none">{it.quantity}×</span>
                <span className="flex-1 min-w-0 truncate">{it.name}</span>
              </div>
            ))}
          </div>
        ))}
      </div>

      {occupied && activity && activity.guests.length > 0 && (
        <>
          {sectionHead(`Guests · ${activity.guests.length}`)}
          <div className="divide-y divide-line-row">
            {activity.guests.map((g, i) => (
              <div key={g.diner_id ?? i} className="flex items-center gap-3 py-1.5 text-sm">
                <span className="flex-1 min-w-0 truncate">{g.name || 'Guest'}</span>
                {g.is_first_timer && <StatusPill tone="tag">First visit</StatusPill>}
                {g.allergens.length > 0 && (
                  <span className="text-[12px] text-bad truncate max-w-[160px]" title={g.allergens.join(', ')}>
                    {g.allergens.join(', ')}
                  </span>
                )}
                <span className="text-[13px] text-ink-soft whitespace-nowrap">
                  {g.joined_at ? `scanned ${timeSince(g.joined_at)}` : ''}
                </span>
              </div>
            ))}
          </div>
        </>
      )}

      {sectionHead('Settings')}
      {field('Server', (
        <Select
          fullWidth
          value={table.assigned_server_id || ''}
          onChange={e => void save('server', { assigned_server_id: e.target.value || null })}
          placeholder="No server assigned"
          options={[{ value: '', label: 'No server assigned' }, ...staff.map(s => ({ value: s.id, label: s.name }))]}
          data-testid={`table-server-select-${n}`}
        />
      ))}
      {field('Seats', (
        <>
          <input type="number" min={0} value={seats} onChange={e => setSeats(e.target.value)}
            aria-label={`Seats at table ${n}`} data-testid={`table-seats-input-${n}`} className={`${input} max-w-[110px] flex-none`} />
          {seatsDirty && saveBtn('seats', `table-seats-save-${n}`, () => void save('seats', { capacity: seatsNum }))}
        </>
      ))}
      {field('Section', (
        <>
          <input type="text" list={`section-suggestions-${table.id}`} placeholder="e.g. Patio, Bar, Upstairs"
            value={section} onChange={e => setSection(e.target.value)} aria-label={`Section for table ${n}`}
            data-testid={`table-section-input-${n}`} className={input} />
          <datalist id={`section-suggestions-${table.id}`}>
            {sections.map(s => <option key={s} value={s} />)}
          </datalist>
          {sectionDirty && saveBtn('section', `table-section-save-${n}`, () => void save('section', { table_section: section.trim() || null }))}
        </>
      ))}
      {field('Label', (
        <>
          <input type="text" placeholder="Custom label" value={label} onChange={e => setLabel(e.target.value)}
            aria-label={`Custom label for table ${n}`} data-testid={`table-label-input-${n}`} className={input} />
          {labelDirty && saveBtn('label', `table-label-save-${n}`, () => void save('label', { table_label: label.trim() || null }))}
        </>
      ))}

      {sectionHead('QR code')}
      <div className="flex items-center gap-4 py-2">
        {table.qr_code_url ? (
          <img src={table.qr_code_url} alt={`QR code for Table ${n}`} data-testid={`table-qr-image-${n}`}
            className="w-24 h-24 rounded-ctl border border-line bg-white object-contain p-1" />
        ) : (
          <span className="text-sm text-ink-soft">Not generated yet — use Generate QR above the list.</span>
        )}
        {onAskRotateQr && table.qr_code_url && (
          <button type="button" onClick={() => { onClose(); onAskRotateQr(table); }} disabled={rotatingQrId === table.id}
            data-testid={`table-rotate-qr-${n}`} aria-label={`Regenerate QR code for table ${n}`}
            title="Regenerate QR — the printed code stops working immediately (killswitch)" className={secondary}>
            {rotatingQrId === table.id ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} aria-hidden="true" />}
            Regenerate QR
          </button>
        )}
      </div>
    </Drawer>
  );
}
