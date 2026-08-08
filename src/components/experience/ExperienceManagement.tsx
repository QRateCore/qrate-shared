'use client';

import { useState, useEffect, useCallback, useMemo, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import {
  LayoutGrid,
  Plus,
  Loader2,
  QrCode,
  Download,
  Trash2,
  BellRing,
  AlertTriangle,
  Check,
  X,
  Settings2,
} from 'lucide-react';
import type { ExperienceService, RestaurantTable, StaffMember, TableActivity, WaiterCall, TableActivityEntry } from '../../types/experience';
import StaffManagement from '../staff/StaffManagement';
import KitchenTab from './KitchenTab';
import Select from '../common/Select';
import { timeSince, initials, callTypeLabel, avatarColor } from './table-utils';
import { useIsMobile } from '../../hooks/useIsMobile';

type Tab = 'staff' | 'tables' | 'kitchen';

interface ExperienceManagementProps {
  initialTab?: Tab;
  restaurantId?: string | null;
  service: ExperienceService;
  /**
   * Optional owner-only deep link to the dedicated in-shift floor board
   * (`/owner/host-station`). When provided, the mobile Tables tab surfaces
   * an "Open Host Station" affordance for full sound/push alerting — which
   * this management surface deliberately does NOT duplicate. Omitted by
   * waiter/admin consumers, so no link renders there.
   */
  hostStationHref?: string;
  /**
   * KDS deep-link base (`NEXT_PUBLIC_KDS_URL`) + a QR renderer, threaded to the Kitchen tab so it can
   * show a scannable pair-QR without pulling the `qrcode.react` dep into this shared package. Both
   * omitted by waiter/admin consumers → the Kitchen tab shows the typed code only, no QR.
   */
  kdsUrl?: string;
  renderPairingQr?: (value: string) => ReactNode;
  /**
   * Whether to show the Kitchen (KDS pairing) tab. Defaults to `true` so waiter/admin
   * consumers are unaffected. The owner app passes `false` (STR-950) to hide it — the
   * tab is dropped from the bar and a `?tab=kitchen` deep-link falls back to Tables.
   */
  showKitchenTab?: boolean;
}

export default function ExperienceManagement({ initialTab = 'tables', restaurantId, service, hostStationHref, kdsUrl, renderPairingQr, showKitchenTab = true }: ExperienceManagementProps) {
  const [activeTab, setActiveTab] = useState<Tab>(
    !showKitchenTab && initialTab === 'kitchen' ? 'tables' : initialTab,
  );
  const [tabCounts, setTabCounts] = useState<{ tables?: number }>({});
  const isMobile = useIsMobile();
  // Desktop only: the active tab portals its primary controls (Add Table /
  // Add Staff / QR actions) into this node so they sit on the tab row instead
  // of a second header strip below it. On a phone the row has no space, so the
  // slot isn't rendered and each tab falls back to its own inline button block.
  const [actionsSlot, setActionsSlot] = useState<HTMLDivElement | null>(null);

  const fetchTabCounts = useCallback(async () => {
    if (!restaurantId) return;
    try {
      const tablesData = await service.getTables(restaurantId).catch(() => null);
      setTabCounts({
        tables: tablesData ? tablesData.tables.filter(t => t.table_number < 9900).length : undefined,
      });
    } catch {
      // Non-critical — badges will just not show
    }
  }, [restaurantId, service]);

  useEffect(() => {
    fetchTabCounts();
    const interval = setInterval(fetchTabCounts, 15_000);
    return () => clearInterval(interval);
  }, [fetchTabCounts]);

  const tabs = [
    { id: 'staff' as Tab, label: 'Staff', count: undefined as number | undefined },
    { id: 'tables' as Tab, label: 'Tables', count: tabCounts.tables as number | undefined },
    ...(showKitchenTab
      ? [{ id: 'kitchen' as Tab, label: 'Kitchen', count: undefined as number | undefined }]
      : []),
  ];

  return (
    <div className="space-y-6">
      {/* Underline tab strip — same treatment as Insights / Payments. The page
          controls for the active tab portal into the right-hand slot so this
          single row is the surface's top bar. */}
      <div className="mb-4 flex items-end justify-between gap-3 border-b border-gray-200">
        <div
          className="flex gap-0.5 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
          role="tablist"
          aria-label="Tables and Staff"
          data-testid="experience-tabs"
        >
          {tabs.map((tab) => (
            <button
              key={tab.id}
              type="button"
              role="tab"
              aria-selected={activeTab === tab.id}
              onClick={() => setActiveTab(tab.id)}
              data-testid={`experience-tab-${tab.id}`}
              className={`flex items-center gap-2 px-4 py-2.5 text-[13.5px] font-semibold whitespace-nowrap border-b-2 -mb-px transition-colors ${
                activeTab === tab.id
                  ? 'border-orange-500 text-orange-600'
                  : 'border-transparent text-gray-500 hover:text-gray-700'
              }`}
            >
              {tab.label}
              {tab.count != null && (
                <span
                  className={`px-2 py-0.5 text-xs rounded-full font-medium ${
                    activeTab === tab.id ? 'bg-orange-100 text-orange-700' : 'bg-gray-100 text-gray-600'
                  }`}
                >
                  {tab.count}
                </span>
              )}
            </button>
          ))}
        </div>
        {!isMobile && (
          <div
            ref={setActionsSlot}
            data-testid="experience-tab-actions"
            className="flex items-center gap-2 pb-2"
          />
        )}
      </div>

      {/* Tab Content */}
      <div className="bg-white rounded-xl shadow-lg p-6">
        {activeTab === 'staff' && <StaffManagement restaurantId={restaurantId ?? null} service={service} actionsSlot={actionsSlot} />}
        {activeTab === 'tables' && <TablesTab restaurantId={restaurantId || undefined} service={service} hostStationHref={hostStationHref} actionsSlot={actionsSlot} />}
        {showKitchenTab && activeTab === 'kitchen' && <KitchenTab restaurantId={restaurantId || undefined} service={service} kdsUrl={kdsUrl} renderPairingQr={renderPairingQr} />}
      </div>
    </div>
  );
}

function TablesTab({ restaurantId, service, hostStationHref, actionsSlot }: { restaurantId?: string; service: ExperienceService; hostStationHref?: string; actionsSlot?: HTMLElement | null }) {
  const isMobile = useIsMobile();
  // Mobile-only: which occupied cards have the config controls ("Manage")
  // expanded. Config is collapsed by default on a phone so the card's
  // default state is glanceable READ (status / calls / orders). Desktop
  // always shows the controls (this Set is ignored when !isMobile).
  const [expandedManage, setExpandedManage] = useState<Set<number>>(new Set());
  const [tables, setTables] = useState<RestaurantTable[]>([]);
  const [staff, setStaff] = useState<StaffMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; message: string } | null>(null);
  const [capacityEdits, setCapacityEdits] = useState<Record<string, number>>({});
  const [savingCapacity, setSavingCapacity] = useState<Record<string, boolean>>({});

  // Add table modal
  const [showAddModal, setShowAddModal] = useState(false);
  const [addCount, setAddCount] = useState(1);
  const [addStartNumber, setAddStartNumber] = useState(1);
  const [addingTables, setAddingTables] = useState(false);

  // Reset state
  const [resetting, setResetting] = useState(false);
  const [showResetModal, setShowResetModal] = useState(false);
  const [resetConfirmText, setResetConfirmText] = useState('');

  // Waiter calls
  const [waiterCalls, setWaiterCalls] = useState<WaiterCall[]>([]);
  const [tableActivity, setTableActivity] = useState<TableActivity | null>(null);

  // Per-card tab state and QR modal
  const [cardTabState, setCardTabState] = useState<Record<number, 'orders' | 'service'>>({});
  const [qrModalTable, setQrModalTable] = useState<RestaurantTable | null>(null);

  // Delete table
  const [deleteConfirm, setDeleteConfirm] = useState<{ tableId: string; tableNumber: number } | null>(null);
  const [deleting, setDeleting] = useState(false);

  const fetchTableActivity = useCallback(async () => {
    if (!restaurantId) return;
    try {
      const data = await service.getTableActivity(restaurantId);
      setTableActivity(data);
    } catch {
      // Non-fatal
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

  const handleAcknowledgeCall = async (callId: string) => {
    // Optimistic: drop the call immediately — this is the single most
    // time-critical in-shift tap, and on restaurant wifi an await-then-remove
    // felt laggy. Re-add on failure (only if a poll hasn't already restored it)
    // so a service request is never silently lost.
    const call = waiterCalls.find(c => c.id === callId);
    setWaiterCalls(prev => prev.filter(c => c.id !== callId));
    try {
      await service.acknowledgeWaiterCall(callId);
    } catch {
      if (call) setWaiterCalls(prev => (prev.some(c => c.id === callId) ? prev : [...prev, call]));
      showFeedback('error', 'Failed to dismiss call');
    }
  };

  const handleReset = async () => {
    if (!restaurantId) return;
    setResetting(true);
    showFeedback('success', 'Resetting...');
    try {
      // 1. Refresh table activity immediately to get the latest active sessions
      //    (avoids skipping sessions that weren't in the stale cached state).
      let freshActivity: TableActivity | null = null;
      try {
        freshActivity = await service.getTableActivity(restaurantId);
        setTableActivity(freshActivity);
      } catch { /* best effort — fall back to cached state */ }

      // 2. Close each active table session (sends farewell to patrons)
      if (service.closeTableSession) {
        const activityToUse = freshActivity ?? tableActivity;
        const activeTables = activityToUse?.tables?.filter(t => t.has_active_session) ?? [];
        for (const t of activeTables) {
          try { await service.closeTableSession(restaurantId, t.table_number); } catch { /* best effort */ }
        }
      }

      // 3. Purge any remaining WebSocket sessions (cleanup DynamoDB + SQL state)
      await service.purgeSessions!(restaurantId);

      // 4. Purge all orders (archives + soft-deletes)
      await service.purgeOrders!(restaurantId);

      // 5. Resolve all waiter calls
      const freshCalls = await service.getWaiterCalls(restaurantId);
      for (const call of freshCalls) {
        try { await service.acknowledgeWaiterCall(call.id); } catch { /* best effort */ }
      }

      // Refresh all data
      setWaiterCalls([]);
      await fetchTables();
      await fetchTableActivity();
      showFeedback('success', 'Restaurant reset — all sessions, orders, and service requests cleared');
    } catch (err: any) {
      showFeedback('error', err.message || 'Failed to reset restaurant');
    } finally {
      setResetting(false);
    }
  };

  const fetchTables = useCallback(async () => {
    if (!restaurantId) return;
    setLoading(true);
    try {
      const data = await service.getTables(restaurantId);
      setTables(data.tables.filter(t => t.table_number < 9900));
    } catch (err) {
      console.error('Failed to load tables:', err);
      showFeedback('error', 'Failed to load tables');
    } finally {
      setLoading(false);
    }
  }, [restaurantId, service]);

  const fetchStaff = useCallback(async () => {
    if (!restaurantId) return;
    try {
      const data = await service.getStaff(restaurantId);
      setStaff(data.staff.filter(s => s.is_active));
    } catch (err) {
      console.error('Failed to load staff:', err);
    }
  }, [restaurantId, service]);

  useEffect(() => {
    fetchTables();
    fetchStaff();
    fetchWaiterCalls();
    fetchTableActivity();
    const interval = setInterval(() => {
      fetchWaiterCalls();
      fetchTableActivity();
      // Re-poll staff so a server added/activated mid-shift (from another
      // device or the Staff tab) appears in the per-table assignment dropdown.
      // Previously fetchStaff ran only once at mount → stale dropdown options.
      fetchStaff();
    }, 10000);
    return () => clearInterval(interval);
  }, [fetchTables, fetchStaff, fetchWaiterCalls, fetchTableActivity]);

  const showFeedback = (type: 'success' | 'error', message: string) => {
    setFeedback({ type, message });
    setTimeout(() => setFeedback(null), 3000);
  };

  const handleGenerate = async () => {
    if (!restaurantId) return;
    setGenerating(true);
    try {
      const result = await service.generateQRCodes(restaurantId);
      showFeedback('success', result.message || `Generated QR codes for ${result.tables.length} tables`);
      await fetchTables();
    } catch (err) {
      console.error('Failed to generate QR codes:', err);
      showFeedback('error', 'Failed to generate QR codes');
    } finally {
      setGenerating(false);
    }
  };

  const handleDownloadZip = async () => {
    if (!restaurantId) return;
    setDownloading(true);
    try {
      const result = await service.downloadQRCodesZip(restaurantId);
      window.open(result.download_url, '_blank');
      showFeedback('success', `Downloading ${result.table_count} QR codes`);
    } catch (err) {
      console.error('Failed to download ZIP:', err);
      showFeedback('error', 'Failed to download QR codes');
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
      await service.updateTable(restaurantId, tableId, {
        capacity: capacityEdits[tableId],
      });
      setTables(prev =>
        prev.map(t => t.id === tableId ? { ...t, capacity: capacityEdits[tableId] } : t)
      );
      setCapacityEdits(prev => {
        const next = { ...prev };
        delete next[tableId];
        return next;
      });
      showFeedback('success', 'Capacity updated');
    } catch (err) {
      console.error('Failed to update capacity:', err);
      showFeedback('error', 'Failed to update capacity');
    } finally {
      setSavingCapacity(prev => ({ ...prev, [tableId]: false }));
    }
  };

  const handleAssignServer = async (tableId: string, serverId: string | null) => {
    if (!restaurantId) return;
    try {
      await service.updateTable(restaurantId, tableId, {
        assigned_server_id: serverId,
      });
      setTables(prev =>
        prev.map(t => t.id === tableId ? { ...t, assigned_server_id: serverId } : t)
      );
      showFeedback('success', serverId ? 'Server assigned' : 'Server unassigned');
    } catch (err) {
      console.error('Failed to assign server:', err);
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
    } catch (err) {
      console.error('Failed to delete table:', err);
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
      await service.createTables(restaurantId, {
        table_count: addCount,
        start_number: addStartNumber,
      });
      // Auto-generate QR codes for new tables
      try {
        await service.generateQRCodes(restaurantId);
      } catch {
        // Non-fatal
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

  const tablesWithQR = tables.filter(t => t.qr_code_url);
  const activeTables = tables.filter(t => t.is_active);
  // Distinct occupied tables with an active/overdue service call — drives the
  // mobile "needs service" banner (glanceable urgency without scanning cards).
  const tablesNeedingService = new Set(
    waiterCalls
      .filter(c => (c.status === 'active' || c.status === 'overdue') && c.table_number != null)
      .map(c => c.table_number)
  ).size;

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

  if (tables.length === 0) {
    return (
      <>
        <div className="text-center py-12 text-gray-500">
          <LayoutGrid className="h-8 w-8 mx-auto mb-3 opacity-40" />
          <p className="font-medium">No tables found</p>
          <p className="text-sm mt-1">Tables will appear here once created</p>
          <button
            onClick={() => setShowAddModal(true)}
            className="mt-4 bg-orange-500 text-white px-4 py-2 rounded-lg font-medium hover:bg-orange-600 transition-colors text-sm inline-flex items-center gap-2"
          >
            <Plus className="h-4 w-4" />
            Add Table
          </button>
        </div>

        {/* Add Table Modal */}
        {showAddModal && (
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
                >
                  {addingTables ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
                  {addingTables ? 'Creating...' : 'Create'}
                </button>
              </div>
            </div>
          </div>
        )}
      </>
    );
  }

  // Primary controls for this tab. On desktop they portal into the tab-row
  // slot; on mobile (no slot) they stay inline under the count line.
  const tableActions = (
    <>
      {tablesWithQR.length > 0 && (
        <button
          onClick={handleDownloadZip}
          disabled={downloading}
          className="px-4 py-2 border border-gray-200 rounded-lg font-medium text-gray-600 hover:bg-gray-50 transition-colors text-sm flex items-center gap-2 disabled:opacity-50"
        >
          {downloading ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Download className="h-4 w-4" />
          )}
          Download All
        </button>
      )}
      <button
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
            {tablesWithQR.length > 0 ? 'Regenerate QR' : 'Generate QR'}
          </>
        )}
      </button>
      <button
        onClick={() => setShowAddModal(true)}
        className="bg-orange-500 text-white px-4 py-2 rounded-lg font-medium hover:bg-orange-600 transition-colors text-sm flex items-center gap-2"
      >
        <Plus className="h-4 w-4" />
        Add Table
      </button>
      {service.purgeSessions && service.purgeOrders && (
        <button
          onClick={() => { setResetConfirmText(''); setShowResetModal(true); }}
          disabled={resetting}
          className="px-4 py-2 border border-red-200 rounded-lg font-medium text-red-600 hover:bg-red-50 transition-colors text-sm flex items-center gap-2 disabled:opacity-50"
        >
          {resetting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
          {resetting ? 'Resetting...' : 'Reset Restaurant'}
        </button>
      )}
    </>
  );

  return (
    <div>
      {/* Header — the title is gone (the tab row labels this surface); only the
          glanceable count line stays. Controls live on the tab row on desktop. */}
      <div className={isMobile ? 'flex flex-col gap-3 mb-4' : 'flex items-center justify-between mb-6'}>
        <p className="text-sm text-gray-500">
          {activeTables.length} active table{activeTables.length !== 1 ? 's' : ''}
          {' '}&middot;{' '}
          {tablesWithQR.length} with QR codes
        </p>
        {actionsSlot
          ? createPortal(tableActions, actionsSlot)
          : (
            <div className={`flex gap-2 ${isMobile ? 'flex-wrap [&>button]:min-h-[44px]' : ''}`}>
              {tableActions}
            </div>
          )}
      </div>

      {/* Reset Restaurant confirmation modal */}
      {showResetModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center"
          style={{ backgroundColor: 'rgba(0,0,0,0.5)' }}
          onClick={(e) => { if (e.target === e.currentTarget) { setShowResetModal(false); setResetConfirmText(''); } }}
        >
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md mx-4 p-6">
            <div className="flex items-start gap-3 mb-4">
              <div className="flex-shrink-0 w-10 h-10 rounded-full bg-red-100 flex items-center justify-center">
                <AlertTriangle className="h-5 w-5 text-red-600" />
              </div>
              <div>
                <h2 className="text-lg font-bold text-gray-900">Reset Restaurant</h2>
                <p className="text-sm text-gray-500 mt-1">
                  This will immediately disconnect all active patrons, complete and archive all open orders, and clear all service requests. This cannot be undone.
                </p>
              </div>
            </div>
            <div className="mb-5">
              <label className="block text-sm font-medium text-gray-700 mb-1.5">
                Type <span className="font-mono font-bold text-red-600">purge</span> to confirm
              </label>
              <input
                type="text"
                value={resetConfirmText}
                onChange={(e) => setResetConfirmText(e.target.value)}
                placeholder="purge"
                autoFocus
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && resetConfirmText === 'purge') {
                    setShowResetModal(false);
                    handleReset();
                  }
                }}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-red-300 focus:border-red-400"
              />
            </div>
            <div className="flex gap-3 justify-end">
              <button
                onClick={() => { setShowResetModal(false); setResetConfirmText(''); }}
                className="px-4 py-2 text-sm font-medium text-gray-600 border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={() => { setShowResetModal(false); handleReset(); }}
                disabled={resetConfirmText !== 'purge'}
                className="px-4 py-2 text-sm font-bold text-white bg-red-600 rounded-lg hover:bg-red-700 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
              >
                Reset Restaurant
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Feedback */}
      {feedback && (
        <div
          className={`mb-4 px-4 py-2.5 rounded-lg text-sm font-medium ${
            feedback.type === 'success'
              ? 'bg-green-100 text-green-700'
              : 'bg-red-100 text-red-700'
          }`}
        >
          {feedback.message}
        </div>
      )}

      {/* Mobile-only "needs service" banner — surfaces call urgency at the top
          of the tab without the manager scanning every card. Full live alerting
          (sound/push) stays in Host Station (linked when hostStationHref given). */}
      {isMobile && tablesNeedingService > 0 && (
        <div className="mb-4 flex items-center justify-between gap-3 rounded-xl bg-red-50 border border-red-200 px-4 py-3">
          <div className="flex items-center gap-2 min-w-0">
            <BellRing className="h-5 w-5 text-red-500 flex-shrink-0" />
            <span className="text-sm font-semibold text-red-700 truncate">
              {tablesNeedingService} table{tablesNeedingService !== 1 ? 's' : ''} need{tablesNeedingService === 1 ? 's' : ''} service
            </span>
          </div>
          {hostStationHref && (
            <a
              href={hostStationHref}
              className="flex-shrink-0 text-xs font-semibold text-red-700 underline underline-offset-2 min-h-[44px] flex items-center"
            >
              Open Host Station →
            </a>
          )}
        </div>
      )}

      {/* Table Grid — host station style */}
      {(() => {
        const sorted = [...tables]
          .filter(t => t.is_active)
          .sort((a, b) => {
            const actA = tableActivity?.tables?.find(t => t.table_number === a.table_number);
            const actB = tableActivity?.tables?.find(t => t.table_number === b.table_number);
            const hasA = actA?.has_active_session === true;
            const hasB = actB?.has_active_session === true;
            const callA = waiterCalls.filter(c => c.table_number === a.table_number && (c.status === 'active' || c.status === 'overdue')).length;
            const callB = waiterCalls.filter(c => c.table_number === b.table_number && (c.status === 'active' || c.status === 'overdue')).length;
            if (hasA !== hasB) return hasA ? -1 : 1;
            if (hasA && callA !== callB) return callB - callA;
            return a.table_number - b.table_number;
          });

        return (
          <div className={`grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3 ${isMobile ? 'pb-24' : ''}`}>
            {sorted.map(table => {
              const activity = tableActivity?.tables?.find(t => t.table_number === table.table_number) ?? null;
              const isOccupied = activity?.has_active_session === true;
              const borderClass = isOccupied ? 'border-red-400' : 'border-green-400';
              const tableCalls = waiterCalls.filter(c => c.table_number === table.table_number && (c.status === 'active' || c.status === 'overdue'));
              // Mobile: when a table has active calls and the manager hasn't
              // explicitly picked a sub-tab, default to Service so the call + the
              // large "Done" ack show without a tap (desktop keeps the Orders default).
              const activeTab = cardTabState[table.table_number] ?? ((isMobile && tableCalls.length > 0) ? 'service' : 'orders');
              const serverName = table.assigned_server_id ? (staff.find(s => s.id === table.assigned_server_id)?.name ?? null) : null;

              return (
                <div key={table.id} className={`border-2 border-dashed rounded-xl p-3 bg-white ${borderClass}`}>
                  {/* Row 1: Table name + server + QR + seats */}
                  <div className="flex items-center justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-baseline gap-2">
                        <h3 className="font-bold text-base text-gray-900 whitespace-nowrap">Table {table.table_number}</h3>
                        {serverName && (
                          <span title={`Server: ${serverName}`} className="text-xs text-gray-400 truncate">Server: {serverName}</span>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center gap-1 flex-shrink-0">
                      <button
                        onClick={() => setQrModalTable(table)}
                        className={`rounded-md hover:bg-gray-100 transition-colors ${isMobile ? 'min-h-[44px] min-w-[44px] flex items-center justify-center' : 'p-1.5'}`}
                        title="Show QR code"
                      >
                        <QrCode className={`h-4 w-4 ${isOccupied ? 'text-red-400' : 'text-green-500'}`} />
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
                                  }))
                                ).slice(0, 5).map(item => (
                                  <div key={item.key} className="flex items-center justify-between text-xs py-1 border-b border-gray-50 last:border-0">
                                    <div className="flex items-center gap-1.5 min-w-0 flex-1">
                                      <span className="text-gray-900 font-medium whitespace-nowrap">{item.quantity}&times;</span>
                                      <span title={item.name} className="text-gray-700 truncate">{item.name}</span>
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
                                  data-testid={`table-ack-call-${table.table_number}`}
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

                  {/* Management controls. Mobile: config (server / seats / delete)
                      collapses behind "Manage" so the card default is glanceable READ;
                      Reset Table stays visible below (in-shift core). Desktop: always shown. */}
                  <div className="mt-3 pt-3 border-t border-gray-100 space-y-2">
                    {isMobile && (
                      <button
                        onClick={() => setExpandedManage(prev => {
                          const n = new Set(prev);
                          if (n.has(table.table_number)) n.delete(table.table_number);
                          else n.add(table.table_number);
                          return n;
                        })}
                        className="w-full flex items-center justify-center gap-1.5 min-h-[44px] text-xs font-semibold text-gray-600 rounded-lg bg-gray-50 hover:bg-gray-100 transition-colors"
                        data-testid={`table-manage-toggle-${table.table_number}`}
                        aria-expanded={expandedManage.has(table.table_number)}
                      >
                        <Settings2 className="h-4 w-4" />
                        {expandedManage.has(table.table_number) ? 'Hide manage' : 'Manage'}
                      </button>
                    )}
                    {(!isMobile || expandedManage.has(table.table_number)) && (
                    <>
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
                    />
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-gray-500 whitespace-nowrap">Seats:</span>
                      <input
                        type="number"
                        min={0}
                        value={capacityEdits[table.id] ?? table.capacity ?? 0}
                        onChange={e => handleCapacityChange(table.id, e.target.value)}
                        className={`px-2 text-xs border border-gray-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-orange-400 text-center ${isMobile ? 'w-20 min-h-[44px]' : 'w-16 py-1'}`}
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
                        data-testid={`table-delete-${table.table_number}`}
                      >
                        <Trash2 className="h-3 w-3" />
                        Delete Table
                      </button>
                    )}
                    </>
                    )}
                    {isOccupied && service.closeTableSession && (
                      <button
                        onClick={async () => {
                          if (!restaurantId || !confirm(`Reset Table #${table.table_number}? This will end the session and remove all guests.`)) return;
                          try {
                            await service.closeTableSession!(restaurantId, table.table_number);
                            setTableActivity(prev => prev ? {
                              ...prev,
                              tables: prev.tables.map(t =>
                                t.table_number === table.table_number
                                  ? { ...t, guests: [], active_carts: [], placed_orders: [], has_active_session: false, needs_attention: false }
                                  : t
                              ),
                            } : prev);
                            setWaiterCalls(prev => prev.filter(c => c.table_number !== table.table_number));
                            showFeedback('success', `Table #${table.table_number} reset`);
                          } catch {
                            showFeedback('error', `Failed to reset Table #${table.table_number}`);
                          }
                        }}
                        className={`w-full px-2 text-xs border border-red-200 text-red-600 rounded-lg hover:bg-red-50 transition-colors flex items-center justify-center gap-1 ${isMobile ? 'min-h-[44px]' : 'py-1.5'}`}
                      >
                        <Trash2 className="h-3 w-3" />
                        Reset Table
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        );
      })()}

      {/* Add Table Modal */}
      {showAddModal && (
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
              >
                {addingTables ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
                {addingTables ? 'Creating...' : 'Create'}
              </button>
            </div>
          </div>
        </div>
      )}

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
            <h3 className="text-lg font-bold text-gray-900 text-center mb-1">Table {qrModalTable.table_number}</h3>
            {qrModalTable.assigned_server_id && staff.find(s => s.id === qrModalTable.assigned_server_id) && (
              <p className="text-xs text-gray-400 text-center mb-4">
                Server: {staff.find(s => s.id === qrModalTable.assigned_server_id)?.name}
              </p>
            )}
            <div className="flex items-center justify-center bg-gray-50 rounded-xl p-4 aspect-square">
              {qrModalTable.qr_code_url ? (
                <img src={qrModalTable.qr_code_url} alt={`QR code for Table ${qrModalTable.table_number}`} className="w-full h-full object-contain" />
              ) : (
                <div className="text-center text-gray-400">
                  <QrCode className="w-16 h-16 mx-auto mb-2" />
                  <p className="text-sm">QR code not generated</p>
                  <p className="text-xs mt-1">Use Generate QR above</p>
                </div>
              )}
            </div>
            <p className="text-xs text-gray-400 text-center mt-3">Scan to open the menu for this table</p>
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
                  This will permanently remove Table #{deleteConfirm.tableNumber} and its QR code. This cannot be undone.
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
