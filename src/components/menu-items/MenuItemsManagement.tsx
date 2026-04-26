"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import type {
  MenuItemDisplay,
  MenuItemsService,
  MenuAssociation,
  FoodTags,
  BeverageTags,
} from "../../types/restaurant";
import { TAG_CATEGORIES, BEVERAGE_TYPES, BASE_SPIRITS, WINE_VARIETIES, BEER_STYLES, FLAVOR_NOTES, SERVING_STYLES, DRINK_STRENGTHS } from "../../constants/food-tags";
import Select from "../common/Select";

// ─── Constants ──────────────────────────────────────────────────────────────

const CANONICAL_CATEGORIES = [
  'Beverages',
  'Appetizers',
  'Soups',
  'Salads',
  'Sides',
  'Breads',
  'Entrees',
  'Desserts',
] as const;

const BOOST_LEVELS = [
  {
    label: "Low",
    value: 1,
    active: "bg-blue-500 border-blue-500 text-white",
    idle: "bg-white text-gray-500 border-gray-200 hover:border-blue-300 hover:text-blue-500",
  },
  {
    label: "Moderate",
    value: 2,
    active: "bg-yellow-500 border-yellow-500 text-white",
    idle: "bg-white text-gray-500 border-gray-200 hover:border-yellow-300 hover:text-yellow-500",
  },
  {
    label: "High",
    value: 3,
    active: "bg-red-500 border-red-500 text-white",
    idle: "bg-white text-gray-500 border-gray-200 hover:border-red-300 hover:text-red-500",
  },
];

// ─── Helpers ────────────────────────────────────────────────────────────────

function formatPrice(
  price: number | null | undefined,
  priceRaw?: string | null,
): string {
  if (price != null) return `$${price.toFixed(2)}`;
  if (priceRaw) return priceRaw;
  return "";
}

function resizeImage(file: File): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement("canvas");
      const maxSize = 1024;
      let { width, height } = img;
      if (width > maxSize || height > maxSize) {
        if (width > height) {
          height = Math.round((height * maxSize) / width);
          width = maxSize;
        } else {
          width = Math.round((width * maxSize) / height);
          height = maxSize;
        }
      }
      canvas.width = width;
      canvas.height = height;
      canvas.getContext("2d")!.drawImage(img, 0, 0, width, height);
      canvas.toBlob(
        (blob) =>
          blob ? resolve(blob) : reject(new Error("Conversion failed")),
        "image/png",
      );
    };
    img.onerror = () => reject(new Error("Failed to load image"));
    img.src = URL.createObjectURL(file);
  });
}

// ─── InlineTagInput ─────────────────────────────────────────────────────────

function InlineTagInput({
  tags = [],
  onChange,
  testId,
}: {
  tags: string[];
  onChange: (t: string[]) => void;
  testId?: string;
}) {
  const [input, setInput] = useState("");
  const add = () => {
    const v = input.trim().toLowerCase();
    if (v && !tags.includes(v)) onChange([...tags, v]);
    setInput("");
  };
  const remove = (t: string) => onChange(tags.filter((x) => x !== t));
  return (
    <div>
      <div className="flex gap-1 flex-wrap mb-1" data-testid={testId ? `tag-badges-${testId}` : undefined}>
        {tags.map((t) => (
          <span
            key={t}
            className="flex items-center gap-1 bg-orange-100 text-orange-800 text-xs px-2 py-0.5 rounded-full"
            data-testid={testId ? `tag-badge-${testId}-${t}` : undefined}
          >
            {t}
            <button
              onClick={() => remove(t)}
              className="text-orange-400 hover:text-orange-700 leading-none"
              data-testid={testId ? `tag-remove-${testId}-${t}` : undefined}
            >
              &times;
            </button>
          </span>
        ))}
      </div>
      <div className="flex gap-1">
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              add();
            }
          }}
          className="flex-1 border border-gray-200 rounded-lg px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-orange-300"
          placeholder="Type and press Enter..."
          data-testid={testId ? `tag-input-${testId}` : undefined}
        />
        <button
          onClick={add}
          className="bg-orange-500 hover:bg-orange-600 text-white text-xs px-3 py-1 rounded-lg transition"
          data-testid={testId ? `tag-add-btn-${testId}` : undefined}
        >
          Add
        </button>
      </div>
    </div>
  );
}

// ─── ItemCard ───────────────────────────────────────────────────────────────

function ItemCard({
  item,
  selected,
  onSelect,
  bulkMode,
  bulkChecked,
  onBulkToggle,
}: {
  item: MenuItemDisplay;
  selected: boolean;
  onSelect: (id: string) => void;
  bulkMode?: boolean;
  bulkChecked?: boolean;
  onBulkToggle?: (id: string) => void;
}) {
  return (
    <button
      data-testid={`menu-item-card-${item.id}`}
      onClick={() => bulkMode && onBulkToggle ? onBulkToggle(item.id) : onSelect(item.id)}
      className={
        "w-full text-left p-3 rounded-xl border transition-all " +
        (bulkChecked
          ? "border-red-300 bg-red-50"
          : selected
            ? "border-orange-400 bg-orange-50 shadow-md"
            : "border-gray-100 bg-white hover:border-orange-200 hover:shadow-sm")
      }
    >
      <div className="flex items-center gap-3">
        {bulkMode && (
          <div className="shrink-0">
            <div className={`w-5 h-5 rounded-md border-2 flex items-center justify-center transition ${
              bulkChecked ? 'bg-red-500 border-red-500' : 'border-gray-300 bg-white'
            }`}>
              {bulkChecked && (
                <svg className="w-3 h-3 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                </svg>
              )}
            </div>
          </div>
        )}
        <div className="w-12 h-12 rounded-lg bg-gradient-to-br from-orange-100 to-amber-100 flex items-center justify-center text-xl shrink-0 overflow-hidden">
          {item.thumbnail_url ? (
            <img
              src={item.thumbnail_url}
              className="w-full h-full object-cover rounded-lg"
              alt={item.name}
            />
          ) : (
            <span>{"\u{1F37D}\uFE0F"}</span>
          )}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1 flex-wrap">
            <span
              data-testid={`menu-item-name-${item.id}`}
              title={item.name || "Unnamed Item"}
              className={
                "font-semibold text-sm truncate " +
                (item.active === false ? "text-gray-400" : "text-gray-800")
              }
            >
              {item.name || "Unnamed Item"}
            </span>
            {item.active === false && (
              <span
                data-testid={`menu-item-inactive-badge-${item.id}`}
                className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-amber-100 text-amber-700 shrink-0"
              >
                Hidden
              </span>
            )}
            {(!item.menu_associations || item.menu_associations.length === 0) && (
              <span
                className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-red-100 text-red-700 shrink-0"
              >
                Not on menu
              </span>
            )}
            {(item.boost_level ?? 0) >= 3 && (
              <span className="text-xs">{"\u{1F525}"}</span>
            )}
            {item.enrichment_status === "enriched" && (
              <span className="text-xs">{"\u2726"}</span>
            )}
          </div>
          <div title={item.category || "No category"} className="text-xs text-gray-400 truncate mt-0.5">
            {item.category || "No category"}
          </div>
        </div>
        {item.menu_associations && item.menu_associations.length > 0 ? (
          <div className="text-[10px] text-gray-400 shrink-0 text-right">
            {item.menu_associations.length}{" "}
            {item.menu_associations.length === 1 ? "menu" : "menus"}
          </div>
        ) : (
          <div className="text-orange-600 font-bold text-sm shrink-0">
            {formatPrice(item.price, item.price_raw) || "\u2014"}
          </div>
        )}
      </div>
    </button>
  );
}

// ─── Props ──────────────────────────────────────────────────────────────────

export interface MenuItemsManagementProps {
  restaurantId: string | null;
  service: MenuItemsService;
  /** Optional extra header content rendered below the title (e.g. re-crawl controls) */
  headerExtra?: React.ReactNode;
  /** Canonical category mapping from menu intelligence (original_name → canonical_names) */
  canonicalCategoryMap?: Record<string, string[]>;
  /** When set, only show items belonging to this menu */
  filterMenuId?: string | null;
  /** Called when user clears the menu filter */
  onClearMenuFilter?: () => void;
}

// ─── Main Component ─────────────────────────────────────────────────────────

