# @qrate/shared — Shared Package for the QRate Platform

> **For AI agents:** This is the shared types, components, and utilities package consumed by `qrate-owner-webapp` and `qrate-waiter-webapp` via git submodule.

## Purpose

This package provides the shared contract between QRate's frontend applications:
- **Types** — TypeScript interfaces for restaurants, menus, orders, staff, ratings, pairings
- **Components** — Reusable React components (menu management, staff, pairings, experience)
- **Utils** — Order status display helpers, category utilities
- **Constants** — Food tag definitions, dietary/allergen/taste constants
- **Services** — Plugin-style service interfaces (auth-agnostic HTTP adapters)

## How It's Consumed

This package is mounted as a **git submodule** at `packages/shared/` in consumer repos:

```
qrate-owner-webapp/
  packages/shared/     ← git submodule → this repo
  apps/owner/

qrate-waiter-webapp/
  packages/shared/     ← git submodule → this repo
  apps/waiter/
```

Consumer repos use npm workspaces (`"workspaces": ["apps/*", "packages/*"]`) so imports resolve as:

```typescript
import { MenuItem, OrderStatus } from '@qrate/shared'
import { MenuItemsManagement } from '@qrate/shared'
```

## No Build Step

This package is consumed as **TypeScript source** — consumers' bundlers (Next.js/webpack) compile it. The `build` script runs `tsc --noEmit` for type checking only.

## Package Structure

```
src/
├── index.ts                    # Barrel export — all public API
├── types/
│   ├── restaurant.ts           # Restaurant, MenuItem, Menu, Table types
│   ├── experience.ts           # OrderStatus, TableActivity, StaffMember, WaiterCall
│   ├── pairing.ts              # MenuPairing, PairingSuggestion
│   └── rating.ts               # Rating, RatingCreate
├── components/
│   ├── menu-items/             # MenuItemsManagement — full menu editor
│   ├── menu/                   # FoodTagBadges, MenuTabs, MenuScheduleEditor
│   ├── pairings/               # Pairing card/grid components
│   ├── experience/             # ExperienceManagement (guided dining sections)
│   ├── staff/                  # StaffManagement, SwipeSlider
│   └── common/                 # QRateLogo
├── services/
│   └── createMenuItemsService.ts  # Plugin factory for menu item CRUD
├── utils/
│   └── order-status-display.ts    # Status labels, colors, transitions
└── constants/
    └── food-tags.ts               # TAG_CATEGORIES, allergens, dietary, heat levels
```

## Key Architecture Patterns

### Plugin Service Interface

`MenuItemsService` uses a plugin pattern — consumers provide an `HttpAdapter` that handles auth:

```typescript
import { createMenuItemsService, type HttpAdapter } from '@qrate/shared'

const adapter: HttpAdapter = {
  fetchJson: (url, opts) => authenticatedFetch(url, opts).then(r => r.json()),
  fetchRaw: (url, opts) => authenticatedFetch(url, opts),
}

const service = createMenuItemsService({ adapter, restaurantId })
```

This lets owner-webapp (Cognito owner auth) and waiter-webapp (Cognito staff auth) use the same components with different auth mechanisms.

### Peer Dependencies

React, React-DOM, and Lucide-React are **peer dependencies** — consumers must install them. This avoids duplicate React instances.

## Making Changes

1. Edit files in `src/`
2. Export new items from `src/index.ts`
3. Run `npm run build` to verify types compile
4. Push to this repo
5. In consumer repos, update the submodule: `cd packages/shared && git pull origin main`

## CI

Every push to `main` and every PR runs `tsc --noEmit` to validate types compile. No build artifacts are produced.

## Types Reference

### Core Types
- `Restaurant` — Restaurant metadata (name, address, phone, cuisine, headers)
- `MenuItem` / `MenuItemDisplay` — Menu item with food tags, pricing, images, boost level
- `Menu` / `MenuSummary` — Menu with schedule, items, guided categories
- `RestaurantTable` — Table with number, label, capacity, server assignment, QR code
- `FoodTags` / `BeverageTags` — Structured taste/dietary/allergen metadata

### Experience Types (Waiter App)
- `OrderStatus` — `'confirmed' | 'preparing' | 'ready' | 'delivered' | 'completed' | 'cancelled' | 'issue'`
- `TableActivityEntry` — Aggregated table data (guests, carts, orders, attention flag)
- `WaiterCall` — Service request (table number, status, timestamps)
- `StaffMember` — Staff profile (name, email, role, permissions)
- `OrderSummary` — Order with status, amounts, items, POS tracking

### Service Types
- `ExperienceService` — Full interface for restaurant operations (tables, staff, orders, waiter calls)
- `MenuItemsService` — Plugin interface for menu item CRUD operations
- `HttpAdapter` — Auth-agnostic HTTP client interface

## Related Repos

| Repo | Relationship |
|------|-------------|
| `qrate-owner-webapp` | Consumer — restaurant owner dashboard |
| `qrate-waiter-webapp` | Consumer — staff/waiter order management app |
| `qrate-core` | Backend — API endpoints these types model |

---

*Document reflects package state as of March 2026.*
