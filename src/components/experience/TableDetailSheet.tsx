'use client';

import { useState, useMemo } from 'react';
import { X, AlertTriangle, BellRing, Check, Loader2 } from 'lucide-react';
import type { TableActivityEntry, WaiterCall, OrderSummary, OrderStatus } from '../../types/experience';
import { callTypeLabel, timeSince, initials, allergenColor, StatusPill } from './table-utils';
import SwipeSlider from '../staff/SwipeSlider';

export interface TableDetailSheetProps {
  table: TableActivityEntry;
  orders: OrderSummary[];
  orderDetails?: Record<string, { items: Array<{ id?: string; item_status?: string }> }>;
  waiterCalls: WaiterCall[];
  updatingStatus?: string | null;
  onClose: () => void;
  onStatusUpdate?: (orderIds: string[], nextStatus: OrderStatus) => Promise<void>;
  onAcknowledgeCall?: (callId: string) => Promise<void>;
  onCancelItem?: (orderId: string, itemId: string, itemName: string) => void;
  onCloseTable?: () => Promise<void>;
  /** Extra tab for owner-specific controls e.g. server assignment */
  extraTab?: { label: string; content: React.ReactNode };
}

type TabKey = 'guests' | 'service' | 'bill' | 'extra';

type FlatItem = {
  itemId: string | null;
  orderId: string;
  status: string;
  itemStatus: string;
  name: string;
  quantity: number;
  price: number;
  lineTotal: number;
  guestName: string;
};

