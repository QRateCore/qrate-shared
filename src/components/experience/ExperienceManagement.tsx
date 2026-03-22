'use client';

import { useState, useEffect, useCallback } from 'react';
import {
  LayoutGrid,
  Calendar,
  ShoppingBag,
  Users,
  Plus,
  Edit2,
  Clock,
  Check,
  X,
  ChevronRight,
  Filter,
  Search,
  ImageIcon,
  RefreshCw,
  Loader2,
  Zap,
  QrCode,
  Download,
  ExternalLink,
  Save,
  AlertTriangle,
  Bell,
  Trash2,
} from 'lucide-react';
import type { ExperienceService, RestaurantTable, StaffMember, TableActivity, OrderSummary, BoostItem, WaiterCall } from '../../types/experience';

type Tab = 'tables' | 'reservations' | 'orders' | 'menu-boost';

interface Reservation {
  id: string;
  customerName: string;
  date: string;
  time: string;
  partySize: number;
  status: 'confirmed' | 'pending' | 'cancelled';
  tableNumber?: number;
}

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
    { id: 'tables' as Tab, label: 'Tables', icon: LayoutGrid, count: 12 as number | undefined },
    { id: 'reservations' as Tab, label: 'Reservations', icon: Calendar, count: 8 as number | undefined },
    { id: 'orders' as Tab, label: 'Orders', icon: ShoppingBag, count: 15 as number | undefined },
    { id: 'menu-boost' as Tab, label: 'Menu Boost', icon: Zap, count: undefined as number | undefined },
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
          {activeTab === 'tables' && <TablesTab restaurantId={restaurantId || undefined} service={service} />}
          {activeTab === 'reservations' && <ReservationsTab />}
          {activeTab === 'orders' && <OrdersTab restaurantId={restaurantId || undefined} service={service} />}
          {activeTab === 'menu-boost' && <MenuBoostTab restaurantId={restaurantId || undefined} service={service} />}
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

      {/* Table Grid */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
        {tables
          .filter(t => t.is_active)
          .sort((a, b) => a.table_number - b.table_number)
          .map(table => {
            const editedCapacity = capacityEdits[table.id];
            const hasCapacityEdit = editedCapacity !== undefined && editedCapacity !== (table.capacity ?? 0);
            const isSaving = savingCapacity[table.id];
            const tableCalls = waiterCalls.filter(c => c.table_number === table.table_number);
            const activeCall = tableCalls.find(c => c.status === 'active' || c.status === 'overdue');
            const hasActiveSession = tableActivity?.tables?.find(t => t.table_number === table.table_number)?.has_active_session;

            return (
              <div
                key={table.id}
                className={`border-2 rounded-xl p-3 transition-colors bg-white relative ${
                  activeCall ? 'border-red-300 ring-1 ring-red-200'
                    : hasActiveSession ? 'border-red-400'
                      : 'border-green-400 hover:border-green-500'
                }`}
              >
                {/* Waiter Call Bubble */}
                {activeCall && (
                  <button
                    onClick={() => handleAcknowledgeCall(activeCall.id)}
                    className="absolute -top-2 -right-2 bg-red-500 text-white rounded-full px-2 py-0.5 text-xs font-bold flex items-center gap-1 animate-pulse shadow-md hover:bg-red-600 transition-colors"
                    title="Click to dismiss"
                  >
                    <Bell className="h-3 w-3" />
                    Calling
                  </button>
                )}

                {/* Needs Attention Bubble */}
                {!activeCall && tableActivity?.tables?.find(t => t.table_number === table.table_number)?.needs_attention && (
                  <div className="absolute -top-2 -right-2 bg-yellow-400 text-yellow-900 rounded-full px-2 py-0.5 text-xs font-bold flex items-center gap-1 shadow-md">
                    <AlertTriangle className="h-3 w-3" />
                    Needs Attention
                  </div>
                )}

                {/* Table info */}
                <div className="flex items-center justify-between">
                  <div className="font-bold text-gray-900">
                    Table #{table.table_number}
                  </div>
                  {table.qr_code_url ? (
                    <button
                      onClick={() => setQrPopupTable(table)}
                      className="p-1.5 text-orange-600 hover:bg-orange-50 rounded-lg transition-colors"
                      title="Show QR Code"
                    >
                      <QrCode className="h-5 w-5" />
                    </button>
                  ) : (
                    <span className="text-xs text-gray-400">No QR</span>
                  )}
                </div>
                {table.table_label && (
                  <div className="text-xs text-gray-500 mt-0.5">{table.table_label}</div>
                )}

                {/* Capacity */}
                <div className="flex items-center gap-2 mt-3">
                  <Users className="h-4 w-4 text-gray-400" />
                  <input
                    type="number"
                    min={0}
                    value={editedCapacity ?? table.capacity ?? 0}
                    onChange={(e) => handleCapacityChange(table.id, e.target.value)}
                    className="w-16 px-2 py-1 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-orange-500"
                  />
                  {hasCapacityEdit && (
                    <button
                      onClick={() => handleSaveCapacity(table.id)}
                      disabled={isSaving}
                      className="p-1 text-orange-600 hover:bg-orange-50 rounded transition-colors disabled:opacity-50"
                      title="Save capacity"
                    >
                      {isSaving ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <Save className="h-4 w-4" />
                      )}
                    </button>
                  )}
                </div>

                {/* Server Assignment */}
                {staff.length > 0 && (
                  <div className="mt-3">
                    <select
                      value={table.assigned_server_id || ''}
                      onChange={(e) => handleAssignServer(table.id, e.target.value || null)}
                      className="w-full px-2 py-1.5 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-orange-500 bg-white text-gray-700"
                    >
                      <option value="">No server assigned</option>
                      {staff.map(s => (
                        <option key={s.id} value={s.id}>{s.name}</option>
                      ))}
                    </select>
                  </div>
                )}

                {/* Delete Service Requests */}
                {(() => {
                  const hasRequests = tableCalls.length > 0;
                  return (
                    <button
                      onClick={async () => {
                        for (const call of tableCalls) {
                          await handleAcknowledgeCall(call.id);
                        }
                      }}
                      disabled={!hasRequests}
                      className={`mt-3 w-full flex items-center justify-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border transition-colors ${
                        hasRequests
                          ? 'text-red-700 bg-red-50 border-red-200 hover:bg-red-100'
                          : 'text-gray-400 bg-gray-50 border-gray-200 cursor-not-allowed'
                      }`}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                      {hasRequests
                        ? `Delete Service Request${tableCalls.length > 1 ? 's' : ''} (${tableCalls.length})`
                        : 'No Service Requests'}
                    </button>
                  );
                })()}

                {/* Reset Table — close session + resolve waiter calls (portal only) */}
                {service.closeTableSession && (
                  <button
                    onClick={async () => {
                      if (!restaurantId) return;
                      if (!confirm(`Reset Table #${table.table_number}? This will close the active session (patrons see farewell screen) and clear service requests.`)) return;
                      try {
                        // Close session (sends farewell to patrons, marks orders completed, resolves waiter calls)
                        await service.closeTableSession!(restaurantId, table.table_number);
                        // Also resolve any remaining waiter calls for this table
                        for (const call of tableCalls) {
                          try { await handleAcknowledgeCall(call.id); } catch { /* best effort */ }
                        }
                        await fetchTableActivity();
                        showFeedback('success', `Table #${table.table_number} reset`);
                      } catch {
                        showFeedback('error', `Failed to reset Table #${table.table_number}`);
                      }
                    }}
                    className="mt-1.5 w-full flex items-center justify-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border border-orange-200 text-orange-700 bg-orange-50 hover:bg-orange-100 transition-colors"
                  >
                    <RefreshCw className="h-3.5 w-3.5" />
                    Reset Table
                  </button>
                )}

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

function ReservationsTab() {
  const [reservations] = useState<Reservation[]>([
    { id: '1', customerName: 'John Smith', date: '2024-01-15', time: '19:00', partySize: 4, status: 'confirmed', tableNumber: 3 },
    { id: '2', customerName: 'Sarah Johnson', date: '2024-01-15', time: '19:30', partySize: 2, status: 'pending' },
    { id: '3', customerName: 'Mike Wilson', date: '2024-01-15', time: '20:00', partySize: 6, status: 'confirmed', tableNumber: 5 },
    { id: '4', customerName: 'Emily Brown', date: '2024-01-16', time: '18:30', partySize: 3, status: 'pending' },
  ]);

  const getStatusBadge = (status: Reservation['status']) => {
    switch (status) {
      case 'confirmed':
        return <span className="px-2 py-1 text-xs font-medium bg-green-100 text-green-700 rounded-full">Confirmed</span>;
      case 'pending':
        return <span className="px-2 py-1 text-xs font-medium bg-yellow-100 text-yellow-700 rounded-full">Pending</span>;
      case 'cancelled':
        return <span className="px-2 py-1 text-xs font-medium bg-red-100 text-red-700 rounded-full">Cancelled</span>;
    }
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h3 className="text-lg font-bold text-gray-900">Reservations</h3>
          <p className="text-sm text-gray-500">Manage upcoming reservations</p>
        </div>
        <div className="flex gap-2">
          <button className="px-4 py-2 border border-gray-200 rounded-lg font-medium text-gray-600 hover:bg-gray-50 transition-colors flex items-center gap-2">
            <Filter className="h-5 w-5" />
            Filter
          </button>
          <button className="bg-orange-500 text-white px-4 py-2 rounded-lg font-medium hover:bg-orange-600 transition-colors flex items-center gap-2">
            <Plus className="h-5 w-5" />
            New Reservation
          </button>
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full">
          <thead>
            <tr className="border-b border-gray-100">
              <th className="text-left py-3 px-4 text-sm font-medium text-gray-500">Guest</th>
              <th className="text-left py-3 px-4 text-sm font-medium text-gray-500">Date & Time</th>
              <th className="text-left py-3 px-4 text-sm font-medium text-gray-500">Party</th>
              <th className="text-left py-3 px-4 text-sm font-medium text-gray-500">Table</th>
              <th className="text-left py-3 px-4 text-sm font-medium text-gray-500">Status</th>
              <th className="text-right py-3 px-4 text-sm font-medium text-gray-500">Actions</th>
            </tr>
          </thead>
          <tbody>
            {reservations.map((res) => (
              <tr key={res.id} className="border-b border-gray-50 hover:bg-gray-50">
                <td className="py-3 px-4">
                  <span className="font-medium text-gray-900">{res.customerName}</span>
                </td>
                <td className="py-3 px-4">
                  <div className="flex items-center gap-2 text-gray-600">
                    <Calendar className="h-4 w-4" />
                    {res.date}
                    <Clock className="h-4 w-4 ml-2" />
                    {res.time}
                  </div>
                </td>
                <td className="py-3 px-4">
                  <span className="flex items-center gap-1 text-gray-600">
                    <Users className="h-4 w-4" />
                    {res.partySize}
                  </span>
                </td>
                <td className="py-3 px-4">
                  {res.tableNumber ? (
                    <span className="font-medium">Table #{res.tableNumber}</span>
                  ) : (
                    <span className="text-gray-400">Unassigned</span>
                  )}
                </td>
                <td className="py-3 px-4">{getStatusBadge(res.status)}</td>
                <td className="py-3 px-4">
                  <div className="flex justify-end gap-2">
                    {res.status === 'pending' && (
                      <>
                        <button className="p-1.5 text-green-600 hover:bg-green-50 rounded-lg transition-colors">
                          <Check className="h-5 w-5" />
                        </button>
                        <button className="p-1.5 text-red-600 hover:bg-red-50 rounded-lg transition-colors">
                          <X className="h-5 w-5" />
                        </button>
                      </>
                    )}
                    <button className="p-1.5 text-gray-600 hover:bg-gray-100 rounded-lg transition-colors">
                      <Edit2 className="h-5 w-5" />
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function OrdersTab({ restaurantId, service }: { restaurantId?: string; service: ExperienceService }) {
  const [orders, setOrders] = useState<OrderSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [tables, setTables] = useState<RestaurantTable[]>([]);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [purging, setPurging] = useState(false);

  useEffect(() => {
    if (!restaurantId) return;
    service.getTables(restaurantId)
      .then(data => setTables(data.tables.filter(t => t.table_number < 9900)))
      .catch(() => {});
  }, [restaurantId, service]);

  const fetchOrders = useCallback(async () => {
    if (!restaurantId) return;
    try {
      const data = await service.getOrders(restaurantId, undefined, 50);
      setOrders(data.orders || []);
    } catch {
      // silent
    } finally {
      setLoading(false);
    }
  }, [restaurantId, service]);

  useEffect(() => {
    fetchOrders();
    const interval = setInterval(fetchOrders, 15_000);
    return () => clearInterval(interval);
  }, [fetchOrders]);

  const STALE_THRESHOLD = 2 * 60 * 1000;
  const assignedTableNumbers = new Set(
    tables.filter(t => t.assigned_server_id).map(t => t.table_number)
  );
  const staleOrders = orders.filter(order =>
    order.status === 'pending' &&
    order.table_number != null &&
    assignedTableNumbers.has(order.table_number) &&
    Date.now() - new Date(order.created_at).getTime() > STALE_THRESHOLD
  );

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'pending':
        return <span className="px-2 py-1 text-xs font-medium bg-yellow-100 text-yellow-700 rounded-full">Pending</span>;
      case 'confirmed':
        return <span className="px-2 py-1 text-xs font-medium bg-blue-100 text-blue-700 rounded-full">Confirmed</span>;
      case 'preparing':
        return <span className="px-2 py-1 text-xs font-medium bg-blue-100 text-blue-700 rounded-full">Preparing</span>;
      case 'ready':
        return <span className="px-2 py-1 text-xs font-medium bg-green-100 text-green-700 rounded-full">Ready</span>;
      case 'completed':
        return <span className="px-2 py-1 text-xs font-medium bg-gray-100 text-gray-700 rounded-full">Completed</span>;
      case 'cancelled':
        return <span className="px-2 py-1 text-xs font-medium bg-red-100 text-red-700 rounded-full">Cancelled</span>;
      default:
        return <span className="px-2 py-1 text-xs font-medium bg-gray-100 text-gray-600 rounded-full">{status}</span>;
    }
  };

  const formatTimeAgo = (dateStr: string) => {
    const diff = Date.now() - new Date(dateStr).getTime();
    const mins = Math.floor(diff / 60_000);
    if (mins < 1) return 'Just now';
    if (mins < 60) return `${mins} min ago`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs}h ago`;
    return `${Math.floor(hrs / 24)}d ago`;
  };

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
        <p className="text-sm text-gray-500">Loading orders...</p>
      </div>
    );
  }

  return (
    <div>
      {staleOrders.length > 0 && (
        <div className="bg-red-50 border border-red-200 text-red-700 rounded-lg px-4 py-3 mb-4 flex items-start gap-3">
          <AlertTriangle className="h-5 w-5 flex-shrink-0 mt-0.5" />
          <div>
            <p className="font-medium">
              {staleOrders.length} pending order{staleOrders.length !== 1 ? 's' : ''} not acted on by assigned waiter for over 2 minutes
            </p>
            <p className="text-sm mt-1">
              Table{staleOrders.length !== 1 ? 's' : ''}: {staleOrders.map(o => `#${o.table_number}`).join(', ')}
            </p>
          </div>
        </div>
      )}

      <div className="flex items-center justify-between mb-6">
        <div>
          <h3 className="text-lg font-bold text-gray-900">Active Orders</h3>
          <p className="text-sm text-gray-500">
            {orders.length} order{orders.length !== 1 ? 's' : ''}
          </p>
        </div>
        <div className="flex items-center gap-3">
          {service.purgeOrders && orders.length > 0 && (
            <button
              onClick={async () => {
                if (!restaurantId || !confirm(`Delete all ${orders.length} orders? This cannot be undone.`)) return;
                setPurging(true);
                try {
                  await service.purgeOrders!(restaurantId);
                  setOrders([]);
                } catch (err) {
                  console.error('Purge failed:', err);
                  alert('Failed to purge orders');
                } finally {
                  setPurging(false);
                }
              }}
              disabled={purging}
              className="flex items-center gap-1.5 px-3 py-2 text-sm font-medium text-red-600 bg-red-50 hover:bg-red-100 rounded-lg transition-colors disabled:opacity-50"
            >
              {purging ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
              Purge All
            </button>
          )}
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-5 w-5 text-gray-400" />
            <input
              type="text"
              placeholder="Search orders..."
              className="pl-10 pr-4 py-2 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-orange-500"
            />
          </div>
        </div>
      </div>

      {orders.length === 0 ? (
        <div className="text-center py-12 text-gray-500">
          <ShoppingBag className="h-8 w-8 mx-auto mb-3 opacity-40" />
          <p className="font-medium">No orders yet</p>
          <p className="text-sm mt-1">Orders will appear here when diners place them</p>
        </div>
      ) : (
        <div className="space-y-4">
          {orders.map((order) => (
            <div
              key={order.id}
              className="flex items-center justify-between p-4 border border-gray-100 rounded-xl hover:border-gray-200 transition-colors"
            >
              <div className="flex items-center gap-4">
                <div className="bg-orange-100 p-3 rounded-lg">
                  <ShoppingBag className="h-6 w-6 text-orange-600" />
                </div>
                <div>
                  <div className="flex items-center gap-3">
                    {getStatusBadge(order.status)}
                  </div>
                  <p className="text-sm text-gray-500 mt-0.5">
                    {order.table_number != null ? `Table ${order.table_number}` : order.diner_name || 'Takeout'}
                    {' '}&middot;{' '}{order.item_count ?? 0} item{(order.item_count ?? 0) !== 1 ? 's' : ''}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-4">
                <div className="text-right">
                  <p className="font-bold text-gray-900">${Number(order.total_amount ?? 0).toFixed(2)}</p>
                  <p className="text-xs text-gray-400">{formatTimeAgo(order.created_at)}</p>
                </div>
                {service.deleteOrder && (
                  <button
                    onClick={async () => {
                      if (!restaurantId || !confirm('Delete this order?')) return;
                      setDeletingId(order.id);
                      try {
                        await service.deleteOrder!(restaurantId, order.id);
                        setOrders(prev => prev.filter(o => o.id !== order.id));
                      } catch (err) {
                        console.error('Delete failed:', err);
                        alert('Failed to delete order');
                      } finally {
                        setDeletingId(null);
                      }
                    }}
                    disabled={deletingId === order.id}
                    className="p-2 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors disabled:opacity-50"
                    title="Delete order"
                  >
                    {deletingId === order.id ? <Loader2 className="h-5 w-5 animate-spin" /> : <Trash2 className="h-5 w-5" />}
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ========================================
// MENU BOOST TAB
// ========================================

const BOOST_LABELS: Record<number, string> = {
  [-2]: 'Hide',
  [-1]: 'Deprioritize',
  [0]: 'Neutral',
  [1]: 'Push',
  [2]: 'Feature',
};

const BOOST_COLORS: Record<number, { bg: string; text: string; border: string }> = {
  [-2]: { bg: '#fff5f5', text: '#e53e3e', border: '#feb2b2' },
  [-1]: { bg: '#fffaf0', text: '#c05621', border: '#fbd38d' },
  [0]: { bg: '#f7fafc', text: '#718096', border: '#e2e8f0' },
  [1]: { bg: '#FFF4EE', text: '#e5511a', border: '#fed7aa' },
  [2]: { bg: '#fff7ed', text: '#c2410c', border: '#fb923c' },
};

function MenuBoostTab({ restaurantId, service }: { restaurantId?: string; service: ExperienceService }) {
  const [items, setItems] = useState<BoostItem[]>([]);
  const [originalItems, setOriginalItems] = useState<BoostItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  const hasChanges = items.some((item, i) => item.boost_level !== originalItems[i]?.boost_level);
  const changedCount = items.filter((item, i) => item.boost_level !== originalItems[i]?.boost_level).length;

  const fetchBoosts = useCallback(async () => {
    if (!restaurantId) return;
    setLoading(true);
    try {
      const data = await service.getMenuBoosts(restaurantId);
      setItems(data.items);
      setOriginalItems(data.items.map(i => ({ ...i })));
    } catch (err) {
      console.error('Failed to load menu boosts:', err);
      showFeedback('error', 'Failed to load menu items');
    } finally {
      setLoading(false);
    }
  }, [restaurantId, service]);

  useEffect(() => {
    fetchBoosts();
  }, [fetchBoosts]);

  const showFeedback = (type: 'success' | 'error', message: string) => {
    setFeedback({ type, message });
    setTimeout(() => setFeedback(null), 3000);
  };

  const updateBoost = (itemId: string, boost_level: number) => {
    setItems(prev => prev.map(i => i.id === itemId ? { ...i, boost_level } : i));
  };

  const handleSave = async () => {
    const changed = items.filter((item, i) => item.boost_level !== originalItems[i]?.boost_level);
    if (changed.length === 0 || !restaurantId) return;
    setSaving(true);
    try {
      const result = await service.updateMenuBoosts(
        restaurantId,
        changed.map(i => ({ id: i.id, boost_level: i.boost_level }))
      );
      setOriginalItems(items.map(i => ({ ...i })));
      showFeedback('success', `Updated ${result.updated_count} item${result.updated_count !== 1 ? 's' : ''}`);
    } catch (err) {
      console.error('Failed to save boosts:', err);
      showFeedback('error', 'Failed to save changes');
    } finally {
      setSaving(false);
    }
  };

  const handleReset = () => {
    setItems(originalItems.map(i => ({ ...i })));
  };

  // Group items by category
  const categories = items.reduce<Record<string, BoostItem[]>>((acc, item) => {
    const cat = item.category_name || 'Uncategorized';
    if (!acc[cat]) acc[cat] = [];
    acc[cat].push(item);
    return acc;
  }, {});

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
        <p className="text-sm text-gray-500">Loading menu items...</p>
      </div>
    );
  }

  if (items.length === 0) {
    return (
      <div className="text-center py-12 text-gray-500">
        <Zap className="h-8 w-8 mx-auto mb-3 opacity-40" />
        <p className="font-medium">No menu items found</p>
        <p className="text-sm mt-1">Add menu items from the Menu page first</p>
      </div>
    );
  }

  return (
    <div>
      {/* Header with save/reset */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h3 className="text-lg font-bold text-gray-900">Menu Boost</h3>
          <p className="text-sm text-gray-500">Influence which items get recommended more to diners</p>
        </div>
        <div className="flex gap-2">
          {hasChanges && (
            <button
              onClick={handleReset}
              className="px-4 py-2 border border-gray-200 rounded-lg font-medium text-gray-600 hover:bg-gray-50 transition-colors text-sm"
            >
              Reset
            </button>
          )}
          <button
            onClick={handleSave}
            disabled={!hasChanges || saving}
            className={`px-4 py-2 rounded-lg font-medium text-sm transition-colors flex items-center gap-2 ${
              hasChanges
                ? 'bg-orange-500 text-white hover:bg-orange-600'
                : 'bg-gray-100 text-gray-400 cursor-default'
            }`}
          >
            {saving ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Saving...
              </>
            ) : (
              <>Save{changedCount > 0 ? ` (${changedCount})` : ''}</>
            )}
          </button>
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

      {/* Legend */}
      <div className="flex flex-wrap gap-2 mb-6">
        {([-2, -1, 0, 1, 2] as const).map(level => {
          const c = BOOST_COLORS[level];
          return (
            <span
              key={level}
              className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold"
              style={{ background: c.bg, color: c.text, border: `1px solid ${c.border}` }}
            >
              {level > 0 ? `+${level}` : level} {BOOST_LABELS[level]}
            </span>
          );
        })}
      </div>

      {/* Categories + items */}
      <div className="space-y-6">
        {Object.entries(categories).map(([category, catItems]) => (
          <div key={category}>
            <div className="flex items-center justify-between mb-3">
              <h4 className="font-bold text-gray-900">{category}</h4>
              <span className="px-2 py-0.5 text-xs font-medium bg-orange-100 text-orange-700 rounded-full">
                {catItems.length} item{catItems.length !== 1 ? 's' : ''}
              </span>
            </div>
            <div className="space-y-2">
              {catItems.map(item => {
                const level = item.boost_level;
                const c = BOOST_COLORS[level];
                const isModified = originalItems.find(o => o.id === item.id)?.boost_level !== level;

                return (
                  <div
                    key={item.id}
                    className="flex items-center gap-3 p-3 rounded-xl border transition-all"
                    style={{
                      borderColor: isModified ? c.border : '#e5e7eb',
                      background: c.bg,
                    }}
                  >
                    {/* Thumbnail */}
                    <div className="w-10 h-10 rounded-lg flex-shrink-0 overflow-hidden bg-gray-100 flex items-center justify-center">
                      {item.thumbnail_url ? (
                        <img src={item.thumbnail_url} alt={item.name} className="w-full h-full object-cover" />
                      ) : (
                        <ShoppingBag className="h-4 w-4 text-gray-300" />
                      )}
                    </div>

                    {/* Name + price */}
                    <div className="flex-1 min-w-0">
                      <div className="font-medium text-gray-900 text-sm truncate">{item.name}</div>
                      <div className="text-xs text-gray-500">
                        ${typeof item.price === 'number' ? item.price.toFixed(2) : item.price}
                      </div>
                    </div>

                    {/* Slider */}
                    <div className="flex items-center gap-2 flex-shrink-0">
                      <span className="text-xs text-gray-400 font-medium">-2</span>
                      <input
                        type="range"
                        min={-2}
                        max={2}
                        step={1}
                        value={level}
                        onChange={(e) => updateBoost(item.id, parseInt(e.target.value))}
                        className="w-36 h-2 rounded-full appearance-none cursor-pointer boost-slider"
                        style={{ accentColor: '#f97316' }}
                      />
                      <span className="text-xs text-gray-400 font-medium">+2</span>
                    </div>

                    {/* Badge */}
                    <span
                      className="text-[11px] font-bold px-2 py-1 rounded-full text-center min-w-[68px] flex-shrink-0"
                      style={{ background: c.bg, color: c.text, border: `1px solid ${c.border}` }}
                    >
                      {level > 0 ? `+${level}` : level} {BOOST_LABELS[level]}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
