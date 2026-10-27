'use client';

import { useState, useEffect, useCallback, useMemo, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import {
  LayoutGrid,
  Plus,
  Loader2,
  RefreshCw,
  QrCode,
  Download,
  Trash2,
  BellRing,
  AlertTriangle,
  Check,
  X,
  Settings2,
  Cylinder,
  KeyRound,
} from 'lucide-react';
import type { ExperienceService, RestaurantTable, StaffMember, TableActivity, WaiterCall, TableActivityEntry, ExperienceTableDevice } from '../../types/experience';
import StaffManagement from '../staff/StaffManagement';
import KitchenTab from './KitchenTab';
import DrinksQrTab from './DrinksQrTab';
import Select from '../common/Select';
import { timeSince, initials, callTypeLabel, avatarColor } from './table-utils';
import { useIsMobile } from '../../hooks/useIsMobile';
import type { ListKit } from '../common/listKit';
import TablesListView, { type TableUpdate } from './TablesListView';

type Tab = 'staff' | 'tables' | 'kitchen' | 'drinks';

interface ExperienceManagementProps {
  /**
   * Whether the restaurant's POS is actually connected.
   *
   * Only meaningful alongside `service.importPosTables`. When false the
   * import button is shown DISABLED rather than hidden: an absent button
   * reads as "this restaurant cannot import", where a greyed one with a
   * reason reads as "connect a POS first", which is the actionable truth.
   */
  posConnected?: boolean;
  /**
   * Rendered at the top of the Tables tab, above the grid. The owner app puts
   * its read-only table-device panel here (remote-config PDD 2026-10-24: the
   * device pairing code is retired, QRate sets devices up from the admin
   * portal). Admin and waiter leave it unset.
   */
  tablesTopSlot?: ReactNode;
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
   * Show tables numbered >= 9900, which are hidden by default.
   *
   * Those numbers are reserved for E2E fixtures (workspace rule: mutation
   * specs must use 9900+ so a test can never touch a real owner's table
   * 1-15 — the 2026-03-24 image-deletion incident). Hiding them keeps a real
   * owner's grid clean, including anything a crashed run left behind.
   *
   * But the E2E suite has to SEE its own tables, and since /owner/tables was
   * retired this is the only page that lists them. So the owner portal turns
   * this on from `?testTables=1` and nothing else does. Default OFF: an owner
   * sees exactly what they saw before.
   */
  showTestTables?: boolean;
  /**
   * Whether to show the Kitchen (KDS pairing) tab. Defaults to `true` so waiter/admin
   * consumers are unaffected. The owner app passes `false` (STR-950) to hide it — the
   * tab is dropped from the bar and a `?tab=kitchen` deep-link falls back to Tables.
   */
  showKitchenTab?: boolean;
  /**
   * Whether to show the Drinks QR tab (standalone drinks-ordering QR, gated
   * on the admin-only `drinks_qr_enabled` deluxe flag). Defaults to `false` —
   * the OPPOSITE polarity of showKitchenTab — since most restaurants won't
   * have the flag on; the owner app fetches the flag and passes `true` only
   * when it's enabled for that restaurant. A `?tab=drinks` deep-link falls
   * back to Tables when hidden, same coercion as the Kitchen tab.
   */
  showDrinksTab?: boolean;
  /**
   * The host app's list + modal primitives. When given (owner portal), Tables
   * and Staff render as one-line rows in that app's house table, each row
   * opening a modal — the same look as every other owner list. Omitted
   * (waiter, admin) → the card layouts below. Phones always get the cards.
   */
  listKit?: ListKit;
}

export default function ExperienceManagement({ initialTab = 'tables', restaurantId, service, posConnected = true, tablesTopSlot, hostStationHref, kdsUrl, renderPairingQr, showKitchenTab = true, showDrinksTab = false, showTestTables = false, listKit }: ExperienceManagementProps) {
  const [activeTab, setActiveTab] = useState<Tab>(() => {
    if (!showKitchenTab && initialTab === 'kitchen') return 'tables';
    if (!showDrinksTab && initialTab === 'drinks') return 'tables';
    return initialTab;
  });
  const [tabCounts, setTabCounts] = useState<{ tables?: number }>({});
  const isMobile = useIsMobile();
  const kit = isMobile ? undefined : listKit;
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
        tables: tablesData
          ? tablesData.tables.filter(t => showTestTables || t.table_number < 9900).length
          : undefined,
      });
    } catch {
      // Non-critical — badges will just not show
    }
  }, [restaurantId, service, showTestTables]);

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
    ...(showDrinksTab
      ? [{ id: 'drinks' as Tab, label: 'Drinks', count: undefined as number | undefined }]
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

      {/* Tab Content. With a list kit (desktop) Staff and Tables bring their
          own bordered table, so they sit on the page rather than in a card. */}
      <div className={kit && (activeTab === 'staff' || activeTab === 'tables') ? '' : 'bg-white rounded-xl shadow-lg p-6'}>
        {activeTab === 'staff' && <StaffManagement restaurantId={restaurantId ?? null} service={service} actionsSlot={actionsSlot} listKit={kit} />}
        {activeTab === 'tables' && <TablesTab restaurantId={restaurantId || undefined} service={service} posConnected={posConnected} hostStationHref={hostStationHref} actionsSlot={actionsSlot} showTestTables={showTestTables} topSlot={tablesTopSlot} listKit={kit} />}
        {showKitchenTab && activeTab === 'kitchen' && <KitchenTab restaurantId={restaurantId || undefined} service={service} kdsUrl={kdsUrl} renderPairingQr={renderPairingQr} />}
        {showDrinksTab && activeTab === 'drinks' && <DrinksQrTab restaurantId={restaurantId || undefined} service={service} />}
      </div>
    </div>
  );
}

