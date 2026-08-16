'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  Loader2, Download, QrCode, X, Wine, Plus, Trash2, AlertTriangle,
  BellRing, Check,
} from 'lucide-react';
import type {
  ExperienceService, RestaurantTable, StaffMember, WaiterCall, DrinksTableActivity,
} from '../../types/experience';
import { useIsMobile } from '../../hooks/useIsMobile';
import Select from '../common/Select';
import { initials, avatarColor, callTypeLabel, timeSince } from './table-utils';

interface DrinksQrTabProps {
  restaurantId?: string;
  service: ExperienceService;
}

/**
 * Drinks QR tab — generates a SEPARATE, standalone QR per table that routes
 * diners to the drinks-ordering app (qrate-drinks-webapp), independent of
 * the patron food-menu QR the Tables tab manages. Only rendered when the
 * admin-only `drinks_qr_enabled` deluxe flag is on for the restaurant — see
 * ExperienceManagement's `showDrinksTab` prop.
 *
 * Full functional/visual parity with the Tables tab (card layout, live
 * AVAILABLE/OCCUPIED occupancy, guest pills, Orders/Service toggle, seats +
 * server assignment, delete/add table) — but entirely independent code and
 * data (getDrinksTableActivity, not getTableActivity), since drinks tables
 * are the SAME restaurant_tables rows and this tab must never touch or
 * refactor ExperienceManagement's Tables tab implementation.
 */
