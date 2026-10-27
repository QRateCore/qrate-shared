// ─── Experience Management Types ─────────────────────────────────────────────

// Import and re-export RestaurantTable so components can import all experience types from one place
import type { RestaurantTable } from './restaurant';
export type { RestaurantTable } from './restaurant';

export type StaffRole = 'server' | 'host' | 'chef' | 'bartender' | 'manager';

export interface StaffMember {
  id: string;
  name: string;
  email: string;
  role: StaffRole;
  permissions: string[];
  is_active: boolean;
  created_at: string;
}

export interface CreateStaffRequest {
  name: string;
  email: string;
  role: StaffRole;
  temporary_password: string;
}

// ─── Order Status ────────────────────────────────────────────────────────────

// PDD 2026-05-22 Step 6c: `ready` retired from the order state machine.
// `ready` was REVIVED by STR-897/STR-901 (2026-07) — the KDS writes
// `preparing → ready` when the kitchen plates a dish. It is a real persisted
// status again; the 2026-05-22 retirement no longer holds (STR-903).
export type OrderStatus = 'placed' | 'pending' | 'confirmed' | 'preparing' | 'ready' | 'delivered' | 'completed' | 'cancelled' | 'issue';

// ─── Table Activity Detail Types ─────────────────────────────────────────────

export interface TableGuest {
  diner_id: string | null;
  name: string | null;
  allergens: string[];
  dietary_restrictions: string[];
  is_first_timer: boolean;
  order_ids?: string[];
  connected?: boolean;
  /** True when patron's phone has been away >5 min (disconnected → idle) */
  idle?: boolean;
  /** ISO timestamp of when patron went idle/disconnected */
  idle_since?: string | null;
  /** Dining occasion selected by this patron (e.g. 'celebration', 'date', 'family') */
  occasion?: string | null;
  /** ISO time this guest scanned the table QR / joined the session (owner_waiter `_patron_joined_at`). */
  joined_at?: string | null;
}

export interface TableCart {
  order_id: string;
  diner_name: string | null;
  created_at: string;
  minutes_browsing: number;
  items: { name: string; quantity: number; price: number }[];
}

export interface TablePlacedOrder {
  order_id: string;
  status: string;
  diner_id: string | null;
  diner_name: string | null;
  created_at: string;
  item_count: number;
  total_amount: number;
  /** Order tax. Exposed so the Bill tab can render a consistent subtotal/tax/total from a single feed. */
  tax?: number;
  /**
   * total_amount minus item-level cancelled lines (price × quantity). Equals
   * total_amount when nothing is cancelled. The Bill tab sums this instead of
   * total_amount so cancelled items are excluded from the bill.
   */
  active_total?: number;
  items?: Array<{ id?: string; name: string; quantity: number; price: number; patron_display_name?: string | null; item_status?: string }>;
}

/**
 * Per-table Check Please coverage block (§7 settled signal, §5 bill lines).
 * Computed server-side by `get_table_activity` in `owner_waiter.py` from the
 * DynamoDB session-patron rows + the `bill_math.settlement_lines` helper.
 *
 * - `covered` / `total` — count of connected patrons in the Cover state and
 *   the total number of connected patrons on the table.
 * - `settled` — true when `total > 0` and `covered === total`. The waiter
 *   should render "Ready to close" instead of "Settling — c/t covered".
 * - `lines` — price-free §5 settlement strings rendered on the Bill tab
 *   (e.g. "{Name} is paying for the whole table.").
 *
 * Spec: docs/2026-06-05_SPEC-check-please-settlement.md.
 */
export interface TableCoverageSummary {
  covered: number;
  total: number;
  settled: boolean;
  lines: string[];
}

export interface TableActivityEntry {
  table_number: number;
  guests: TableGuest[];
  active_carts: TableCart[];
  placed_orders: TablePlacedOrder[];
  needs_attention: boolean;
  has_active_session?: boolean;
  /**
   * Check Please coverage summary — present only when the backend has
   * computed it (post-d57894f7). Optional so consumers built before the
   * Check Please rollout don't break.
   */
  coverage?: TableCoverageSummary;
}

