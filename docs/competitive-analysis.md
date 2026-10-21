# Competitive analysis: NeWay TMS (surveyed 2 Oct 2026)

A working US trucking TMS used daily by a ~200-truck carrier with dispatcher teams. We studied the
feature set and UX. **No data from it is copied** — our demo data is a fictional Uzbek carrier.

## Feature inventory (what they have)

### Shell
- Dark sidebar, grouped: Fleet (Trucks, Maintenance, Work Orders, Trailers) · Operations (Drivers,
  Loads) · Safety (Claims) · Dispatch (Daily Board, Live Map, Prebook Board, Weekly Board, Chat) ·
  Admin (Company) · Me (My Performance). Badges on nav items (e.g. "2" on Maintenance).
- Top bar: page title, announcements bell with count, user chip, sign out.
- "Search anything…" field on boards.
- Floating **Fleet Assistant** (AI chat): "Ask me anything about your trucks & drivers", suggested
  prompts (trucks with no driver, active trucks by make, inactive trucks).

### Daily dispatch board (their home page)
- Spreadsheet grid grouped by **dispatcher team** (collapsible, driver count, "Add driver").
- Columns: Load # (+ "NO REC" flag = no rate confirmation on file), Driver (+ "HOLD" flag),
  Truck #, Trailer #, Phone(s), **Status**, **Active since** (time in current status), ETA,
  Miles, Origin / Delivery (next stop), Notes (free text).
- Status vocabulary: DISPATCHED, COVERED, READY, AT PU, ENROUTE, UNLOADING, STOP, REST, HOME,
  VACATION. Statuses are auto-derived from the load but can be **manually overridden**
  ("Manual override — click to restore automatic value").
- Interactions: cell **fill colour** (select cells, pick colour — dispatchers highlight rows),
  "flat board ordered by status", pick a **date** to see a past/future board, **ELD sync**
  (pull Samsara positions), click column header to select + Ctrl+C copies the column,
  right-click → edit history, hover driver → current GPS location.

### Live map
- Leaflet map + card list. Filters: Rolling / Idle / Stopped; On a load / Unassigned. Counts.
- Card: unit, driver, speed, reverse-geocoded location, **fuel %**, GPS fix age ("fix 596h old").

### Prebook board
- Loads whose pickup is > 24 h away. Team filter, assigned/unassigned filter, "Run activation".
  Reserving a driver here doesn't occupy them today; load auto-moves to Daily/Weekly within 24 h.

### Weekly production board
- Week picker (years back). **Goal: $10k solo / $15k team per week.**
- Per team (collapsible, totals, avg/truck) → per driver: rows Amount / Miles / RPM / Load # for
  each weekday; columns Total $, Total mi, Avg RPM, Plan reach, Plan adj, Days worked,
  **Efficiency %** (= total / goal). Grand total. Driver type tags: OO (owner-operator), OO/C,
  C (company), LO (lease-operator). Cell fill colour. Report export.

### Loads
- KPIs: total loads, total revenue, avg rate, **avg RPM** (revenue per mile).
- Statuses: Booked, Dispatched, In transit, Delivered, Cancelled, **TONU** (truck ordered, not used).
- Table: Load #, **Broker**, Status, Origin, Destination, PU date, DEL date, Driver, Truck,
  Customer, Rate, **Loaded mi, Empty mi, Total, RPM**.
- Row actions: View/Documents, Edit, **File a claim on this load**, **Recover → move to another
  unit**, Delete.
- Add Load: Load/Trip #, Status, Broker (typeahead), Customer reference #, Driver (typeahead),
  Truck, Dispatcher team, Trailer, **Stops (n)** each PICKUP/DELIVERY + city typeahead + state +
  datetime, "+ Add stop"; Rate, Loaded miles, Empty miles, Reefer.
- Load detail: status **stepper** (Booked → Dispatched → At pickup → In transit → Delivered →
  Completed) with timestamps; origin → destination header with Rate / Miles / RPM; map of stops
  ("Fix stop location"); stops list with appointment + DONE; **documents checklist** (RC, BOL,
  POD; "missing"); notes; broker; **financials** (rate, invoice #, billing stage e.g.
  "MISSING DOCS", paperwork status); assignment (driver with type + phone, truck, trailer);
  **activity feed** with tabs All / Status / Edits / Documents / Billing.

### Trucks
- KPIs: total, active, inactive, maint due soon, maint overdue, non-company.
- Table: unit, status, live location, odometer, mileage-based PM status, date-based PM status,
  recent notes.
