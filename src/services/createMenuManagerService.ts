import type { HttpAdapter } from '../types/restaurant';
import type { MenuManagerService } from '../types/restaurant';

/**
 * Factory that creates a MenuManagerService backed by the owner API.
 * Consumers provide an HttpAdapter that handles authentication, allowing
 * different auth mechanisms (e.g. owner Cognito token vs portal admin token).
 *
 * Originally lifted into @qrate/shared alongside MenuManagerClient (54cfe3f),
 * then deleted (df73858) as "unused" — that deletion missed qrate-admin-webapp,
 * which IS a consumer. Restored 2026-05-18 with admin-webapp added to the
 * consumer list in CLAUDE.md so future grep-based cleanup doesn't repeat the
 * mistake.
 *
 * Usage:
 *   const service = createMenuManagerService(adapter, OWNER_API_URL);
 *   <MenuManagerClient service={service} ... />
 *
 * Optional methods on MenuManagerService (cloneMenu, getItemModifiers,
 * getMenuIntelligence, getMenuItemPerformance) are NOT wired by this factory
 * — consumers needing them construct the service object directly via
 * Object.assign or a wiring hook (see qrate-owner-webapp's
 * useMenuManagerWiring for the reference pattern).
 */
export function createMenuManagerService(
  adapter: HttpAdapter,
  ownerApiUrl: string,
): MenuManagerService {
  const api = ownerApiUrl;

  return {
    getAllMenuItems: async (restaurantId) => {
      const data = await adapter.fetchJson<{ items: unknown[] }>(`${api}/owner/restaurants/${restaurantId}/all-items`);
      return (data.items ?? []) as ReturnType<MenuManagerService['getAllMenuItems']> extends Promise<infer T> ? T : never;
    },

    getMenus: async (restaurantId) => {
      const data = await adapter.fetchJson<{ menus: unknown[] }>(`${api}/owner/restaurants/${restaurantId}/menus`);
      return (data.menus ?? []) as ReturnType<MenuManagerService['getMenus']> extends Promise<infer T> ? T : never;
    },

    addMenuItem: async (restaurantId, itemData) => {
      return adapter.fetchJson(`${api}/owner/restaurants/${restaurantId}/menu/items`, {
        method: 'POST',
        body: itemData,
      });
    },

    updateMenuItem: async (itemId, updates) => {
      return adapter.fetchJson(`${api}/owner/menu/items/${itemId}`, {
        method: 'PUT',
        body: updates,
      });
    },

    deleteMenuItem: async (itemId) => {
      await adapter.fetchJson(`${api}/owner/menu/items/${itemId}`, { method: 'DELETE' });
    },

    toggleMenuItemActive: async (itemId, active) => {
      await adapter.fetchJson(`${api}/owner/menu/items/${itemId}/active`, {
        method: 'PATCH',
        body: { active },
      });
    },

    createMenu: async (restaurantId, data) => {
      return adapter.fetchJson(`${api}/owner/restaurants/${restaurantId}/menus`, {
        method: 'POST',
        body: data,
      });
    },

    updateMenu: async (restaurantId, menuId, data) => {
      return adapter.fetchJson(`${api}/owner/restaurants/${restaurantId}/menus/${menuId}`, {
        method: 'PUT',
        body: data,
      });
    },

    deleteMenu: async (restaurantId, menuId) => {
      await adapter.fetchJson(`${api}/owner/restaurants/${restaurantId}/menus/${menuId}`, {
        method: 'DELETE',
      });
    },

    addItemToMenu: async (itemId, menuId, price, category, settings) => {
      return adapter.fetchJson(`${api}/owner/menu/items/${itemId}/menus`, {
        method: 'POST',
        body: {
          menu_id: menuId,
          price: price ?? null,
          category_name: category,
          canonical_categories: settings?.canonical_categories,
          ...(settings?.raw_categories !== undefined && { raw_categories: settings.raw_categories }),
        },
      });
    },

    removeItemFromMenu: async (itemId, menuId) => {
      return adapter.fetchJson(`${api}/owner/menu/items/${itemId}/menus/${menuId}`, {
        method: 'DELETE',
      });
    },

    updateMenuItemInMenu: async (itemId, menuId, patch) => {
      return adapter.fetchJson(`${api}/owner/menu/items/${itemId}/menus/${menuId}`, {
        method: 'PATCH',
        body: patch,
      });
    },

    updateItemModifiers: async (itemId, data) => {
      await adapter.fetchJson(`${api}/owner/menu/items/${itemId}/modifiers`, {
        method: 'PUT',
        body: data,
      });
    },

    getAddonItems: async (restaurantId) => {
      const data = await adapter.fetchJson<{ items: unknown[] }>(`${api}/owner/restaurants/${restaurantId}/addon-items`);
      return (data.items ?? []) as ReturnType<MenuManagerService['getAddonItems']> extends Promise<infer T> ? T : never;
    },

    bulkAssignModifiers: async (restaurantId, payload) => {
      return adapter.fetchJson(`${api}/owner/restaurants/${restaurantId}/bulk-assign-modifiers`, {
        method: 'POST',
        body: payload,
      });
    },

    getMenuItemImageUploadUrl: async (itemId) => {
      return adapter.fetchJson(`${api}/owner/menu/items/${itemId}/image/upload-url`, {
        method: 'POST',
      });
    },

    confirmMenuItemImageUpload: async (itemId) => {
      return adapter.fetchJson(`${api}/owner/menu/items/${itemId}/image/confirm`, {
        method: 'POST',
      });
    },

    enhanceMenuItemImage: async (itemId) => {
      return adapter.fetchJson(`${api}/owner/menu/items/${itemId}/image/enhance`, {
        method: 'POST',
      });
    },

    generateMenuItemImage: async (itemId) => {
      return adapter.fetchJson(`${api}/owner/menu/items/${itemId}/image/generate`, {
        method: 'POST',
      });
    },

    removeMenuItemImage: async (itemId) => {
      await adapter.fetchJson(`${api}/owner/menu/items/${itemId}/image`, { method: 'DELETE' });
    },

    // Raw sub-categories (menu raw sub-categories feature, 2026-06-09). Without
    // these, MenuManagerClient's `service.renameMenuRawCategory?.()` guard
    // returns early and rename/delete silently no-op (the bug behind the
    // raw-subcategories E2E rename failure). POST verbs (no new CORS method).
    listMenuRawCategories: async (menuId) => {
      const data = await adapter.fetchJson<{ raw_categories: { label: string; item_count: number }[] }>(
        `${api}/owner/menus/${menuId}/raw-categories`,
      );
      return data.raw_categories ?? [];
    },

    renameMenuRawCategory: async (menuId, from, to) => {
      const data = await adapter.fetchJson<{ updated_count: number }>(
        `${api}/owner/menus/${menuId}/raw-categories/rename`,
        { method: 'POST', body: { from, to } },
      );
      return { updated_count: data?.updated_count ?? 0 };
    },

    deleteMenuRawCategory: async (menuId, label) => {
      const data = await adapter.fetchJson<{ updated_count: number }>(
        `${api}/owner/menus/${menuId}/raw-categories/delete`,
        { method: 'POST', body: { label } },
      );
      return { updated_count: data?.updated_count ?? 0 };
    },

    // ── First-class sub-category structure (PDD 2026-06-19 Phase 3) ──────────
    // The single-source replacement for raw_categories grouping + junction
    // dual-write, gated behind isSubcategoryV2Enabled() in MenuManagerClient.
    getMenuStructure: async (menuId) => {
      return adapter.fetchJson(`${api}/owner/menus/${menuId}/structure`);
    },
    createMenuSubcategory: async (menuId, body) => {
      return adapter.fetchJson(`${api}/owner/menus/${menuId}/subcategories`, {
        method: 'POST',
        body,
      });
    },
    updateMenuSubcategory: async (menuId, subId, body) => {
      return adapter.fetchJson(`${api}/owner/menus/${menuId}/subcategories/${subId}`, {
        method: 'PATCH',
        body,
      });
    },
    deleteMenuSubcategory: async (menuId, subId) => {
      await adapter.fetchJson(`${api}/owner/menus/${menuId}/subcategories/${subId}`, {
        method: 'DELETE',
      });
    },
    assignItemToSubcategory: async (menuId, itemId, subId) => {
      await adapter.fetchJson(`${api}/owner/menus/${menuId}/items/${itemId}/subcategory`, {
        method: 'PUT',
        body: { subcategory_id: subId },
      });
    },
    unassignItemFromSubcategory: async (menuId, itemId, course) => {
      await adapter.fetchJson(`${api}/owner/menus/${menuId}/items/${itemId}/subcategory`, {
        method: 'PUT',
        body: { subcategory_id: null, course },
      });
    },
  };
}