export default function TableDetailSheet({
  table,
  orders,
  orderDetails = {},
  waiterCalls,
  updatingStatus,
  onClose,
  onStatusUpdate,
  onAcknowledgeCall,
  onCancelItem,
  onCloseTable,
  extraTab,
}: TableDetailSheetProps) {
  const [activeTab, setActiveTab] = useState<TabKey>('guests');
  const [guestFilter, setGuestFilter] = useState<string | null>(null);

  // ─── Bill totals ──────────────────────────────────────────────────────────

  const bill = useMemo(() => {
    // Sum from the table's placed orders (the same feed as the itemized bill
    // below) using active_total — total_amount net of item-level cancellations —
    // so cancelled items are excluded from the bill. Falls back to the old
    // orders-based sum when the backend hasn't shipped active_total yet (graceful
    // during the qrate-core → owner deploy gap). NUMERIC fields may arrive as
    // strings, so every value is wrapped in Number().
    const placed = table.placed_orders || [];
    if (placed.length === 0) {
      const subtotal = orders.reduce((sum, o) => sum + (Number(o.total_amount) - Number(o.tax)), 0);
      const tax = orders.reduce((sum, o) => sum + Number(o.tax), 0);
      return { subtotal, tax, total: subtotal + tax };
    }
    let subtotal = 0, tax = 0, total = 0;
    for (const po of placed) {
      const liveOrder = orders.find(o => o.id === po.order_id);
      const liveStatus = liveOrder?.status || po.status;
      if (liveStatus === 'cancelled') continue; // fully-cancelled orders are excluded entirely
      const orderTotal = Number(po.active_total ?? po.total_amount);
      const orderTax = Number(po.tax ?? liveOrder?.tax ?? 0);
      total += orderTotal;
      tax += orderTax;
      subtotal += orderTotal - orderTax;
    }
    return { subtotal, tax, total };
  }, [table.placed_orders, orders]);

  // ─── Waiter calls for this table ─────────────────────────────────────────

  const tableCalls = waiterCalls.filter(c => c.table_number === table.table_number);
  const tableActive = tableCalls.filter(c => c.status === 'active');
  const tableOverdue = tableCalls.filter(c => c.status === 'overdue');
  const tableHistory = tableCalls.filter(c => c.status === 'acknowledged');
  const alertCallCount = tableActive.length + tableOverdue.length;

  // ─── Flat item list (guests tab) ─────────────────────────────────────────

  const { allItems, cancelledItems } = useMemo(() => {
    const all: FlatItem[] = [];
    const cancelled: FlatItem[] = [];

    for (const po of (table.placed_orders || [])) {
      const liveOrder = orders.find(o => o.id === po.order_id);
      const status = liveOrder?.status || po.status;
      const isOrderCancelled = status === 'cancelled';
      const guest = table.guests.find(
        g =>
          (g.order_ids || []).includes(po.order_id) ||
          (g.diner_id && po.diner_id && g.diner_id === po.diner_id)
      );
      const orderGuestName = guest?.name || po.diner_name || 'Guest';

      if (po.items && po.items.length > 0) {
        for (const [idx, item] of (
          po.items as {
            id?: string;
            name: string;
            quantity: number;
            price: number;
            patron_display_name?: string | null;
            item_status?: string;
          }[]
        ).entries()) {
          const guestName = item.patron_display_name || orderGuestName;
          const itemStatus = item.item_status || 'active';
          const detailItem = orderDetails[po.order_id]?.items?.[idx];
          const itemId = detailItem?.id || item.id || null;
          const resolvedItemStatus =
            detailItem?.item_status === 'cancelled' || itemStatus === 'cancelled'
              ? 'cancelled'
              : detailItem?.item_status || itemStatus;

          if (isOrderCancelled || resolvedItemStatus === 'cancelled') {
            cancelled.push({
              itemId,
              orderId: po.order_id,
              status,
              itemStatus: 'cancelled',
              name: item.name,
              quantity: item.quantity,
              price: item.price,
              lineTotal: item.quantity * item.price,
              guestName,
            });
          } else {
            all.push({
              itemId,
              orderId: po.order_id,
              status,
              itemStatus: resolvedItemStatus,
              name: item.name,
              quantity: item.quantity,
              price: item.price,
              lineTotal: item.quantity * item.price,
              guestName,
            });
          }
        }
      } else if (isOrderCancelled) {
        cancelled.push({
          itemId: null,
          orderId: po.order_id,
          status,
          itemStatus: 'cancelled',
          name: `${po.item_count} item${po.item_count !== 1 ? 's' : ''}`,
          quantity: 1,
          price: Number(po.total_amount),
          lineTotal: Number(po.total_amount),
          guestName: orderGuestName,
        });
      } else {
        all.push({
          itemId: null,
          orderId: po.order_id,
          status,
          itemStatus: 'active',
          name: `${po.item_count} item${po.item_count !== 1 ? 's' : ''}`,
          quantity: 1,
          price: Number(po.total_amount),
          lineTotal: Number(po.total_amount),
          guestName: orderGuestName,
        });
      }
    }

    return { allItems: all, cancelledItems: cancelled };
  }, [table, orders, orderDetails]);

  const guestNames = [...new Set(allItems.map(i => i.guestName))];
  const filteredItems = guestFilter ? allItems.filter(i => i.guestName === guestFilter) : allItems;

  // PDD 2026-05-22 Step 6c: workflow is Order Placed → In Kitchen
  // (Mark Served) → Served. The legacy "Ready" row is gone — Step 6b
  // confirmed zero `ready` rows remained in the DB.
  const statusGroups = [
    { statuses: ['pending'],               label: 'Order Placed',   actionLabel: 'Enter in POS', nextStatus: 'confirmed' as OrderStatus, labelCls: 'text-blue-700',    bgCls: 'bg-blue-50'   },
    { statuses: ['confirmed', 'preparing'], label: 'In Kitchen',     actionLabel: 'Mark Served', nextStatus: 'delivered' as OrderStatus, labelCls: 'text-purple-700',  bgCls: 'bg-purple-50' },
    { statuses: ['delivered'],             label: 'Served',         actionLabel: null,            nextStatus: null,                       labelCls: 'text-emerald-700', bgCls: 'bg-emerald-50'},
    { statuses: ['completed'],             label: 'Completed',      actionLabel: null,            nextStatus: null,                       labelCls: 'text-gray-500',    bgCls: 'bg-gray-50'   },
  ];

  // ─── Tab labels ───────────────────────────────────────────────────────────

  const tabs: { key: TabKey; label: React.ReactNode }[] = [
    { key: 'guests', label: 'guests' },
    {
      key: 'service',
      label: (
        <span className="flex items-center justify-center gap-1">
          Service
          {alertCallCount > 0 && (
            <span className="bg-red-500 text-white text-xs rounded-full w-4 h-4 inline-flex items-center justify-center">
              {alertCallCount}
            </span>
          )}
        </span>
      ),
    },
    { key: 'bill', label: 'bill' },
    ...(extraTab ? [{ key: 'extra' as TabKey, label: extraTab.label }] : []),
  ];

  return (
    <div className="fixed inset-0 z-50" onClick={onClose}>
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/40" />

      {/* Sheet */}
      <div
        className="absolute bottom-0 left-0 right-0 bg-white rounded-t-2xl h-[70vh] flex flex-col shadow-2xl"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100 flex-shrink-0">
          <div>
            <h3 className="text-title text-gray-900">Table #{table.table_number}</h3>
            <p className="text-xs text-gray-500">
              {table.guests.length} guest{table.guests.length !== 1 ? 's' : ''}
              {bill.total > 0 && ` · $${bill.total.toFixed(2)}`}
            </p>
          </div>
          <button onClick={onClose} className="p-1.5 text-gray-400 active:text-gray-600 rounded-lg">
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Sub-tabs */}
        <div className="flex border-b border-gray-100 flex-shrink-0">
          {tabs.map(tab => (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              className={`flex-1 py-2.5 text-xs font-semibold capitalize transition-colors ${
                activeTab === tab.key
                  ? 'text-orange-600 border-b-2 border-orange-500'
                  : 'text-gray-500'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* Scrollable content */}
        <div className="flex-1 overflow-y-auto p-4">

          {/* ─── GUESTS TAB ─── */}
          {activeTab === 'guests' && (
            <>
              {allItems.length === 0 && cancelledItems.length === 0 ? (
                <p className="text-sm text-gray-400 text-center py-6">No orders at this table</p>
              ) : (
                <div className="space-y-4">
                  {/* Guest filter pills */}
                  <div className="flex gap-2 overflow-x-auto pb-1 -mx-4 px-4 scrollbar-hide">
                    <button
                      onClick={() => setGuestFilter(null)}
                      className={`px-3 py-1.5 rounded-full text-sm font-medium whitespace-nowrap transition-colors flex-shrink-0 ${
                        guestFilter === null ? 'bg-gray-900 text-white' : 'bg-gray-100 text-gray-600'
                      }`}
                    >
                      All
                    </button>
                    {guestNames.map(name => (
                      <button
                        key={name}
                        onClick={() => setGuestFilter(name)}
                        className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm font-medium whitespace-nowrap transition-colors flex-shrink-0 ${
                          guestFilter === name ? 'bg-gray-900 text-white' : 'bg-gray-100 text-gray-600'
                        }`}
                      >
                        <span
                          className={`w-5 h-5 rounded-full flex items-center justify-center text-xs font-bold ${
                            guestFilter === name ? 'bg-white/20 text-white' : 'bg-gray-300 text-gray-700'
                          }`}
                        >
                          {initials(name)}
                        </span>
                        {name}
                      </button>
                    ))}
                  </div>

                  {/* Guest dietary profile card */}
                  {guestFilter && (() => {
                    const guest = table.guests.find(g => (g.name || 'Guest') === guestFilter);
                    if (!guest) return null;
                    const hasAllergens = guest.allergens.length > 0;
                    const hasDietary = guest.dietary_restrictions.length > 0;
                    if (!hasAllergens && !hasDietary) return null;
                    return (
                      <div className="bg-white border border-gray-200 rounded-xl p-3 space-y-2">
                        {hasAllergens && (
                          <div>
                            <p className="section-header text-red-600 mb-1">
                              <AlertTriangle className="inline h-3 w-3 mr-0.5 -mt-0.5" />
                              Allergens
                            </p>
                            <div className="flex flex-wrap gap-1.5">
                              {guest.allergens.map(a => (
                                <span
                                  key={a}
                                  className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium text-white"
                                  style={{ backgroundColor: allergenColor(a) }}
                                >
                                  {a}
                                </span>
                              ))}
                            </div>
                          </div>
                        )}
                        {hasDietary && (
                          <div>
                            <p className="section-header mb-1">
                              Dietary Preferences
                            </p>
                            <div className="flex flex-wrap gap-1.5">
                              {guest.dietary_restrictions.map(d => (
                                <span key={d} className="px-2 py-0.5 rounded-full text-xs font-medium bg-blue-50 text-blue-700 border border-blue-200">
                                  {d}
                                </span>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })()}

                  {/* Status groups */}
                  {statusGroups.map(group => {
                    const groupItems = filteredItems.filter(i => group.statuses.includes(i.status));
                    if (groupItems.length === 0) return null;
                    const orderIds = [...new Set(groupItems.map(i => i.orderId))];
                    return (
                      <div key={group.label}>
                        <div className="flex items-center justify-between mb-2">
                          <span className={`section-header ${group.labelCls}`}>
                            {group.label} · {groupItems.length} item{groupItems.length !== 1 ? 's' : ''}
                          </span>
                          {group.actionLabel && group.nextStatus && onStatusUpdate && (
                            <button
                              onClick={async () => {
                                await onStatusUpdate(orderIds, group.nextStatus!);
                              }}
                              disabled={!!updatingStatus}
                              className="text-xs font-semibold text-gray-700 bg-gray-100 px-2.5 py-1 rounded-full active:bg-gray-200 disabled:opacity-50"
                            >
                              {group.actionLabel}
                            </button>
                          )}
                        </div>
                        <div className={`rounded-xl overflow-hidden ${group.bgCls}`}>
                          {groupItems.map((item, idx) => (
                            <div key={idx} className={`flex items-center gap-2 px-3 py-2 ${idx > 0 ? 'border-t border-white/60' : ''}`}>
                              <span className="text-sm text-gray-800 flex-1">{item.quantity}× {item.name}</span>
                              <span className="text-xs text-gray-500">{item.guestName}</span>
                              <span className="text-sm font-medium text-gray-700 w-14 text-right" style={{ fontVariantNumeric: 'tabular-nums' }}>${item.lineTotal.toFixed(2)}</span>
                              {item.status !== 'delivered' && item.status !== 'completed' && item.itemId && onCancelItem && (
                                <button
                                  onClick={() => onCancelItem(item.orderId, item.itemId!, item.name)}
                                  disabled={!!updatingStatus}
                                  className="ml-1 p-1 text-red-400 hover:text-red-600 active:text-red-700 disabled:opacity-50 flex-shrink-0"
                                  title={`Cancel ${item.name}`}
                                  data-testid={`cancel-item-btn-${item.itemId}`}
                                >
                                  <X className="h-4 w-4" />
                                </button>
                              )}
                            </div>
                          ))}
                        </div>
                      </div>
                    );
                  })}

                  {/* Cancelled items */}
                  {cancelledItems.length > 0 && (
                    <div>
                      <div className="flex items-center justify-between mb-2">
                        <span className="section-header text-red-600">
                          Cancelled · {cancelledItems.length} item{cancelledItems.length !== 1 ? 's' : ''}
                        </span>
                      </div>
                      <div className="rounded-xl overflow-hidden bg-red-50" data-testid="cancelled-items-section">
                        {cancelledItems.map((item, idx) => (
                          <div key={idx} className={`flex items-center gap-2 px-3 py-2 ${idx > 0 ? 'border-t border-red-100' : ''}`}>
                            <span className="text-sm text-red-300 flex-1 line-through">{item.quantity}× {item.name}</span>
                            <span className="text-xs text-red-300">{item.guestName}</span>
                            <span className="text-sm font-medium text-red-300 w-14 text-right line-through" style={{ fontVariantNumeric: 'tabular-nums' }}>${item.lineTotal.toFixed(2)}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </>
          )}

          {/* ─── SERVICE TAB ─── */}
          {activeTab === 'service' && (
            <div className="space-y-3">
              {tableCalls.length === 0 && !table.needs_attention ? (
                <p className="text-sm text-gray-400 text-center py-6">No service requests</p>
              ) : (
                <>
                  {/* Active requests */}
                  {tableActive.map(call => (
                    <div key={call.id} className="bg-red-50 border border-red-100 rounded-xl p-3">
                      <div className="flex items-center justify-between mb-2">
                        <div className="flex items-center gap-2">
                          <BellRing className="h-4 w-4 text-red-500 flex-shrink-0" />
                          <p className="text-sm font-semibold text-red-800">{callTypeLabel(call.call_type ?? '')}</p>
                        </div>
                        <p className="text-xs text-red-500">{timeSince(call.created_at)}</p>
                      </div>
                      {onAcknowledgeCall ? (
                        <SwipeSlider
                          label="Slide to complete"
                          color="bg-red-500"
                          onComplete={() => onAcknowledgeCall(call.id)}
                        />
                      ) : (
                        <button
                          className="w-full py-2 rounded-lg text-sm font-semibold text-white bg-red-500 active:bg-red-600 opacity-50 cursor-not-allowed"
                          disabled
                        >
                          Done
                        </button>
                      )}
                    </div>
                  ))}

                  {/* Overdue requests */}
                  {tableOverdue.map(call => (
                    <div key={call.id} className="bg-orange-50 border border-orange-200 rounded-xl p-3">
                      <div className="flex items-center justify-between mb-1">
                        <div className="flex items-center gap-2">
                          <AlertTriangle className="h-4 w-4 text-orange-500 flex-shrink-0" />
                          <p className="text-sm font-semibold text-orange-800">{callTypeLabel(call.call_type ?? '')}</p>
                        </div>
                        <p className="text-xs text-orange-600 font-medium">Not completed</p>
                      </div>
                      <p className="text-xs text-orange-600 ml-6">
                        Requested {timeSince(call.created_at)} — unattended for 30+ min
                      </p>
                    </div>
                  ))}

                  {/* Acknowledged history */}
                  {tableHistory.length > 0 && (
                    <div className="pt-1">
                      <p className="section-header text-gray-400 mb-2">Completed</p>
                      <div className="space-y-1.5">
                        {tableHistory.map(call => (
                          <div key={call.id} className="flex items-center justify-between py-2 px-3 bg-gray-50 rounded-lg">
                            <div className="flex items-center gap-2">
                              <Check className="h-3.5 w-3.5 text-emerald-500 flex-shrink-0" />
                              <p className="text-sm text-gray-500">{callTypeLabel(call.call_type ?? '')}</p>
                            </div>
                            <span className="text-xs text-emerald-600 font-medium">Done</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Needs attention warning */}
                  {table.needs_attention && (
                    <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 flex items-start gap-2">
                      <AlertTriangle className="h-4 w-4 text-amber-600 mt-0.5 flex-shrink-0" />
                      <div>
                        <p className="text-sm font-medium text-amber-800">Needs Attention</p>
                        <p className="text-xs text-amber-700 mt-0.5">
                          A guest has been browsing for 3+ minutes without ordering.
                        </p>
                      </div>
                    </div>
                  )}
                </>
              )}
            </div>
          )}

          {/* ─── BILL TAB ─── */}
          {activeTab === 'bill' && (
            <div className="space-y-4 pb-6">
              {orders.length === 0 ? (
                <div className="text-center py-6 space-y-6">
                  <p className="text-sm text-gray-400">No orders yet</p>
                  {onCloseTable && (
                    <SwipeSlider
                      label="Swipe to Close Table"
                      color="bg-gray-800"
                      onComplete={async () => {
                        await onCloseTable();
                        onClose();
                      }}
                    />
                  )}
                </div>
              ) : (
                <>
                  {/* Itemized by guest */}
                  {(() => {
                    type BillItem = { orderId: string; itemId: string | null; name: string; quantity: number; price: number; status: string; itemStatus: string };
                    const byGuest: Record<string, BillItem[]> = {};

                    for (const po of (table.placed_orders || [])) {
                      const liveOrder = orders.find(o => o.id === po.order_id);
                      const status = liveOrder?.status || po.status;
                      if (status === 'cancelled') continue;

                      const orderGuestName = po.diner_name || 'Guest';
                      if (po.items && po.items.length > 0) {
                        for (const item of po.items) {
                          const guestName = item.patron_display_name || orderGuestName;
                          if (!byGuest[guestName]) byGuest[guestName] = [];
                          byGuest[guestName].push({
                            orderId: po.order_id,
                            itemId: item.id ?? null,
                            name: item.name,
                            quantity: item.quantity,
                            price: item.price,
                            status,
                            itemStatus: item.item_status || 'active',
                          });
                        }
                      }
                    }

                    return Object.entries(byGuest).map(([name, items]) => (
                      <div key={name}>
                        <h5 className="section-header mb-1.5">{name}</h5>
                        {items.map((item, i) => {
                          // Item-level cancellation: a cancelled line is shown struck-through
                          // with a Cancelled pill and is NOT counted in the bill total (the
                          // total is summed from active_total, which nets these out).
                          const isCancelled = item.itemStatus === 'cancelled';
                          return (
                            <div
                              key={`${item.orderId}-${i}`}
                              data-testid={item.itemId ? `bill-item-${item.itemId}` : undefined}
                              data-cancelled={isCancelled ? 'true' : 'false'}
                              className="flex items-center justify-between py-1.5"
                              style={isCancelled ? { opacity: 0.55 } : undefined}
                            >
                              <div className="flex items-center gap-1.5">
                                <span
                                  className="text-sm text-gray-800"
                                  style={isCancelled ? { textDecoration: 'line-through' } : undefined}
                                >
                                  {item.quantity}x {item.name}
                                </span>
                                <StatusPill status={isCancelled ? 'cancelled' : item.status} />
                              </div>
                              <span
                                className="text-sm font-medium"
                                style={{ fontVariantNumeric: 'tabular-nums', textDecoration: isCancelled ? 'line-through' : undefined }}
                              >
                                ${(item.quantity * item.price).toFixed(2)}
                              </span>
                            </div>
                          );
                        })}
                      </div>
                    ));
                  })()}

                  {/* Totals */}
                  <div data-testid="bill-totals" className="border-t border-gray-200 pt-3 space-y-1">
                    <div className="flex justify-between text-sm text-gray-600">
                      <span>Subtotal</span>
                      <span data-testid="bill-subtotal" style={{ fontVariantNumeric: 'tabular-nums' }}>${bill.subtotal.toFixed(2)}</span>
                    </div>
                    <div className="flex justify-between text-sm text-gray-600">
                      <span>Tax</span>
                      <span data-testid="bill-tax" style={{ fontVariantNumeric: 'tabular-nums' }}>${bill.tax.toFixed(2)}</span>
                    </div>
                    <div className="flex justify-between text-base font-bold text-gray-900">
                      <span>Total</span>
                      <span data-testid="bill-total" style={{ fontVariantNumeric: 'tabular-nums' }}>${bill.total.toFixed(2)}</span>
                    </div>
                  </div>

                  {/* PDD Step 7: Mark All Served now operates on
                      confirmed/preparing — all advance to `delivered` in
                      one tap. */}
                  {(() => {
                    const inKitchenOrders = orders.filter(o =>
                      o.status === 'confirmed' || o.status === 'preparing'
                    );
                    if (inKitchenOrders.length === 0) return null;
                    return (
                      <button
                        onClick={async () => {
                          if (!onStatusUpdate) return;
                          await onStatusUpdate(inKitchenOrders.map(o => o.id), 'delivered');
                        }}
                        disabled={!!updatingStatus || !onStatusUpdate}
                        className="w-full py-3 rounded-lg text-sm font-semibold text-white bg-emerald-600 active:bg-emerald-700 disabled:opacity-50 transition-colors"
                      >
                        {updatingStatus ? (
                          <Loader2 className="h-4 w-4 animate-spin mx-auto" />
                        ) : (
                          `Mark All Served (${inKitchenOrders.length})`
                        )}
                      </button>
                    );
                  })()}

                  {/* Close Check swipe */}
                  {orders.some(o => o.status !== 'completed' && o.status !== 'cancelled') && (() => {
                    const STALE_MS = 120 * 60 * 1000;
                    const now = Date.now();
                    const unservedOrders = orders.filter(o => {
                      if (o.status === 'delivered' || o.status === 'completed' || o.status === 'cancelled') return false;
                      return now - new Date(o.created_at).getTime() < STALE_MS;
                    });
                    const hasUnserved = unservedOrders.length > 0;
                    return (
                      <div className="pt-2 space-y-2">
                        {hasUnserved && (
                          <div className="bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 text-amber-800 text-xs font-medium">
                            Please make sure all ordered items are moved to served state or Canceled (Remove) from the table.
                          </div>
                        )}
                        {onCloseTable && (
                          <SwipeSlider
                            label="Swipe after bill is settled"
                            color="bg-gray-800"
                            disabled={!!updatingStatus || hasUnserved}
                            onComplete={async () => {
                              await onCloseTable();
                              onClose();
                            }}
                          />
                        )}
                      </div>
                    );
                  })()}
                </>
              )}
            </div>
          )}

          {/* ─── EXTRA TAB ─── */}
          {activeTab === 'extra' && extraTab && (
            <>{extraTab.content}</>
          )}

        </div>
      </div>
    </div>
  );
}