- Detail: header (unit, status, year make model, VIN); actions Work order / Files / Edit /
  Set inactive; tabs **Overview / Maintenance / Specs / Financial / Compliance / Loads**;
  sections: essential info, fleet & company assignment (company, owner, fleet id, asset tag,
  driver), location (GPS provider, device id, coords, last update), **telematics** (miles,
  fuel %, engine state, speed, MPG, odometer updated), activity log with notes.

### Maintenance (tabs)
- **Expense summary**: period Week/Month/Quarter/Year; total spend, **cost per mile**, open
  vehicles (in shop), avg per vehicle, inactive trucks, **lease overage exposure**; top vendors;
  spend by category; "which parts give us trouble" (frequency ranking); vehicle spend breakdown;
  **anomaly detection** (critical/high/medium/low).
- **Repair log**: records, spend, still open, days in shop; categories PM / Engine & drivetrain /
  Cooling / Tires / Brakes / Electrical / Body-accident / Towing / Other; table unit, category,
  what, vendor, in, out, days, cost, status, logged by.
- **Oil change / PM**: groups by company/lessor; overdue / due soon counts; per unit: last PM
  date + mileage, current mileage, PM interval, next service, **miles left** (negative = overdue),
  amount, shop.
- **Mileage control** (leased units): lessor, lease start mileage, current, allowed, annual
  limit, buffer %, hard cap, overage $/mi, remaining, **penalty exposure $**.
- **In shop**: unit, reason, since, duration.
- **Documents**: compliance per unit (Insurance/COI, Registration, Annual inspection) → expired /
  expiring / missing, responsible dept, renew/upload.

### Work orders
- WO #, title, status (Draft/…/Completed), priority, vehicle, vendor, created, total.

### Trailers
- KPIs: total, in use, empty, dropped, shop, out of service, docs expired, docs missing.
- Status set: In use / Empty / Dropped / Yard / Shop / Out of service (+ "since" date), inline
  status change. Columns: unit, paired truck, type, status, location, GPS provider, driver,
  documents (n missing), doc owner, upload.

### Drivers
- KPIs: total, active, at risk, total loads. Filters: at-risk only, show inactive.
- Table: name (+HOLD), **score** (A · 100, "needs review"), status, **team** (inline select),
  truck, phone, loads, revenue, miles, avg rev/load.

### Claims
- Types: cargo damage, cargo loss, late cargo, OS&D, accident/liability, equipment damage,
  injury, other. Statuses: Reported → Under review → Docs collected → Submitted → Negotiation →
  Approved / Denied → Paid → Closed; Disputed; Litigation. Columns: claim #, type, severity,
  status, days open, driver, load #, truck, incident, fault, docs. Analytics tab.

### Company
- Profile (legal name, DBA, MC #, DOT #, EIN, SCAC, phone, email, W-9, addresses, insurance
  agent, factoring company, NOA). Company documents valid/expiring/expired/missing. Broker setup
  packet. SOPs.

### My performance (staff)
- Weekly score A/100 = manager mark 60 % + events 40 %; bonuses/charges; live pay-period
  earnings; last/next payday; 8-week trend; compliance task list.

### Team chat / announcements
- One company room, emoji, images. Announcements via bell.

## UX problems we must not repeat
- Everything shouts: ALL-CAPS names and headers, dense uppercase labels, no hierarchy.
- A `<select>` in every row of long tables (team picker) — slow and noisy.
- Noise over signal: "901 missing documents", "100 trucks overdue" with no triage.
- Inconsistent casing and copy; placeholder/test records visible in production.
- Dispatch board is a raw spreadsheet: horizontal scrolling, tiny type, no row focus state.
- No dark mode, no density control, generic Tailwind-admin look.
- No keyboard-first navigation or global command palette.

## What we take, and do better
| Theirs | Ours |
|---|---|
| Daily board grouped by team | Same grid, but keyboard-navigable, sticky first columns, row drawer, auto status with override + "since" timers, flags (hold, no RC) as quiet chips |
| Status vocabulary | Same vocabulary; auto-derived from multi-stop progress; manual override with history |
| Weekly production board | Same, with goals per driver type, sparklines, CSV export |
| Prebook | Same rule (> 24 h) — surfaced as a tab on dispatch, not a separate page |
| RC/BOL/POD checklist → billing stage | Same, driving a "ready to invoice" queue |
| Claims | Same lifecycle + documents + Telegram alerts |
| Maintenance analytics | Cost per km, vendors, categories, PM board, lease caps, in-shop — with triage not noise |
| Trailer statuses with "since" | Same |
| Fleet Assistant | Same idea, grounded in our data with read-only tools |
| Team chat | Company room + per-load threads; announcements pinned |
| Company profile | Localised (INN, licence, bank details) |
