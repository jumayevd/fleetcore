# FleetCore — for fleet specialists

A workspace for the person who keeps trucks on the road: what needs a decision today, repair orders from the shop
visit to the invoice, oil changes by odometer, the weekly walk-around (pre-trip) video review and the defects it finds,
roadside inspections, expiring paperwork, drivers, fuel and repair costs, and a live map. It started as a copy of the
full FleetOps platform with dispatch, loads, customers, billing, claims and chat taken out, and with **accounts and
companies** added so one specialist can work for several fleets — each in its own units and time zone.

## Live

- Production: **https://fleetcore-uz.vercel.app** (Vercel project `fleetcore`, region `fra1`). Every push to `main` deploys.
- Its own Neon database (`fleetcore-db`) and private Blob store (`fleetcore-docs`); nothing is shared with FleetOps.
- Production holds real companies only (the demo companies and sign-ins were removed on 2026-10-28), so **never run
  the seed against it**. Demo logins are hidden on the sign-in page (`DEMO_MODE=false`); the demo data lives in the
  local database.

## Accounts and companies

- An **account** is a sign-in (email + password). A **company** is one fleet's workspace; it owns every truck, trailer,
  driver, work order, fuel log, document and audit entry. A **membership** gives an account a role in a company.
- One account can belong to many companies (Slack-style), and one browser can be signed in to **several accounts at
  once** (Gmail-style) — useful when a company gives you its own login. **All companies** (the user menu, top right, or
  the company name leading the breadcrumb) lists every signed-in account with its companies; `Alt+1…9` and the command
  palette (`⌘K`) switch too.
- Switching keeps the same page (Trucks stays Trucks) with the other company's data. A browser works in one company at
  a time: if another tab switches, the stale tab stops and asks before anything can be saved to the wrong company.
- Roles are per company: **Owner** (everything, incl. owners and deleting the company), **Admin** (everything except
  owners), **Fleet specialist** (all fleet work), **View only**.
- **Platform owners** run FleetCore itself (`User.platformRole = "OWNER"`, set by an operator only). They belong to no
  company: the **Platform console** (`/platform`) lists every company (size, TrackPro, last activity), every account
  and every open invitation. They can **open** any company and work in it with an owner's rights without being a
  member, so they don't show in its member list; what they do is in its audit log under their name
  (`src/lib/platform.ts`, `resolve()` in `src/lib/session.ts`).
- **Password links** stand in for email resets: the console's "Password link" (or
  `npm run user:password-link -- <email>`) makes a one-time link, valid 3 days, to `/reset/<token>`, where the person
  sets their own password. Only a hash of the token is stored. Making a platform owner:
  `npm run user:password-link -- <email> --create "Full name" --platform-owner` (production: the production
  `DATABASE_URL`, `CONFIRM=yes`, `APP_URL`).
- People join by **invitation link** (Settings → Members → Invite). The link works once, for the invited email; an
  existing account just signs in and accepts. Joining by invitation asks for **first and last name, ID number
  (passport, national ID or employee number) and date of birth**; a member who isn't an owner and has none on file is
  asked once (`/profile`) before working. They are the same in every company, editable in My account, and shown to
  owners and admins under Members (`src/lib/profile.ts`). Nobody in a company can see or reset another person's password
  (platform owners can send a password link, below).
- New here? `/signup` creates the account and its first company; the overview then shows a set-up checklist.

### How data is kept apart

`src/lib/db.ts` exports a Prisma client that scopes **every** query on a company model to the active company: it adds
`companyId` to every `where` (including `findUnique`) and every create, and refuses foreign keys that point at another
company's row. The active company comes from the session (`src/lib/session.ts`): the signed `fo_session` cookie lists
the signed-in accounts; `fo_active` says which account × company this browser works in and is re-checked against the
membership on every request. `rootDb` (`src/lib/db-root.ts`) is unscoped and used only for accounts, memberships,
invites and companies. Raw SQL is not scoped — don't use it for company data.

### Security and backups

- **Password guessing**: 5 wrong passwords for one email within 15 minutes pause sign-in for that email for 15
  minutes, and 30 from one IP address pause that address (`src/lib/login-throttle.ts`, table `LoginThrottle`). While
  paused even the right password is refused; the pause is in the audit log. Emails without an account are counted the
  same way, so a pause doesn't reveal which accounts exist. The current-password check in My account has the same brakes.
- **New password, other devices out**: changing a password (My account, a password link, or
  `scripts/reset-password.mjs`) sets `User.sessionsValidFrom`; sign-ins made before it stop counting everywhere except
  the browser that made the change.
- **Headers** (`next.config.ts`): no framing by other sites, no MIME sniffing, origin-only referrers (invite and
  password links carry tokens), no plugins, no camera / microphone / location APIs. HSTS comes from Vercel.
- **Only `main` deploys**: `vercel.json` turns off automatic deployments for every other branch
  (`git.deploymentEnabled`), and a Preview build never runs migrations, because the Preview environment shares the
  production database. Deploy by hand only with `vercel deploy --prod`.