export default function DrinksQrTab({ restaurantId, service }: DrinksQrTabProps) {
  const isMobile = useIsMobile();
  const [tables, setTables] = useState<RestaurantTable[]>([]);
  const [staff, setStaff] = useState<StaffMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [qrModalTable, setQrModalTable] = useState<RestaurantTable | null>(null);
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  // Live occupancy (drinks surface only)
  const [drinksActivity, setDrinksActivity] = useState<DrinksTableActivity | null>(null);
  const [waiterCalls, setWaiterCalls] = useState<WaiterCall[]>([]);
  const [cardTabState, setCardTabState] = useState<Record<number, 'orders' | 'service'>>({});

  // Seats / server assignment
  const [capacityEdits, setCapacityEdits] = useState<Record<string, number>>({});
  const [savingCapacity, setSavingCapacity] = useState<Record<string, boolean>>({});

  // Add table
  const [showAddModal, setShowAddModal] = useState(false);
  const [addCount, setAddCount] = useState(1);
  const [addStartNumber, setAddStartNumber] = useState(1);
  const [addingTables, setAddingTables] = useState(false);

  // Delete table
  const [deleteConfirm, setDeleteConfirm] = useState<{ tableId: string; tableNumber: number } | null>(null);
  const [deleting, setDeleting] = useState(false);

  const showFeedback = useCallback((type: 'success' | 'error', message: string) => {
    setFeedback({ type, message });
    setTimeout(() => setFeedback(null), 4000);
  }, []);

  const fetchTables = useCallback(async () => {
    if (!restaurantId) return;
    try {
      const data = await service.getTables(restaurantId);
      setTables(data.tables);
    } catch {
      showFeedback('error', 'Failed to load tables');
    } finally {
      setLoading(false);
    }
  }, [restaurantId, service, showFeedback]);

  const fetchStaff = useCallback(async () => {
    if (!restaurantId) return;
    try {
      const data = await service.getStaff(restaurantId);
      setStaff(data.staff);
    } catch {
      // Server names are a nice-to-have on the card — silently degrade to no name.
    }
  }, [restaurantId, service]);

  const fetchDrinksActivity = useCallback(async () => {
    if (!restaurantId || !service.getDrinksTableActivity) return;
    try {
      const data = await service.getDrinksTableActivity(restaurantId);
      setDrinksActivity(data);
    } catch {
      // Non-fatal — cards fall back to NOT GENERATED-only display.
    }
  }, [restaurantId, service]);

  const fetchWaiterCalls = useCallback(async () => {
    if (!restaurantId) return;
    try {
      const calls = await service.getWaiterCalls(restaurantId);
      setWaiterCalls(calls);
    } catch {
      // Non-fatal
    }
  }, [restaurantId, service]);

  useEffect(() => {
    fetchTables();
    fetchStaff();
    fetchDrinksActivity();
    fetchWaiterCalls();
    // Same 10s cadence as the Tables tab.
    const interval = setInterval(() => {
      fetchDrinksActivity();
      fetchWaiterCalls();
      fetchStaff();
    }, 10000);
    return () => clearInterval(interval);
  }, [fetchTables, fetchStaff, fetchDrinksActivity, fetchWaiterCalls]);

  const handleAcknowledgeCall = async (callId: string) => {
    const call = waiterCalls.find(c => c.id === callId);
    setWaiterCalls(prev => prev.filter(c => c.id !== callId));
    try {
      await service.acknowledgeWaiterCall(callId);
    } catch {
      if (call) setWaiterCalls(prev => (prev.some(c => c.id === callId) ? prev : [...prev, call]));
      showFeedback('error', 'Failed to dismiss call');
    }
  };

  const handleGenerate = async () => {
    if (!restaurantId || !service.generateDrinksQRCodes) return;
    setGenerating(true);
    try {
      await service.generateDrinksQRCodes(restaurantId);
      await fetchTables();
      showFeedback('success', 'Drinks QR codes generated');
    } catch (err: any) {
      showFeedback('error', err?.response?.data?.error || 'Failed to generate drinks QR codes');
    } finally {
      setGenerating(false);
    }
  };

  const handleDownloadZip = async () => {
    if (!restaurantId || !service.downloadDrinksQRCodesZip) return;
    setDownloading(true);
    try {
      const { download_url } = await service.downloadDrinksQRCodesZip(restaurantId);
      window.open(download_url, '_blank');
    } catch (err: any) {
      showFeedback('error', err?.response?.data?.error || 'Failed to download drinks QR codes');
    } finally {
      setDownloading(false);
    }
  };

  const handleCapacityChange = (tableId: string, value: string) => {
    const num = parseInt(value);
    if (!isNaN(num) && num >= 0) {
      setCapacityEdits(prev => ({ ...prev, [tableId]: num }));
    }
  };

  const handleSaveCapacity = async (tableId: string) => {
    if (!restaurantId || capacityEdits[tableId] === undefined) return;
    setSavingCapacity(prev => ({ ...prev, [tableId]: true }));
    try {
      await service.updateTable(restaurantId, tableId, { capacity: capacityEdits[tableId] });
      setTables(prev => prev.map(t => t.id === tableId ? { ...t, capacity: capacityEdits[tableId] } : t));
      setCapacityEdits(prev => {
        const next = { ...prev };
        delete next[tableId];
        return next;
      });
      showFeedback('success', 'Capacity updated');
    } catch {
      showFeedback('error', 'Failed to update capacity');
    } finally {
      setSavingCapacity(prev => ({ ...prev, [tableId]: false }));
    }
  };

  const handleAssignServer = async (tableId: string, serverId: string | null) => {
    if (!restaurantId) return;
    try {
      await service.updateTable(restaurantId, tableId, { assigned_server_id: serverId });
      setTables(prev => prev.map(t => t.id === tableId ? { ...t, assigned_server_id: serverId } : t));
      showFeedback('success', serverId ? 'Server assigned' : 'Server unassigned');
    } catch {
      showFeedback('error', 'Failed to assign server');
    }
  };

  const handleDeleteTable = async (tableId: string) => {
    if (!restaurantId) return;
    setDeleting(true);
    try {
      await service.deleteTable!(restaurantId, tableId);
      setTables(prev => prev.filter(t => t.id !== tableId));
      showFeedback('success', 'Table deleted');
    } catch {
      showFeedback('error', 'Failed to delete table');
    } finally {
      setDeleting(false);
      setDeleteConfirm(null);
    }
  };

  const handleAddTables = async () => {
    if (!restaurantId || addCount < 1) return;
    setAddingTables(true);
    try {
      await service.createTables(restaurantId, { table_count: addCount, start_number: addStartNumber });
      if (service.generateDrinksQRCodes) {
        try {
          await service.generateDrinksQRCodes(restaurantId);
        } catch {
          // Non-fatal
        }
      }
      await fetchTables();
      setShowAddModal(false);
      setAddCount(1);
      showFeedback('success', `Added ${addCount} table${addCount > 1 ? 's' : ''}`);
    } catch (err: any) {
      showFeedback('error', err?.response?.data?.error || 'Failed to add tables');
    } finally {
      setAddingTables(false);
    }
  };

  const activeTables = tables.filter(t => t.is_active);
  const tablesWithDrinksQR = tables.filter(t => t.drinks_qr_code_url);

  if (!restaurantId) {
    return (
      <div className="text-center py-12 text-gray-500">
        <p>No restaurant selected.</p>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="text-center py-12">
        <Loader2 className="h-6 w-6 animate-spin mx-auto text-orange-500 mb-3" />
        <p className="text-sm text-gray-500">Loading tables...</p>
      </div>
    );
  }

  const addTableModal = showAddModal && (
    <div className={`fixed inset-0 bg-black/40 flex z-50 ${isMobile ? 'items-end' : 'items-center justify-center'}`} onClick={() => setShowAddModal(false)}>
      <div className={isMobile ? 'bg-white rounded-t-2xl p-6 pb-8 w-full shadow-xl' : 'bg-white rounded-2xl p-6 w-full max-w-sm mx-4 shadow-xl'} onClick={e => e.stopPropagation()}>
        <h3 className="text-lg font-bold text-gray-900 mb-4">Add Tables</h3>
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Number of tables</label>
            <input
              type="number"
              min={1}
              max={50}
              value={addCount}
              onChange={e => setAddCount(Math.max(1, parseInt(e.target.value) || 1))}
              className="w-full px-3 py-2 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-orange-500"
              data-testid="drinks-add-table-count"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Start numbering from</label>
            <input
              type="number"
              min={1}
              value={addStartNumber}
              onChange={e => setAddStartNumber(Math.max(1, parseInt(e.target.value) || 1))}
              className="w-full px-3 py-2 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-orange-500"
              data-testid="drinks-add-table-start"
            />
          </div>
        </div>
        <div className="flex gap-3 mt-6">
          <button
            onClick={() => setShowAddModal(false)}
            className="flex-1 px-4 py-2 border border-gray-200 rounded-lg font-medium text-gray-600 hover:bg-gray-50 transition-colors text-sm"
          >
            Cancel
          </button>
          <button
            onClick={handleAddTables}
            disabled={addingTables}
            className="flex-1 bg-orange-500 text-white px-4 py-2 rounded-lg font-medium hover:bg-orange-600 transition-colors text-sm flex items-center justify-center gap-2 disabled:opacity-50"
            data-testid="drinks-add-table-confirm"
          >
            {addingTables ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
            {addingTables ? 'Creating...' : 'Create'}
          </button>
        </div>
      </div>
    </div>
  );

  if (activeTables.length === 0) {
    return (
      <>
        <div className="text-center py-12 text-gray-500">
          <Wine className="h-8 w-8 mx-auto mb-3 opacity-40" />
          <p className="font-medium">No tables found</p>
          <p className="text-sm mt-1">Add a table below to start generating drinks QR codes.</p>
          {service.deleteTable && (
            <button
              onClick={() => setShowAddModal(true)}
              className="mt-4 bg-orange-500 text-white px-4 py-2 rounded-lg font-medium hover:bg-orange-600 transition-colors text-sm inline-flex items-center gap-2"
              data-testid="drinks-add-table-btn"
            >
              <Plus className="h-4 w-4" />
              Add Table
            </button>
          )}
        </div>
        {addTableModal}
      </>
    );
  }

  return (
    <div>
      {feedback && (
        <div className={`mb-4 px-4 py-2 rounded-lg text-sm font-medium ${feedback.type === 'success' ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700'}`}>
          {feedback.message}
        </div>
      )}

      {/* Header */}
      <div className={isMobile ? 'flex flex-col gap-3 mb-4' : 'flex items-center justify-between mb-6'}>
        <div>
          {!isMobile && <h3 className="text-lg font-bold text-gray-900">Drinks QR</h3>}
          <p className="text-sm text-gray-500">
            {activeTables.length} active table{activeTables.length !== 1 ? 's' : ''}
            {' '}&middot;{' '}
            {tablesWithDrinksQR.length} with drinks QR codes
          </p>
          <p className="text-xs text-gray-400 mt-1">
            A separate, standalone QR for the drinks-ordering app — the food menu QR in the Tables tab is untouched.
          </p>
        </div>
        <div className={`flex gap-2 ${isMobile ? 'flex-wrap [&>button]:min-h-[44px]' : ''}`}>
          {tablesWithDrinksQR.length > 0 && (
            <button
              data-testid="download-drinks-qr-btn"
              onClick={handleDownloadZip}
              disabled={downloading}
              className="px-4 py-2 border border-gray-200 rounded-lg font-medium text-gray-600 hover:bg-gray-50 transition-colors text-sm flex items-center gap-2 disabled:opacity-50"
            >
              {downloading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
              Download All
            </button>
          )}
          <button
            data-testid="generate-drinks-qr-btn"
            onClick={handleGenerate}
            disabled={generating || activeTables.length === 0}
            className="px-4 py-2 border border-gray-200 rounded-lg font-medium text-gray-600 hover:bg-gray-50 transition-colors text-sm flex items-center gap-2 disabled:opacity-50"
          >
            {generating ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Generating...
              </>
            ) : (
              <>
                <QrCode className="h-4 w-4" />
                {tablesWithDrinksQR.length > 0 ? 'Regenerate Drinks QR' : 'Generate Drinks QR'}
              </>
            )}
          </button>
          <button
            onClick={() => setShowAddModal(true)}
            className="bg-orange-500 text-white px-4 py-2 rounded-lg font-medium hover:bg-orange-600 transition-colors text-sm flex items-center gap-2"
            data-testid="drinks-add-table-btn"
          >
            <Plus className="h-4 w-4" />
            Add Table
          </button>
        </div>
      </div>

      {/* Table grid — same card shell/behavior as the Tables tab: border-dashed
          card, AVAILABLE/OCCUPIED badge driven by a LIVE drinks session (not
          just QR-generated state), guest pills, Orders/Service toggle, seats +
          server assignment, delete table. */}
      <div className={`grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3 ${isMobile ? 'pb-24' : ''}`}>
        {activeTables.map(table => {
          const hasQR = Boolean(table.drinks_qr_code_url);
          const serverName = table.assigned_server_id
            ? (staff.find(s => s.id === table.assigned_server_id)?.name ?? null)
            : null;
          const activity = drinksActivity?.tables?.find(t => t.table_number === table.table_number) ?? null;
          const isOccupied = activity?.has_active_session === true;
          const borderClass = isOccupied ? 'border-red-400' : 'border-green-400';
          const tableCalls = waiterCalls.filter(
            c => c.table_number === table.table_number && (c.status === 'active' || c.status === 'overdue'),
          );
          const activeTab = cardTabState[table.table_number] ?? 'orders';

          return (
            <div
              key={table.id}
              data-testid={`drinks-qr-table-${table.table_number}`}
              className={`border-2 border-dashed rounded-xl p-3 bg-white ${borderClass}`}
            >
              {/* Row 1: Table name + server + QR + seats */}
              <div className="flex items-center justify-between gap-2">
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline gap-2">
                    <h3 className="font-bold text-base text-gray-900 whitespace-nowrap">
                      {table.table_label || `Table ${table.table_number}`}
                    </h3>
                    {serverName && (
                      <span title={`Server: ${serverName}`} className="text-xs text-gray-400 truncate">Server: {serverName}</span>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-1 flex-shrink-0">
                  <button
                    onClick={() => setQrModalTable(table)}
                    className={`rounded-md hover:bg-gray-100 transition-colors ${isMobile ? 'min-h-[44px] min-w-[44px] flex items-center justify-center' : 'p-1.5'}`}
                    title="Show drinks QR code"
                  >
                    <QrCode className={`h-4 w-4 ${hasQR ? 'text-orange-500' : 'text-gray-400'}`} />
                  </button>
                  <span className="text-xs text-gray-500">{table.capacity || '?'} seats</span>
                </div>
              </div>

              {/* Row 2: Status badge */}
              <div className="mt-2">
                {isOccupied ? (
                  <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-bold bg-red-100 text-red-700">OCCUPIED</span>
                ) : (
                  <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-bold bg-green-100 text-green-700">AVAILABLE</span>
                )}
              </div>

              {/* Occupied content */}
              {isOccupied && activity && (
                <>
                  {/* Row 3: Guest avatar pills */}
                  {activity.guests.length > 0 && (
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {activity.guests.map((g, i) => (
                        <span key={i} className="inline-flex items-center gap-1.5 px-2 py-1 rounded-full bg-gray-100 text-gray-800 text-xs font-medium">
                          <span className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold text-white flex-shrink-0 ${avatarColor(g.name)}`}>
                            {initials(g.name)}
                          </span>
                          <span title={g.name || 'Guest'} className="truncate max-w-[90px]">{g.name || 'Guest'}</span>
                        </span>
                      ))}
                    </div>
                  )}

                  {/* Row 4: Orders / Service toggle */}
                  <div className="mt-3 flex rounded-lg border border-gray-200 overflow-hidden">
                    <button
                      onClick={() => setCardTabState(prev => ({ ...prev, [table.table_number]: 'orders' }))}
                      className={`flex-1 ${isMobile ? 'py-3' : 'py-1.5'} text-xs font-semibold flex items-center justify-center gap-1 transition-colors ${activeTab === 'orders' ? 'bg-gray-900 text-white' : 'bg-white text-gray-600 hover:bg-gray-50'}`}
                    >
                      Orders
                      {activity.placed_orders.length > 0 && (
                        <span className={`text-[10px] rounded-full w-4 h-4 inline-flex items-center justify-center font-bold ${activeTab === 'orders' ? 'bg-white text-gray-900' : 'bg-orange-500 text-white'}`}>
                          {activity.placed_orders.length}
                        </span>
                      )}
                    </button>
                    <button
                      onClick={() => setCardTabState(prev => ({ ...prev, [table.table_number]: 'service' }))}
                      className={`flex-1 ${isMobile ? 'py-3' : 'py-1.5'} text-xs font-semibold flex items-center justify-center gap-1 transition-colors ${activeTab === 'service' ? 'bg-gray-900 text-white' : 'bg-white text-gray-600 hover:bg-gray-50'}`}
                    >
                      Service
                      {tableCalls.length > 0 && (
                        <span className={`text-[10px] rounded-full w-4 h-4 inline-flex items-center justify-center font-bold ${activeTab === 'service' ? 'bg-white text-gray-900' : 'bg-red-500 text-white'}`}>
                          {tableCalls.length}
                        </span>
                      )}
                    </button>
                  </div>

                  {/* Row 5: Inline content */}
                  <div className="mt-2">
                    {activeTab === 'orders' && (
                      <div className="space-y-1">
                        {activity.placed_orders.length === 0 ? (
                          <p className="text-xs text-gray-400 text-center py-2">No orders yet</p>
                        ) : (
                          <>
                            {activity.placed_orders.flatMap((order, oi) =>
                              (order.items || []).map((item, idx) => ({
                                ...item,
                                dinerName: order.diner_name,
                                key: `${oi}-${idx}`,
                              })),
                            ).slice(0, 5).map(item => (
                              <div key={item.key} className="flex items-center justify-between text-xs py-1 border-b border-gray-50 last:border-0">
                                <div className="flex items-center gap-1.5 min-w-0 flex-1">
                                  <span className="text-gray-900 font-medium whitespace-nowrap">{item.quantity}&times;</span>
                                  <span title={item.name ?? ''} className="text-gray-700 truncate">{item.name}</span>
                                </div>
                                <div className="flex items-center gap-2 flex-shrink-0 ml-2">
                                  {item.dinerName && (
                                    <span title={item.dinerName} className="text-gray-400 text-[11px] truncate max-w-[60px]">{item.dinerName}</span>
                                  )}
                                  <span className="text-gray-600 font-medium whitespace-nowrap">${(item.price * item.quantity).toFixed(2)}</span>
                                </div>
                              </div>
                            ))}
                            {(() => {
                              const total = activity.placed_orders.reduce((s, o) => s + (o.items?.length ?? 0), 0);
                              return total > 5 ? <p className="text-[11px] text-gray-400 text-center pt-1">+{total - 5} more item{total - 5 !== 1 ? 's' : ''}</p> : null;
                            })()}
                          </>
                        )}
                      </div>
                    )}
                    {activeTab === 'service' && (
                      <div className="space-y-1.5">
                        {tableCalls.length === 0 ? (
                          <p className="text-xs text-gray-400 text-center py-2">No service requests</p>
                        ) : tableCalls.map(call => (
                          <div key={call.id} className={`flex items-center justify-between rounded-lg px-2.5 py-2 ${call.status === 'overdue' ? 'bg-orange-50' : 'bg-red-50'}`}>
                            <div className="flex items-center gap-2 min-w-0">
                              {call.status === 'overdue'
                                ? <AlertTriangle className="h-3.5 w-3.5 text-orange-500 flex-shrink-0" />
                                : <BellRing className="h-3.5 w-3.5 text-red-500 flex-shrink-0" />
                              }
                              <div className="min-w-0">
                                <p title={callTypeLabel(call.call_type ?? '')} className="text-xs font-medium text-gray-800 truncate">{callTypeLabel(call.call_type ?? '')}</p>
                                <p className={`text-[11px] ${call.status === 'overdue' ? 'text-orange-500' : 'text-red-400'}`}>{timeSince(call.created_at)}</p>
                              </div>
                            </div>
                            <button
                              onClick={() => handleAcknowledgeCall(call.id)}
                              className={`ml-2 flex items-center justify-center gap-1 rounded-md font-semibold text-white bg-gray-800 active:bg-gray-900 flex-shrink-0 ${isMobile ? 'min-h-[44px] px-4 text-sm' : 'px-2 py-1 text-[11px]'}`}
                              data-testid={`drinks-table-ack-call-${table.table_number}`}
                            >
                              <Check className={isMobile ? 'h-4 w-4' : 'h-3 w-3'} />
                              Done
                            </button>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </>
              )}

              {/* Management controls: server assignment, seats, delete */}
              <div className="mt-3 pt-3 border-t border-gray-100 space-y-2">
                <Select
                  fullWidth
                  size="sm"
                  className={isMobile ? '[&>button]:min-h-[44px]' : ''}
                  value={table.assigned_server_id || ''}
                  onChange={e => handleAssignServer(table.id, e.target.value || null)}
                  placeholder="No server assigned"
                  options={[
                    { value: '', label: 'No server assigned' },
                    ...staff.map(s => ({ value: s.id, label: s.name })),
                  ]}
                  data-testid={`drinks-table-server-select-${table.table_number}`}
                />
                <div className="flex items-center gap-2">
                  <span className="text-xs text-gray-500 whitespace-nowrap">Seats:</span>
                  <input
                    type="number"
                    min={0}
                    value={capacityEdits[table.id] ?? table.capacity ?? 0}
                    onChange={e => handleCapacityChange(table.id, e.target.value)}
                    className={`px-2 text-xs border border-gray-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-orange-400 text-center ${isMobile ? 'w-20 min-h-[44px]' : 'w-16 py-1'}`}
                    data-testid={`drinks-table-seats-${table.table_number}`}
                  />
                  {capacityEdits[table.id] !== undefined && capacityEdits[table.id] !== (table.capacity ?? 0) && (
                    <button
                      onClick={() => handleSaveCapacity(table.id)}
                      disabled={savingCapacity[table.id]}
                      className={`px-3 text-xs bg-orange-500 text-white rounded-lg disabled:opacity-50 ${isMobile ? 'min-h-[44px]' : 'py-1'}`}
                    >
                      {savingCapacity[table.id] ? <Loader2 className="h-3 w-3 animate-spin" /> : 'Save'}
                    </button>
                  )}
                </div>
                {!isOccupied && service.deleteTable && (
                  <button
                    onClick={() => setDeleteConfirm({ tableId: table.id, tableNumber: table.table_number })}
                    className={`w-full px-2 text-xs border border-red-200 text-red-600 rounded-lg hover:bg-red-50 transition-colors flex items-center justify-center gap-1 ${isMobile ? 'min-h-[44px]' : 'py-1.5'}`}
                    data-testid={`drinks-table-delete-${table.table_number}`}
                  >
                    <Trash2 className="h-3 w-3" />
                    Delete Table
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {addTableModal}

      {/* QR Code Modal */}
      {qrModalTable && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center"
          onClick={() => setQrModalTable(null)}
        >
          <div className="absolute inset-0 bg-black/50" />
          <div className="relative bg-white rounded-2xl shadow-2xl p-6 mx-4 max-w-sm w-full" onClick={e => e.stopPropagation()}>
            <button onClick={() => setQrModalTable(null)} className="absolute top-3 right-3 p-1.5 text-gray-400 hover:text-gray-600 rounded-lg">
              <X className="h-5 w-5" />
            </button>
            <h3 className="text-lg font-bold text-gray-900 text-center mb-1">
              {qrModalTable.table_label || `Table ${qrModalTable.table_number}`} &middot; Drinks
            </h3>
            <div className="flex items-center justify-center bg-gray-50 rounded-xl p-4 aspect-square">
              {qrModalTable.drinks_qr_code_url ? (
                <img src={qrModalTable.drinks_qr_code_url} alt={`Drinks QR code for Table ${qrModalTable.table_number}`} className="w-full h-full object-contain" />
              ) : (
                <div className="text-center text-gray-400">
                  <QrCode className="w-16 h-16 mx-auto mb-2" />
                  <p className="text-sm">Drinks QR code not generated</p>
                  <p className="text-xs mt-1">Use Generate Drinks QR above</p>
                </div>
              )}
            </div>
            <p className="text-xs text-gray-400 text-center mt-3">Scan to open the standalone drinks menu for this table</p>
          </div>
        </div>
      )}

      {/* Delete Table Confirmation Modal */}
      {deleteConfirm && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center"
          style={{ backgroundColor: 'rgba(0,0,0,0.5)' }}
          onClick={(e) => { if (e.target === e.currentTarget) setDeleteConfirm(null); }}
        >
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm mx-4 p-6">
            <div className="flex items-start gap-3 mb-4">
              <div className="flex-shrink-0 w-10 h-10 rounded-full bg-red-100 flex items-center justify-center">
                <AlertTriangle className="h-5 w-5 text-red-600" />
              </div>
              <div>
                <h2 className="text-lg font-bold text-gray-900">Delete Table {deleteConfirm.tableNumber}</h2>
                <p className="text-sm text-gray-500 mt-1">
                  This will permanently remove Table #{deleteConfirm.tableNumber} and its QR codes (food + drinks). This cannot be undone.
                </p>
              </div>
            </div>
            <div className="flex gap-3 justify-end">
              <button
                onClick={() => setDeleteConfirm(null)}
                disabled={deleting}
                className="px-4 py-2 text-sm font-medium text-gray-600 border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={() => handleDeleteTable(deleteConfirm.tableId)}
                disabled={deleting}
                className="px-4 py-2 text-sm font-bold text-white bg-red-600 rounded-lg hover:bg-red-700 transition-colors disabled:opacity-50 flex items-center gap-2"
                data-testid="drinks-table-delete-confirm"
              >
                {deleting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
                {deleting ? 'Deleting...' : 'Delete'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
