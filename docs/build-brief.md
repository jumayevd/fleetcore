# Build brief for module agents

You are building one module of **FleetOps**, a trucking TMS (Next.js 16 App Router, React 19, Prisma 6 +
Postgres, Tailwind v4). Read these first, in order:

1. `docs/design-system.md` — tokens, components, rules. **Tokens only** (no `slate-*`, `bg-white`, hex).
2. `src/components/ui.tsx` — the kit. Use it; extend it only by adding to it if truly missing (coordinate: prefer local components in your module folder).
3. `docs/competitive-analysis.md` — what the competitor does and how we do it better.
4. `prisma/schema.prisma` — the data model (frozen: **do not edit the schema or run migrations**). `AppSetting` key/values are fine for small settings.
5. `src/lib/constants.ts`, `src/lib/permissions.ts`, `src/lib/workflow.ts`, `src/lib/telemetry.ts`, `src/lib/alerts.ts`, `src/lib/stats.ts`, `src/lib/documents.ts` — shared logic. Reuse, don't duplicate.
6. The relevant files in `src/app/actions/*` — server actions already exist for loads, fleet (trucks, trailers, work orders), people (drivers, teams, customers, users), driver portal, documents, finance, telegram, auth. Add new action files only for your module.

## Hard rules

- **Only touch the files/folders assigned to you.** Other agents work in parallel in the same checkout. Never edit `ui.tsx`, `app-shell.tsx`, `nav.ts`, `constants.ts`, `permissions.ts`, `schema.prisma`, `seed.ts`, `(app)/layout.tsx`, or another module's files. If you need something there, write it in your module and note it in your report.
- **Don't restart the dev server, don't run seeds or migrations.** A dev server is running at http://localhost:3000 against a local database with demo data.
- Both themes must look right. Use `bg-surface`, `text-fg`, `border-line`, `text-fg-muted`, `bg-raised`, `bg-sunken`, tones via `Badge`/`Chip`/`Stat`. Numbers/IDs/money get the `num` class.
- Compact and professional: 13px tables (`Table`), `PageHeader` with eyebrow + actions, `Card` (`flush` for tables), `Stat` tiles with `delta`/`hint`. Sentence case. No ALL CAPS. No exclamation marks. Empty states say what to do next.
- Server Components by default; client components only for interactivity (`"use client"`, small, in your folder). Forms use `ActionForm` + `SubmitButton` from `src/components/forms.tsx` with the existing server actions (`action.bind(null, id)`).
- Permissions: every page starts with `const user = await requireUser("<perm>")`; hide edit controls with `can(user.role, "...")`.
- Next 16: `params`/`searchParams` are Promises (`await props.params`). Page props type: `PageProps<"/route">` (globally available). Route handlers: `RouteContext<"/api/...">`.
- Money: `money()`/`money2()` from `src/lib/format.ts`; dates `date()`/`dateTime()`/`ago()`; distances `km()`.
- Documents: use `<DocumentsPanel user target={{type, id}} path=... />` from `src/components/documents/panel.tsx` (supports load, truck, trailer, driver, customer, workOrder, claim, company).
- Charts: `src/components/charts.tsx` (theme-aware). Maps: `LeafletMap` from `src/components/map`.

## Verify before you finish (all required)

```bash
npx tsc --noEmit                      # must be 0 errors (ignore errors in files that aren't yours only if pre-existing — report them)
npx eslint <your files>               # must be clean
C=$(node scripts/dev-cookie.mjs owner@demo.local)
curl -s -b "lp_session=$C" -o /tmp/p.html -w '%{http_code}\n' http://localhost:3000/<your-route>   # expect 200
grep -c "Application error\|Unhandled Runtime Error\|__next_error__" /tmp/p.html                   # expect 0
```
Also curl each of your routes as `dispatch@demo.local`, `fleet@demo.local`, `accounting@demo.local`, `driver@demo.local` and confirm the permission behaviour (200 or 307 redirect) matches `permissions.ts`. Check for hardcoded palette classes: `grep -nE "slate-|gray-|zinc-|bg-white|text-white|#[0-9a-fA-F]{3,6}" <your files>` should return nothing except deliberate `text-white` on `bg-danger`/`bg-ok` buttons and chart/marker colours that read tokens.

## Report format (your final message)

Return JSON: `{ "module": "...", "files": [...], "routes": [...], "verified": { "tsc": true, "eslint": true, "curl": { "/route": 200 } }, "notes": "anything the integrator must know", "needs": ["cross-module requests, if any"] }`.

## Lessons from the first run (read these)

- A `"use client"` component must never import a module that has `import "server-only"` (or touches Prisma). Keep pure helpers and shared types in a client-safe file (e.g. `shared.ts`) and import data loaders only from server pages. `import type` is fine.
- Server components cannot pass **functions** to client components (`format={money}` crashes at runtime). Chart components accept preset names instead: `format="money" | "moneyCompact" | "compact" | "number" | "percent" | "km"`. Pre-format strings (`total={fmtMoneyCompact(x)}` from `@/lib/format`) where a label is needed.
- `fmtCompact` / `fmtMoneyCompact` live in `src/lib/format.ts` (server-safe); `charts.tsx` re-exports them for client code.
- Turbopack treats a syntax error in any imported file as a build failure for every route that imports it: run `npx tsc --noEmit` *and* curl your routes after every substantial change, not only at the end.
- Mixing `??` with `||` needs parentheses.