export interface TableActivity {
  tables: TableActivityEntry[];
}

// ─── Drinks-surface Table Activity (standalone drinks-ordering QR) ──────────
// A separate, independent view from TableActivity above — see
// owner_waiter.py::get_drinks_table_activity. Deliberately simpler: no
// coverage/bill-splitting fields (not supported on this surface) and no
// active_carts (drinks orders are placed directly, no browsing-cart state).

export interface DrinksTableGuest {
  diner_id: string | null;
  name: string;
  connected: boolean | null;
  idle: boolean | null;
  order_ids: string[];
}

export interface DrinksPlacedOrderItem {
  id: string;
  name: string | null;
  quantity: number;
  price: number;
  patron_display_name: string | null;
  item_status: string;
}

export interface DrinksPlacedOrder {
  order_id: string;
  status: string;
  diner_id: string | null;
  diner_name: string | null;
  created_at: string;
  total_amount: number;
  active_total: number;
  items: DrinksPlacedOrderItem[];
}

export interface DrinksTableActivityEntry {
  table_number: number;
  guests: DrinksTableGuest[];
  placed_orders: DrinksPlacedOrder[];
  has_active_session: boolean;
}

export interface DrinksTableActivity {
  tables: DrinksTableActivityEntry[];
}

export interface WaiterCall {
  id: string;
  table_number: number | null;
  status: string;
  created_at: string;
  call_type?: string;
  acknowledged_at?: string | null;
  minutes_old?: number;
}

export interface OrderSummary {
  id: string;
  status: string;
  subtotal: number;
  tax: number;
  tip: number;
  total_amount: number;
  special_instructions: string | null;
  table_number: number | null;
  external_order_id: string | null;
  pos_status: number | null;
  diner_name: string | null;
  item_count: number;
  created_at: string;
  updated_at: string;
}

export interface BoostItem {
  id: string;
  name: string;
  category_name: string;
  price: number;
  thumbnail_url: string | null;
  boost_level: number;
}

// ─── KDS config (STR-876 stations + STR-880 device tunables) ─────────────────

export interface KdsStationConfig {
  id: string;
  label: string;
  order: number;
  color?: string;
}

export interface KdsDeviceSettings {
  autoCloseMs?: number;
  ageWarnMs?: number;
  ageCritMs?: number;
  readyRetainMs?: number;
}

export interface KdsConfig {
  stations: KdsStationConfig[];
  device: KdsDeviceSettings;
}

/**
 * The restaurant's ONE reusable pairing code (STR-890). A kitchen-tablet operator scans the QR
 * (or types the code) to pair a device to this restaurant (KDS `PairingScreen`). The code is
 * PERSISTENT — it stays valid (until a 24h backstop) and pairs MANY devices, so mid-shift a new
 * tablet can join without disrupting the ones already connected. The owner regenerates on demand
 * ("Generate new code"); regenerating SUPERSEDES the prior code but NEVER disconnects paired
 * devices (that is what per-device Revoke is for). `code` is the human-typeable value;
 * `generatedAt` (client-stamped on create) / `expiresAt` are ISO strings.
 */
export interface KdsPairingCode {
  code: string;
  generatedAt?: string;
  expiresAt?: string | null;
}

/**
 * A kitchen display currently paired to the restaurant (STR-890 device list + revoke). The owner
 * uses `lastSeenAt` to tell a live display from a dead one before revoking (never kill an active
 * board). Names default to "Kitchen display" when the tablet didn't supply one.
 */
export interface KdsDevice {
  deviceId: string;
  name: string;
  /** ISO — when the device first paired. */
  pairedAt: string | null;
  /** ISO — last time the device polled the board; drives the "active / offline" cue. */
  lastSeenAt: string | null;
}

// ─── Service Interface ──────────────────────────────────────────────────────

/**
 * A paired on-table puck, as the Tables tab needs it. Structurally the owner
 * API's TableDevice; declared here so @qrate/shared keeps no dependency on the
 * owner data layer.
 */
export interface ExperienceTableDevice {
  deviceId: string;
  name: string;
  tableId: string | null;
  tableNumber: number | null;
  tableLabel: string | null;
  pairedAt: string;
  /** Null until the device's first poll lands. */
  lastSeenAt: string | null;
}

