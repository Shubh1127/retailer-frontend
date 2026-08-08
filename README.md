# RetailCompare — frontend (UI preview)

This is a **UI-only** preview of the frontend for `retailcompare-backend`
(the cross-supplier grocery ordering/allocation core). Every page is built
with static mock data from `src/lib/mock-data.ts` — there are no API calls,
no auth, and no live pricing wired up yet. It's meant to show the shape and
feel of the product before connecting it to the real backend.

## Run it

```bash
npm install
npm run dev
```

Then open http://localhost:3000. (The first `npm run dev` needs internet
access once, to fetch the Google Fonts used in `src/app/layout.tsx`.)

## Pages

| Route         | Purpose                                                        |
|----------------|-----------------------------------------------------------------|
| `/`            | Marketing landing page                                          |
| `/dashboard`   | Overview: open orders, savings, supplier snapshot, recent orders |
| `/compare`     | List builder + per-supplier price comparison table               |
| `/cart`        | Allocation view — the list split into one manifest per supplier  |
| `/suppliers`   | Manage connected suppliers                                       |
| `/orders`      | Full order history / ledger                                      |

## Design system

- **Look & feel:** a "warehouse manifest" aesthetic — kraft paper, stenciled
  crate tags, hairline ledger rules — grounded in the idea of a grocery order
  being split and shipped across multiple suppliers.
- **Signature element:** `AllocationBar` (`src/components/AllocationBar.tsx`),
  a segmented manifest bar that recurs across the landing page, dashboard,
  and cart page to visualize how an order's spend splits across suppliers.
- **Colors:** ink (`#12201B`), kraft (`#DDD2B8`), paper (`#F5F1E4`),
  pallet green (`#2F5233`), dock yellow (`#E8A93B`), rust (`#B5502E`),
  slate (`#3A4048`) — see `tailwind.config.ts`.
- **Type:** Big Shoulders Display (condensed, industrial) for headings,
  Inter for body copy, IBM Plex Mono for data/prices/labels.

## Next steps (not built yet)

- Wire `/compare` and `/cart` to the real allocation engine in
  `retailcompare-backend`.
- Replace mock data with live API calls (add a `src/lib/api.ts` client).
- Add auth for `/dashboard` and order actions.