- **Nightly backup**: `/api/cron/backup` (Vercel Cron, 03:00 UTC, `CRON_SECRET`) writes the whole database as gzipped
  JSON to the private Blob store under `backups/`, keeping 30 days (`src/lib/backup.ts`). Uploaded files are not copied
  (they are in the store already). `npm run db:backup -- list | download [name] | restore <file>` lists them, downloads
  one to `./backups-local/` (gitignored: it holds every company's data), or loads one into an **empty**, migrated
  database (a new Neon branch or a local one), all tables in one transaction.

## Modules

| Module | Highlights |
|---|---|
| **Today** | Eight tiles that each open the filtered page where you act (oil overdue / due, walk-around issues, videos missing, waiting on parts, papers holding dispatch, in the shop, annual DOT inspections due); one "needs a decision" list with a single action per row; who is in the shop; this month's spend |
| **Trucks & trailers** | Status counters, column chooser, next service in distance and ≈days, completeness prompts with one-click fixes, document slots (issued / expires), maintenance, expenses (fuel economy, fuel cost per distance, driver charges), history, readings with "as of" |
| **Repairs** | Repair orders (RO-0001…): stage pipeline with history, downtime clock, job lines by system, who pays (company / driver / investigation / warranty) and "driver told", invoice, void, notes, CSV |
| **Oil & PM** | Truck types with their own oil interval, the board (overdue / due / on schedule / no recent reading), book a shop, log an oil change |
| **Vendors** | Shops, dealers, tire and road service, with their repairs and spend; tidy up free-text shop names |
| **Inspections** | Weekly walk-around board (videos in, to review, nothing sent), component-by-component review, defects with owner and due date — a "fix before next load" defect takes the truck out of service until someone confirms the repair; **DOT inspections** (roadside) with violations and corrections |
| **Drivers** | Cleared to drive, assigned truck, dispatcher, licence and medical expiry, hold, safety score, documents |
| **Live map** | Rolling / idle / stopped / in shop / out of service / no signal, filters, truck details |
| **Reports** | Spend, distance, cost per distance, downtime, repairs by type and system, repeat repairs, driver charges, defects, walk-around compliance, roadside; CSV export |
| **Settings** | Company profile, **region & units**, company documents, members and invitations, audit log, **integrations** (TrackPro ELD) |
| **Fleet assistant** | Ask about the active company's fleet in plain language (Vercel AI Gateway) |

Distances come from odometer readings (fuel fills, repairs, manual readings) — `src/lib/mileage.ts` — since there are
no loads in this product. The oil-change rule is in `src/lib/service.ts`: a reading older than 14 days makes "used" a
lower bound and shows "no recent reading" rather than "on schedule".

### ELD: TrackPro

Settings → Integrations (owners and admins). Paste the carrier's TrackPro integration API token; FleetCore checks it
against TrackPro, stores it encrypted (AES-GCM keyed from `AUTH_SECRET`, `src/lib/secret-box.ts`) and shows only its
last characters. TrackPro's API (https://trackproeld.com/docs) has two versions, and a token may answer on either:
version 2 (`GET https://api.trackproeld.com/logger/integrations/access/trucks`) is asked first, version 1
(`/logger/external/vehicles/current`) when version 2 refuses the token or lists no trucks (`src/lib/eld/trackpro.ts`).
Live tokens answer in a third layout (`truck`, `driver`, `location.vehicle_coordinates`, `fuel_level`, `def_level`),
read as well. They give each truck's position, place, direction, time of the fix, the driver logged in and (not version
1) fuel and DEF level, but **no speed and no odometer**. A sync that works but brings in no trucks, or trucks without a
single position, says why on the Integrations page, with the field names TrackPro sent (never values). So
`src/lib/eld/sync.ts`:

- matches ELD vehicles to trucks by VIN, then unit number (leading zeros ignored); a match can be picked by hand;
- writes position, place, heading, fuel and the fix time onto the truck (`pingSource = TRACKPRO`, so the live map treats
  it as a tracker);
- works speed out from the last two fixes, and adds up the straight-line distance between fixes since the truck's last
  odometer reading (`EldUnit.gpsDistance`, shown as "≈ +312 mi by GPS"). It never overwrites the odometer: the oil
  countdown stays on real readings;
- reads TrackPro's zone-less timestamps as UTC or company time, worked out on the first sync (changeable on the page).

A sync runs at most once a minute per company: after any page view (`after()` in the app layout), on each live-map poll
(`/api/fleet`), from "Sync now", and from `/api/cron/eld` (Vercel Cron once a day on the Hobby plan; it needs
`Authorization: Bearer $CRON_SECRET`, so an outside scheduler can call it more often). `TRACKPRO_API_BASE` (default
`https://api.trackproeld.com/logger`) points the client at a stand-in server for local testing.

### Units, time zone and currency

