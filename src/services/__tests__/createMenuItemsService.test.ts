/**
 * Unit tests for createMenuItemsService.
 *
 * Factory builds a MenuItemsService backed by an injected HttpAdapter.
 * Different consumer apps (owner-webapp, waiter-webapp) wire different
 * auth mechanisms behind the adapter and reuse the same factory.
 *
 * Coverage focuses on:
 *   - URL composition for every method (owner-API vs recommendation-API)
 *   - HTTP method routing (GET / POST / PUT / PATCH / DELETE)
 *   - Body shape on writes
 *   - The two opt-in methods (saveTags / toggleActive) are gated by options
 *   - Image upload chain (upload-url → S3 PUT → confirm)
 *   - Filtering of inactive menus from getMenus
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createMenuItemsService } from '../createMenuItemsService';
import type {
  HttpAdapter,
  MenuAssociation,
  FoodTags,
} from '../../types/restaurant';

const OWNER_URL = 'https://owner.example.com';
const REC_URL = 'https://rec.example.com';

interface FetchJsonCall {
  url: string;
  method: string;
  body: unknown;
}

interface FetchRawCall {
  url: string;
  method: string;
  body: unknown;
  headers?: HeadersInit;
}

let jsonCalls: FetchJsonCall[];
let rawCalls: FetchRawCall[];
let jsonResponses: unknown[];
let rawResponseOk = true;

function makeAdapter(): HttpAdapter {
  return {
    fetchJson: vi.fn(async (url: string, opts?: { method?: string; body?: unknown }) => {
      jsonCalls.push({
        url,
        method: opts?.method ?? 'GET',
        body: opts?.body,
      });
      const next = jsonResponses.shift();
      return (next ?? {}) as never;
    }),
    fetchRaw: vi.fn(async (url: string, opts?: RequestInit) => {
      rawCalls.push({
        url,
        method: opts?.method ?? 'GET',
        body: opts?.body,
        headers: opts?.headers,
      });
      return new Response('', { status: rawResponseOk ? 200 : 500 });
    }),
  };
}

beforeEach(() => {
  jsonCalls = [];
  rawCalls = [];
  jsonResponses = [];
  rawResponseOk = true;
});

// ────────────────────────────────────────────────────────────────────────
// getItems
// ────────────────────────────────────────────────────────────────────────

describe('createMenuItemsService.getItems', () => {
  it('GETs /owner/restaurants/{id}/all-items and returns the items array', async () => {
    jsonResponses = [{ items: [{ id: '1', name: 'Pasta', category: 'Mains' }] }];
    const svc = createMenuItemsService(makeAdapter(), OWNER_URL);
    const items = await svc.getItems('rest-1');

    expect(jsonCalls[0].url).toBe(`${OWNER_URL}/owner/restaurants/rest-1/all-items`);
    expect(items).toHaveLength(1);
    expect(items[0].name).toBe('Pasta');
  });

  it('coerces missing category to empty string', async () => {
    jsonResponses = [{ items: [{ id: '1', name: 'X', category: null as never }] }];
    const svc = createMenuItemsService(makeAdapter(), OWNER_URL);
    const items = await svc.getItems('rest-1');
    expect(items[0].category).toBe('');
  });

  it('returns empty array when items is missing from the response', async () => {
    jsonResponses = [{}];
    const svc = createMenuItemsService(makeAdapter(), OWNER_URL);
    const items = await svc.getItems('rest-1');
    expect(items).toEqual([]);
  });
});

// ────────────────────────────────────────────────────────────────────────
// updateItem / addItem / deleteItem
// ────────────────────────────────────────────────────────────────────────

describe('createMenuItemsService write operations', () => {
  it('updateItem PUTs the whitelisted fields to /owner/menu/items/{id}', async () => {
    const svc = createMenuItemsService(makeAdapter(), OWNER_URL);
    jsonResponses = [{}];
    await svc.updateItem('item-1', {
      name: 'New name',
      description: 'desc',
      price: 12.5,
      category: 'Mains',
      food_tags: { allergens: ['eggs'] } as FoodTags,
      chefs_special: true,
      portion_type: 'shared',
      portion_serves: 2,
      // unknown field — should be dropped because the impl explicitly
      // whitelists fields in the body.
      not_a_field: 'x',
    } as never);

    expect(jsonCalls[0].method).toBe('PUT');
    expect(jsonCalls[0].url).toBe(`${OWNER_URL}/owner/menu/items/item-1`);
    expect(jsonCalls[0].body).toEqual({
      name: 'New name',
      description: 'desc',
      price: 12.5,
      category: 'Mains',
      food_tags: { allergens: ['eggs'] },
      chefs_special: true,
      portion_type: 'shared',
      portion_serves: 2,
    });
  });

  it('addItem POSTs to the menu/items collection on the restaurant', async () => {
    const svc = createMenuItemsService(makeAdapter(), OWNER_URL);
    jsonResponses = [{}];
    const data = { name: 'New', description: 'd', price: 10, category: 'Mains' };
    await svc.addItem('rest-1', data as never);

    expect(jsonCalls[0]).toEqual({
      url: `${OWNER_URL}/owner/restaurants/rest-1/menu/items`,
      method: 'POST',
      body: data,
    });
  });

  it('deleteItem DELETEs /owner/menu/items/{id}', async () => {
    const svc = createMenuItemsService(makeAdapter(), OWNER_URL);
    jsonResponses = [{}];
    await svc.deleteItem('item-1');

    expect(jsonCalls[0]).toEqual({
      url: `${OWNER_URL}/owner/menu/items/item-1`,
      method: 'DELETE',
      body: undefined,
    });
  });
});

// ────────────────────────────────────────────────────────────────────────
// Opt-in methods (toggleActive, saveTags, generateAllTags)
// ────────────────────────────────────────────────────────────────────────

describe('createMenuItemsService opt-in methods', () => {
  it('toggleActive is undefined by default', () => {
    const svc = createMenuItemsService(makeAdapter(), OWNER_URL);
    expect(svc.toggleActive).toBeUndefined();
  });

  it('toggleActive PATCHes /active when includeToggleActive=true', async () => {
    const svc = createMenuItemsService(makeAdapter(), OWNER_URL, undefined, {
      includeToggleActive: true,
    });
    jsonResponses = [{}];
    await svc.toggleActive!('item-1', false);

    expect(jsonCalls[0]).toEqual({
      url: `${OWNER_URL}/owner/menu/items/item-1/active`,
      method: 'PATCH',
      body: { active: false },
    });
  });

  it('saveTags is undefined unless both includeSaveTags=true and recommendationApiUrl set', () => {
    const a = createMenuItemsService(makeAdapter(), OWNER_URL, undefined, {
      includeSaveTags: true,
    });
    expect(a.saveTags).toBeUndefined();

    const b = createMenuItemsService(makeAdapter(), OWNER_URL, REC_URL);
    expect(b.saveTags).toBeUndefined();
  });

  it('saveTags PUTs to recommendation API when both options set', async () => {
    const svc = createMenuItemsService(makeAdapter(), OWNER_URL, REC_URL, {
      includeSaveTags: true,
    });
    jsonResponses = [{}];
    const tags = { allergens: ['eggs'] } as FoodTags;
    await svc.saveTags!('item-1', tags);

    expect(jsonCalls[0]).toEqual({
      url: `${REC_URL}/recommendation/menu-items/item-1/tags`,
      method: 'PUT',
      body: { food_tags: tags },
    });
  });

  it('generateAllTags is undefined when no recommendation URL provided', () => {
    const svc = createMenuItemsService(makeAdapter(), OWNER_URL);
    expect(svc.generateAllTags).toBeUndefined();
  });

  it('generateAllTags POSTs to /recommendation/food-tags/{rid}', async () => {
    const svc = createMenuItemsService(makeAdapter(), OWNER_URL, REC_URL);
    jsonResponses = [{}];
    await svc.generateAllTags!('rest-1');

    expect(jsonCalls[0]).toEqual({
      url: `${REC_URL}/recommendation/food-tags/rest-1`,
      method: 'POST',
      body: {},
    });
  });
});

// ────────────────────────────────────────────────────────────────────────
// Image operations (3-step upload + confirm chain)
// ────────────────────────────────────────────────────────────────────────

describe('createMenuItemsService image operations', () => {
  it('uploadImage walks the 3-step chain: upload-url → S3 PUT → confirm', async () => {
    const svc = createMenuItemsService(makeAdapter(), OWNER_URL);
    jsonResponses = [
      { upload_url: 'https://s3/presigned-url' },
      { thumbnail_url: 'https://cdn/thumb.jpg' },
    ];
    const blob = new Blob(['x'], { type: 'image/png' });
    const url = await svc.uploadImage('item-1', blob);

    // Step 1: POST upload-url
    expect(jsonCalls[0]).toEqual({
      url: `${OWNER_URL}/owner/menu/items/item-1/image/upload-url`,
      method: 'POST',
      body: undefined,
    });
    // Step 2: PUT to S3 (raw, with Content-Type)
    expect(rawCalls[0].url).toBe('https://s3/presigned-url');
    expect(rawCalls[0].method).toBe('PUT');
    expect(rawCalls[0].headers).toEqual({ 'Content-Type': 'image/png' });
    expect(rawCalls[0].body).toBe(blob);
    // Step 3: POST confirm
    expect(jsonCalls[1]).toEqual({
      url: `${OWNER_URL}/owner/menu/items/item-1/image/confirm`,
      method: 'POST',
      body: undefined,
    });

    expect(url).toBe('https://cdn/thumb.jpg');
  });

  it('uploadImage throws when S3 PUT fails', async () => {
    const svc = createMenuItemsService(makeAdapter(), OWNER_URL);
    jsonResponses = [{ upload_url: 'https://s3/presigned-url' }];
    rawResponseOk = false;
    const blob = new Blob(['x'], { type: 'image/png' });

    await expect(svc.uploadImage('item-1', blob)).rejects.toThrow(/S3 upload failed/);
  });

  it('generateImage POSTs to /image/generate and returns the new thumbnail_url', async () => {
    const svc = createMenuItemsService(makeAdapter(), OWNER_URL);
    jsonResponses = [{ thumbnail_url: 'https://cdn/g.jpg' }];
    const url = await svc.generateImage('item-1');

    expect(jsonCalls[0].url).toBe(`${OWNER_URL}/owner/menu/items/item-1/image/generate`);
    expect(jsonCalls[0].method).toBe('POST');
    expect(url).toBe('https://cdn/g.jpg');
  });

  it('enhanceImage POSTs to /image/enhance', async () => {
    const svc = createMenuItemsService(makeAdapter(), OWNER_URL);
    jsonResponses = [{ thumbnail_url: 'https://cdn/e.jpg' }];
    await svc.enhanceImage('item-1');
    expect(jsonCalls[0].url).toBe(`${OWNER_URL}/owner/menu/items/item-1/image/enhance`);
  });

  it('removeImage DELETEs /image', async () => {
    const svc = createMenuItemsService(makeAdapter(), OWNER_URL);
    jsonResponses = [{}];
    await svc.removeImage('item-1');
    expect(jsonCalls[0]).toEqual({
      url: `${OWNER_URL}/owner/menu/items/item-1/image`,
      method: 'DELETE',
      body: undefined,
    });
  });
});

// ────────────────────────────────────────────────────────────────────────
// Menu junction operations
// ────────────────────────────────────────────────────────────────────────

describe('createMenuItemsService menu junctions', () => {
  it('addItemToMenu POSTs the menu_id, price, category_name', async () => {
    const svc = createMenuItemsService(makeAdapter(), OWNER_URL);
    const associations: MenuAssociation[] = [{ menu_id: 'm1', menu_name: 'Main' }];
    jsonResponses = [{ menu_associations: associations }];
    const out = await svc.addItemToMenu('item-1', 'm1', 12.5, 'Mains');

    expect(jsonCalls[0]).toEqual({
      url: `${OWNER_URL}/owner/menu/items/item-1/menus`,
      method: 'POST',
      body: { menu_id: 'm1', price: 12.5, category_name: 'Mains' },
    });
    expect(out).toEqual(associations);
  });

  it('removeItemFromMenu DELETEs the per-menu junction', async () => {
    const svc = createMenuItemsService(makeAdapter(), OWNER_URL);
    jsonResponses = [{ menu_associations: [] }];
    await svc.removeItemFromMenu('item-1', 'm1');
    expect(jsonCalls[0]).toEqual({
      url: `${OWNER_URL}/owner/menu/items/item-1/menus/m1`,
      method: 'DELETE',
      body: undefined,
    });
  });

  it('updateItemInMenu PATCHes the junction with the settings body', async () => {
    const svc = createMenuItemsService(makeAdapter(), OWNER_URL);
    jsonResponses = [{ menu_associations: [] }];
    await svc.updateItemInMenu('item-1', 'm1', { price: 20 } as never);
    expect(jsonCalls[0]).toEqual({
      url: `${OWNER_URL}/owner/menu/items/item-1/menus/m1`,
      method: 'PATCH',
      body: { price: 20 },
    });
  });

  it('updateBoost PUTs the items array with one entry', async () => {
    const svc = createMenuItemsService(makeAdapter(), OWNER_URL);
    jsonResponses = [{}];
    await svc.updateBoost('rest-1', 'item-1', 2 as never);

    expect(jsonCalls[0]).toEqual({
      url: `${OWNER_URL}/owner/restaurants/rest-1/menu-boosts`,
      method: 'PUT',
      body: { items: [{ id: 'item-1', boost_level: 2 }] },
    });
  });
});

// ────────────────────────────────────────────────────────────────────────
// getMenus — filters out inactive menus
// ────────────────────────────────────────────────────────────────────────

describe('createMenuItemsService.getMenus', () => {
  it('GETs /owner/restaurants/{id}/menus', async () => {
    const svc = createMenuItemsService(makeAdapter(), OWNER_URL);
    jsonResponses = [{ menus: [] }];
    await svc.getMenus('rest-1');
    expect(jsonCalls[0]).toEqual({
      url: `${OWNER_URL}/owner/restaurants/rest-1/menus`,
      method: 'GET',
      body: undefined,
    });
  });

  it('filters out menus with active=false; keeps active=true and undefined', async () => {
    jsonResponses = [
      {
        menus: [
          { id: 'm1', name: 'Active' },               // undefined active → kept
          { id: 'm2', name: 'Live', active: true },   // explicit true → kept
          { id: 'm3', name: 'Archived', active: false }, // false → dropped
        ],
      },
    ];
    const svc = createMenuItemsService(makeAdapter(), OWNER_URL);
    const menus = await svc.getMenus('rest-1');

    expect(menus.map((m) => m.id)).toEqual(['m1', 'm2']);
  });
});
