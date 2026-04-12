import type { HttpAdapter } from '../types/restaurant';
import type { MenuManagerService } from '../types/restaurant';

/**
 * Factory that creates a MenuManagerService backed by the owner API.
 * Consumers provide an HttpAdapter that handles authentication, allowing
 * different auth mechanisms (e.g. owner Cognito token vs portal admin token).
 *
 * Usage:
 *   const service = createMenuManagerService(adapter, OWNER_API_URL);
 *   <MenuManagerClient service={service} ... />
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

    approveAddonSuggestion: async (itemId, assocId) => {
      await adapter.fetchJson(`${api}/owner/menu-items/${itemId}/addons/${assocId}/approve`, {
        method: 'PATCH',
        body: {},
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
  };
}
