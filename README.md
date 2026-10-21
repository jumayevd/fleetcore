# FleetOps — Logistics Platform

A control tower for a trucking company: dispatch board, loads with multi-stop routing, live tracking,
fleet and trailer lifecycle, maintenance and work orders, drivers and dispatcher teams, customers and
brokers, billing driven by paperwork, claims, team chat, announcements, Telegram alerts, reports and an AI
fleet assistant — with role-based access for every team and a Day/Night "Graphite" design.

## Live

- Production: **https://fleetops-ochre.vercel.app** (Vercel project `fleetops`, region `fra1`). Every push to `main` deploys.
- Demo-company logins and their shared password are in `DEMO-CREDENTIALS.local.txt` (git-ignored, never deployed).
  Change passwords under **My account** after signing in.

| Role          | Email                   | What they see |
|---------------|-------------------------|---------------|
| Owner         | owner@demo.local        | Everything, including managing other owners |
| Admin         | admin@demo.local        | Everything except owner accounts |
| Dispatcher    | dispatch@demo.local     | Board, loads, tracking, drivers, customers, chat, claims |
| Fleet manager | fleet@demo.local        | Trucks, trailers, maintenance, work orders, drivers, reports |
| Accountant    | accounting@demo.local   | Finance, billing queue, invoices, customers, claims, reports |
| Driver        | driver@demo.local       | Mobile driver portal (their own trips), chat, announcements |

## Local development

```bash
npm install
npm run setup      # starts a local PostgreSQL in ./.pgdata, runs migrations, seeds demo data
npm run dev        # http://localhost:3000 — one-click demo logins, password demo1234
```

Development uses a **local PostgreSQL 17** cluster (`scripts/dev-db.mjs`, started automatically by `npm run dev`).
Production stays on Neon; its credentials are pulled into `.env.vercel` with `npm run env:pull` and are only used
for deliberate production operations. The seed wipes the database it points at, so it refuses any non-local
database unless `CONFIRM_SEED=yes` is set.

| Command | What it does |
|---|---|
| `npm run db:migrate` | Apply pending migrations (`prisma/migrations`) to the local database |
| `npm run db:seed` | Wipe the local database and reload demo data (`DEMO_PASSWORD` to choose the password) |
| `npm run db:stop` | Stop the local PostgreSQL |
| `npx dotenv -e .env.local -- prisma migrate dev --name <change>` | Create a migration after editing the schema |
| `node scripts/dev-cookie.mjs owner@demo.local` | Print a session cookie for smoke-testing pages with curl |

## Modules

| Module | Highlights |
|---|---|
| **Overview** | Customizable (show or hide each section); six key numbers; "Needs attention" (top items, critical first, filter by compliance / dispatch / fleet / money / safety, full list one click away); today's pickups and recent activity in one tabbed card; live fleet map; billing queue; this week's production; monthly performance with chart |
| **Dispatch board** | Daily board grouped by dispatcher team: load, driver (hold / type tags), truck, trailer, phones, status, time in status, ETA, next stop, notes. Statuses derive from the load and stop progress (Dispatched → At pickup → En route → Unloading) with manual override (Stop / Rest / Home / Vacation) and history. Row colours and notes per day, flat and prebook (> 24 h) views, date navigation, keyboard navigation, column copy, live refresh |
| **Weekly production** | Revenue / km / $-per-km / load per driver per weekday, totals, goals per driver type, efficiency, CSV export |
| **Loads** | Table and kanban board, filters, multi-stop booking form (pickups, intermediate deliveries, windows), broker vs customer, customer reference, empty km, suggested rate; detail with stepper, stops (arrive / complete), documents checklist (RC / BOL / POD → billing stage), recover to another unit, TONU / cancel with reason, activity with filters |
| **Live tracking** | Control tower: rolling / idle / stopped, on a load / unassigned, team; speed, location, fuel, GPS fix age; routes through stops, ETA and late flags |
| **Trucks & trailers** | Ownership (company / owner-operator / leased) with lease mileage caps and exposure; PM schedule by odometer; telematics; tabs (overview, maintenance, specs, financial, compliance, loads). Trailers: in use / empty / dropped / yard / shop / out of service with "since", paired truck, location, GPS provider, paperwork |
| **Maintenance** | Spend summary (cost per km, vendors, categories, flagged units), repair log, PM schedule, lease mileage control, in shop, compliance; work orders with priorities, costs and documents |
| **Drivers** | Teams, driver types, hold with reason, score, board status with history, performance, licence / medical expiry, documents |
| **Customers & brokers** | Shippers and brokers, terms, credit exposure, loads as customer or broker, invoices, contracts |
| **Finance** | Billing queue (missing documents → ready to invoice), invoices (draft / sent / paid / void), aging, DSO, printable invoices with company letterhead |
| **Reports** | Revenue vs cost, margin, on-time, empty km, lane profitability, broker vs direct, drivers, trucks, claims; CSV export |
| **Claims** | Cargo, late, OS&D, accident, equipment, injury; full lifecycle with notes, documents, assignee, analytics |
| **Chat & announcements** | Company room, team rooms, per-load threads; pinned announcements |
| **Company & admin** | Company profile and documents, teams, users and roles, Telegram alerts, audit log |
| **Driver portal** | Mobile-first: current trip with stops, POD from the camera, status, GPS sharing, next trips, earnings, fuel |
| **Fleet assistant** | Ask about the fleet in plain language; answers come from read-only tools over your own data (Vercel AI Gateway) |

