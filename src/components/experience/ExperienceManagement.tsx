'use client';

import { useState, useEffect, useCallback } from 'react';
import {
  LayoutGrid,
  Users,
  Plus,
  ImageIcon,
  RefreshCw,
  Loader2,
  QrCode,
  Download,
  ExternalLink,
  Save,
  AlertTriangle,
  Bell,
  Trash2,
} from 'lucide-react';
import type { ExperienceService, RestaurantTable, StaffMember, TableActivity, WaiterCall } from '../../types/experience';
import StaffManagement from '../staff/StaffManagement';

type Tab = 'staff' | 'tables';

interface ExperienceManagementProps {
  initialTab?: Tab;
  restaurantId?: string | null;
  service: ExperienceService;
}

const THEME_LABELS: Record<string, string> = {
  default: 'Default',
  diwali: 'Diwali',
  christmas: 'Christmas',
  lunar_new_year: 'Lunar New Year',
  holi: 'Holi',
  eid_al_fitr: 'Eid al-Fitr',
  thanksgiving: 'Thanksgiving',
  valentines_day: "Valentine's Day",
  independence_day: '4th of July',
  new_year: 'New Year',
};

export default function ExperienceManagement({ initialTab = 'tables', restaurantId, service }: ExperienceManagementProps) {
  const [activeTab, setActiveTab] = useState<Tab>(initialTab);
  const [dynamicEnabled, setDynamicEnabled] = useState(false);
  const [currentTheme, setCurrentTheme] = useState<string | null>(null);
  const [lastGenerated, setLastGenerated] = useState<string | null>(null);
  const [toggling, setToggling] = useState(false);
  const [regenerating, setRegenerating] = useState(false);
  const [headerError, setHeaderError] = useState<string | null>(null);
  const [tabCounts, setTabCounts] = useState<{ tables?: number }>({});

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

  const fetchRestaurantInfo = useCallback(async () => {
    if (!restaurantId) return;
    try {
      const restaurant = await service.getRestaurant(restaurantId);
      setDynamicEnabled(restaurant.dynamic_headers_enabled || false);
      setCurrentTheme(restaurant.current_header_theme || null);
      setLastGenerated(restaurant.header_last_generated_at || null);
    } catch {
      // Restaurant info not critical for this page
    }
  }, [restaurantId, service]);

  useEffect(() => {
    fetchRestaurantInfo();
  }, [fetchRestaurantInfo]);

  const handleToggleDynamic = async () => {
    if (!restaurantId) return;
    setToggling(true);
    setHeaderError(null);
    try {
      const result = await service.toggleDynamicHeaders(restaurantId, !dynamicEnabled);
      setDynamicEnabled(result.dynamic_headers_enabled);
      setCurrentTheme(result.current_header_theme || null);
      setLastGenerated(result.header_last_generated_at || null);
      if (result.generation_error) {
        setHeaderError(result.generation_error);
      }
    } catch (err: any) {
      setHeaderError(err.message || 'Failed to toggle dynamic headers');
    } finally {
      setToggling(false);
    }
  };

  const handleRegenerate = async () => {
    if (!restaurantId) return;
    setRegenerating(true);
    setHeaderError(null);
    try {
      await service.regenerateHeader(restaurantId);
      await fetchRestaurantInfo();
    } catch (err: any) {
      setHeaderError(err.message || 'Failed to regenerate header');
    } finally {
      setRegenerating(false);
    }
  };

  const tabs = [
    { id: 'staff' as Tab, label: 'Staff', icon: Users, count: undefined as number | undefined },
    { id: 'tables' as Tab, label: 'Tables', icon: LayoutGrid, count: tabCounts.tables as number | undefined },
  ];

  return (
    <div className="space-y-6">
      {/* Dynamic Headers Card */}
      {restaurantId && (
        <div className="bg-white rounded-xl shadow-lg p-6">
          <div className="flex items-start justify-between">
            <div className="flex items-start gap-4">
              <div className="bg-gradient-to-br from-purple-100 to-orange-100 p-3 rounded-lg">
                <ImageIcon className="h-6 w-6 text-purple-600" />
              </div>
              <div>
                <h3 className="text-lg font-bold text-gray-900">Dynamic Header Images</h3>
                <p className="text-sm text-gray-500 mt-0.5">
                  Automatically generate and update your restaurant&apos;s header image based on your cuisine and upcoming festivities
                </p>
                {dynamicEnabled && (
                  <div className="flex items-center gap-3 mt-3">
                    {currentTheme && (
                      <span className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium bg-purple-100 text-purple-700">
                        {THEME_LABELS[currentTheme] || currentTheme} Theme
                      </span>
                    )}
                    {lastGenerated && (
                      <span className="text-xs text-gray-400">
                        Last generated: {new Date(lastGenerated).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' })}
                      </span>
                    )}
                  </div>
                )}
                {headerError && (
                  <p className="text-sm text-red-500 mt-2">{headerError}</p>
                )}
              </div>
            </div>
            <div className="flex items-center gap-3">
              {dynamicEnabled && (
                <button
                  onClick={handleRegenerate}
                  disabled={regenerating}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-purple-700 bg-purple-50 hover:bg-purple-100 rounded-lg transition-colors disabled:opacity-50"
                >
                  {regenerating ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
                  Regenerate Now
                </button>
              )}
              <button
                onClick={handleToggleDynamic}
                disabled={toggling}
                className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                  dynamicEnabled ? 'bg-orange-500' : 'bg-gray-200'
                } ${toggling ? 'opacity-50' : ''}`}
              >
                <span
                  className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                    dynamicEnabled ? 'translate-x-6' : 'translate-x-1'
                  }`}
                />
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="bg-white rounded-xl shadow-lg overflow-hidden">
        {/* Tabs */}
        <div className="border-b border-gray-100">
          <div className="flex overflow-x-auto">
            {tabs.map((tab) => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`flex items-center gap-2 px-6 py-4 font-medium text-sm whitespace-nowrap border-b-2 transition-colors ${
                  activeTab === tab.id
                    ? 'border-orange-500 text-orange-600 bg-orange-50/50'
                    : 'border-transparent text-gray-500 hover:text-gray-700 hover:bg-gray-50'
                }`}
              >
                <tab.icon className="h-5 w-5" />
                {tab.label}
                {'count' in tab && tab.count != null && (
                  <span
                    className={`px-2 py-0.5 text-xs rounded-full ${
                      activeTab === tab.id ? 'bg-orange-100 text-orange-700' : 'bg-gray-100 text-gray-600'
                    }`}
                  >
                    {tab.count}
                  </span>
                )}
              </button>
            ))}
          </div>
        </div>

        {/* Tab Content */}
        <div className="p-6">
          {activeTab === 'staff' && <StaffManagement restaurantId={restaurantId ?? null} service={service} />}
          {activeTab === 'tables' && <TablesTab restaurantId={restaurantId || undefined} service={service} />}
        </div>
      </div>
    </div>
  );
}