export interface ExperienceService {
  // Tables
  getTables(restaurantId: string): Promise<{ tables: RestaurantTable[]; count: number }>;
  createTables(restaurantId: string, req: { table_count: number; start_number: number }): Promise<{ tables: RestaurantTable[]; message: string }>;
  updateTable(restaurantId: string, tableId: string, updates: { capacity?: number; assigned_server_id?: string | null; table_label?: string | null; table_section?: string | null; is_active?: boolean }): Promise<{ table: RestaurantTable }>;
  generateQRCodes(restaurantId: string): Promise<{ tables: Array<{ table_id: string; table_number: number; qr_code_url: string }>; message: string }>;
  downloadQRCodesZip(restaurantId: string): Promise<{ download_url: string; filename: string; table_count: number }>;
  deleteTable?(restaurantId: string, tableId: string): Promise<void>;
  /**
   * The QR killswitch: bumps `print_gen`, re-derives the table's slug, and
   * stops the PRINTED code resolving immediately. For a sticker swap or a
   * leaked code — the operator reprints from the returned `scan_path`.
   *
   * Optional like the rest, but the owner portal must supply it: before
   * 2026-10-10 it lived only on /owner/tables, and retiring that page without
   * this would have left no way to fire it from any UI.
   */
  rotateTableQR?(restaurantId: string, tableId: string): Promise<{
    slug: string; sig: string; print_gen: number; scan_path: string;
  }>;
  /**
   * Pull the floor plan from the restaurant's POS.
   *
   * OPTIONAL on purpose: only a caller that supplies it gets the button.
   * The owner portal does not, so this stays an admin operation — an owner
   * re-importing a floor plan mid-service could renumber tables under their
   * own staff.
   *
   * Adopts tables QRate already has rather than duplicating them, and never
   * deletes: a QR code may already be printed and stuck to a table.
   */
  importPosTables?(restaurantId: string): Promise<{
    created: number; adopted: number; updated: number;
    skipped: string[]; provider_tables: number;
  }>;

  // On-table service pucks (qrate-table-device). A puck shows its table's QR
  // and a row of tappable service buttons.
  //
  // OPTIONAL for the same reason as importPosTables: only a caller that wires
  // them gets the pairing UI. The owner portal does; admin and waiter do not,
  // and must keep rendering this component unchanged.
  listTableDevices?(restaurantId: string): Promise<{ devices: ExperienceTableDevice[] }>;
  /**
   * The restaurant's pairing code. ONE per restaurant and PERMANENT; the
   * backend provisions it on first read, so in practice `code` is non-null.
   * `neverExpires` is true for it — `expiresAt` is then null, because the
   * stored sentinel date is an implementation detail and "valid until 2999"
   * is not a useful thing to show an owner.
   */
  getCurrentTableDeviceCode?(restaurantId: string): Promise<{
    code: string | null; expiresAt: string | null; neverExpires?: boolean;
  }>;
  revokeTableDevice?(restaurantId: string, deviceId: string): Promise<{ message: string }>;
  /**
   * REPLACE the restaurant's pairing code. Use it when a code leaks; reading
   * the current one is getCurrentTableDeviceCode, which provisions on demand.
   *
   * Rotating SIGNS OUT every paired device (2026-10-17): it is the kill
   * switch for a leaked code, and a code that only stops new devices does not
   * answer a leak. `signedOutDevices` reports how many went dark. This
   * reverses STR-890 for table devices on purpose.
   *
   * Per-table codes were retired 2026-10-11: binding a device at pair time
   * suppressed its table picker, which made "I entered the code and got no
   * table choice" the expected behaviour.
   */
  createTableDeviceCode?(restaurantId: string): Promise<{
    code: string; expiresAt: string | null; neverExpires?: boolean; tableId: string | null;
    /** How many paired devices this rotation signed out (2026-10-17). */
    signedOutDevices?: number;
  }>;