export default function MenuItemsManagement({
  restaurantId,
  service,
  headerExtra,
  canonicalCategoryMap,
  filterMenuId,
  onClearMenuFilter,
}: MenuItemsManagementProps) {
  // Data
  const [items, setItems] = useState<MenuItemDisplay[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filterMenuName, setFilterMenuName] = useState<string | null>(null);

  // Sidebar
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [filterCat, setFilterCat] = useState("All");
  const [filterStatus, setFilterStatus] = useState<"all" | "active" | "inactive">("all");

  // Editor
  const [editName, setEditName] = useState("");
  const [editDescription, setEditDescription] = useState("");
  const [editPrice, setEditPrice] = useState("");
  const [editCategory, setEditCategory] = useState("");
  const [editFoodTags, setEditFoodTags] = useState<FoodTags>({});
  const [editBoost, setEditBoost] = useState("");
  const [editChefsSpecial, setEditChefsSpecial] = useState(false);
  const [editPortionType, setEditPortionType] = useState<'single' | 'shared'>('single');
  const [editPortionServes, setEditPortionServes] = useState<number>(2);

  // Persistence
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState(false);

  // Bulk select
  const [bulkMode, setBulkMode] = useState(false);
  const [bulkSelected, setBulkSelected] = useState<Set<string>>(new Set());
  const [bulkDeleteConfirm, setBulkDeleteConfirm] = useState(false);
  const [bulkDeleting, setBulkDeleting] = useState(false);

  // Attention bulk select
  const [attentionBulkSelected, setAttentionBulkSelected] = useState<Set<string>>(new Set());
  const [attentionBulkConfirm, setAttentionBulkConfirm] = useState(false);
  const [attentionBulkDeleting, setAttentionBulkDeleting] = useState(false);
  const [toggling, setToggling] = useState(false);

  // Image
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [imageLoading, setImageLoading] = useState(false);
  const [imageLoadingText, setImageLoadingText] = useState("");

  // AI tags
  const [generatingTags, setGeneratingTags] = useState(false);
  const [tagProgress, setTagProgress] = useState(0);

  // Items needing attention
  const [showProblems, setShowProblems] = useState(false);
  const [attentionFilter, setAttentionFilter] = useState<string>('all');
  const [attentionPage, setAttentionPage] = useState(0);
  const ATTENTION_PAGE_SIZE = 10;

  // Create-new-item mode (Option A — right panel blanks out)
  const [isCreatingNew, setIsCreatingNew] = useState(false);

  // Menu associations
  const [menuAssociations, setMenuAssociations] = useState<MenuAssociation[]>(
    [],
  );
  const [availableMenus, setAvailableMenus] = useState<
    { id: string; name: string }[]
  >([]);
  const [addingToMenu, setAddingToMenu] = useState(false);
  const [selectedMenuId, setSelectedMenuId] = useState("");
  const [menuPrice, setMenuPrice] = useState("");
  const [menuError, setMenuError] = useState<string | null>(null);

  const selected = items.find((i) => i.id === selectedId) || null;
  const canEdit = !!service.updateItem;
  const canEditTags = !!service.saveTags || canEdit;

  // ─── Load Items ─────────────────────────────────────────────────────────

  const loadItems = useCallback(async () => {
    if (!restaurantId) return;
    try {
      setLoading(true);
      setError(null);
      const data = await service.getItems(restaurantId);
      // Deduplicate by id (same item appears in multiple menus via junction table)
      const seen = new Set<string>();
      const unique = data.filter((i) => {
        if (seen.has(i.id)) return false;
        seen.add(i.id);
        return true;
      });
      unique.sort(
        (a, b) =>
          (a.category || "").localeCompare(b.category || "") ||
          a.name.localeCompare(b.name),
      );
      setItems(unique);
      if (data.length > 0 && !selectedId) {
        const firstVisible = filterMenuId
          ? unique.find(
              (i) =>
                i.menu_associations?.some((a) => a.menu_id === filterMenuId) ||
                i.menu_id === filterMenuId,
            )
          : unique[0];
        setSelectedId(firstVisible?.id || null);
      }
    } catch {
      setError("Failed to load menu items");
    } finally {
      setLoading(false);
    }
  }, [restaurantId, service]);

  useEffect(() => {
    loadItems();
  }, [loadItems]);

  // Load available menus
  useEffect(() => {
    if (!restaurantId || !service.getMenus) return;
    service
      .getMenus(restaurantId)
      .then(setAvailableMenus)
      .catch(() => {});
  }, [restaurantId, service]);

  // Resolve menu name for filter banner
  useEffect(() => {
    if (!filterMenuId) { setFilterMenuName(null); return; }
    // Try availableMenus first
    const fromMenus = availableMenus.find(m => m.id === filterMenuId);
    if (fromMenus) { setFilterMenuName(fromMenus.name); return; }
    // Fallback: derive from item associations
    const fromItems = items.find(i => i.menu_associations?.some(a => a.menu_id === filterMenuId));
    const assoc = fromItems?.menu_associations?.find(a => a.menu_id === filterMenuId);
    setFilterMenuName(assoc?.menu_name ?? null);
  }, [filterMenuId, availableMenus, items]);

  // ─── Sync editor on selection change ──────────────────────────────────

  useEffect(() => {
    if (!selected) return;
    setEditName(selected.name);
    setEditDescription(selected.description || "");
    setEditPrice(selected.price?.toString() || "0");

    setEditCategory(selected.category || "");

    setEditFoodTags(selected.food_tags || {});
    setEditChefsSpecial(selected.chefs_special || false);
    setEditPortionType(selected.portion_type || 'single');
    setEditPortionServes(selected.portion_serves || 2);
    setImageUrl(selected.thumbnail_url || null);
    setDeleteConfirm(false);
    setSaved(false);
    setMenuAssociations(selected.menu_associations || []);
    setAddingToMenu(false);
    setMenuError(null);
    const boostMap: Record<number, string> = {
      1: "Low",
      2: "Moderate",
      3: "High",
    };
    setEditBoost(boostMap[selected.boost_level || 0] || "");
  }, [selectedId, selected?.id]);

  // ─── Save ─────────────────────────────────────────────────────────────

  const handleSave = async () => {
    if (!selectedId || !restaurantId) return;
    try {
      setSaving(true);
      setError(null);

      if (service.updateItem) {
        await service.updateItem(selectedId, {
          name: editName,
          description: editDescription,
          price: parseFloat(editPrice) || 0,
          category: editCategory,
          food_tags: editFoodTags,
          chefs_special: editChefsSpecial,
          portion_type: editPortionType,
          portion_serves: editPortionType === 'shared' ? editPortionServes : null,
        });
      } else if (service.saveTags) {
        await service.saveTags(selectedId, editFoodTags);
      }

      // Update boost if service supports it
      if (service.updateBoost) {
        const boostMap: Record<string, number> = {
          Low: 1,
          Moderate: 2,
          High: 3,
        };
        const newBoost = boostMap[editBoost] || 0;
        if (newBoost !== (selected?.boost_level || 0)) {
          try {
            await service.updateBoost(restaurantId, selectedId, newBoost);
          } catch {
            /* non-fatal */
          }
        }
      }

      // Update local state
      setItems((prev) =>
        prev.map((i) =>
          i.id === selectedId
            ? {
                ...i,
                name: canEdit ? editName : i.name,
                description: canEdit ? editDescription : i.description,
                price: canEdit ? parseFloat(editPrice) || 0 : i.price,
                category: canEdit ? editCategory : i.category,
                food_tags: editFoodTags,
                thumbnail_url: imageUrl,
                chefs_special: editChefsSpecial,
              }
            : i,
        ),
      );

      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    } catch {
      setError("Failed to save changes");
    } finally {
      setSaving(false);
    }
  };

  // ─── Delete ───────────────────────────────────────────────────────────

  const handleDelete = async () => {
    if (!selectedId || !service.deleteItem) return;
    try {
      await service.deleteItem(selectedId);
      const remaining = items.filter((i) => i.id !== selectedId);
      setItems(remaining);
      setSelectedId(remaining[0]?.id || null);
      setDeleteConfirm(false);
    } catch {
      setError("Failed to delete item");
    }
  };

  // ─── Bulk Operations ─────────────────────────────────────────────────

  const handleBulkToggle = (id: string) => {
    setBulkSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleBulkSelectAll = () => {
    if (bulkSelected.size === filtered.length) {
      setBulkSelected(new Set());
    } else {
      setBulkSelected(new Set(filtered.map((i) => i.id)));
    }
  };

  const handleBulkDelete = async () => {
    if (!service.deleteItem || bulkSelected.size === 0) return;
    setBulkDeleting(true);
    setError(null);
    let deletedCount = 0;
    const failedNames: string[] = [];
    for (const id of bulkSelected) {
      try {
        await service.deleteItem(id);
        deletedCount++;
      } catch {
        const item = items.find((i) => i.id === id);
        failedNames.push(item?.name || id);
      }
    }
    setItems((prev) => prev.filter((i) => !bulkSelected.has(i.id) || failedNames.some((n) => n === i.name)));
    if (failedNames.length > 0) {
      setError(`Failed to delete ${failedNames.length} item(s): ${failedNames.join(', ')}`);
    }
    setBulkSelected(new Set());
    setBulkDeleteConfirm(false);
    setBulkDeleting(false);
    setBulkMode(false);
    // Reset selection if current item was deleted
    if (selectedId && bulkSelected.has(selectedId)) {
      const remaining = items.filter((i) => !bulkSelected.has(i.id));
      setSelectedId(remaining[0]?.id || null);
    }
  };

  const exitBulkMode = () => {
    setBulkMode(false);
    setBulkSelected(new Set());
    setBulkDeleteConfirm(false);
  };

  // ─── Attention Bulk Operations ──────────────────────────────────────────

  const handleAttentionBulkToggle = (id: string) => {
    setAttentionBulkSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleAttentionBulkSelectAll = () => {
    if (attentionBulkSelected.size === filteredAttention.length) {
      setAttentionBulkSelected(new Set());
    } else {
      setAttentionBulkSelected(new Set(filteredAttention.map((a) => a.item.id)));
    }
  };

  const handleAttentionBulkDelete = async () => {
    if (!service.deleteItem || attentionBulkSelected.size === 0) return;
    setAttentionBulkDeleting(true);
    setError(null);
    let deletedCount = 0;
    const failedNames: string[] = [];
    for (const id of attentionBulkSelected) {
      try {
        await service.deleteItem(id);
        deletedCount++;
      } catch {
        const item = items.find((i) => i.id === id);
        failedNames.push(item?.name || id);
      }
    }
    setItems((prev) => prev.filter((i) => !attentionBulkSelected.has(i.id) || failedNames.some((n) => n === i.name)));
    if (failedNames.length > 0) {
      setError(`Failed to delete ${failedNames.length} item(s): ${failedNames.join(', ')}`);
    }
    if (selectedId && attentionBulkSelected.has(selectedId)) {
      const remaining = items.filter((i) => !attentionBulkSelected.has(i.id));
      setSelectedId(remaining[0]?.id || null);
    }
    setAttentionBulkSelected(new Set());
    setAttentionBulkConfirm(false);
    setAttentionBulkDeleting(false);
  };

  // ─── Active / Inactive Toggle ─────────────────────────────────────────

  const handleToggleActive = async () => {
    if (!selectedId || !service.toggleActive) return;
    const currentItem = items.find((i) => i.id === selectedId);
    if (!currentItem) return;
    const newActive = !(currentItem.active ?? true);
    setToggling(true);
    try {
      await service.toggleActive(selectedId, newActive);
      setItems(items.map((i) =>
        i.id === selectedId ? { ...i, active: newActive } : i
      ));
    } catch {
      setError("Failed to update item status");
    } finally {
      setToggling(false);
    }
  };

  // ─── New Item (Option A) ──────────────────────────────────────────────

  const handleStartNewItem = () => {
    setIsCreatingNew(true);
    setSelectedId(null);
    setEditName("");
    setEditDescription("");
    setEditPrice("");
    setEditCategory("");
    setEditFoodTags({});
    setEditBoost("");
    setImageUrl(null);
    setMenuAssociations([]);
    setError(null);
    setSaved(false);
    setDeleteConfirm(false);
  };

  const handleCreateItem = async () => {
    if (!restaurantId || !editName.trim() || !service.addItem) return;
    try {
      setSaving(true);
      setError(null);
      const newItem = await service.addItem(restaurantId, {
        name: editName.trim(),
        price: parseFloat(editPrice) || 0,
        category: editCategory.trim() || "Uncategorized",
      });
      // Persist description and food tags if filled (second call)
      if (
        (editDescription.trim() || Object.keys(editFoodTags).length > 0) &&
        service.updateItem
      ) {
        await service.updateItem(newItem.id, {
          description: editDescription,
          food_tags: editFoodTags,
        });
      }
      // Persist boost if selected
      if (editBoost && service.updateBoost) {
        const boostMap: Record<string, number> = {
          Low: 1,
          Moderate: 2,
          High: 3,
        };
        const level = boostMap[editBoost] || 0;
        if (level > 0)
          await service.updateBoost(restaurantId, newItem.id, level);
      }
      await loadItems();
      setIsCreatingNew(false);
      setSelectedId(newItem.id);
    } catch {
      setError("Failed to create item");
    } finally {
      setSaving(false);
    }
  };

  // ─── Image Handlers ───────────────────────────────────────────────────

  // Force browser to fetch fresh image by appending a unique cache-bust param (BUG-003)
  const cacheBust = (url: string) =>
    `${url}${url.includes("?") ? "&" : "?"}t=${Date.now()}`;

  const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!selectedId || !e.target.files?.[0] || !service.uploadImage) return;
    try {
      setImageLoading(true);
      setImageLoadingText("Uploading image...");
      const resizedBlob = await resizeImage(e.target.files[0]);
      const url = cacheBust(await service.uploadImage(selectedId, resizedBlob));
      setImageUrl(url);
      setItems((prev) =>
        prev.map((i) =>
          i.id === selectedId ? { ...i, thumbnail_url: url } : i,
        ),
      );
    } catch {
      setError("Failed to upload image");
    } finally {
      setImageLoading(false);
      setImageLoadingText("");
      e.target.value = "";
    }
  };

  const handleGenerateImage = async () => {
    if (!selectedId || !service.generateImage) return;
    try {
      setImageLoading(true);
      setImageLoadingText("Generating image with AI...");
      const url = cacheBust(await service.generateImage(selectedId));
      setImageUrl(url);
      setItems((prev) =>
        prev.map((i) =>
          i.id === selectedId ? { ...i, thumbnail_url: url } : i,
        ),
      );
    } catch {
      setError("Failed to generate image");
    } finally {
      setImageLoading(false);
      setImageLoadingText("");
    }
  };

  const handleEnhanceImage = async () => {
    if (!selectedId || !service.enhanceImage) return;
    try {
      setImageLoading(true);
      setImageLoadingText("Enhancing image with AI...");
      const url = cacheBust(await service.enhanceImage(selectedId));
      setImageUrl(url);
      setItems((prev) =>
        prev.map((i) =>
          i.id === selectedId ? { ...i, thumbnail_url: url } : i,
        ),
      );
    } catch {
      setError("Failed to enhance image");
    } finally {
      setImageLoading(false);
      setImageLoadingText("");
    }
  };

  const [removeImageConfirm, setRemoveImageConfirm] = useState(false);

  const handleRemoveImage = async () => {
    if (!selectedId || !service.removeImage) return;
    setRemoveImageConfirm(false);
    try {
      setImageLoading(true);
      setImageLoadingText("Removing image...");
      await service.removeImage(selectedId);
      setImageUrl(null);
      setItems((prev) =>
        prev.map((i) =>
          i.id === selectedId ? { ...i, thumbnail_url: null } : i,
        ),
      );
    } catch {
      setError("Failed to remove image");
    } finally {
      setImageLoading(false);
      setImageLoadingText("");
    }
  };

  // ─── Generate Tags ────────────────────────────────────────────────────

  const handleGenerateTags = async () => {
    if (!restaurantId || !service.generateAllTags) return;
    try {
      setGeneratingTags(true);
      setTagProgress(0);
      const totalItems = items.length;
      const estimatedMs = Math.max(15000, totalItems * 500);
      const startTime = Date.now();
      const interval = setInterval(() => {
        const elapsed = Date.now() - startTime;
        const eased = Math.min(0.9, 1 - Math.pow(1 - elapsed / estimatedMs, 2));
        setTagProgress(Math.round(eased * 100));
      }, 300);
      await service.generateAllTags(restaurantId);
      clearInterval(interval);
      setTagProgress(100);
      await loadItems();
    } catch {
      setError("Failed to generate food tags");
    } finally {
      setGeneratingTags(false);
      setTagProgress(0);
    }
  };

  // ─── Tag update ───────────────────────────────────────────────────────

  const updateTag = (key: string, val: string[]) => {
    setEditFoodTags((prev) => ({ ...prev, [key]: val }));
    setSaved(false);
  };

  // ─── Derived ──────────────────────────────────────────────────────────

  const categories = [...new Set(items.map((i) => i.category).filter(Boolean))];
  // Build a helper to get canonical category for a raw category
  const getCanonicalCategory = (rawCat: string | undefined): string[] => {
    if (!rawCat) return [];
    if (canonicalCategoryMap?.[rawCat]) return canonicalCategoryMap[rawCat];
    // If the raw category IS a canonical category, use it directly
    if ((CANONICAL_CATEGORIES as readonly string[]).includes(rawCat)) return [rawCat];
    return [];
  };
  const filtered = items.filter((i) => {
    const matchMenu = !filterMenuId
      || i.menu_associations?.some(a => a.menu_id === filterMenuId)
      || i.menu_id === filterMenuId;
    const matchSearch = i.name.toLowerCase().includes(search.toLowerCase());
    const matchCat = filterCat === "All" || getCanonicalCategory(i.category).includes(filterCat);
    const isActive = i.active ?? true;
    const matchStatus =
      filterStatus === "all" ||
      (filterStatus === "active" && isActive) ||
      (filterStatus === "inactive" && !isActive);
    return matchMenu && matchSearch && matchCat && matchStatus;
  });
  const totalTags = TAG_CATEGORIES.reduce(
    (acc, f) =>
      acc + ((editFoodTags[f.key as keyof FoodTags] as string[]) || []).length,
    0,
  );
  const fileRef = useRef<HTMLInputElement>(null);

  // Items needing attention — scoped to filtered menu when active
  const menuScopedItems = filterMenuId
    ? items.filter(i =>
        i.menu_associations?.some(a => a.menu_id === filterMenuId)
        || i.menu_id === filterMenuId)
    : items;
  const itemTagCount = (item: MenuItemDisplay) =>
    TAG_CATEGORIES.reduce(
      (acc, f) =>
        acc +
        ((item.food_tags?.[f.key as keyof FoodTags] as string[]) || []).length,
      0,
    );
  const noMenuItems = menuScopedItems.filter((i) => !i.menu_associations || i.menu_associations.length === 0);
  const redItems = menuScopedItems.filter((i) => !i.description);
  const yellowItems = menuScopedItems
    .filter((i) => !i.thumbnail_url || itemTagCount(i) === 0)
    .filter((i) => !redItems.some((r) => r.id === i.id));
  const attentionCount = redItems.length + yellowItems.length + noMenuItems.filter(
    (i) => !redItems.some((r) => r.id === i.id) && !yellowItems.some((y) => y.id === i.id)
  ).length;

  // Build deduplicated attention items with issue flags
  const attentionItems = (() => {
    const seen = new Set<string>();
    const result: { item: MenuItemDisplay; issues: string[] }[] = [];
    for (const item of menuScopedItems) {
      const issues: string[] = [];
      if (!item.description) issues.push('No description');
      if (item.price === null || item.price === undefined) issues.push('No price');
      if (!item.thumbnail_url) issues.push('No image');
      if (itemTagCount(item) === 0) issues.push('No tags');
      if (!item.menu_associations || item.menu_associations.length === 0) issues.push('Not on menu');
      if (issues.length > 0 && !seen.has(item.id)) {
        seen.add(item.id);
        result.push({ item, issues });
      }
    }
    return result;
  })();

  // Issue filter options with counts
  const attentionFilterCounts: Record<string, number> = { all: attentionItems.length };
  for (const { issues } of attentionItems) {
    for (const issue of issues) {
      attentionFilterCounts[issue] = (attentionFilterCounts[issue] || 0) + 1;
    }
  }

  const filteredAttention = attentionFilter === 'all'
    ? attentionItems
    : attentionItems.filter(a => a.issues.includes(attentionFilter));
  const pagedAttention = filteredAttention.slice(
    attentionPage * ATTENTION_PAGE_SIZE,
    (attentionPage + 1) * ATTENTION_PAGE_SIZE
  );

  // ─── Guards ───────────────────────────────────────────────────────────

  if (!restaurantId) {
    return (
      <div className="bg-yellow-50 border border-yellow-200 text-yellow-700 px-4 py-3 rounded-lg">
        Please select a restaurant to manage its menu.
      </div>
    );
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="text-center">
          <div className="inline-block w-8 h-8 border-4 border-orange-500 border-t-transparent rounded-full animate-spin" />
          <p className="text-gray-600 mt-4">Loading menu...</p>
        </div>
      </div>
    );
  }

  // ─── Render ───────────────────────────────────────────────────────────

  return (
    <div>
      <div className="mb-4 flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Menu Items</h1>
          <p className="text-gray-600 mt-1">
            Manage your menu items, food tags, and images
          </p>
        </div>
        {headerExtra}
      </div>

      {/* Menu filter banner */}
      {filterMenuId && (
        <div data-testid="menu-filter-banner" className="mb-4 flex items-center gap-3 bg-orange-50 border border-orange-200 rounded-lg px-4 py-3">
          <span className="text-sm text-gray-700">
            Filtered to{' '}
            <strong data-testid="menu-filter-name" className="text-gray-900">{filterMenuName || 'this menu'}</strong>
            {' '}&mdash; <span data-testid="menu-filter-count">{filtered.length}</span> item{filtered.length !== 1 ? 's' : ''}
          </span>
          {onClearMenuFilter && (
            <button
              data-testid="menu-filter-clear"
              onClick={onClearMenuFilter}
              className="ml-auto text-sm text-orange-600 hover:text-orange-800 font-medium"
            >
              Clear filter &times;
            </button>
          )}
        </div>
      )}

      {/* Items Needing Attention */}
      {attentionCount > 0 && (
        <section className="mb-4 bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
          <button
            onClick={() => setShowProblems(!showProblems)}
            className="w-full px-5 py-4 flex items-center justify-between hover:bg-gray-50 transition"
          >
            <div className="flex items-center gap-2">
              <span className="text-lg">{"\u26A0\uFE0F"}</span>
              <h3 className="text-sm font-semibold text-gray-600 uppercase tracking-wider">
                Items Needing Attention
              </h3>
              <span className="text-xs bg-red-100 text-red-700 px-2 py-0.5 rounded-full font-medium">
                {attentionCount}
              </span>
            </div>
            <svg
              className={
                "w-4 h-4 text-gray-400 transition-transform " +
                (showProblems ? "rotate-180" : "")
              }
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M19 9l-7 7-7-7"
              />
            </svg>
          </button>

          {showProblems && (
            <div className="px-5 pb-4">
              {/* Filter pills */}
              <div className="flex flex-wrap gap-1.5 mb-3">
                {Object.entries(attentionFilterCounts).map(([issue, count]) => (
                  <button
                    key={issue}
                    onClick={() => { setAttentionFilter(issue); setAttentionPage(0); }}
                    className={`text-[11px] px-2.5 py-1 rounded-full font-medium transition ${
                      attentionFilter === issue
                        ? 'bg-orange-500 text-white'
                        : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                    }`}
                  >
                    {issue === 'all' ? 'All' : issue} ({count})
                  </button>
                ))}
              </div>

              {/* Table */}
              <div className="overflow-x-auto rounded-xl border border-gray-100">
                <table className="w-full">
                  <thead>
                    <tr className="border-b-2 border-gray-100 text-left bg-gray-50/50">
                      {service.deleteItem && (
                        <th className="px-2 py-2 w-8">
                          <button onClick={handleAttentionBulkSelectAll} title={attentionBulkSelected.size === filteredAttention.length ? 'Deselect all' : 'Select all'}>
                            <div className={`w-4 h-4 rounded border-2 flex items-center justify-center transition ${
                              attentionBulkSelected.size > 0 && attentionBulkSelected.size === filteredAttention.length
                                ? 'bg-red-500 border-red-500' : 'border-gray-300 bg-white'
                            }`}>
                              {attentionBulkSelected.size > 0 && attentionBulkSelected.size === filteredAttention.length && (
                                <svg className="w-2.5 h-2.5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                                </svg>
                              )}
                            </div>
                          </button>
                        </th>
                      )}
                      <th className="px-3 py-2 text-xs font-semibold text-gray-500">Item</th>
                      <th className="px-3 py-2 text-xs font-semibold text-gray-500">Category</th>
                      <th className="px-3 py-2 text-xs font-semibold text-gray-500 text-right">Price</th>
                      <th className="px-3 py-2 text-xs font-semibold text-gray-500">Issues</th>
                    </tr>
                  </thead>
                  <tbody>
                    {pagedAttention.map(({ item, issues }) => {
                      const hasRed = issues.includes('No description') || issues.includes('No price') || issues.includes('Not on menu');
                      const isChecked = attentionBulkSelected.has(item.id);
                      return (
                        <tr
                          key={item.id}
                          onClick={() => {
                            setSelectedId(item.id);
                            setTimeout(() => {
                              document.getElementById('menu-detail-panel')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
                            }, 50);
                          }}
                          className={`border-b border-gray-50 cursor-pointer transition-colors ${
                            isChecked ? 'bg-red-50/50' : 'hover:bg-orange-50/40'
                          }`}
                        >
                          {service.deleteItem && (
                            <td className="px-2 py-2 w-8" onClick={(e) => { e.stopPropagation(); handleAttentionBulkToggle(item.id); }}>
                              <div className={`w-4 h-4 rounded border-2 flex items-center justify-center transition ${
                                isChecked ? 'bg-red-500 border-red-500' : 'border-gray-300 bg-white'
                              }`}>
                                {isChecked && (
                                  <svg className="w-2.5 h-2.5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                                  </svg>
                                )}
                              </div>
                            </td>
                          )}
                          <td className="px-3 py-2">
                            <div className="flex items-center gap-2">
                              <span className={`w-2 h-2 rounded-full shrink-0 ${hasRed ? 'bg-red-500' : 'bg-amber-500'}`} />
                              {item.thumbnail_url ? (
                                <img src={item.thumbnail_url} alt={item.name} className="w-7 h-7 rounded-md object-cover shrink-0" />
                              ) : (
                                <div className="w-7 h-7 rounded-md bg-gray-100 shrink-0" />
                              )}
                              <span title={item.name} className="text-sm font-medium text-gray-800 truncate">{item.name}</span>
                            </div>
                          </td>
                          <td className="px-3 py-2 text-xs text-gray-500">{item.category || '\u2014'}</td>
                          <td className="px-3 py-2 text-xs text-gray-500 text-right">
                            {item.price != null ? `$${Number(item.price).toFixed(2)}` : '\u2014'}
                          </td>
                          <td className="px-3 py-2">
                            <div className="flex flex-wrap gap-1">
                              {issues.map((issue) => (
                                <span
                                  key={issue}
                                  className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium ${
                                    issue === 'No description' || issue === 'No price' || issue === 'Not on menu'
                                      ? 'bg-red-100 text-red-700'
                                      : 'bg-amber-100 text-amber-700'
                                  }`}
                                >
                                  {issue}
                                </span>
                              ))}
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              {/* Pagination */}
              {filteredAttention.length > ATTENTION_PAGE_SIZE && (
                <div className="flex items-center justify-between mt-2">
                  <span className="text-xs text-gray-400">
                    {attentionPage * ATTENTION_PAGE_SIZE + 1}&ndash;{Math.min((attentionPage + 1) * ATTENTION_PAGE_SIZE, filteredAttention.length)} of {filteredAttention.length}
                  </span>
                  <div className="flex gap-1">
                    <button
                      onClick={() => setAttentionPage(p => Math.max(0, p - 1))}
                      disabled={attentionPage === 0}
                      className="px-2.5 py-1 text-xs rounded-lg border border-gray-200 text-gray-500 hover:bg-gray-50 disabled:opacity-30 disabled:cursor-not-allowed"
                    >
                      Prev
                    </button>
                    <button
                      onClick={() => setAttentionPage(p => p + 1)}
                      disabled={(attentionPage + 1) * ATTENTION_PAGE_SIZE >= filteredAttention.length}
                      className="px-2.5 py-1 text-xs rounded-lg border border-gray-200 text-gray-500 hover:bg-gray-50 disabled:opacity-30 disabled:cursor-not-allowed"
                    >
                      Next
                    </button>
                  </div>
                </div>
              )}

              {/* Bulk delete bar */}
              {service.deleteItem && attentionBulkSelected.size > 0 && (
                <div className="mt-3">
                  {!attentionBulkConfirm ? (
                    <button
                      onClick={() => setAttentionBulkConfirm(true)}
                      className="w-full text-xs font-semibold py-2 rounded-xl bg-red-500 hover:bg-red-600 text-white transition"
                    >
                      Delete {attentionBulkSelected.size} selected item{attentionBulkSelected.size !== 1 ? 's' : ''}
                    </button>
                  ) : (
                    <div className="bg-red-50 border border-red-200 rounded-xl p-3 space-y-2">
                      <p className="text-xs text-red-700 font-semibold">
                        Permanently delete {attentionBulkSelected.size} item{attentionBulkSelected.size !== 1 ? 's' : ''}?
                      </p>
                      <div className="max-h-20 overflow-y-auto text-xs text-red-600 space-y-0.5">
                        {Array.from(attentionBulkSelected).map((id) => {
                          const entry = attentionItems.find((a) => a.item.id === id);
                          return <div key={id} title={entry?.item.name || id} className="truncate">{entry?.item.name || id}</div>;
                        })}
                      </div>
                      <p className="text-[10px] text-red-500">This action cannot be undone.</p>
                      <div className="flex gap-2">
                        <button
                          onClick={() => setAttentionBulkConfirm(false)}
                          disabled={attentionBulkDeleting}
                          className="flex-1 text-xs font-medium py-2 rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50 disabled:opacity-50"
                        >
                          Cancel
                        </button>
                        <button
                          onClick={handleAttentionBulkDelete}
                          disabled={attentionBulkDeleting}
                          className="flex-1 text-xs font-semibold py-2 rounded-lg bg-red-600 hover:bg-red-700 text-white disabled:opacity-50"
                        >
                          {attentionBulkDeleting ? 'Deleting...' : 'Confirm Delete'}
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </section>
      )}

      <div id="menu-detail-panel" className="flex h-[calc(100vh-200px)] overflow-hidden rounded-2xl border border-gray-100 shadow-sm">
        {/* ─── Left sidebar: Item list ─── */}
        <aside className="w-72 shrink-0 bg-white border-r border-gray-100 flex flex-col">
          <div className="p-3 border-b border-gray-100 space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-sm font-semibold text-gray-700">
                {bulkMode ? `${bulkSelected.size} selected` : `${filtered.length} Items`}
              </span>
              <div className="flex items-center gap-1.5">
                {service.deleteItem && (
                  <button
                    onClick={bulkMode ? exitBulkMode : () => setBulkMode(true)}
                    className={`text-xs font-medium px-2.5 py-1.5 rounded-lg transition ${
                      bulkMode
                        ? 'bg-gray-200 text-gray-700'
                        : 'bg-gray-100 text-gray-500 hover:bg-gray-200'
                    }`}
                  >
                    {bulkMode ? 'Cancel' : 'Select'}
                  </button>
                )}
                {service.addItem && !bulkMode && (
                  <button
                    data-testid="add-menu-item-btn"
                    onClick={handleStartNewItem}
                    className={
                      "flex items-center gap-1 text-xs font-semibold px-3 py-1.5 rounded-lg transition " +
                      (isCreatingNew
                        ? "bg-orange-100 text-orange-700 border border-orange-300"
                        : "bg-orange-500 hover:bg-orange-600 text-white")
                    }
                  >
                    + New Item
                  </button>
                )}
              </div>
            </div>

            <div className="relative">
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder={"\u{1F50D}  Search items..."}
                className="w-full border border-gray-200 rounded-xl px-3 py-2 pr-8 text-sm focus:outline-none focus:ring-2 focus:ring-orange-300"
              />
              {search && (
                <button
                  onClick={() => setSearch("")}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 text-sm leading-none"
                >
                  &times;
                </button>
              )}
            </div>

            <Select
              fullWidth
              value={filterCat}
              onChange={(e) => setFilterCat(e.target.value)}
              options={[
                { value: 'All', label: 'All Categories' },
                ...CANONICAL_CATEGORIES.map((c) => ({ value: c, label: c })),
              ]}
            />

            {/* Active / Inactive filter — only shown when toggleActive is available */}
            {service.toggleActive && (
              <div className="flex rounded-xl border border-gray-200 overflow-hidden text-xs font-medium">
                {(["all", "active", "inactive"] as const).map((status) => (
                  <button
                    key={status}
                    onClick={() => setFilterStatus(status)}
                    className={
                      "flex-1 py-1.5 transition " +
                      (filterStatus === status
                        ? status === "inactive"
                          ? "bg-amber-100 text-amber-700"
                          : "bg-orange-100 text-orange-700"
                        : "bg-white text-gray-500 hover:bg-gray-50")
                    }
                  >
                    {status === "all" ? "All" : status === "active" ? "Visible" : "Hidden"}
                  </button>
                ))}
              </div>
            )}

            {/* AI tag generation */}
            {service.generateAllTags && (
              <div className="flex gap-1.5 pt-1">
                <button
                  onClick={handleGenerateTags}
                  disabled={generatingTags || items.length === 0}
                  className="flex-1 flex items-center justify-center gap-1 bg-gradient-to-r from-orange-500 to-amber-500 hover:from-orange-600 hover:to-amber-600 disabled:opacity-50 text-white text-xs font-semibold px-2 py-1.5 rounded-lg transition"
                >
                  {generatingTags ? (
                    <>
                      <div className="w-3 h-3 border-2 border-white border-t-transparent rounded-full animate-spin" />{" "}
                      Tags...
                    </>
                  ) : (
                    <>{"\u2726"} Gen Tags</>
                  )}
                </button>
              </div>
            )}
          </div>

          {/* Tag generation progress */}
          {generatingTags && (
            <div className="px-3 py-2 border-b border-gray-100 bg-orange-50">
              <div className="flex items-center justify-between mb-1">
                <span className="text-xs text-gray-600">
                  Analyzing {items.length} items...
                </span>
                <span className="text-xs text-gray-500">{tagProgress}%</span>
              </div>
              <div className="w-full bg-gray-200 rounded-full h-1.5">
                <div
                  className="bg-orange-500 h-1.5 rounded-full transition-all duration-300"
                  style={{ width: `${tagProgress}%` }}
                />
              </div>
            </div>
          )}

          {/* Item list */}
          <div className="flex-1 overflow-y-auto p-3 space-y-2">
            {filtered.length === 0 && (
              <p className="text-center text-sm text-gray-400 py-8">
                No items found
              </p>
            )}
            {filtered.map((item) => (
              <ItemCard
                key={item.id}
                item={item}
                selected={item.id === selectedId}
                onSelect={(id) => {
                  setIsCreatingNew(false);
                  setSelectedId(id);
                }}
                bulkMode={bulkMode}
                bulkChecked={bulkSelected.has(item.id)}
                onBulkToggle={handleBulkToggle}
              />
            ))}
          </div>

          {/* Bulk action bar */}
          {bulkMode && (
            <div className="p-3 border-t border-gray-100 bg-white space-y-2">
              <div className="flex items-center gap-2">
                <button
                  onClick={handleBulkSelectAll}
                  className="text-xs text-orange-600 hover:text-orange-700 font-medium"
                >
                  {bulkSelected.size === filtered.length ? 'Deselect all' : 'Select all'}
                </button>
                <span className="text-xs text-gray-400 ml-auto">
                  {bulkSelected.size} of {filtered.length}
                </span>
              </div>
              {!bulkDeleteConfirm ? (
                <button
                  onClick={() => setBulkDeleteConfirm(true)}
                  disabled={bulkSelected.size === 0}
                  className="w-full text-sm font-semibold py-2.5 rounded-xl transition bg-red-500 hover:bg-red-600 text-white disabled:opacity-30 disabled:cursor-not-allowed"
                >
                  Delete {bulkSelected.size} item{bulkSelected.size !== 1 ? 's' : ''}
                </button>
              ) : (
                <div className="bg-red-50 border border-red-200 rounded-xl p-3 space-y-2">
                  <p className="text-xs text-red-700 font-semibold">
                    Permanently delete {bulkSelected.size} item{bulkSelected.size !== 1 ? 's' : ''}?
                  </p>
                  <div className="max-h-24 overflow-y-auto text-xs text-red-600 space-y-0.5">
                    {Array.from(bulkSelected).map((id) => {
                      const item = items.find((i) => i.id === id);
                      return <div key={id} title={item?.name || id} className="truncate">{item?.name || id}</div>;
                    })}
                  </div>
                  <p className="text-[10px] text-red-500">This action cannot be undone.</p>
                  <div className="flex gap-2">
                    <button
                      onClick={() => setBulkDeleteConfirm(false)}
                      disabled={bulkDeleting}
                      className="flex-1 text-xs font-medium py-2 rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50 disabled:opacity-50"
                    >
                      Cancel
                    </button>
                    <button
                      onClick={handleBulkDelete}
                      disabled={bulkDeleting}
                      className="flex-1 text-xs font-semibold py-2 rounded-lg bg-red-600 hover:bg-red-700 text-white disabled:opacity-50"
                    >
                      {bulkDeleting ? 'Deleting...' : 'Confirm Delete'}
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}
        </aside>

        {/* ─── Right panel: Editor (existing item OR new-item creation) ─── */}
        {selected || isCreatingNew ? (
          <main className="flex-1 overflow-y-auto p-6 space-y-5 bg-gray-50/50">
            {/* Header */}
            <div className="flex items-center justify-between">
              <h2 title={isCreatingNew ? (editName || "New Item") : (canEdit ? editName : selected!.name)} className="text-xl font-bold text-gray-800 truncate max-w-lg">
                {isCreatingNew
                  ? editName || "New Item"
                  : canEdit
                    ? editName
                    : selected!.name}
              </h2>
              <div className="flex gap-2 shrink-0">
                {/* Enrichment status badge — existing items only */}
                {!isCreatingNew &&
                  selected?.food_tags_source &&
                  selected.food_tags_source !== "none" &&
                  !canEdit && (
                    <span
                      className={
                        "text-xs font-medium px-2.5 py-1 rounded-full " +
                        (selected.food_tags_source === "ai"
                          ? "bg-green-50 text-green-600"
                          : selected.food_tags_source === "manual"
                            ? "bg-blue-50 text-blue-600"
                            : "bg-purple-50 text-purple-600")
                      }
                    >
                      {selected.food_tags_source === "ai"
                        ? "\u2726 AI Enriched"
                        : selected.food_tags_source === "manual"
                          ? "Manually Edited"
                          : "\u2726 AI + Manual"}
                    </span>
                  )}
                {/* Create-mode buttons */}
                {isCreatingNew ? (
                  <>
                    <button
                      onClick={() => setIsCreatingNew(false)}
                      className="bg-gray-100 hover:bg-gray-200 text-gray-700 text-sm px-4 py-2 rounded-xl transition"
                    >
                      Cancel
                    </button>
                    <button
                      onClick={handleCreateItem}
                      disabled={saving || !editName.trim()}
                      className={
                        "text-sm font-semibold px-5 py-2 rounded-xl transition shadow " +
                        (saving
                          ? "bg-orange-300 text-white cursor-not-allowed"
                          : "bg-orange-500 hover:bg-orange-600 text-white disabled:opacity-50")
                      }
                    >
                      {saving ? "Creating..." : "Create Item"}
                    </button>
                  </>
                ) : service.deleteItem && deleteConfirm ? (
                  <>
                    <div className="flex flex-col items-end">
                      <span className="text-sm font-medium text-gray-700 self-center">
                        Permanently delete this item?
                      </span>
                      <span className="text-xs text-gray-400 self-center">
                        This cannot be undone. Use &ldquo;Hide from Menu&rdquo; to temporarily hide it instead.
                      </span>
                    </div>
                    <button
                      onClick={handleDelete}
                      data-testid="confirm-delete-btn"
                      className="bg-red-600 hover:bg-red-700 text-white text-sm font-semibold px-4 py-2 rounded-xl transition"
                    >
                      Delete Permanently
                    </button>
                    <button
                      onClick={() => setDeleteConfirm(false)}
                      className="bg-gray-100 hover:bg-gray-200 text-gray-700 text-sm px-4 py-2 rounded-xl transition"
                    >
                      Cancel — Keep Item
                    </button>
                  </>
                ) : (
                  <>
                    {service.toggleActive && selected && (
                      <button
                        onClick={handleToggleActive}
                        disabled={toggling}
                        data-testid="toggle-active-btn"
                        aria-pressed={selected.active === false}
                        aria-label={
                          selected.active === false
                            ? `${selected.name}: currently hidden — click to show on menu`
                            : `${selected.name}: currently visible — click to hide from menu`
                        }
                        className={
                          "text-sm font-medium px-4 py-2 rounded-xl transition border " +
                          (toggling
                            ? "opacity-50 cursor-not-allowed bg-gray-50 text-gray-400 border-gray-200"
                            : selected.active === false
                              ? "bg-green-50 hover:bg-green-100 text-green-700 border-green-200"
                              : "bg-amber-50 hover:bg-amber-100 text-amber-700 border-amber-200")
                        }
                      >
                        {toggling
                          ? "Updating..."
                          : selected.active === false
                            ? "Show on Menu"
                            : "Hide from Menu"}
                      </button>
                    )}
                    {service.toggleActive && service.deleteItem && (
                      <div className="w-6 shrink-0" aria-hidden="true" />
                    )}
                    {service.deleteItem && (
                      <button
                        onClick={() => setDeleteConfirm(true)}
                        data-testid="delete-menu-item-btn"
                        className="bg-red-50 hover:bg-red-100 text-red-600 text-sm font-medium px-4 py-2 rounded-xl transition border border-red-100"
                      >
                        Delete
                      </button>
                    )}
                    {(canEdit || canEditTags) && (
                      <button
                        onClick={handleSave}
                        disabled={saving}
                        className={
                          "text-sm font-semibold px-5 py-2 rounded-xl transition shadow " +
                          (saved
                            ? "bg-green-500 text-white"
                            : "bg-orange-500 hover:bg-orange-600 text-white")
                        }
                      >
                        {saving
                          ? "Saving..."
                          : saved
                            ? "\u2713 Saved!"
                            : "Save Changes"}
                      </button>
                    )}
                  </>
                )}
              </div>
            </div>

            {error && (
              <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-xl text-sm">
                {error}
                <button
                  onClick={() => setError(null)}
                  className="ml-2 text-red-400 hover:text-red-600"
                >
                  &times;
                </button>
              </div>
            )}

            {/* ─── Image + Basic Info ─── */}
            <div className="grid grid-cols-2 gap-5">
              {/* Image section */}
              <section className="bg-white rounded-2xl p-5 border border-gray-100 shadow-sm">
                <div className="flex items-center justify-between mb-3">
                  <h3 className="text-sm font-semibold text-gray-600 uppercase tracking-wider">
                    Item Image
                  </h3>
                  {imageUrl && (
                    <span className="text-xs text-green-500 font-medium">
                      {service.uploadImage ? "Uploaded" : "From crawl"}
                    </span>
                  )}
                </div>
                <div className="relative group mb-4">
                  <div
                    className={
                      "w-full aspect-[4/3] rounded-xl overflow-hidden border-2 transition-all " +
                      (imageUrl
                        ? "border-gray-200"
                        : "border-dashed border-gray-200 bg-gradient-to-br from-gray-50 to-gray-100")
                    }
                  >
                    {imageLoading ? (
                      <div className="w-full h-full flex flex-col items-center justify-center gap-2">
                        <div className="w-6 h-6 border-2 border-orange-500 border-t-transparent rounded-full animate-spin" />
                        <span className="text-xs text-gray-500">
                          {imageLoadingText}
                        </span>
                      </div>
                    ) : imageUrl ? (
                      <>
                        <img
                          src={imageUrl}
                          className="w-full h-full object-cover"
                          alt={editName || selected?.name || "Menu item"}
                        />
                        {service.removeImage && !removeImageConfirm && (
                          <button
                            onClick={() => setRemoveImageConfirm(true)}
                            className="absolute top-2 right-2 w-7 h-7 bg-red-500 hover:bg-red-600 text-white rounded-full text-sm flex items-center justify-center opacity-0 group-hover:opacity-100 transition shadow"
                            title="Remove image"
                          >
                            &times;
                          </button>
                        )}
                        {removeImageConfirm && (
                          <div className="absolute inset-0 bg-black/60 flex flex-col items-center justify-center gap-2 rounded-xl">
                            <p className="text-white text-xs font-medium text-center px-3">Remove this image?</p>
                            <div className="flex gap-2">
                              <button
                                onClick={handleRemoveImage}
                                className="bg-red-500 hover:bg-red-600 text-white text-xs font-semibold px-3 py-1.5 rounded-lg"
                              >
                                Remove
                              </button>
                              <button
                                onClick={() => setRemoveImageConfirm(false)}
                                className="bg-white/20 hover:bg-white/30 text-white text-xs font-semibold px-3 py-1.5 rounded-lg"
                              >
                                Cancel
                              </button>
                            </div>
                          </div>
                        )}
                      </>
                    ) : (
                      <div
                        onClick={() =>
                          service.uploadImage && fileRef.current?.click()
                        }
                        className={
                          "w-full h-full flex flex-col items-center justify-center text-gray-300 " +
                          (service.uploadImage
                            ? "hover:text-orange-400 transition cursor-pointer"
                            : "")
                        }
                      >
                        <span className="text-4xl mb-1">
                          {service.uploadImage ? "+" : "\u{1F37D}\uFE0F"}
                        </span>
                        <span className="text-sm">
                          {service.uploadImage
                            ? "Upload a photo"
                            : "No image available"}
                        </span>
                      </div>
                    )}
                  </div>
                </div>

                {/* Image action buttons */}
                {service.uploadImage && !imageLoading && (
                  <div className="space-y-2">
                    <div className="flex gap-2">
                      <label className="flex-1 flex items-center justify-center gap-1.5 bg-gray-100 hover:bg-gray-200 text-gray-700 text-xs font-medium px-3 py-2 rounded-lg cursor-pointer transition">
                        {"\u{1F4C1}"} {imageUrl ? "Replace" : "Upload"}
                        <input
                          ref={fileRef}
                          type="file"
                          accept="image/*"
                          className="hidden"
                          onChange={handleImageUpload}
                        />
                      </label>
                      {service.generateImage && (
                        <button
                          onClick={handleGenerateImage}
                          className="flex-1 flex items-center justify-center gap-1.5 bg-orange-500 hover:bg-orange-600 text-white text-xs font-medium px-3 py-2 rounded-lg transition"
                        >
                          {"\u2726"} Generate AI
                        </button>
                      )}
                    </div>
                    {imageUrl && service.enhanceImage && (
                      <button
                        onClick={handleEnhanceImage}
                        className="w-full flex items-center justify-center gap-1.5 bg-gradient-to-r from-purple-500 to-violet-500 hover:from-purple-600 hover:to-violet-600 text-white text-xs font-semibold px-3 py-2 rounded-lg transition"
                      >
                        {"\u2726"} Enhance with AI
                      </button>
                    )}
                  </div>
                )}
              </section>

              {/* Basic Info section */}
              <section className="bg-white rounded-2xl p-5 border border-gray-100 shadow-sm space-y-4">
                <h3 className="text-sm font-semibold text-gray-600 uppercase tracking-wider">
                  Basic Info
                </h3>
                <div>
                  <label className="text-xs font-medium text-gray-500 mb-1 block">
                    Item Name
                  </label>
                  {canEdit ? (
                    <input
                      value={editName}
                      onChange={(e) => setEditName(e.target.value)}
                      className="w-full border border-gray-200 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-orange-300"
                      placeholder="e.g. Pan-Seared Salmon"
                    />
                  ) : (
                    <div className="w-full border border-gray-200 rounded-xl px-4 py-2.5 text-sm bg-gray-50 text-gray-800">
                      {selected?.name}
                    </div>
                  )}
                </div>
                <div>
                  <label className="text-xs font-medium text-gray-500 mb-1 block">
                    Description
                  </label>
                  {canEdit ? (
                    <textarea
                      value={editDescription}
                      onChange={(e) => setEditDescription(e.target.value)}
                      rows={3}
                      className="w-full border border-gray-200 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-orange-300 resize-none"
                      placeholder="Describe the dish..."
                    />
                  ) : (
                    <div className="w-full border border-gray-200 rounded-xl px-4 py-2.5 text-sm bg-gray-50 text-gray-800 min-h-[60px]">
                      {selected?.description || (
                        <span className="text-gray-400">No description</span>
                      )}
                    </div>
                  )}
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="text-xs font-medium text-gray-500 mb-1 block">
                      Price
                    </label>
                    {canEdit ? (
                      <input
                        data-testid="menu-item-price"
                        value={editPrice}
                        onChange={(e) => setEditPrice(e.target.value)}
                        type="number"
                        min="0"
                        step="0.01"
                        className="w-full border border-gray-200 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-orange-300"
                        placeholder="0.00"
                      />
                    ) : (
                      <div
                        data-testid="menu-item-price"
                        className="w-full border border-gray-200 rounded-xl px-4 py-2.5 text-sm bg-gray-50 text-orange-600 font-bold"
                      >
                        {formatPrice(selected?.price, selected?.price_raw) ||
                          "\u2014"}
                      </div>
                    )}
                  </div>
                  <div>
                    <label className="text-xs font-medium text-gray-500 mb-1 block">
                      Category
                    </label>
                    {canEdit ? (
                      <input
                        type="text"
                        value={editCategory}
                        onChange={(e) => { setEditCategory(e.target.value); setSaved(false); }}
                        placeholder="e.g. Chicken Dishes"
                        className="w-full border border-gray-200 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-orange-300 bg-white"
                      />
                    ) : (
                      <div className="w-full border border-gray-200 rounded-xl px-4 py-2.5 text-sm bg-gray-50 text-gray-800">
                        {selected?.category || "\u2014"}
                      </div>
                    )}
                  </div>
                </div>
                {/* Enrichment status (read-only mode, existing items only) */}
                {!canEdit && selected?.enrichment_status && (
                  <div>
                    <label className="text-xs font-medium text-gray-500 mb-1 block">
                      Enrichment Status
                    </label>
                    <div className="flex items-center gap-2">
                      <span
                        className={
                          "w-2 h-2 rounded-full " +
                          (selected.enrichment_status === "enriched"
                            ? "bg-green-400"
                            : selected.enrichment_status === "failed"
                              ? "bg-red-400"
                              : selected.enrichment_status === "enriching"
                                ? "bg-orange-400"
                                : "bg-gray-300")
                        }
                      />
                      <span className="text-sm text-gray-600 capitalize">
                        {selected.enrichment_status || "pending"}
                      </span>
                    </div>
                  </div>
                )}
                {/* Boost controls */}
                {service.updateBoost && (
                  <div>
                    <div className="flex items-center gap-1.5 mb-1.5">
                      <span className="text-sm">{"\u{1F680}"}</span>
                      <label className="text-xs font-medium text-gray-500">
                        Boost Item
                      </label>
                    </div>
                    <div className="flex gap-1.5">
                      {BOOST_LEVELS.map((b) => (
                        <button
                          key={b.label}
                          onClick={() =>
                            setEditBoost(editBoost === b.label ? "" : b.label)
                          }
                          className={
                            "flex-1 text-xs py-2 rounded-lg border-2 font-semibold transition " +
                            (editBoost === b.label ? b.active : b.idle)
                          }
                        >
                          {b.label}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
                {/* Chef's Special */}
                {canEdit && !isCreatingNew && (
                  <div
                    className={`rounded-xl border-2 p-3 transition-colors duration-200 ${editChefsSpecial ? 'bg-amber-50 border-amber-300' : 'border-gray-200 bg-white'}`}
                  >
                    <div className="flex items-center gap-3">
                      <svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#ff6900" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M17 21a1 1 0 0 0 1-1v-5.35c0-.457.316-.844.727-1.041a4 4 0 0 0-2.134-7.589 5 5 0 0 0-9.186 0 4 4 0 0 0-2.134 7.588c.411.198.727.585.727 1.041V20a1 1 0 0 0 1 1Z"/><path d="M6 17h12"/></svg>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-semibold text-gray-900 leading-tight">Chef&apos;s Special</p>
                        <p className="text-xs text-gray-500 mt-0.5">Feature prominently</p>
                      </div>
                      <button
                        type="button"
                        role="switch"
                        aria-checked={editChefsSpecial}
                        aria-label="Toggle Chef's Special"
                        data-testid="chefs-special-toggle"
                        onClick={() => { setEditChefsSpecial(!editChefsSpecial); setSaved(false); }}
                        className={`relative inline-flex h-6 w-10 shrink-0 items-center rounded-full transition-colors duration-200 ${editChefsSpecial ? 'bg-orange-500' : 'bg-gray-300'}`}
                      >
                        <span className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform duration-200 ${editChefsSpecial ? 'translate-x-5' : 'translate-x-1'}`} />
                      </button>
                    </div>
                  </div>
                )}
                {/* Portion Size */}
                {canEdit && !isCreatingNew && (
                  <div>
                    <label className="text-xs font-medium text-gray-500 mb-2 block">
                      Portion Size
                    </label>
                    <div className="flex gap-2 mb-2">
                      <button
                        type="button"
                        data-testid="portion-type-single"
                        onClick={() => { setEditPortionType('single'); setSaved(false); }}
                        className={`flex-1 py-2 px-3 rounded-xl border text-xs font-semibold transition-colors ${
                          editPortionType === 'single'
                            ? 'bg-orange-500 border-orange-500 text-white'
                            : 'bg-white border-gray-200 text-gray-600 hover:border-gray-300'
                        }`}
                      >
                        Single
                      </button>
                      <button
                        type="button"
                        data-testid="portion-type-shared"
                        onClick={() => { setEditPortionType('shared'); setSaved(false); }}
                        className={`flex-1 py-2 px-3 rounded-xl border text-xs font-semibold transition-colors ${
                          editPortionType === 'shared'
                            ? 'bg-orange-500 border-orange-500 text-white'
                            : 'bg-white border-gray-200 text-gray-600 hover:border-gray-300'
                        }`}
                      >
                        Shared
                      </button>
                    </div>
                    {editPortionType === 'shared' && (
                      <Select
                        fullWidth
                        value={String(editPortionServes)}
                        onChange={(e) => { setEditPortionServes(parseInt(e.target.value, 10)); setSaved(false); }}
                        data-testid="portion-serves-select"
                        options={[2, 3, 4, 5, 6].map((n) => ({ value: String(n), label: `${n} guests` }))}
                      />
                    )}
                  </div>
                )}
                {/* Select the Menu it belongs to — existing items only */}
                {!isCreatingNew &&
                  service.addItemToMenu && (
                    <div>
                      <label className="text-xs font-medium text-gray-500 uppercase tracking-wider block mb-1.5">
                        Select the Menu it belongs to
                      </label>
                      {menuError && (
                        <p className="text-xs text-red-500 mb-1">{menuError}</p>
                      )}

                      {/* Menu pills */}
                      {availableMenus.length > 0 && (
                        <div className="flex flex-wrap gap-1.5 mb-2">
                          {availableMenus.map((menu) => {
                            const isAssigned = menuAssociations.some(
                              (a) => a.menu_id === menu.id,
                            );
                            return (
                              <button
                                key={menu.id}
                                type="button"
                                data-testid={`menu-pill-${menu.id}`}
                                onClick={() => {
                                  if (isAssigned) {
                                    setMenuError(null);
                                    service.removeItemFromMenu?.(
                                      selectedId!,
                                      menu.id,
                                    )
                                      .then(setMenuAssociations)
                                      .catch(() =>
                                        setMenuError("Failed to remove"),
                                      );
                                  } else {
                                    if (!selectedId) {
                                      setMenuError("No item selected");
                                      return;
                                    }
                                    setMenuError(null);
                                    service.addItemToMenu!(
                                      selectedId,
                                      menu.id,
                                      parseFloat(editPrice) || 0,
                                      editCategory,
                                    )
                                      .then(setMenuAssociations)
                                      .catch((err) => {
                                        console.error("addItemToMenu error:", err);
                                        setMenuError(`Failed to add: ${err?.message || err}`);
                                      });
                                  }
                                }}
                                className={`px-3 py-1 rounded-full text-xs font-medium transition-all ${
                                  isAssigned
                                    ? "bg-orange-600 text-white hover:bg-orange-700"
                                    : "bg-white text-gray-500 border border-gray-300 hover:border-orange-400 hover:text-orange-600"
                                }`}
                              >
                                {isAssigned && (
                                  <span className="mr-0.5">&#10003;</span>
                                )}
                                {menu.name}
                              </button>
                            );
                          })}
                        </div>
                      )}

                      {/* Per-menu price rows */}
                      {menuAssociations.length > 0 && (
                        <div className="space-y-1.5">
                          {menuAssociations.map((assoc) => (
                            <div
                              key={assoc.menu_id}
                              className="flex items-center gap-2 py-1.5 px-2.5 bg-gray-50 rounded-lg"
                            >
                              <span className="text-xs font-medium text-gray-600 min-w-[70px]">
                                {assoc.menu_name}
                              </span>
                              <div className="relative flex-1 max-w-[100px]">
                                <span className="absolute left-2 top-1/2 -translate-y-1/2 text-xs text-gray-400">
                                  $
                                </span>
                                <input
                                  type="number"
                                  step="0.01"
                                  data-testid={`menu-price-${assoc.menu_id}`}
                                  defaultValue={
                                    assoc.price != null
                                      ? assoc.price.toFixed(2)
                                      : ""
                                  }
                                  onBlur={(e) => {
                                    const newPrice = parseFloat(
                                      e.target.value,
                                    );
                                    if (
                                      !selectedId ||
                                      isNaN(newPrice) ||
                                      newPrice === assoc.price
                                    )
                                      return;
                                    setMenuError(null);
                                    service.addItemToMenu!(
                                      selectedId,
                                      assoc.menu_id,
                                      newPrice,
                                      editCategory,
                                    )
                                      .then(setMenuAssociations)
                                      .catch((err) => {
                                        console.error("updatePrice error:", err);
                                        setMenuError(`Failed to update price: ${err?.message || err}`);
                                      });
                                  }}
                                  className="w-full pl-5 pr-2 py-1 text-xs border border-gray-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-orange-300"
                                />
                              </div>
                              {service.removeItemFromMenu && (
                                  <button
                                    onClick={() => {
                                      setMenuError(null);
                                      service.removeItemFromMenu!(
                                        selectedId!,
                                        assoc.menu_id,
                                      )
                                        .then(setMenuAssociations)
                                        .catch(() =>
                                          setMenuError("Failed to remove"),
                                        );
                                    }}
                                    className="text-gray-300 hover:text-red-500 ml-auto"
                                    title="Remove from menu"
                                  >
                                    <svg
                                      className="w-3.5 h-3.5"
                                      fill="none"
                                      stroke="currentColor"
                                      viewBox="0 0 24 24"
                                    >
                                      <path
                                        strokeLinecap="round"
                                        strokeLinejoin="round"
                                        strokeWidth={2}
                                        d="M6 18L18 6M6 6l12 12"
                                      />
                                    </svg>
                                  </button>
                                )}
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
              </section>
            </div>

            {/* ─── Food Tags ─── */}
            <section className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
              <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
                <h3 className="text-sm font-semibold text-gray-600 uppercase tracking-wider">
                  Food Tags
                </h3>
                <span className="text-xs text-gray-400">
                  {totalTags} tags added
                </span>
              </div>
              <div className="divide-y divide-gray-50">
                {TAG_CATEGORIES.map(({ key, label, icon }) => {
                  const tags =
                    (editFoodTags[key as keyof FoodTags] as string[]) || [];
                  return (
                    <div key={key} className="px-5 py-3" data-testid={`food-tag-category-${key}`}>
                      <div className="flex items-start gap-3">
                        <div className="w-7 h-7 rounded-lg bg-orange-50 flex items-center justify-center text-sm shrink-0 mt-0.5">
                          {icon}
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-xs font-semibold text-gray-700 mb-1.5">
                            {label}
                          </p>
                          {canEditTags ? (
                            <InlineTagInput
                              tags={tags}
                              onChange={(val) => updateTag(key, val)}
                              testId={key}
                            />
                          ) : (
                            <div className="flex gap-1 flex-wrap">
                              {tags.length > 0 ? (
                                tags.map((t) => (
                                  <span
                                    key={t}
                                    className="bg-orange-100 text-orange-800 text-xs px-2 py-0.5 rounded-full"
                                  >
                                    {t}
                                  </span>
                                ))
                              ) : (
                                <span className="text-xs text-gray-400">
                                  No tags
                                </span>
                              )}
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>

            {/* ─── Beverage Tags (only for Beverages category) ─── */}
            {(editCategory === 'Beverages' || getCanonicalCategory(selected?.category).includes('Beverages')) && (() => {
              const bev: BeverageTags = (editFoodTags as FoodTags).beverage || {};
              const updateBev = (field: string, value: unknown) => {
                const updated = { ...bev, [field]: value };
                setEditFoodTags((prev) => ({ ...prev, beverage: updated }));
                setSaved(false);
              };
              return (
                <section className="bg-white rounded-2xl border border-purple-100 shadow-sm overflow-hidden">
                  <div className="px-5 py-3 border-b border-purple-50 flex items-center gap-2">
                    <span className="text-base">{'\u{1F378}'}</span>
                    <h3 className="text-sm font-semibold text-purple-700">
                      Beverage Tags
                    </h3>
                  </div>
                  <div className="p-5 space-y-4">
                    {/* Row 1: Type + Alcoholic */}
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="text-xs font-medium text-gray-500 mb-1 block">Drink Type</label>
                        <Select
                          fullWidth
                          value={bev.beverage_type || ''}
                          onChange={(e) => updateBev('beverage_type', e.target.value || null)}
                          disabled={!canEditTags}
                          placeholder="Select type"
                          options={[
                            { value: '', label: 'Select type' },
                            ...BEVERAGE_TYPES.map((t) => ({ value: t, label: t.charAt(0).toUpperCase() + t.slice(1) })),
                          ]}
                        />
                      </div>
                      <div>
                        <label className="text-xs font-medium text-gray-500 mb-1 block">Alcoholic</label>
                        <div className="flex gap-2 mt-1">
                          {[{ label: 'Yes', value: true }, { label: 'No', value: false }].map((opt) => (
                            <button
                              key={opt.label}
                              type="button"
                              onClick={() => canEditTags && updateBev('alcoholic', opt.value)}
                              className={`flex-1 text-sm py-2 rounded-lg border transition font-medium ${
                                bev.alcoholic === opt.value
                                  ? 'bg-purple-500 border-purple-500 text-white'
                                  : 'bg-white border-gray-200 text-gray-500 hover:border-purple-300'
                              } ${!canEditTags ? 'opacity-50 cursor-not-allowed' : ''}`}
                            >
                              {opt.label}
                            </button>
                          ))}
                        </div>
                      </div>
                    </div>

                    {/* Row 2: Conditional fields based on type */}
                    {bev.beverage_type === 'cocktail' && (
                      <div>
                        <label className="text-xs font-medium text-gray-500 mb-1 block">Base Spirit</label>
                        <Select
                          fullWidth
                          value={bev.base_spirit || ''}
                          onChange={(e) => updateBev('base_spirit', e.target.value || null)}
                          disabled={!canEditTags}
                          placeholder="Select spirit"
                          options={[
                            { value: '', label: 'Select spirit' },
                            ...BASE_SPIRITS.map((s) => ({ value: s, label: s.charAt(0).toUpperCase() + s.slice(1) })),
                          ]}
                        />
                      </div>
                    )}
                    {bev.beverage_type === 'wine' && (
                      <div>
                        <label className="text-xs font-medium text-gray-500 mb-1 block">Wine Variety</label>
                        <Select
                          fullWidth
                          value={bev.wine_variety || ''}
                          onChange={(e) => updateBev('wine_variety', e.target.value || null)}
                          disabled={!canEditTags}
                          placeholder="Select variety"
                          options={[
                            { value: '', label: 'Select variety' },
                            ...WINE_VARIETIES.map((v) => ({ value: v, label: v.charAt(0).toUpperCase() + v.slice(1) })),
                          ]}
                        />
                      </div>
                    )}
                    {bev.beverage_type === 'beer' && (
                      <div>
                        <label className="text-xs font-medium text-gray-500 mb-1 block">Beer Style</label>
                        <Select
                          fullWidth
                          value={bev.beer_style || ''}
                          onChange={(e) => updateBev('beer_style', e.target.value || null)}
                          disabled={!canEditTags}
                          placeholder="Select style"
                          options={[
                            { value: '', label: 'Select style' },
                            ...BEER_STYLES.map((s) => ({ value: s, label: s })),
                          ]}
                        />
                      </div>
                    )}

                    {/* Row 3: Flavor Notes (multi-select chips) */}
                    <div>
                      <label className="text-xs font-medium text-gray-500 mb-1.5 block">Flavor Notes</label>
                      <div className="flex flex-wrap gap-1.5">
                        {FLAVOR_NOTES.map((note) => {
                          const isActive = (bev.flavor_notes || []).includes(note);
                          return (
                            <button
                              key={note}
                              type="button"
                              onClick={() => {
                                if (!canEditTags) return;
                                const current = bev.flavor_notes || [];
                                updateBev('flavor_notes', isActive
                                  ? current.filter((n: string) => n !== note)
                                  : [...current, note]);
                              }}
                              className={`text-xs px-2.5 py-1 rounded-full border transition ${
                                isActive
                                  ? 'bg-purple-100 border-purple-300 text-purple-700 font-medium'
                                  : 'bg-white border-gray-200 text-gray-500 hover:border-purple-200'
                              } ${!canEditTags ? 'opacity-50 cursor-not-allowed' : ''}`}
                            >
                              {note}
                            </button>
                          );
                        })}
                      </div>
                    </div>

                    {/* Row 4: Serving + Strength */}
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="text-xs font-medium text-gray-500 mb-1 block">Served</label>
                        <Select
                          fullWidth
                          value={bev.served || ''}
                          onChange={(e) => updateBev('served', e.target.value || null)}
                          disabled={!canEditTags}
                          placeholder="Select style"
                          options={[
                            { value: '', label: 'Select style' },
                            ...SERVING_STYLES.map((s) => ({ value: s, label: s.charAt(0).toUpperCase() + s.slice(1) })),
                          ]}
                        />
                      </div>
                      <div>
                        <label className="text-xs font-medium text-gray-500 mb-1 block">Strength</label>
                        <Select
                          fullWidth
                          value={bev.strength || ''}
                          onChange={(e) => updateBev('strength', e.target.value || null)}
                          disabled={!canEditTags}
                          placeholder="Select strength"
                          options={[
                            { value: '', label: 'Select strength' },
                            ...DRINK_STRENGTHS.map((s) => ({ value: s, label: s === 'none' ? 'Non-alcoholic' : s.charAt(0).toUpperCase() + s.slice(1) })),
                          ]}
                        />
                      </div>
                    </div>

                    {/* Row 5: Key Ingredients */}
                    <div>
                      <label className="text-xs font-medium text-gray-500 mb-1 block">Key Ingredients</label>
                      {canEditTags ? (
                        <InlineTagInput
                          tags={bev.key_ingredients || []}
                          onChange={(val) => updateBev('key_ingredients', val)}
                        />
                      ) : (
                        <div className="flex gap-1 flex-wrap">
                          {(bev.key_ingredients || []).length > 0 ? (
                            (bev.key_ingredients || []).map((t) => (
                              <span key={t} className="bg-purple-100 text-purple-800 text-xs px-2 py-0.5 rounded-full">{t}</span>
                            ))
                          ) : (
                            <span className="text-xs text-gray-400">No ingredients</span>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                </section>
              );
            })()}

            {/* ─── Bottom action bar ─── */}
            {isCreatingNew ? (
              <div className="flex gap-3 pb-4">
                <button
                  onClick={handleCreateItem}
                  disabled={saving || !editName.trim()}
                  className={
                    "flex-1 text-sm font-semibold py-3 rounded-xl transition shadow " +
                    (saving
                      ? "bg-orange-300 text-white cursor-not-allowed"
                      : "bg-orange-500 hover:bg-orange-600 text-white disabled:opacity-50")
                  }
                >
                  {saving ? "Creating..." : "Create Item"}
                </button>
                <button
                  onClick={() => setIsCreatingNew(false)}
                  className="bg-gray-100 hover:bg-gray-200 text-gray-600 font-medium text-sm px-6 py-3 rounded-xl transition"
                >
                  Cancel
                </button>
              </div>
            ) : canEdit || canEditTags ? (
              <div className="flex gap-3 pb-4">
                <button
                  onClick={handleSave}
                  disabled={saving}
                  className={
                    "flex-1 text-sm font-semibold py-3 rounded-xl transition shadow " +
                    (saved
                      ? "bg-green-500 text-white"
                      : "bg-orange-500 hover:bg-orange-600 text-white")
                  }
                >
                  {saving
                    ? "Saving..."
                    : saved
                      ? "\u2713 Changes Saved!"
                      : "Save Changes"}
                </button>
                {service.deleteItem && (
                  <button
                    onClick={() => setDeleteConfirm(true)}
                    data-testid="delete-menu-item-mobile-btn"
                    className="bg-red-50 hover:bg-red-100 text-red-600 font-medium text-sm px-6 py-3 rounded-xl transition border border-red-100"
                  >
                    Delete Item
                  </button>
                )}
              </div>
            ) : null}
          </main>
        ) : (
          <main className="flex-1 flex items-center justify-center text-center p-10 bg-gray-50/50">
            <div>
              <div className="text-6xl mb-4">{"\u{1F37D}\uFE0F"}</div>
              <h3 className="text-xl font-bold text-gray-700 mb-2">
                {items.length === 0 ? "No menu items yet" : "No item selected"}
              </h3>
              <p className="text-gray-400 mb-4">
                {items.length === 0
                  ? service.addItem
                    ? "Add your first menu item to get started."
                    : "Menu will appear after the first crawl."
                  : "Select an item from the sidebar to view and edit its food tags."}
              </p>
              {items.length === 0 && service.addItem && (
                <button
                  onClick={handleStartNewItem}
                  className="bg-orange-500 hover:bg-orange-600 text-white font-semibold px-6 py-2.5 rounded-xl transition"
                >
                  + New Item
                </button>
              )}
            </div>
          </main>
        )}
      </div>
    </div>
  );
}