function TablesTab({ restaurantId, service }: { restaurantId?: string; service: ExperienceService }) {
  const [tables, setTables] = useState<RestaurantTable[]>([]);
  const [staff, setStaff] = useState<StaffMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; message: string } | null>(null);
  const [capacityEdits, setCapacityEdits] = useState<Record<string, number>>({});
  const [savingCapacity, setSavingCapacity] = useState<Record<string, boolean>>({});
  const [labelEdits, setLabelEdits] = useState<Record<string, string>>({});
  const [savingLabel, setSavingLabel] = useState<Record<string, boolean>>({});

  // Add table modal
  const [showAddModal, setShowAddModal] = useState(false);
  const [addCount, setAddCount] = useState(1);
  const [addStartNumber, setAddStartNumber] = useState(1);
  const [addingTables, setAddingTables] = useState(false);

  // QR code popup
  const [qrPopupTable, setQrPopupTable] = useState<RestaurantTable | null>(null);

  // Reset state
  const [resetting, setResetting] = useState(false);

  // Waiter calls
  const [waiterCalls, setWaiterCalls] = useState<{ id: string; table_number: number | null; status?: string; created_at: string }[]>([]);
  const [tableActivity, setTableActivity] = useState<TableActivity | null>(null);

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
    try {
      await service.acknowledgeWaiterCall(callId);
      setWaiterCalls(prev => prev.filter(c => c.id !== callId));
    } catch {
      showFeedback('error', 'Failed to dismiss call');
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

  const handleSaveLabel = async (tableId: string) => {
    if (!restaurantId || labelEdits[tableId] === undefined) return;
    const newLabel = labelEdits[tableId].trim();
    setSavingLabel(prev => ({ ...prev, [tableId]: true }));
    try {
      await service.updateTable(restaurantId, tableId, { table_label: newLabel || null });
      setTables(prev =>
        prev.map(t => t.id === tableId ? { ...t, table_label: newLabel || undefined } : t)
      );
      setLabelEdits(prev => {
        const next = { ...prev };
        delete next[tableId];
        return next;
      });
    } catch (err) {
      console.error('Failed to update label:', err);
      showFeedback('error', 'Failed to update label');
    } finally {
      setSavingLabel(prev => ({ ...prev, [tableId]: false }));
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
          <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50" onClick={() => setShowAddModal(false)}>
            <div className="bg-white rounded-2xl p-6 w-full max-w-sm mx-4 shadow-xl" onClick={e => e.stopPropagation()}>
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

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h3 className="text-lg font-bold text-gray-900">Table Management</h3>
          <p className="text-sm text-gray-500">
            {activeTables.length} active table{activeTables.length !== 1 ? 's' : ''}
            {' '}&middot;{' '}
            {tablesWithQR.length} with QR codes
          </p>
        </div>
        <div className="flex gap-2">
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
              onClick={async () => {
                if (!restaurantId) return;
                if (!confirm('Reset all sessions, orders, and service requests for this restaurant? This cannot be undone.')) return;
                setResetting(true);
                showFeedback('success', 'Resetting...');
                try {
                  // 1. Close each active table session (sends farewell to patrons)
                  if (service.closeTableSession && tableActivity?.tables) {
                    const activeTables = tableActivity.tables.filter(t => t.has_active_session);
                    for (const t of activeTables) {
                      try { await service.closeTableSession(restaurantId, t.table_number); } catch { /* best effort */ }
                    }
                  }
                  // 2. Purge any remaining WebSocket sessions (cleanup DynamoDB)
                  await service.purgeSessions!(restaurantId);
                  // 3. Purge all orders
                  await service.purgeOrders!(restaurantId);
                  // 3. Acknowledge all waiter calls
                  for (const call of waiterCalls) {
                    try { await service.acknowledgeWaiterCall(call.id); } catch { /* best effort */ }
                  }
                  // Re-acknowledge to resolve any already-acknowledged calls
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
              }}
              disabled={resetting}
              className="px-4 py-2 border border-red-200 rounded-lg font-medium text-red-600 hover:bg-red-50 transition-colors text-sm flex items-center gap-2 disabled:opacity-50"
            >
              {resetting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
              {resetting ? 'Resetting...' : 'Reset Restaurant'}
            </button>
          )}
        </div>
      </div>

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

      {/* Table List */}
      <div className="border border-gray-100 rounded-xl overflow-hidden">
        {/* Header */}
        <div className="grid items-center gap-3 px-4 py-2.5 bg-gray-50 border-b border-gray-100 text-xs font-semibold text-gray-500 uppercase tracking-wide"
          style={{ gridTemplateColumns: '80px 1fr 110px 1fr 130px 44px 44px' }}>
          <div>Table</div>
          <div>Label</div>
          <div className="flex items-center gap-1"><Users className="h-3.5 w-3.5" /> Seats</div>
          <div>Server</div>
          <div>Status</div>
          <div></div>
          <div></div>
        </div>

        {/* Rows */}
        {tables
          .filter(t => t.is_active)
          .sort((a, b) => a.table_number - b.table_number)
          .map(table => {
            const editedCapacity = capacityEdits[table.id];
            const hasCapacityEdit = editedCapacity !== undefined && editedCapacity !== (table.capacity ?? 0);
            const isSavingCapacity = savingCapacity[table.id];
            const tableCalls = waiterCalls.filter(c => c.table_number === table.table_number);
            const activeCall = tableCalls.find(c => c.status === 'active' || c.status === 'overdue');
            const needsAttention = !activeCall && tableActivity?.tables?.find(t => t.table_number === table.table_number)?.needs_attention;
            const hasActiveSession = tableActivity?.tables?.find(t => t.table_number === table.table_number)?.has_active_session;
            const labelValue = labelEdits[table.id] !== undefined ? labelEdits[table.id] : (table.table_label ?? '');
            const isSavingLbl = savingLabel[table.id];

            return (
              <div
                key={table.id}
                className={`grid items-center gap-3 px-4 py-3 border-b border-gray-50 last:border-b-0 transition-colors ${
                  activeCall ? 'bg-red-50' : needsAttention ? 'bg-yellow-50' : 'hover:bg-gray-50'
                }`}
                style={{ gridTemplateColumns: '80px 1fr 110px 1fr 130px 44px 44px' }}
              >
                {/* Table number */}
                <div className="font-bold text-gray-900 text-sm">#{table.table_number}</div>

                {/* Label */}
                <input
                  type="text"
                  value={labelValue}
                  placeholder="Add label…"
                  onChange={e => setLabelEdits(prev => ({ ...prev, [table.id]: e.target.value }))}
                  onBlur={() => { if (labelEdits[table.id] !== undefined) handleSaveLabel(table.id); }}
                  disabled={isSavingLbl}
                  className="w-full px-2.5 py-1.5 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-orange-500 disabled:opacity-50 placeholder:text-gray-300"
                />

                {/* Seats */}
                <div className="flex items-center gap-1.5">
                  <input
                    type="number"
                    min={0}
                    value={editedCapacity ?? table.capacity ?? 0}
                    onChange={e => handleCapacityChange(table.id, e.target.value)}
                    className="w-16 px-2 py-1.5 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-orange-500 text-center"
                  />
                  {hasCapacityEdit && (
                    <button
                      onClick={() => handleSaveCapacity(table.id)}
                      disabled={isSavingCapacity}
                      className="p-1 text-orange-600 hover:bg-orange-50 rounded transition-colors disabled:opacity-50"
                      title="Save seats"
                    >
                      {isSavingCapacity ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
                    </button>
                  )}
                </div>

                {/* Server */}
                <select
                  value={table.assigned_server_id || ''}
                  onChange={e => handleAssignServer(table.id, e.target.value || null)}
                  className="w-full px-2.5 py-1.5 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-orange-500 bg-white text-gray-700"
                >
                  <option value="">Unassigned</option>
                  {staff.map(s => (
                    <option key={s.id} value={s.id}>{s.name}</option>
                  ))}
                </select>

                {/* Status */}
                <div className="flex items-center gap-1">
                  {activeCall ? (
                    <button
                      onClick={() => handleAcknowledgeCall(activeCall.id)}
                      className="bg-red-500 text-white rounded-full px-2.5 py-1 text-xs font-bold flex items-center gap-1 animate-pulse hover:bg-red-600 transition-colors"
                      title="Click to dismiss"
                    >
                      <Bell className="h-3 w-3" />
                      Calling
                    </button>
                  ) : needsAttention ? (
                    <span className="bg-yellow-100 text-yellow-800 rounded-full px-2.5 py-1 text-xs font-medium flex items-center gap-1">
                      <AlertTriangle className="h-3 w-3" />
                      Attention
                    </span>
                  ) : (
                    <span className={`text-xs font-medium px-2.5 py-1 rounded-full ${
                      hasActiveSession ? 'bg-red-100 text-red-700' : 'bg-green-100 text-green-700'
                    }`}>
                      {hasActiveSession ? 'Occupied' : 'Available'}
                    </span>
                  )}
                </div>

                {/* QR */}
                <div className="flex justify-center">
                  {table.qr_code_url ? (
                    <button
                      onClick={() => setQrPopupTable(table)}
                      className="p-2 text-orange-600 hover:bg-orange-50 rounded-lg transition-colors"
                      title="Show QR Code"
                    >
                      <QrCode className="h-4 w-4" />
                    </button>
                  ) : (
                    <span className="text-xs text-gray-300 px-2">—</span>
                  )}
                </div>

                {/* Reset (portal only) */}
                <div className="flex justify-center">
                  {service.closeTableSession ? (
                    <button
                      onClick={async () => {
                        if (!restaurantId) return;
                        if (!confirm(`Reset Table #${table.table_number}? This closes the active session and clears service requests.`)) return;
                        try {
                          await service.closeTableSession!(restaurantId, table.table_number);
                          for (const call of tableCalls) {
                            try { await handleAcknowledgeCall(call.id); } catch { /* best effort */ }
                          }
                          await fetchTableActivity();
                          showFeedback('success', `Table #${table.table_number} reset`);
                        } catch {
                          showFeedback('error', `Failed to reset Table #${table.table_number}`);
                        }
                      }}
                      className="p-2 text-orange-600 hover:bg-orange-50 rounded-lg transition-colors"
                      title="Reset table"
                    >
                      <RefreshCw className="h-4 w-4" />
                    </button>
                  ) : tableCalls.length > 0 ? (
                    <button
                      onClick={async () => {
                        for (const call of tableCalls) {
                          await handleAcknowledgeCall(call.id);
                        }
                      }}
                      className="p-2 text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                      title={`Clear ${tableCalls.length} service request${tableCalls.length > 1 ? 's' : ''}`}
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  ) : (
                    <span className="w-8" />
                  )}
                </div>
              </div>
            );
          })}
      </div>

      {/* Add Table Modal */}
      {showAddModal && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50" onClick={() => setShowAddModal(false)}>
          <div className="bg-white rounded-2xl p-6 w-full max-w-sm mx-4 shadow-xl" onClick={e => e.stopPropagation()}>
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

      {/* QR Code Popup */}
      {qrPopupTable && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50" onClick={() => setQrPopupTable(null)}>
          <div className="bg-white rounded-2xl p-6 w-full max-w-xs mx-4 shadow-xl text-center" onClick={e => e.stopPropagation()}>
            <h3 className="text-lg font-bold text-gray-900 mb-1">Table #{qrPopupTable.table_number}</h3>
            {qrPopupTable.table_label && (
              <p className="text-sm text-gray-500 mb-4">{qrPopupTable.table_label}</p>
            )}
            <div className="bg-gray-50 rounded-xl p-4 mb-4">
              <img
                src={qrPopupTable.qr_code_url!}
                alt={`QR Code - Table ${qrPopupTable.table_number}`}
                className="w-full h-auto"
              />
            </div>
            <div className="flex gap-3">
              <button
                onClick={() => setQrPopupTable(null)}
                className="flex-1 px-4 py-2 border border-gray-200 rounded-lg font-medium text-gray-600 hover:bg-gray-50 transition-colors text-sm"
              >
                Close
              </button>
              <a
                href={qrPopupTable.qr_code_url!}
                target="_blank"
                rel="noopener noreferrer"
                className="flex-1 px-4 py-2 bg-orange-500 text-white rounded-lg font-medium hover:bg-orange-600 transition-colors text-sm inline-flex items-center justify-center gap-2"
              >
                <ExternalLink className="h-4 w-4" />
                Full Size
              </a>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