Each company has its own (Settings → Company profile → Region & units): **imperial** (mi, gal, MPG, lb, mph, US dates
and 12-hour times) or **metric** (km, L, L/100 km, kg, km/h), an IANA time zone and a currency. Values are stored in
the company's own units — a column named `odometerKm` holds miles for an imperial company — so only labels and
fuel-economy maths change; switching units offers to convert what is stored. Dates and the walk-around week (Sunday
start for imperial, Monday for metric) follow the company's time zone, and the top bar shows the viewer's own clock
next to the company's. Server code formats with `await getFormat()`, client code with `useFormat()`
(`src/lib/locale.ts`).

## Local development

```bash
npm install
npm run setup      # local PostgreSQL in ./.pgdata on port 5434, migrations, demo data
npm run dev        # http://localhost:3000 — one-click demo logins, password demo1234
```

Demo data (`prisma/seed.ts`): four companies. Silk Road Freight (Chicago area) and Caspian Carriers (Pennsylvania /
New Jersey) are US fleets in miles and US time zones; Nomad Trucking (Fergana valley) is metric on Tashkent time.
**aziza@demo.local** owns Silk Road Freight, is a fleet specialist at Caspian Carriers and has an open invitation to
Turon Logistics; **aziza@nomadtrucking.demo** is the same person's second login for Nomad Trucking. Sign in with one,
then *Add another account* from the user menu (top right) to try switching. Also: owner@demo.local, timur@nomadtrucking.demo,
bekzod@demo.local, viewer@demo.local. All names, shops, phone numbers (555-01xx) and DOT numbers are made up.

| Command | What it does |
|---|---|
| `npm run db:migrate` | Apply pending migrations (`prisma/migrations`) to the local database |
| `npm run db:seed` | Wipe the local database and reload demo data (`DEMO_PASSWORD` to choose the password) |
| `npm run db:stop` | Stop the local PostgreSQL |
| `npx dotenv -e .env.local -- prisma migrate dev --name <change>` | Create a migration after editing the schema |
| `node scripts/dev-cookie.mjs aziza@demo.local "Caspian Carriers"` | Print a Cookie header for smoke-testing pages with curl |

The local cluster uses port **5434** so it can run next to the full platform's (5433).

## Deploying (Vercel project `fleetcore`)

FleetCore has its own database and must not share the full platform's. This is how `fleetcore` was set up (to repeat
it elsewhere):

1. Push this folder to its own repository and create a **new** Vercel project connected to it (`vercel.json` pins the
   framework to Next.js and the region to `fra1`).
2. Add a **new** Neon database from the Vercel Marketplace (sets `DATABASE_URL`, `DATABASE_URL_UNPOOLED`) and a private
   Blob store (`BLOB_READ_WRITE_TOKEN`).
3. Set `AUTH_SECRET` (random 32-byte hex) and `DEMO_MODE=false`; optionally `APP_URL` for invitation links.
4. Deploy. The production build runs `prisma migrate deploy`, which applies `prisma/migrations` (`0_init` onwards).
   Other branches don't deploy (`git.deploymentEnabled`), since Preview shares the production database.
5. Open `/signup` to create the first account and company. Seed demo data into production only on purpose:
   `CONFIRM_SEED=yes` (it wipes the database).

## Architecture

- **Next.js 16 (App Router)**: Server Components, Server Actions, route handlers under `src/app/api`
- **Prisma 6 + PostgreSQL**: `prisma/schema.prisma`; company scope in `src/lib/db.ts`; migrations applied on every production build
- **Vercel Blob (private)** for documents (keys prefixed by company); local `./storage` fallback; seeded documents render a placeholder PDF
- **AI SDK 7** for the assistant; **Leaflet + OpenStreetMap**; **Recharts**
- "Graphite" design system with Day/Night themes: `docs/design-system.md`, kit in `src/components/ui.tsx`
- Brand: the "fleetcore" wordmark (the "o" is a wheel with a purple nut) and the wheel app icon, purple #801AB8 —
  `<Wordmark />` and `<BrandIcon />` in `src/components/brand.tsx`; files for use elsewhere in `public/brand/`
  (wordmark on light and on dark, icon SVG and PNGs); favicon, `icon.svg`, `apple-icon.png` and `manifest.ts` in
  `src/app/`

## Environment variables

| Name | Source |
|---|---|
| `DATABASE_URL`, `DATABASE_URL_UNPOOLED` | Neon integration of this project; local cluster (`.env.local`) |
| `BLOB_READ_WRITE_TOKEN` | Blob store of this project |
| `AUTH_SECRET` | Random 32-byte hex (also keys the encrypted ELD tokens: changing it means pasting them again) |
| `CRON_SECRET` | Random; Vercel Cron sends it to `/api/cron/eld` and `/api/cron/backup` |
| `DEMO_MODE` | `true` locally, `false` in production |
| `APP_URL` | Optional, base URL for invitation links |
| `AI_GATEWAY_API_KEY`, `ASSISTANT_MODEL` | Optional locally; OIDC on Vercel |
| `NEXT_PUBLIC_MAP_TILE_URL`, `NEXT_PUBLIC_MAP_SATELLITE_URL` | Optional (street map; satellite imagery, Esri by default) |
