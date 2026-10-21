# FleetCore — for fleet specialists

A workspace for the person who keeps trucks on the road: trucks and trailers, PM by odometer, work orders and shop
time, expiring paperwork, drivers' licences and medicals, fuel and maintenance costs, and a live map. It started as a
copy of the full FleetOps platform with dispatch, loads, customers, billing, claims and chat taken out, and with **accounts and
companies** added so one specialist can work for several fleets.

## Accounts and companies

- An **account** is a sign-in (email + password). A **company** is one fleet's workspace; it owns every truck, trailer,
  driver, work order, fuel log, document and audit entry. A **membership** gives an account a role in a company.
- One account can belong to many companies (Slack-style), and one browser can be signed in to **several accounts at
  once** (Gmail-style) — useful when a company gives you its own login. The company menu at the top of the sidebar lists
  every signed-in account with its companies; `Alt+1…9` and the command palette (`⌘K`) switch too.
- Switching keeps the same page (Trucks stays Trucks) with the other company's data. A browser works in one company at
  a time: if another tab switches, the stale tab stops and asks before anything can be saved to the wrong company.
- Roles are per company: **Owner** (everything, incl. owners and deleting the company), **Admin** (everything except
  owners), **Fleet specialist** (all fleet work), **View only**.
- People join by **invitation link** (Settings → Members → Invite). The link works once, for the invited email; an
  existing account just signs in and accepts. Nobody in a company can see or reset another person's password
  (`npm run user:reset-password -- <email> <password>` for operators).
- New here? `/signup` creates the account and its first company; the overview then shows a set-up checklist.

### How data is kept apart

`src/lib/db.ts` exports a Prisma client that scopes **every** query on a company model to the active company: it adds
`companyId` to every `where` (including `findUnique`) and every create, and refuses foreign keys that point at another
company's row. The active company comes from the session (`src/lib/session.ts`): the signed `fo_session` cookie lists
the signed-in accounts; `fo_active` says which account × company this browser works in and is re-checked against the
membership on every request. `rootDb` (`src/lib/db-root.ts`) is unscoped and used only for accounts, memberships,
invites and companies. Raw SQL is not scoped — don't use it for company data.

## Modules

| Module | Highlights |
|---|---|
| **Overview** | Six numbers, what needs you today, the shop today, coming-up expiries and PM, live fleet, costs; set-up checklist for a new company |
| **Trucks & trailers** | Status, ownership and lease caps, PM by odometer, readings (odometer / fuel / location), paperwork with expiry, notes, costs per truck (fuel + maintenance per km, L/100 km), documents |
| **Maintenance** | Spend summary, repair log, PM schedule, lease mileage, in shop, compliance; work orders numbered per company |
| **Drivers** | Cleared to drive, assigned truck, licence and medical expiry, hold, safety score, documents, fuel by driver |
| **Live map** | Rolling / idle / stopped / in shop / no signal, filters, truck details |
| **Reports** | Maintenance and fuel spend, km driven, cost per km, downtime, by truck, category and vendor; CSV export |
| **Settings** | Company profile and badge colour, company documents, members and invitations, audit log |
| **Fleet assistant** | Ask about the active company's fleet in plain language (Vercel AI Gateway) |

Distances come from odometer readings (fuel fills, work orders, manual readings) — `src/lib/mileage.ts` — since there are
no loads in this product.

## Local development

```bash
npm install
npm run setup      # local PostgreSQL in ./.pgdata on port 5434, migrations, demo data
npm run dev        # http://localhost:3000 — one-click demo logins, password demo1234
```

Demo data (`prisma/seed.ts`): four companies. **aziza@demo.local** owns Silk Road Freight, is a fleet specialist at
Caspian Carriers and has an open invitation to Turon Logistics; **aziza@nomadtrucking.demo** is the same person's second
login for Nomad Trucking. Sign in with one, then *Add another account* from the company menu to try switching. Also:
owner@demo.local, timur@nomadtrucking.demo, bekzod@demo.local, viewer@demo.local.

| Command | What it does |
|---|---|
| `npm run db:migrate` | Apply pending migrations (`prisma/migrations`) to the local database |
| `npm run db:seed` | Wipe the local database and reload demo data (`DEMO_PASSWORD` to choose the password) |
| `npm run db:stop` | Stop the local PostgreSQL |
| `npx dotenv -e .env.local -- prisma migrate dev --name <change>` | Create a migration after editing the schema |
| `node scripts/dev-cookie.mjs aziza@demo.local "Caspian Carriers"` | Print a Cookie header for smoke-testing pages with curl |

The local cluster uses port **5434** so it can run next to the full platform's (5433).

## Deploying (Vercel project `fleetcore`)

This copy has its own database and must not share the full platform's:

1. Push this folder to its own repository and import it as a **new** Vercel project (region `fra1` is set in `vercel.json`).
2. Add a **new** Neon database from the Vercel Marketplace (sets `DATABASE_URL`, `DATABASE_URL_UNPOOLED`) and a private
   Blob store (`BLOB_READ_WRITE_TOKEN`).
3. Set `AUTH_SECRET` (random 32-byte hex) and `DEMO_MODE=false`; optionally `APP_URL` for invitation links.
4. Deploy. The build runs `prisma migrate deploy`, which creates the schema from `prisma/migrations/0_init`.
5. Open `/signup` to create the first account and company. Seed demo data into production only on purpose:
   `CONFIRM_SEED=yes` (it wipes the database).

## Architecture

- **Next.js 16 (App Router)**: Server Components, Server Actions, route handlers under `src/app/api`
- **Prisma 6 + PostgreSQL**: `prisma/schema.prisma`; company scope in `src/lib/db.ts`; migrations applied on every Vercel build
- **Vercel Blob (private)** for documents (keys prefixed by company); local `./storage` fallback; seeded documents render a placeholder PDF
- **AI SDK 7** for the assistant; **Leaflet + OpenStreetMap**; **Recharts**
- "Graphite" design system with Day/Night themes: `docs/design-system.md`, kit in `src/components/ui.tsx`

## Environment variables

| Name | Source |
|---|---|
| `DATABASE_URL`, `DATABASE_URL_UNPOOLED` | Neon integration of this project; local cluster (`.env.local`) |
| `BLOB_READ_WRITE_TOKEN` | Blob store of this project |
| `AUTH_SECRET` | Random 32-byte hex |
| `DEMO_MODE` | `true` locally, `false` in production |
| `APP_URL` | Optional, base URL for invitation links |
| `AI_GATEWAY_API_KEY`, `ASSISTANT_MODEL` | Optional locally; OIDC on Vercel |
| `NEXT_PUBLIC_MAP_TILE_URL` | Optional |
