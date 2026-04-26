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
  items?: Array<{ name: string; quantity: number; price: number; patron_display_name?: string | null; item_status?: string }>;
}

export interface TableActivityEntry {
  table_number: number;
  guests: TableGuest[];
  active_carts: TableCart[];
  placed_orders: TablePlacedOrder[];
  needs_attention: boolean;
  has_active_session?: boolean;
}

export interface TableActivity {
  tables: TableActivityEntry[];
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

// ─── Service Interface ──────────────────────────────────────────────────────

export interface ExperienceService {
  // Tables
  getTables(restaurantId: string): Promise<{ tables: RestaurantTable[]; count: number }>;
  createTables(restaurantId: string, req: { table_count: number; start_number: number }): Promise<{ tables: RestaurantTable[]; message: string }>;
  updateTable(restaurantId: string, tableId: string, updates: { capacity?: number; assigned_server_id?: string | null; table_label?: string | null }): Promise<{ table: RestaurantTable }>;
  generateQRCodes(restaurantId: string): Promise<{ tables: Array<{ table_id: string; table_number: number; qr_code_url: string }>; message: string }>;
  downloadQRCodesZip(restaurantId: string): Promise<{ download_url: string; filename: string; table_count: number }>;
  deleteTable?(restaurantId: string, tableId: string): Promise<void>;

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
}
