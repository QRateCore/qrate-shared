// @vitest-environment jsdom
/**
 * EditModal — wine section (PLAN 2026-08-04 M5).
 *
 * Covers:
 *  - New wine fields render only for beverage_type='wine'
 *  - 'rosé' → 'rose' value-drift fix: legacy accented value displays as Rosé
 *    and SUBMITS the ASCII canonical 'rose'; 'dessert' is a color option
 *  - Key-PRESERVING normalizeBeverage: unknown beverage keys survive a save
 *    (legacy food_tags full-replace channel)
 *  - Dual-channel save: identity fields ride a follow-up top-level PATCH
 *    together with a `beverage` sub-object filtered to the server merge
 *    whitelist
 *  - wine_old_world is NOT sent for a known-world country (server derives);
 *    for an unknown country the explicit toggle is sent
 *  - Tannin slider renders only for red/dessert colors
 *  - Tasting note maxLength counter
 *  - Non-wine beverages save via a single PUT (no wine follow-up)
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor, fireEvent, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import EditModal from '../EditModal';
import { MenuManagerServiceProvider } from '../../context';
import type {
  MenuItemDisplay,
  MenuManagerService,
  FoodTags,
} from '../../../../types/restaurant';

vi.mock('../../../../utils/imageProcessing', () => ({
  processImageForUpload: vi.fn(async (f: File) => f),
}));

vi.mock('../../../../hooks/useIsMobile', () => ({
  useIsMobile: () => false,
}));

const MOCK_PERF = {
  carousel_views: 10,
  conversions: 2,
  card_flips: 5,
  conversion_rate: 20,
};

function makeWineItem(overrides: Partial<MenuItemDisplay> = {}): MenuItemDisplay {
  return {
    id: 'wine-1',
    name: 'Barolo Riserva',
    description: 'A structured Nebbiolo from Piedmont',
    category: 'Beverages',
    canonical_category: 'Beverages',
    price: 18,
    active: true,
    item_type: 'dish',
    thumbnail_url: null,
    food_tags: {
      beverage: { beverage_type: 'wine', alcoholic: true, wine_color: 'red' },
    } as FoodTags,
    addons: [],
    sides: [],
    recommendations: [],
    boost_level: null,
    chefs_special: false,
    ...overrides,
  } as unknown as MenuItemDisplay;
}

function makeService(overrides: Partial<MenuManagerService> = {}): MenuManagerService {
  const saved = makeWineItem();
  return {
    getAllMenuItems: vi.fn().mockResolvedValue([]),
    getMenus: vi.fn().mockResolvedValue([]),
    addMenuItem: vi.fn().mockResolvedValue(saved),
    updateMenuItem: vi.fn().mockResolvedValue(saved),
    deleteMenuItem: vi.fn().mockResolvedValue(undefined),
    toggleMenuItemActive: vi.fn().mockResolvedValue(undefined),
    addItemToMenu: vi.fn().mockResolvedValue([]),
    removeItemFromMenu: vi.fn().mockResolvedValue([]),
    updateMenuItemInMenu: vi.fn().mockResolvedValue([]),
    updateItemModifiers: vi.fn().mockResolvedValue(undefined),
    getAddonItems: vi.fn().mockResolvedValue([]),
    getMenuItemImageUploadUrl: vi.fn().mockResolvedValue({ upload_url: 'https://s3.example.com/upload', s3_key: 'k' }),
    confirmMenuItemImageUpload: vi.fn().mockResolvedValue({ thumbnail_url: 'https://cdn.example.com/i.jpg' }),
    enhanceMenuItemImage: vi.fn().mockResolvedValue({ thumbnail_url: 'https://cdn.example.com/e.jpg' }),
    generateMenuItemImage: vi.fn().mockResolvedValue({ thumbnail_url: 'https://cdn.example.com/g.jpg' }),
    removeMenuItemImage: vi.fn().mockResolvedValue(undefined),
    getMenuItemPerformance: vi.fn().mockResolvedValue(MOCK_PERF),
    ...overrides,
  } as unknown as MenuManagerService;
}

function renderModal(config: {
  item?: MenuItemDisplay;
  service?: MenuManagerService;
  onComplete?: (u: MenuItemDisplay & { _deleted?: boolean }) => void;
} = {}) {
  const {
    item = makeWineItem(),
    service = makeService(),
    onComplete = vi.fn(),
  } = config;
  render(
    <MenuManagerServiceProvider value={service}>
      <EditModal
        item={item}
        restaurantId="rest-1"
        menus={[]}
        allItems={[]}
        onClose={vi.fn()}
        onComplete={onComplete}
      />
    </MenuManagerServiceProvider>,
  );
  return { service, onComplete };
}

async function save(service: MenuManagerService) {
  const user = userEvent.setup();
  await user.click(screen.getByTestId('edit-save-btn'));
  await waitFor(() => {
    expect(service.updateMenuItem).toHaveBeenCalled();
  });
  return (service.updateMenuItem as ReturnType<typeof vi.fn>).mock.calls;
}

describe('EditModal wine section — rendering', () => {
  it('renders identity inputs, sliders, pairing chips and tasting note for wine', () => {
    renderModal();
    expect(screen.getByTestId('beverage-input-varietal')).toBeInTheDocument();
    expect(screen.getByTestId('beverage-input-producer')).toBeInTheDocument();
    expect(screen.getByTestId('beverage-input-region')).toBeInTheDocument();
    expect(screen.getByTestId('beverage-input-vintage')).toBeInTheDocument();
    expect(screen.getByTestId('beverage-input-country')).toBeInTheDocument();
    expect(screen.getByTestId('beverage-old-world-chip')).toBeInTheDocument();
    expect(screen.getByTestId('beverage-scale-body')).toBeInTheDocument();
    expect(screen.getByTestId('beverage-scale-sweetness')).toBeInTheDocument();
    expect(screen.getByTestId('beverage-scale-acidity')).toBeInTheDocument();
    expect(screen.getByTestId('beverage-scale-alcohol')).toBeInTheDocument();
    expect(screen.getByTestId('beverage-dish-pairing-red_meat')).toBeInTheDocument();
    expect(screen.getByTestId('beverage-dish-pairing-spiced')).toBeInTheDocument();
    expect(screen.getByTestId('beverage-input-tasting-note')).toBeInTheDocument();
    expect(screen.getByTestId('beverage-input-short-story')).toBeInTheDocument();
    expect(screen.getByTestId('beverage-input-long-story')).toBeInTheDocument();
  });

  it('does not render the wine section for a non-wine beverage', () => {
    renderModal({
      item: makeWineItem({
        food_tags: { beverage: { beverage_type: 'beer', alcoholic: true } } as FoodTags,
      }),
    });
    expect(screen.queryByTestId('beverage-input-producer')).not.toBeInTheDocument();
    expect(screen.queryByTestId('beverage-scale-body')).not.toBeInTheDocument();
    expect(screen.queryByTestId('beverage-input-tasting-note')).not.toBeInTheDocument();
    expect(screen.queryByTestId('beverage-input-short-story')).not.toBeInTheDocument();
    expect(screen.queryByTestId('beverage-input-long-story')).not.toBeInTheDocument();
  });

  it('hydrates identity inputs from the item wine columns', () => {
    renderModal({
      item: makeWineItem({
        wine_varietal: 'Nebbiolo',
        wine_producer: 'Gaja',
        wine_region: 'Barolo DOCG',
        wine_vintage: 2019,
        wine_country: 'Italy',
      }),
    });
    expect((screen.getByTestId('beverage-input-varietal') as HTMLInputElement).value).toBe('Nebbiolo');
    expect((screen.getByTestId('beverage-input-producer') as HTMLInputElement).value).toBe('Gaja');
    expect((screen.getByTestId('beverage-input-region') as HTMLInputElement).value).toBe('Barolo DOCG');
    expect((screen.getByTestId('beverage-input-vintage') as HTMLInputElement).value).toBe('2019');
    expect((screen.getByTestId('beverage-input-country') as HTMLInputElement).value).toBe('Italy');
  });

  it('renders the tannin slider for red, hides it for white', () => {
    renderModal();
    expect(screen.getByTestId('beverage-scale-tannin')).toBeInTheDocument();
  });

  it('hides the tannin slider for white wine', () => {
    renderModal({
      item: makeWineItem({
        food_tags: { beverage: { beverage_type: 'wine', wine_color: 'white' } } as FoodTags,
      }),
    });
    expect(screen.queryByTestId('beverage-scale-tannin')).not.toBeInTheDocument();
  });

  it('renders the tannin slider for dessert wine', () => {
    renderModal({
      item: makeWineItem({
        food_tags: { beverage: { beverage_type: 'wine', wine_color: 'dessert' } } as FoodTags,
      }),
    });
    expect(screen.getByTestId('beverage-scale-tannin')).toBeInTheDocument();
  });

  it('offers Dessert as a wine color option', async () => {
    const user = userEvent.setup();
    renderModal();
    await user.click(screen.getByTestId('beverage-input-wine-color'));
    const listbox = screen.getByTestId('beverage-input-wine-color-listbox');
    expect(within(listbox).getByRole('option', { name: 'Dessert' })).toBeInTheDocument();
  });

  it("displays a legacy 'rosé' value as the selected Rosé option", () => {
    renderModal({
      item: makeWineItem({
        food_tags: { beverage: { beverage_type: 'wine', wine_color: 'rosé' } } as FoodTags,
      }),
    });
    expect(screen.getByTestId('beverage-input-wine-color').textContent).toContain('Rosé');
  });

  it('shows a live character counter on the tasting note (max 160)', async () => {
    const user = userEvent.setup();
    renderModal();
    const note = screen.getByTestId('beverage-input-tasting-note') as HTMLTextAreaElement;
    expect(note.maxLength).toBe(160);
    expect(screen.getByTestId('beverage-tasting-note-counter').textContent).toBe('0/160');
    await user.type(note, 'Bold and structured');
    expect(screen.getByTestId('beverage-tasting-note-counter').textContent).toBe('19/160');
  });

  it('shows live character counters on short story (max 300) and long story (max 3000)', async () => {
    const user = userEvent.setup();
    renderModal();
    const short = screen.getByTestId('beverage-input-short-story') as HTMLTextAreaElement;
    const long = screen.getByTestId('beverage-input-long-story') as HTMLTextAreaElement;
    expect(short.maxLength).toBe(300);
    expect(long.maxLength).toBe(3000);
    expect(screen.getByTestId('beverage-short-story-counter').textContent).toBe('0/300');
    expect(screen.getByTestId('beverage-long-story-counter').textContent).toBe('0/3000');
    await user.type(short, 'A boutique estate.');
    expect(screen.getByTestId('beverage-short-story-counter').textContent).toBe('18/300');
  });

  it('shows a story-source badge when set, hides it when absent', () => {
    renderModal({
      item: makeWineItem({
        food_tags: {
          beverage: { beverage_type: 'wine', story_source: 'llm_knowledge' },
        } as FoodTags,
      }),
    });
    expect(screen.getByTestId('wine-story-source-badge').textContent).toBe('Auto-filled');
  });

  it('renders no story-source badge when story_source is absent', () => {
    renderModal();
    expect(screen.queryByTestId('wine-story-source-badge')).not.toBeInTheDocument();
  });
});

describe('EditModal wine section — old-world chip', () => {
  it('derives Old World read-only for a known old-world country', async () => {
    const user = userEvent.setup();
    renderModal();
    await user.type(screen.getByTestId('beverage-input-country'), 'France');
    const chip = screen.getByTestId('beverage-old-world-chip');
    expect(chip.getAttribute('data-derived')).toBe('true');
    expect(chip.textContent).toBe('Old World');
  });

  it('derives New World read-only for a known new-world country', async () => {
    const user = userEvent.setup();
    renderModal();
    await user.type(screen.getByTestId('beverage-input-country'), 'Chile');
    const chip = screen.getByTestId('beverage-old-world-chip');
    expect(chip.getAttribute('data-derived')).toBe('true');
    expect(chip.textContent).toBe('New World');
  });

  it('renders an editable toggle for an unknown country', async () => {
    const user = userEvent.setup();
    renderModal();
    await user.type(screen.getByTestId('beverage-input-country'), 'Atlantis');
    const chip = screen.getByTestId('beverage-old-world-chip');
    expect(chip.getAttribute('data-derived')).toBe('false');
    expect(screen.getByTestId('beverage-old-world-old')).toBeInTheDocument();
    expect(screen.getByTestId('beverage-old-world-new')).toBeInTheDocument();
  });
});

describe('EditModal wine section — save payload shape', () => {
  it('sends identity fields top-level + beverage sub-object in a follow-up PUT', async () => {
    const user = userEvent.setup();
    const { service } = renderModal();
    await user.type(screen.getByTestId('beverage-input-varietal'), 'Nebbiolo');
    await user.type(screen.getByTestId('beverage-input-producer'), 'Gaja');
    await user.type(screen.getByTestId('beverage-input-region'), 'Barolo');
    await user.type(screen.getByTestId('beverage-input-vintage'), '2019');
    await user.type(screen.getByTestId('beverage-input-country'), 'Italy');

    const calls = await save(service);
    expect(calls).toHaveLength(2);
    // Call 1 — the legacy body: food_tags present, no wine identity keys.
    const [, mainBody] = calls[0];
    expect(mainBody.food_tags).toBeDefined();
    expect(mainBody).not.toHaveProperty('wine_varietal');
    expect(mainBody).not.toHaveProperty('beverage');
    // Call 2 — the wine patch: identity top-level + beverage sub-object,
    // and NO food_tags (the backend can't take both in one request).
    const [, winePatch] = calls[1];
    expect(winePatch).not.toHaveProperty('food_tags');
    expect(winePatch.wine_varietal).toBe('Nebbiolo');
    expect(winePatch.wine_producer).toBe('Gaja');
    expect(winePatch.wine_region).toBe('Barolo');
    expect(winePatch.wine_vintage).toBe(2019);
    expect(winePatch.wine_country).toBe('Italy');
    const bev = winePatch.beverage as Record<string, unknown>;
    expect(bev).toBeDefined();
    expect(bev.beverage_type).toBe('wine');
  });

  it('does NOT send wine_old_world for a known-world country (server derives)', async () => {
    const user = userEvent.setup();
    const { service } = renderModal();
    await user.type(screen.getByTestId('beverage-input-country'), 'France');
    const calls = await save(service);
    const [, winePatch] = calls[1];
    expect(winePatch.wine_country).toBe('France');
    expect(winePatch).not.toHaveProperty('wine_old_world');
  });

  it('sends the explicit wine_old_world toggle for an unknown country', async () => {
    const user = userEvent.setup();
    const { service } = renderModal();
    await user.type(screen.getByTestId('beverage-input-country'), 'Atlantis');
    await user.click(screen.getByTestId('beverage-old-world-old'));
    const calls = await save(service);
    const [, winePatch] = calls[1];
    expect(winePatch.wine_country).toBe('Atlantis');
    expect(winePatch.wine_old_world).toBe(true);
  });

  it('omits wine_old_world for an unknown country when the owner never toggled', async () => {
    const user = userEvent.setup();
    const { service } = renderModal();
    await user.type(screen.getByTestId('beverage-input-country'), 'Atlantis');
    const calls = await save(service);
    const [, winePatch] = calls[1];
    expect(winePatch).not.toHaveProperty('wine_old_world');
  });

  it("submits 'rose' (ASCII) when the item carried the legacy accented 'rosé'", async () => {
    const { service } = renderModal({
      item: makeWineItem({
        food_tags: { beverage: { beverage_type: 'wine', wine_color: 'rosé' } } as FoodTags,
      }),
    });
    const calls = await save(service);
    const mainBev = (calls[0][1].food_tags as FoodTags).beverage as Record<string, unknown>;
    expect(mainBev.wine_color).toBe('rose');
    const patchBev = calls[1][1].beverage as Record<string, unknown>;
    expect(patchBev.wine_color).toBe('rose');
  });

  it('key-preserving normalize: unknown beverage keys survive the legacy channel', async () => {
    const { service } = renderModal({
      item: makeWineItem({
        food_tags: {
          beverage: {
            beverage_type: 'wine',
            wine_color: 'red',
            // Keys this EditModal build doesn't own — must survive the save.
            some_future_key: 'keep-me',
            taste_scales: { body: 77 },
          },
        } as unknown as FoodTags,
      }),
    });
    const calls = await save(service);
    const mainBev = (calls[0][1].food_tags as FoodTags).beverage as Record<string, unknown>;
    expect(mainBev.some_future_key).toBe('keep-me');
    expect((mainBev.taste_scales as Record<string, number>).body).toBe(77);
    // The merge-channel payload is filtered to the server whitelist — the
    // unknown key must NOT ride it (400 code=unknown_key otherwise).
    const patchBev = calls[1][1].beverage as Record<string, unknown>;
    expect(patchBev).not.toHaveProperty('some_future_key');
    expect((patchBev.taste_scales as Record<string, number>).body).toBe(77);
  });

  it('taste-scale slider edits land in beverage.taste_scales on both channels', async () => {
    const { service } = renderModal();
    fireEvent.change(screen.getByTestId('beverage-scale-body'), { target: { value: '85' } });
    fireEvent.change(screen.getByTestId('beverage-scale-tannin'), { target: { value: '90' } });
    const calls = await save(service);
    const mainTs = ((calls[0][1].food_tags as FoodTags).beverage as Record<string, unknown>)
      .taste_scales as Record<string, number>;
    expect(mainTs.body).toBe(85);
    expect(mainTs.tannin).toBe(90);
    const patchTs = (calls[1][1].beverage as Record<string, unknown>).taste_scales as Record<string, number>;
    expect(patchTs.body).toBe(85);
    expect(patchTs.tannin).toBe(90);
  });

  it('dish-pairing chips toggle into beverage.dish_pairings', async () => {
    const user = userEvent.setup();
    const { service } = renderModal();
    await user.click(screen.getByTestId('beverage-dish-pairing-seafood'));
    await user.click(screen.getByTestId('beverage-dish-pairing-cheese'));
    await user.click(screen.getByTestId('beverage-dish-pairing-seafood')); // toggle off
    const calls = await save(service);
    const patchBev = calls[1][1].beverage as Record<string, unknown>;
    expect(patchBev.dish_pairings).toEqual(['cheese']);
  });

  it('tasting note rides beverage.tasting_note', async () => {
    const user = userEvent.setup();
    const { service } = renderModal();
    await user.type(screen.getByTestId('beverage-input-tasting-note'), 'Cherry and tar, firm tannin.');
    const calls = await save(service);
    const patchBev = calls[1][1].beverage as Record<string, unknown>;
    expect(patchBev.tasting_note).toBe('Cherry and tar, firm tannin.');
  });

  it('short_story and long_story ride beverage.{short_story,long_story} on both channels', async () => {
    const user = userEvent.setup();
    const { service } = renderModal();
    await user.type(screen.getByTestId('beverage-input-short-story'), 'A boutique Piedmont estate.');
    await user.type(screen.getByTestId('beverage-input-long-story'), 'Founded in 1920 by...');
    const calls = await save(service);
    const mainBev = (calls[0][1].food_tags as FoodTags).beverage as Record<string, unknown>;
    expect(mainBev.short_story).toBe('A boutique Piedmont estate.');
    expect(mainBev.long_story).toBe('Founded in 1920 by...');
    const patchBev = calls[1][1].beverage as Record<string, unknown>;
    expect(patchBev.short_story).toBe('A boutique Piedmont estate.');
    expect(patchBev.long_story).toBe('Founded in 1920 by...');
  });

  it('clearing short_story/long_story drops the keys rather than sending empty strings', async () => {
    const { service } = renderModal({
      item: makeWineItem({
        food_tags: {
          beverage: {
            beverage_type: 'wine',
            short_story: 'Old story.',
            long_story: 'Old long story.',
          },
        } as FoodTags,
      }),
    });
    fireEvent.change(screen.getByTestId('beverage-input-short-story'), { target: { value: '' } });
    fireEvent.change(screen.getByTestId('beverage-input-long-story'), { target: { value: '' } });
    const calls = await save(service);
    const mainBev = (calls[0][1].food_tags as FoodTags).beverage as Record<string, unknown>;
    expect(mainBev).not.toHaveProperty('short_story');
    expect(mainBev).not.toHaveProperty('long_story');
  });

  it('does not send story_source from this form — provenance is server-owned', async () => {
    const user = userEvent.setup();
    const { service } = renderModal({
      item: makeWineItem({
        food_tags: {
          beverage: { beverage_type: 'wine', story_source: 'menu_source' },
        } as FoodTags,
      }),
    });
    await user.type(screen.getByTestId('beverage-input-short-story'), 'Edited by owner.');
    const calls = await save(service);
    const mainBev = (calls[0][1].food_tags as FoodTags).beverage as Record<string, unknown>;
    // Preserved via the key-preserving spread, not re-sent as a form-owned
    // field — editing short_story must not silently flip provenance.
    expect(mainBev.story_source).toBe('menu_source');
  });

  it('non-wine beverages save in a single PUT (no wine follow-up)', async () => {
    const { service } = renderModal({
      item: makeWineItem({
        food_tags: {
          beverage: {
            beverage_type: 'beer',
            beer_style: 'IPA',
            some_future_key: 'keep-me-too',
          },
        } as unknown as FoodTags,
      }),
    });
    const calls = await save(service);
    expect(calls).toHaveLength(1);
    const mainBev = (calls[0][1].food_tags as FoodTags).beverage as Record<string, unknown>;
    // Unknown keys survive on the legacy path for non-wine types too.
    expect(mainBev.some_future_key).toBe('keep-me-too');
    expect(mainBev.beer_style).toBe('IPA');
  });

  it('onComplete carries the wine identity fields (PUT response does not echo them)', async () => {
    const user = userEvent.setup();
    const onComplete = vi.fn();
    const { service } = renderModal({ onComplete });
    await user.type(screen.getByTestId('beverage-input-producer'), 'Gaja');
    await user.type(screen.getByTestId('beverage-input-country'), 'Italy');
    await save(service);
    await waitFor(() => expect(onComplete).toHaveBeenCalled());
    const updated = onComplete.mock.calls[0][0];
    expect(updated.wine_producer).toBe('Gaja');
    expect(updated.wine_country).toBe('Italy');
    // Locally derived to match the server's closed-map derivation.
    expect(updated.wine_old_world).toBe(true);
  });
});