function TablesTab({ restaurantId, service, posConnected = true, hostStationHref, actionsSlot, showTestTables = false, topSlot, listKit }: { restaurantId?: string; service: ExperienceService; posConnected?: boolean; hostStationHref?: string; actionsSlot?: HTMLElement | null; showTestTables?: boolean; topSlot?: ReactNode; listKit?: ListKit }) {
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
  const [importingTables, setImportingTables] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; message: string } | null>(null);
  const [capacityEdits, setCapacityEdits] = useState<Record<string, number>>({});
  const [savingCapacity, setSavingCapacity] = useState<Record<string, boolean>>({});
  const [sectionEdits, setSectionEdits] = useState<Record<string, string>>({});
  const [savingSection, setSavingSection] = useState<Record<string, boolean>>({});

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
  // ── On-table service pucks ────────────────────────────────────────────
  // Keyed by tableId so a card can answer "is a puck live on me?" without
  // scanning the list on every render. Only populated when the consumer wired
  // service.listTableDevices — admin and waiter do not, and see none of this.
  const [devicesByTable, setDevicesByTable] = useState<Record<string, ExperienceTableDevice>>({});

  // ── Ported from the retired /owner/tables (2026-10-10) ────────────────
  // Label, active/inactive and the QR killswitch lived ONLY there. Retiring
  // that page without them would have removed three capabilities, one of them
  // the security control that kills a printed QR after a sticker swap.
  const [labelEdits, setLabelEdits] = useState<Record<string, string>>({});
  const [savingLabel, setSavingLabel] = useState<Record<string, boolean>>({});
  const [togglingActive, setTogglingActive] = useState<Record<string, boolean>>({});
  const [rotatingQr, setRotatingQr] = useState<string | null>(null);
  const [rotateConfirm, setRotateConfirm] = useState<{ tableId: string; tableNumber: number } | null>(null);

  // The ROOM pairing code: one reusable code for the whole floor, as opposed
  // to the per-table codes on each card. Both exist because they answer
  // different jobs — minting 40 codes to set up 40 tables would be worse.
  const [roomCode, setRoomCode] = useState<string | null>(null);
  // Rotation is destructive as of 2026-10-17: it signs out every paired puck,
  // which blacks out the room until someone re-enters the code at each table.
  // So it gets a confirm, like the QR rotate above it.
  const [confirmReplaceCode, setConfirmReplaceCode] = useState(false);
  const [mintingRoom, setMintingRoom] = useState(false);

  const loadDevices = service.listTableDevices;
  useEffect(() => {
    if (!restaurantId || !loadDevices) return;
    let cancelled = false;
    loadDevices(restaurantId)
      .then(({ devices }) => {
        if (cancelled) return;
        const byTable: Record<string, ExperienceTableDevice> = {};
        for (const d of devices ?? []) if (d.tableId) byTable[d.tableId] = d;
        setDevicesByTable(byTable);
      })
      // A device read failing must not blank the Tables tab — the badge is
      // supplementary, the tables are the point.
      .catch(() => { if (!cancelled) setDevicesByTable({}); });
    return () => { cancelled = true; };
  }, [restaurantId, loadDevices]);

  const mintCode = service.createTableDeviceCode;

  /** Green once seen inside this window, amber beyond it. A puck that paired
   *  and then died looks identical to a healthy one without this. */
  const DEVICE_STALE_AFTER_MS = 10 * 60 * 1000;
  const deviceIsFresh = (d: ExperienceTableDevice) =>
    !!d.lastSeenAt && Date.now() - new Date(d.lastSeenAt).getTime() < DEVICE_STALE_AFTER_MS;

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

  // A table read that started BEFORE a local write must not land after it:
  // on a cold page several reads are in flight (StrictMode doubles them in
  // dev, the Lambda can take 1-2s), and the slowest one used to put a
  // just-deleted table back or flip a just-toggled one back (2026-10-27, seen
  // in the toggle-active and create-tables E2E). Each write bumps the epoch;
  // a read only applies if no write happened since it started and no newer
  // read has superseded it.
  const writeEpoch = useRef(0);
  const readSeq = useRef(0);
  const markWrite = () => { writeEpoch.current += 1; };
  // Only the first load blanks the tab with a spinner; a re-read (after
  // Regenerate QR, Import, Add) keeps the list on screen.
  const hasLoaded = useRef(false);

  const fetchTables = useCallback(async () => {
    if (!restaurantId) return;
    const seq = ++readSeq.current;
    const epoch = writeEpoch.current;
    if (!hasLoaded.current) setLoading(true);
    try {
      const data = await service.getTables(restaurantId);
      if (seq !== readSeq.current || epoch !== writeEpoch.current) return;
      hasLoaded.current = true;
      setTables(data.tables.filter(t => showTestTables || t.table_number < 9900));
    } catch (err) {
      if (seq !== readSeq.current) return;
      console.error('Failed to load tables:', err);
      showFeedback('error', 'Failed to load tables');
    } finally {
      // Only the newest read ends the spinner — a superseded one finishing
      // first would otherwise flash "No tables found".
      if (seq === readSeq.current) setLoading(false);
    }
  }, [restaurantId, service, showTestTables]);

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

  // While a table's drawer is open its orders and calls are the thing being
  // watched, so poll them every 4s instead of every 10s.
  const [drawerOpen, setDrawerOpen] = useState(false);
  useEffect(() => {
    if (!drawerOpen) return;
    const fast = setInterval(() => { fetchWaiterCalls(); fetchTableActivity(); }, 4000);
    return () => clearInterval(fast);
  }, [drawerOpen, fetchWaiterCalls, fetchTableActivity]);

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

  const handleImportPosTables = async () => {
    if (!restaurantId || !service.importPosTables) return;
    setImportingTables(true);
    try {
      const result = await service.importPosTables(restaurantId);
      const parts = [`${result.created} added`];
      if (result.adopted) parts.push(`${result.adopted} matched`);
      if (result.updated) parts.push(`${result.updated} renamed`);
      if (result.skipped.length) parts.push(`${result.skipped.length} skipped`);
      showFeedback('success',
        `${result.provider_tables} tables in the POS — ${parts.join(', ')}`);
      // Newly created tables have no QR yet, and a table nobody can scan is
      // not much use on this page.
      if (result.created > 0) {
        await service.generateQRCodes(restaurantId).catch(() => null);
      }
      await fetchTables();
    } catch (err) {
      console.error('Failed to import POS tables:', err);
      showFeedback('error', 'Failed to import tables from the POS');
    } finally {
      setImportingTables(false);
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
    markWrite();
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

  const readRoomCode = service.getCurrentTableDeviceCode;
  useEffect(() => {
    if (!restaurantId || !readRoomCode) return;
    let cancelled = false;
    readRoomCode(restaurantId)
      .then(r => { if (!cancelled) setRoomCode(r.code); })
      .catch(() => { if (!cancelled) setRoomCode(null); });
    return () => { cancelled = true; };
  }, [restaurantId, readRoomCode]);

  const handleMintRoomCode = async () => {
    if (!restaurantId || !mintCode) return;
    setMintingRoom(true);
    try {
      const r = await mintCode(restaurantId);   // no tableId => ROOM code
      setRoomCode(r.code);
      const evicted = r.signedOutDevices ?? 0;
      showFeedback(
        'success',
        evicted > 0
          ? `New code. ${evicted} device${evicted === 1 ? '' : 's'} signed out — re-enter the code at ${evicted === 1 ? 'that table' : 'those tables'}.`
          : 'New pairing code.',
      );
    } catch {
      showFeedback('error', 'Could not generate a pairing code');
    } finally {
      setMintingRoom(false);
    }
  };

  const handleSaveLabel = async (tableId: string) => {
    if (!restaurantId || labelEdits[tableId] === undefined) return;
    markWrite();
    setSavingLabel(prev => ({ ...prev, [tableId]: true }));
    try {
      // null CLEARS the label server-side; the local type uses undefined for
      // "no label", so the two differ on purpose.
      const label = labelEdits[tableId].trim() || null;
      await service.updateTable(restaurantId, tableId, { table_label: label });
      setTables(prev => prev.map(t =>
        t.id === tableId ? { ...t, table_label: label ?? undefined } : t));
      setLabelEdits(prev => { const n = { ...prev }; delete n[tableId]; return n; });
      showFeedback('success', 'Label updated');
    } catch (err) {
      console.error('Failed to update label:', err);
      showFeedback('error', 'Failed to update label');
    } finally {
      setSavingLabel(prev => ({ ...prev, [tableId]: false }));
    }
  };

  const handleToggleActive = async (tableId: string, currentActive: boolean) => {
    if (!restaurantId) return;
    markWrite();
    setTogglingActive(prev => ({ ...prev, [tableId]: true }));
    try {
      await service.updateTable(restaurantId, tableId, { is_active: !currentActive });
      setTables(prev => prev.map(t => t.id === tableId ? { ...t, is_active: !currentActive } : t));
      showFeedback('success', currentActive ? 'Table deactivated' : 'Table reactivated');
    } catch (err) {
      console.error('Failed to update table:', err);
      showFeedback('error', 'Failed to update table');
    } finally {
      setTogglingActive(prev => ({ ...prev, [tableId]: false }));
    }
  };

  const rotateQr = service.rotateTableQR;
  const handleRotateQr = async (tableId: string, tableNumber: number) => {
    if (!restaurantId || !rotateQr) return;
    setRotatingQr(tableId);
    try {
      const result = await rotateQr(restaurantId, tableId);
      // The printed code is dead from this moment. Say the revision out loud:
      // the operator has to reprint, and "it worked" is not enough to act on.
      showFeedback('success', `Table ${tableNumber}: new QR ready (rev ${result.print_gen}) — reprint and replace the table tent`);
      fetchTables();
    } catch (err) {
      console.error('Failed to rotate QR:', err);
      showFeedback('error', `Failed to regenerate the QR for table ${tableNumber}`);
    } finally {
      setRotatingQr(null);
      setRotateConfirm(null);
    }
  };

  const handleSaveSection = async (tableId: string) => {
    if (!restaurantId || sectionEdits[tableId] === undefined) return;
    markWrite();
    setSavingSection(prev => ({ ...prev, [tableId]: true }));
    try {
      const section = sectionEdits[tableId].trim() || null;
      await service.updateTable(restaurantId, tableId, { table_section: section });
      setTables(prev =>
        prev.map(t => t.id === tableId ? { ...t, table_section: section } : t)
      );
      setSectionEdits(prev => {
        const next = { ...prev };
        delete next[tableId];
        return next;
      });
      showFeedback('success', 'Section updated');
    } catch (err) {
      console.error('Failed to update section:', err);
      showFeedback('error', 'Failed to update section');
    } finally {
      setSavingSection(prev => ({ ...prev, [tableId]: false }));
    }
  };

  const handleAssignServer = async (tableId: string, serverId: string | null) => {
    if (!restaurantId) return;
    markWrite();
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

  /** One-field save for the list view's modal (drafts live in the modal). */
  const handleUpdateTable = async (table: RestaurantTable, patch: TableUpdate): Promise<boolean> => {
    if (!restaurantId) return false;
    markWrite();
    try {
      await service.updateTable(restaurantId, table.id, patch);
      setTables(prev => prev.map(t => (t.id === table.id
        ? { ...t, ...patch, table_label: 'table_label' in patch ? patch.table_label ?? undefined : t.table_label }
        : t)));
      const what = 'assigned_server_id' in patch
        ? (patch.assigned_server_id ? 'Server assigned' : 'Server unassigned')
        : 'capacity' in patch ? 'Capacity updated'
          : 'table_section' in patch ? 'Section updated' : 'Label updated';
      showFeedback('success', what);
      return true;
    } catch (err) {
      console.error('Failed to update table:', err);
      showFeedback('error', 'Failed to update table');
      return false;
    }
  };

  const handleResetTable = async (table: RestaurantTable) => {
    if (!restaurantId || !service.closeTableSession) return;
    if (!confirm(`Reset Table #${table.table_number}? This will end the session and remove all guests.`)) return;
    try {
      await service.closeTableSession(restaurantId, table.table_number);
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
  };

  const handleDeleteTable = async (tableId: string) => {
    if (!restaurantId) return;
    markWrite();
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
          <div className="mt-4 flex items-center justify-center gap-2">
            {/* Offered HERE too, and deliberately so: a restaurant with no
                tables is exactly the one that wants to import a floor plan,
                and the toolbar that normally carries this button only renders
                once at least one table exists. */}
            {service.importPosTables && (
              <button
                onClick={handleImportPosTables}
                disabled={importingTables || !posConnected}
                data-testid="import-pos-tables-empty-btn"
                className="px-4 py-2 border border-gray-200 rounded-lg font-medium text-gray-600 hover:bg-gray-50 transition-colors text-sm inline-flex items-center gap-2 disabled:opacity-50"
              >
                {importingTables ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Importing...
                  </>
                ) : (
                  <>
                    <Download className="h-4 w-4" />
                    Import from POS
                  </>
                )}
              </button>
            )}
            <button
              onClick={() => setShowAddModal(true)}
        data-testid="add-tables-btn"
              className="bg-orange-500 text-white px-4 py-2 rounded-lg font-medium hover:bg-orange-600 transition-colors text-sm inline-flex items-center gap-2"
            >
              <Plus className="h-4 w-4" />
              Add Table
            </button>
          </div>
        </div>

        {/* Add Table Modal */}
        {showAddModal && (
          <div className={`fixed inset-0 bg-black/40 flex z-50 ${isMobile ? 'items-end' : 'items-center justify-center'}`} onClick={() => setShowAddModal(false)}>
            <div className={isMobile ? 'bg-white rounded-t-2xl p-6 pb-8 w-full shadow-xl' : 'bg-white rounded-2xl p-6 w-full max-w-sm mx-4 shadow-xl'} onClick={e => e.stopPropagation()}>
              <h3 className="text-lg font-bold text-gray-900 mb-4" data-testid="add-tables-modal">Add Tables</h3>
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Number of tables</label>
                  <input
                    type="number"
                    data-testid="add-tables-count"
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
                    data-testid="add-tables-start"
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
                  data-testid="add-tables-submit"
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
      {service.importPosTables && (
        <button
          onClick={handleImportPosTables}
          disabled={importingTables || !posConnected}
          data-testid="import-pos-tables-btn"
          title={posConnected
            ? "Create any table the POS has that QRate does not. Existing tables are matched, never duplicated, and nothing is deleted."
            : "Connect a POS on the Integrations page first — there is no floor plan to import from."}
          className="px-4 py-2 border border-gray-200 rounded-lg font-medium text-gray-600 hover:bg-gray-50 transition-colors text-sm flex items-center gap-2 disabled:opacity-50"
        >
          {importingTables ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" />
              Importing...
            </>
          ) : (
            <>
              <Download className="h-4 w-4" />
              Import from POS
            </>
          )}
        </button>
      )}
      {tablesWithQR.length > 0 && (
        <button
          data-testid="download-qr-btn"
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
        data-testid="generate-qr-btn"
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
        data-testid="add-tables-btn"
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

      {/* Replacing the code signs out every paired puck (2026-10-17), so it
          gets the same confirm the per-table QR rotate has. The count comes
          from the device list the page already loaded, so the owner is told
          how many tables go dark BEFORE they commit, not after. */}
      {confirmReplaceCode && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center"
          style={{ backgroundColor: 'rgba(0,0,0,0.5)' }}
          onClick={(e) => { if (e.target === e.currentTarget) setConfirmReplaceCode(false); }}
        >
          <div className="bg-white rounded-xl p-5 max-w-sm w-full" data-testid="replace-code-confirm">
            <h2 className="text-lg font-bold text-gray-900">Replace the pairing code?</h2>
            <p className="mt-2 text-sm text-gray-600">
              {Object.keys(devicesByTable).length > 0 ? (
                <>
                  This signs out{' '}
                  <strong className="font-semibold text-red-700">
                    {Object.keys(devicesByTable).length} paired device
                    {Object.keys(devicesByTable).length === 1 ? '' : 's'}
                  </strong>
                  . Each returns to its pairing screen, and somebody has to walk
                  to that table and enter the new code. Do this when the code has
                  leaked.
                </>
              ) : (
                <>No devices are paired yet, so nothing will be signed out.</>
              )}
            </p>
            <div className="mt-4 flex justify-end gap-2">
              <button
                onClick={() => setConfirmReplaceCode(false)}
                data-testid="replace-code-cancel"
                className="px-3 py-2 text-sm rounded-lg border border-gray-200 text-gray-700 hover:bg-gray-50"
              >
                Cancel
              </button>
              <button
                onClick={() => { setConfirmReplaceCode(false); void handleMintRoomCode(); }}
                data-testid="replace-code-confirm-btn"
                className="px-3 py-2 text-sm rounded-lg bg-red-600 text-white hover:bg-red-700"
              >
                Replace and sign out
              </button>
            </div>
          </div>
        </div>
      )}

      {topSlot}

      {/* THE pairing code. One per restaurant, PERMANENT, and the only one
          there is: a device enters it, then picks its own table on-screen.
          Deliberately at the top of the tab rather than on each card -- a
          per-table code bound the device at pair time and suppressed the
          picker, which is the confusion this replaced (2026-10-11).

          Rotating it never disconnects a paired device: every puck already
          holds a durable token and never presents the code again. */}
      {mintCode && (
        <div
          data-testid="room-pairing-code"
          className="mb-4 rounded-xl border border-blue-200 bg-blue-50 px-4 py-3"
        >
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
            <div className="min-w-0">
              <div className="text-xs font-semibold uppercase tracking-wide text-blue-900">
                Device pairing code
              </div>
              <div className="text-[11px] text-blue-700">
                Enter this on any QRate table device
              </div>
            </div>
            {roomCode ? (
              <span
                className="font-mono text-2xl font-semibold tracking-[0.3em] text-blue-900"
                data-testid="room-pairing-code-value"
              >
                {roomCode}
              </span>
            ) : (
              <span className="text-xs text-blue-700" data-testid="room-pairing-code-loading">
                Loading…
              </span>
            )}
            <button
              onClick={() => setConfirmReplaceCode(true)}
              disabled={mintingRoom}
              data-testid="room-pairing-code-generate"
              className="ml-auto inline-flex min-h-[44px] items-center gap-1.5 rounded-lg border border-blue-300 bg-white px-3 py-1.5 text-xs text-blue-800 hover:bg-blue-100 disabled:opacity-50"
            >
              {mintingRoom ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}
              {mintingRoom ? 'Replacing…' : 'Replace code'}
            </button>
          </div>
          {/* Unconditional, because the API guarantees it: a legacy code that
              still had an expiry is UPGRADED on read rather than reported, so
              there is no state in which this sentence is false. The guarantee
              is pinned where it is made —
              test_a_legacy_expiring_room_code_is_UPGRADED_on_read. */}
          <div className="mt-2 text-[11px] text-blue-800" data-testid="room-pairing-code-permanent">
            This code does not expire and pairs every device in the room. After
            pairing, the device asks which table it is on.{' '}
            <strong className="font-semibold text-red-700">
              Replacing it signs out every device you already paired
            </strong>
            {' '}— each one returns to its pairing screen and somebody has to
            re-enter the new code at that table. Replace it when the code has
            leaked, not to tidy up.
          </div>
        </div>
      )}

      {/* Table Grid — host station style; or the host app's list (desktop owner) */}
      {(() => {
        // Inactive tables are shown, dimmed. They used to be filtered out
        // here, which was safe only while /owner/tables existed to reach them;
        // with the toggle living on this card, hiding them would make a table
        // unreachable the moment it was deactivated.
        const sorted = [...tables]
          .sort((a, b) => {
            const actA = tableActivity?.tables?.find(t => t.table_number === a.table_number);
            const actB = tableActivity?.tables?.find(t => t.table_number === b.table_number);
            const hasA = actA?.has_active_session === true;
            const hasB = actB?.has_active_session === true;
            const callA = waiterCalls.filter(c => c.table_number === a.table_number && (c.status === 'active' || c.status === 'overdue')).length;
            const callB = waiterCalls.filter(c => c.table_number === b.table_number && (c.status === 'active' || c.status === 'overdue')).length;
            // A table asking for service floats up whether or not anyone is
            // seated: a device call on an empty table still needs a person.
            const upA = hasA || callA > 0;
            const upB = hasB || callB > 0;
            if (upA !== upB) return upA ? -1 : 1;
            if (upA && callA !== callB) return callB - callA;
            return a.table_number - b.table_number;
          });

        if (listKit && !isMobile) {
          return (
            <TablesListView
              kit={listKit}
              tables={sorted}
              staff={staff}
              tableActivity={tableActivity}
              waiterCalls={waiterCalls}
              devicesByTable={devicesByTable}
              deviceIsFresh={deviceIsFresh}
              onUpdate={handleUpdateTable}
              onAcknowledgeCall={handleAcknowledgeCall}
              onToggleActive={(t) => handleToggleActive(t.id, t.is_active)}
              togglingActive={togglingActive}
              onAskRotateQr={rotateQr ? (t) => setRotateConfirm({ tableId: t.id, tableNumber: t.table_number }) : undefined}
              rotatingQrId={rotatingQr}
              onAskDelete={service.deleteTable ? (t) => setDeleteConfirm({ tableId: t.id, tableNumber: t.table_number }) : undefined}
              onResetTable={service.closeTableSession ? handleResetTable : undefined}
              onDrawerOpenChange={setDrawerOpen}
            />
          );
        }

        return (
          <div className={`grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3 ${isMobile ? 'pb-24' : ''}`}>
            {sorted.map(table => {
              const activity = tableActivity?.tables?.find(t => t.table_number === table.table_number) ?? null;
              const isOccupied = activity?.has_active_session === true;
              const tableCalls = waiterCalls.filter(c => c.table_number === table.table_number && (c.status === 'active' || c.status === 'overdue'));
              const borderClass = isOccupied || tableCalls.length > 0 ? 'border-red-400' : 'border-green-400';
              // Mobile: when a table has active calls and the manager hasn't
              // explicitly picked a sub-tab, default to Service so the call + the
              // large "Done" ack show without a tap (desktop keeps the Orders default).
              const activeTab = cardTabState[table.table_number] ?? ((isMobile && tableCalls.length > 0) ? 'service' : 'orders');
              const renderCalls = () => tableCalls.map(call => (
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
              ));
              const serverName = table.assigned_server_id ? (staff.find(s => s.id === table.assigned_server_id)?.name ?? null) : null;

              return (
                <div
                  key={table.id}
                  data-testid={`table-card-${table.table_number}`}
                  className={`relative border-2 border-dashed rounded-xl p-3 bg-white ${borderClass} ${table.is_active ? '' : 'opacity-60'}`}
                >
                  {/* A puck is live on this table. Icon-only on purpose: any
                      text naming the table here would be a second match for the
                      card's own name and break the Tables E2E, which finds
                      cards by getByText. */}
                  {devicesByTable[table.id] && (
                    <span
                      data-testid={`table-device-paired-${table.table_number}`}
                      title={deviceIsFresh(devicesByTable[table.id])
                        ? `Device paired — ${devicesByTable[table.id].name}`
                        : `Device paired but not seen recently — ${devicesByTable[table.id].name}`}
                      className="absolute top-1.5 right-1.5 inline-flex items-center justify-center"
                    >
                      <Cylinder className={`h-3.5 w-3.5 ${deviceIsFresh(devicesByTable[table.id]) ? 'text-green-600' : 'text-amber-500'}`} />
                    </span>
                  )}
                  {/* Row 1: Table name + server + QR + seats */}
                  <div className="flex items-center justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-baseline gap-2">
                        <h3 className="font-bold text-base text-gray-900 whitespace-nowrap">Table {table.table_number}</h3>
                        {table.pos_linked && (
                          /* Came from the POS floor plan. Its NAME is managed
                             there — renaming it here does not rename it in the
                             POS, and the next import puts the POS name back —
                             and its POS identity is what lets a diner's order
                             join that table's tab, which a manually created
                             table can never do. */
                          <span
                            data-testid={`table-pos-badge-${table.table_number}`}
                            title={`From the POS floor plan${table.pos_table_name ? ` — "${table.pos_table_name}"` : ''}. Its name is managed there, not here.`}
                            className="inline-flex items-center rounded-full bg-indigo-50 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-indigo-700 ring-1 ring-inset ring-indigo-200 flex-shrink-0"
                          >
                            POS
                          </span>
                        )}
                        {table.pos_table_name && table.pos_table_name !== String(table.table_number) && (
                          /* "Bar 1" lives under a synthetic number, because
                             table_number is an INTEGER. Showing 901 alone
                             names a table the restaurant does not have. */
                          <span className="text-xs text-gray-500 truncate">{table.pos_table_name}</span>
                        )}
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
                      {table.table_section && (
                        <span className="text-xs text-gray-400 border border-gray-200 rounded px-1.5 py-0.5 leading-none">{table.table_section}</span>
                      )}
                    </div>
                  </div>

                  {/* Row 2: Status badge */}
                  <div className="mt-2">
                    {isOccupied ? (
                      <span data-testid={`table-status-${table.table_number}`} className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-bold bg-red-100 text-red-700">OCCUPIED</span>
                    ) : (
                      <span data-testid={`table-status-${table.table_number}`} className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-bold bg-green-100 text-green-700">AVAILABLE</span>
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
                            ) : renderCalls()}
                          </div>
                        )}
                      </div>
                    </>
                  )}

                  {/* A call can arrive with nobody seated: the on-table device
                      (and a diner who rang before joining) raise calls on a table
                      with no session. Everything above is gated on a session, so
                      those calls were invisible here although the API returned
                      them (dev Anant tables 3 and 4, 2026-10-22). */}
                  {!isOccupied && tableCalls.length > 0 && (
                    <div className="mt-3 space-y-1.5" data-testid={`table-calls-unseated-${table.table_number}`}>
                      {renderCalls()}
                    </div>
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
                          className={`shrink-0 px-3 text-xs bg-orange-500 text-white rounded-lg disabled:opacity-50 ${isMobile ? 'min-h-[44px]' : 'py-1'}`}
                        >
                          {savingCapacity[table.id] ? <Loader2 className="h-3 w-3 animate-spin" /> : 'Save'}
                        </button>
                      )}
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-gray-500 whitespace-nowrap">Section:</span>
                      <input
                        type="text"
                        list={`section-suggestions-${table.id}`}
                        placeholder="e.g. Patio, Bar, Upstairs"
                        value={sectionEdits[table.id] ?? (table.table_section || '')}
                        onChange={e => setSectionEdits(prev => ({ ...prev, [table.id]: e.target.value }))}
                        className={`min-w-0 flex-1 px-2 text-xs border border-gray-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-orange-400 ${isMobile ? 'min-h-[44px]' : 'py-1'}`}
                        data-testid={`table-section-input-${table.table_number}`}
                      />
                      <datalist id={`section-suggestions-${table.id}`}>
                        {Array.from(new Set(tables.map(t => t.table_section).filter(Boolean))).map(s => (
                          <option key={s} value={s!} />
                        ))}
                      </datalist>
                      {sectionEdits[table.id] !== undefined && sectionEdits[table.id] !== (table.table_section || '') && (
                        <button
                          onClick={() => handleSaveSection(table.id)}
                          disabled={savingSection[table.id]}
                          className={`shrink-0 px-3 text-xs bg-orange-500 text-white rounded-lg disabled:opacity-50 ${isMobile ? 'min-h-[44px]' : 'py-1'}`}
                          data-testid={`table-section-save-${table.table_number}`}
                        >
                          {savingSection[table.id] ? <Loader2 className="h-3 w-3 animate-spin" /> : 'Save'}
                        </button>
                      )}
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-gray-500 whitespace-nowrap">Label:</span>
                      <input
                        type="text"
                        placeholder="Custom label"
                        aria-label={`Custom label for table ${table.table_number}`}
                        value={labelEdits[table.id] ?? (table.table_label || '')}
                        onChange={e => setLabelEdits(prev => ({ ...prev, [table.id]: e.target.value }))}
                        className={`min-w-0 flex-1 px-2 text-xs border border-gray-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-orange-400 ${isMobile ? 'min-h-[44px]' : 'py-1'}`}
                        data-testid={`table-label-input-${table.table_number}`}
                      />
                      {labelEdits[table.id] !== undefined && labelEdits[table.id] !== (table.table_label || '') && (
                        <button
                          onClick={() => handleSaveLabel(table.id)}
                          disabled={savingLabel[table.id]}
                          className={`shrink-0 px-3 text-xs bg-orange-500 text-white rounded-lg disabled:opacity-50 ${isMobile ? 'min-h-[44px]' : 'py-1'}`}
                          data-testid={`table-label-save-${table.table_number}`}
                        >
                          {savingLabel[table.id] ? <Loader2 className="h-3 w-3 animate-spin" /> : 'Save'}
                        </button>
                      )}
                    </div>

                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => handleToggleActive(table.id, table.is_active)}
                        disabled={togglingActive[table.id]}
                        data-testid={`table-toggle-${table.table_number}`}
                        aria-label={`${table.is_active ? 'Deactivate' : 'Reactivate'} table ${table.table_number}`}
                        className={`flex-1 px-2 text-xs rounded-lg border disabled:opacity-50 ${isMobile ? 'min-h-[44px]' : 'py-1.5'} ${
                          table.is_active
                            ? 'border-gray-200 text-gray-600 hover:bg-gray-50'
                            : 'border-green-200 text-green-700 hover:bg-green-50'
                        }`}
                      >
                        {togglingActive[table.id]
                          ? <Loader2 className="h-3 w-3 animate-spin mx-auto" />
                          : table.is_active ? 'Deactivate' : 'Reactivate'}
                      </button>
                      {rotateQr && (
                        <button
                          onClick={() => setRotateConfirm({ tableId: table.id, tableNumber: table.table_number })}
                          disabled={rotatingQr === table.id}
                          data-testid={`table-rotate-qr-${table.table_number}`}
                          aria-label={`Regenerate QR code for table ${table.table_number}`}
                          title="Regenerate QR — the printed code stops working immediately (killswitch)"
                          className={`px-2 text-xs rounded-lg border border-amber-200 text-amber-700 hover:bg-amber-50 disabled:opacity-50 ${isMobile ? 'min-h-[44px]' : 'py-1.5'}`}
                        >
                          {rotatingQr === table.id
                            ? <Loader2 className="h-3 w-3 animate-spin" />
                            : <RefreshCw className="h-3 w-3" />}
                        </button>
                      )}
                    </div>

                    {/* No per-table pairing code here on purpose. A code bound
                        to one table assigned the device at pair time, so the
                        puck never showed its table picker -- "I entered the
                        code and got no table choice" was the EXPECTED
                        behaviour, and it confused everyone. One permanent
                        restaurant code now lives at the top of this tab and
                        the device picks its own table. Retired 2026-10-11. */}
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
            <h3 className="text-lg font-bold text-gray-900 mb-4" data-testid="add-tables-modal">Add Tables</h3>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Number of tables</label>
                <input
                  type="number"
                  data-testid="add-tables-count"
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
                  data-testid="add-tables-start"
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
                data-testid="add-tables-submit"
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

      {/* Regenerate-QR confirmation. Destructive and irreversible for anything
          already printed, so it gets the same weight as Delete. */}
      {rotateConfirm && createPortal(
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="bg-white rounded-xl p-5 max-w-sm w-full" data-testid="rotate-qr-confirm">
            <h2 className="text-lg font-bold text-gray-900">
              Regenerate QR for Table {rotateConfirm.tableNumber}?
            </h2>
            <p className="mt-2 text-sm text-gray-600">
              The current printed QR for this table will stop working immediately.
              Reprint it and replace the table tent.
            </p>
            <div className="mt-4 flex justify-end gap-2">
              <button
                onClick={() => setRotateConfirm(null)}
                data-testid="rotate-qr-cancel"
                className="px-3 py-2 text-sm rounded-lg border border-gray-200 text-gray-700 hover:bg-gray-50"
              >
                Cancel
              </button>
              <button
                onClick={() => handleRotateQr(rotateConfirm.tableId, rotateConfirm.tableNumber)}
                data-testid="rotate-qr-confirm-btn"
                className="px-3 py-2 text-sm rounded-lg bg-amber-600 text-white hover:bg-amber-700"
              >
                Regenerate
              </button>
            </div>
          </div>
        </div>,
        document.body,
      )}

      {/* Delete Table Confirmation Modal */}
      {deleteConfirm && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center"
          style={{ backgroundColor: 'rgba(0,0,0,0.5)' }}
          onClick={(e) => { if (e.target === e.currentTarget) setDeleteConfirm(null); }}
        >
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm mx-4 p-6" data-testid="delete-table-confirm">
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
                data-testid="delete-table-confirm-btn"
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