  // Drinks QR — SEPARATE standalone drinks-ordering QR per table, gated on
  // the admin-only `drinks_qr_enabled` deluxe flag. Optional: only present
  // when the consumer wires the Drinks tab (see ExperienceManagement
  // showDrinksTab prop).
  isDrinksQrEnabled?(restaurantId: string): Promise<boolean>;
  generateDrinksQRCodes?(restaurantId: string): Promise<{ tables: Array<{ table_id: string; table_number: number; drinks_qr_code_url: string }>; message: string }>;
  downloadDrinksQRCodesZip?(restaurantId: string): Promise<{ download_url: string; filename: string; table_count: number }>;
  /**
   * Live occupancy/guests/orders for the drinks surface only — independent
   * of getTableActivity (food). Optional: only present when the consumer
   * wires the Drinks tab.
   */
  getDrinksTableActivity?(restaurantId: string): Promise<DrinksTableActivity>;

  // Staff
  getStaff(restaurantId: string): Promise<{ staff: StaffMember[]; count: number }>;
  createStaff(restaurantId: string, data: CreateStaffRequest): Promise<{ staff: StaffMember }>;
  updateStaff(restaurantId: string, staffId: string, updates: { is_active?: boolean; role?: string }): Promise<{ staff: StaffMember }>;
  deleteStaff?(restaurantId: string, staffId: string): Promise<{ message: string }>;

  // Waiter calls & activity
  getWaiterCalls(restaurantId: string): Promise<WaiterCall[]>;
  acknowledgeWaiterCall(callId: string): Promise<void>;
  getTableActivity(restaurantId: string): Promise<TableActivity>;

  // Orders
  getOrders(restaurantId: string, status?: string, limit?: number): Promise<{ orders: OrderSummary[]; total: number }>;
  deleteOrder?(restaurantId: string, orderId: string): Promise<{ message: string }>;
  purgeOrders?(restaurantId: string): Promise<{ message: string; deleted_count: number }>;
  updateOrderStatus?(restaurantId: string, orderId: string, status: OrderStatus): Promise<void>;
  cancelOrderItem?(restaurantId: string, orderId: string, itemId: string): Promise<void>;

  // Menu Boost
  getMenuBoosts(restaurantId: string): Promise<{ items: BoostItem[] }>;
  updateMenuBoosts(restaurantId: string, items: Array<{ id: string; boost_level: number }>): Promise<{ updated_count: number }>;

  // Dynamic headers — waiter/owner portal
  getRestaurant?(restaurantId: string): Promise<{ dynamic_headers_enabled?: boolean; current_header_theme?: string | null; header_last_generated_at?: string | null }>;
  toggleDynamicHeaders?(restaurantId: string, enabled: boolean): Promise<{ dynamic_headers_enabled: boolean; current_header_theme: string | null; header_last_generated_at: string | null; generation_error?: string }>;
  regenerateHeader?(restaurantId: string): Promise<{ header_image_url: string }>;

  // Reset — portal only
  purgeSessions?(restaurantId: string): Promise<{ message: string }>;
  closeTableSession?(restaurantId: string, tableNumber: number): Promise<void>;

  // KDS config — owner kitchen stations + device tunables (STR-876/880).
  // Optional so waiter/admin ExperienceService impls + test factories don't break.
  getKdsConfig?(restaurantId: string): Promise<KdsConfig>;
  saveKdsConfig?(restaurantId: string, config: KdsConfig): Promise<KdsConfig>;

  // KDS device pairing (STR-890) — ONE reusable, persistent code per restaurant. The owner
  // regenerates on demand; regenerating supersedes the prior code but NEVER disconnects paired
  // devices. Optional (waiter/admin ExperienceService impls + test factories don't provide these).
  getKdsCurrentPairingCode?(restaurantId: string): Promise<KdsPairingCode | null>; // null → none yet (generate-first)
  createKdsPairingCode?(restaurantId: string): Promise<KdsPairingCode>;            // supersede + mint a new code
  getKdsDevices?(restaurantId: string): Promise<{ devices: KdsDevice[] }>;         // paired displays (identify before revoke)
  revokeKdsDevice?(restaurantId: string, deviceId: string): Promise<void>;         // disconnect ONE lost/retired device
}
