import type { HttpAdapter, MenuItemsService, MenuItemDisplay, MenuAssociation, MenuItemJunctionSettings, FoodTags } from '../types/restaurant';

export interface CreateMenuItemsServiceOptions {
  /** When true, a standalone saveTags method is wired (calls recommendation API). */
  includeSaveTags?: boolean;
  /** When true, toggleActive is wired. */
  includeToggleActive?: boolean;
}

/**
 * Creates a MenuItemsService backed by the standard owner API endpoints.
 * Each app provides its own HttpAdapter (with its auth mechanism) and API base URLs.
 */
export function createMenuItemsService(
  adapter: HttpAdapter,
  ownerApiUrl: string,
  recommendationApiUrl?: string,
  options?: CreateMenuItemsServiceOptions,
): MenuItemsService {
  const { includeSaveTags = false, includeToggleActive = false } = options || {};

  return {
    getItems: async (restaurantId: string): Promise<MenuItemDisplay[]> => {
      const data = await adapter.fetchJson<{ items: MenuItemDisplay[] }>(
        `${ownerApiUrl}/owner/restaurants/${restaurantId}/all-items`,
      );
      return (data.items || []).map((item) => ({
        ...item,
        category: item.category || '',
      }));
    },

    updateItem: async (itemId, updates) => {
      return adapter.fetchJson(`${ownerApiUrl}/owner/menu/items/${itemId}`, {
        method: 'PUT',
        body: {
          name: updates.name,
          description: updates.description,
          price: updates.price,
          category: updates.category,
          food_tags: updates.food_tags,
          chefs_special: updates.chefs_special,
          canonical_category: updates.canonical_category,
          portion_type: updates.portion_type,
          portion_serves: updates.portion_serves,
        },
      });
    },

    addItem: async (restaurantId, data) => {
      return adapter.fetchJson(`${ownerApiUrl}/owner/restaurants/${restaurantId}/menu/items`, {
        method: 'POST',
        body: data,
      });
    },

    deleteItem: async (itemId) => {
      await adapter.fetchJson(`${ownerApiUrl}/owner/menu/items/${itemId}`, { method: 'DELETE' });
    },

    toggleActive: includeToggleActive
      ? async (itemId, active) => {
          await adapter.fetchJson(`${ownerApiUrl}/owner/menu/items/${itemId}/active`, {
            method: 'PATCH',
            body: { active },
          });
        }
      : undefined,

    saveTags: includeSaveTags && recommendationApiUrl
      ? async (itemId, tags) => {
          await adapter.fetchJson(`${recommendationApiUrl}/recommendation/menu-items/${itemId}/tags`, {
            method: 'PUT',
            body: { food_tags: tags },
          });
        }
      : undefined,

    generateAllTags: recommendationApiUrl
      ? async (restaurantId) => {
          await adapter.fetchJson(`${recommendationApiUrl}/recommendation/food-tags/${restaurantId}`, {
            method: 'POST',
            body: {},
          });
        }
      : undefined,

    uploadImage: async (itemId, blob) => {
      const { upload_url } = await adapter.fetchJson<{ upload_url: string }>(
        `${ownerApiUrl}/owner/menu/items/${itemId}/image/upload-url`,
        { method: 'POST' },
      );
      const uploadRes = await adapter.fetchRaw(upload_url, {
        method: 'PUT',
        body: blob,
        headers: { 'Content-Type': 'image/png' },
      });
      if (!uploadRes.ok) throw new Error(`S3 upload failed with status ${uploadRes.status}`);
      const { thumbnail_url } = await adapter.fetchJson<{ thumbnail_url: string }>(
        `${ownerApiUrl}/owner/menu/items/${itemId}/image/confirm`,
        { method: 'POST' },
      );
      return thumbnail_url;
    },

    generateImage: async (itemId) => {
      const { thumbnail_url } = await adapter.fetchJson<{ thumbnail_url: string }>(
        `${ownerApiUrl}/owner/menu/items/${itemId}/image/generate`,
        { method: 'POST' },
      );
      return thumbnail_url;
    },

    enhanceImage: async (itemId) => {
      const { thumbnail_url } = await adapter.fetchJson<{ thumbnail_url: string }>(
        `${ownerApiUrl}/owner/menu/items/${itemId}/image/enhance`,
        { method: 'POST' },
      );
      return thumbnail_url;
    },

    removeImage: async (itemId) => {
      await adapter.fetchJson(`${ownerApiUrl}/owner/menu/items/${itemId}/image`, { method: 'DELETE' });
    },

    updateBoost: async (restaurantId, itemId, level) => {
      await adapter.fetchJson(`${ownerApiUrl}/owner/restaurants/${restaurantId}/menu-boosts`, {
        method: 'PUT',
        body: { items: [{ id: itemId, boost_level: level }] },
      });
    },

    addItemToMenu: async (itemId, menuId, price, categoryName) => {
      const data = await adapter.fetchJson<{ menu_associations: MenuAssociation[] }>(
        `${ownerApiUrl}/owner/menu/items/${itemId}/menus`,
        { method: 'POST', body: { menu_id: menuId, price, category_name: categoryName } },
      );
      return data.menu_associations;
    },

    removeItemFromMenu: async (itemId, menuId) => {
      const data = await adapter.fetchJson<{ menu_associations: MenuAssociation[] }>(
        `${ownerApiUrl}/owner/menu/items/${itemId}/menus/${menuId}`,
        { method: 'DELETE' },
      );
      return data.menu_associations;
    },

    updateItemInMenu: async (itemId: string, menuId: string, settings: MenuItemJunctionSettings) => {
      const data = await adapter.fetchJson<{ menu_associations: MenuAssociation[] }>(
        `${ownerApiUrl}/owner/menu/items/${itemId}/menus/${menuId}`,
        { method: 'PATCH', body: settings },
      );
      return data.menu_associations;
    },

    getMenus: async (restaurantId) => {
      const data = await adapter.fetchJson<{ menus: { id: string; name: string; active?: boolean }[] }>(
        `${ownerApiUrl}/owner/restaurants/${restaurantId}/menus`,
      );
      return data.menus.filter(m => m.active !== false);
    },
  };
}

/**
 * Fetches the canonical category map from the recommendation API.
 * Returns a mapping of original_name -> canonical_names[].
 */
export async function fetchCanonicalCategoryMap(
  adapter: HttpAdapter,
  recommendationApiUrl: string,
  restaurantId: string,
): Promise<Record<string, string[]>> {
  const data = await adapter.fetchJson<any>(
    `${recommendationApiUrl}/recommendation/menu-intelligence/${restaurantId}`,
  );
  const cats = data.menu_intelligence?.canonical_categories || [];
  const map: Record<string, string[]> = {};
  for (const cat of cats) {
    const names = cat.canonical_names || (cat.canonical_name ? [cat.canonical_name] : []);
    if (cat.original_name && names.length > 0) {
      map[cat.original_name] = names;
    }
  }
  return map;
}