### Load lifecycle

```
PLANNED (booked) ──assign──▶ ASSIGNED (dispatched) ──pickup──▶ IN_TRANSIT ──POD──▶ DELIVERED ──bill──▶ INVOICED
       ▲                        │          │
       └────────unassign────────┘          └── TONU (truck ordered, not used) ──▶ INVOICED
```

Billing stage follows the paperwork: delivered loads are **Missing docs** until RC and POD are on file, then
**Ready to invoice**, then **Invoiced** / **Paid**. The rules live in `src/lib/workflow.ts`.

**Prebooking.** A truck, driver or trailer can hold several dispatched loads as long as their pickup → delivery
windows don't overlap, with a 6-hour turnaround kept free around each one (`assertAvailable`). A unit already on
the road is busy until its load is delivered.

**Company time.** Every date and time is shown and entered in the company timezone (`TIMEZONE` in
`src/lib/constants.ts`, Asia/Tashkent). The server clock is pinned to it in `src/instrumentation.ts`, because Vercel
runs in UTC.

## Design system

"Graphite": graphite surfaces, one amber signal accent, semantic status colours, tabular numerals, compact density,
Day (default) and Night themes, plus Auto, seven accent colours, three densities and three fonts per person (cookies resolved before first paint). Tokens in `src/app/globals.css`, kit in
`src/components/ui.tsx`, rules in `docs/design-system.md`. The competitor benchmark and how we exceed it:
`docs/competitive-analysis.md`.

## Telegram alerts

1. Message **@BotFather**, send `/newbot`, copy the token.
2. `vercel env add TELEGRAM_BOT_TOKEN production --sensitive`, then `vercel deploy --prod` (or push).
3. **Company → Telegram alerts → Connect webhook** on the live site; each person links under **My account**.
4. Optional: add the bot to a group and send `/connect <code>` from the admin page.

## Fleet assistant

Needs an AI Gateway credential: on Vercel, OIDC works automatically; locally set `AI_GATEWAY_API_KEY` in `.env.local`.
`ASSISTANT_MODEL` overrides the default `anthropic/claude-sonnet-5.5`. Without a credential the panel says so.

## Architecture

- **Next.js 16 (App Router)**: Server Components, Server Actions, route handlers under `src/app/api`
- **Prisma 6 + PostgreSQL**: schema in `prisma/schema.prisma`; migrations applied on every Vercel build
- **Vercel Blob (private)** for documents; local `./storage` fallback; seeded documents render a placeholder PDF
- **Telegram Bot API** (`src/lib/telegram.ts`, routing in `src/lib/notify.ts`), **Vercel Cron** daily brief
- **AI SDK 7** (`ToolLoopAgent`) for the assistant, gateway string models
- **Leaflet + OpenStreetMap** (inverted tiles in Night), **Recharts** with theme-aware tokens

## Environment variables

| Name | Source |
|---|---|
| `DATABASE_URL`, `DATABASE_URL_UNPOOLED` | Neon integration (production); local cluster (`.env.local`) |
| `BLOB_READ_WRITE_TOKEN` | Blob store `fleetops-docs` (production) |
| `AUTH_SECRET`, `CRON_SECRET` | Random 32-byte hex |
| `DEMO_MODE` | `true` locally, `false` in production |
| `TELEGRAM_BOT_TOKEN` | Optional, from @BotFather |
| `AI_GATEWAY_API_KEY`, `ASSISTANT_MODEL` | Optional locally; OIDC on Vercel |
| `APP_URL`, `NEXT_PUBLIC_MAP_TILE_URL` | Optional |
