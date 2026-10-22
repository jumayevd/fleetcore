import Link from "next/link";
import { redirect } from "next/navigation";
import type { ReactNode } from "react";
import { CalendarPlus, Droplet, X } from "lucide-react";
import { requireUser } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { db } from "@/lib/db";
import { getFormat } from "@/lib/format-server";
import { OIL_DUE_SOON, roLabel, serviceStatus, SERVICE_STATE_LABELS, STALE_READING_DAYS, type ServiceState } from "@/lib/service";
import { Card, Field, Input, LinkButton, PageHeader, Stat, Table, Textarea, buttonClass } from "@/components/ui";
import { ActionForm, SubmitButton } from "@/components/forms";
import { VendorPicker } from "@/components/shop/vendor-picker";
import { OIL_SERVICE_TYPES } from "@/components/shop/shared";
import { bookOilChange } from "@/app/actions/oil";
import { oilHref, readingsHref, workOrderHref } from "../_lib/links";
import { str } from "../_lib/data";
import { vendorOptions } from "../_lib/repairs";
import { SearchBox } from "../_components/search-box";
import { OilLogForm } from "../_components/oil-log-form";
import { TruckTypesDialog } from "../_components/oil-types";
import { OilRow } from "../_components/oil-row";

export const metadata = { title: "Oil & PM" };

const VIEWS = ["all", "overdue", "due", "ok", "stale", "unknown"] as const;
type View = (typeof VIEWS)[number];
const VIEW_STATES: Record<View, ServiceState[] | null> = {
  all: null, overdue: ["overdue"], due: ["due_now", "due_soon"], ok: ["ok"], stale: ["no_reading"], unknown: ["unknown"],
};
/** Worst first. */
const RANK: Record<ServiceState, number> = { overdue: 0, due_now: 1, due_soon: 2, no_reading: 3, ok: 4, unknown: 5 };

/**
 * Oil & PM board: every truck in service by its oil change, worst first. Editors type each truck's shop and the
 * odometer of its last oil change into the row (see OilRow). `view` filters (overdue, due, ok, stale, unknown), `q`
 * searches unit / driver, `log=1[&truck=]` opens "Log oil change", `book=<truckId>` opens a booking (the Today page
 * links there), `reading=<truckId>` goes to that truck's readings.
 */
export default async function OilBoard({ searchParams }: PageProps<"/maintenance/oil">) {
  const user = await requireUser("fleet.view");
  const sp = await searchParams;
  const reading = str(sp.reading);
  if (reading) redirect(readingsHref(reading));
  const editable = can(user.role, "fleet.edit");
  const money = can(user.role, "money.view");
  const f = await getFormat();
  const rawView = str(sp.view) ?? str(sp.show);
  const view: View = rawView && (VIEWS as readonly string[]).includes(rawView) ? (rawView as View) : "all";
  const q = str(sp.q)?.toLowerCase();
  const logOpen = editable && str(sp.log) === "1";
  const bookId = editable ? str(sp.book) : undefined;
  const now = new Date();

  const [trucks, open, types, vendors] = await Promise.all([
    db.truck.findMany({
      where: { status: { not: "INACTIVE" } }, orderBy: { unitNumber: "asc" },
      include: { truckType: true, driver: { select: { id: true, name: true } } },
    }),
    db.workOrder.findMany({
      where: { truckId: { not: null }, status: { in: ["DRAFT", "OPEN", "IN_PROGRESS"] }, voidedAt: null, OR: [{ repairType: { in: [...OIL_SERVICE_TYPES] } }, { repairType: "REPAIR", category: "PM" }] },
      orderBy: { scheduledAt: "asc" },
      select: { id: true, number: true, status: true, scheduledAt: true, truckId: true, vendor: true, vendorRef: { select: { id: true, name: true } } },
    }),
    db.truckType.findMany({ orderBy: { name: "asc" }, include: { _count: { select: { trucks: true } } } }),
    editable && (logOpen || bookId) ? vendorOptions() : Promise.resolve([]),
  ]);
  const bookedBy = new Map<string, (typeof open)[number]>();
  for (const w of open) if (w.truckId && !bookedBy.has(w.truckId)) bookedBy.set(w.truckId, w);

  const all = trucks
    .map((t) => ({ t, s: serviceStatus(t, now), booked: bookedBy.get(t.id) ?? null }))
    .sort((a, b) => RANK[a.s.state] - RANK[b.s.state] || (a.s.left ?? Infinity) - (b.s.left ?? Infinity) || a.t.unitNumber.localeCompare(b.t.unitNumber));
  const count = (v: View) => (VIEW_STATES[v] ? all.filter((r) => VIEW_STATES[v]!.includes(r.s.state)).length : all.length);
  const rows = all
    .filter((r) => !VIEW_STATES[view] || VIEW_STATES[view]!.includes(r.s.state))
    .filter((r) => !q || r.t.unitNumber.toLowerCase().includes(q) || r.t.driver?.name.toLowerCase().includes(q) || r.t.truckType?.name.toLowerCase().includes(q));
  const overdueBy = all.filter((r) => r.s.state === "overdue").reduce((a, r) => a + -(r.s.left ?? 0), 0);
  const keep = { view: view === "all" ? undefined : view, q: str(sp.q) };
  const closeHref = oilHref(keep);
  const typeOptions = types.map((t) => ({ id: t.id, name: t.name, oilIntervalKm: t.oilIntervalKm, trucks: t._count.trucks }));
  const bookRow = bookId ? all.find((r) => r.t.id === bookId) : undefined;

  const tile = (v: View, node: ReactNode) => (
    <Link href={oilHref({ ...keep, view: v === "all" ? undefined : v })} aria-current={view === v ? "true" : undefined}
      className="block rounded-lg transition-shadow hover:shadow-lift aria-[current=true]:ring-2 aria-[current=true]:ring-accent/40">{node}</Link>
  );

  return (
    <>
      <PageHeader
        title="Oil & PM"
        subtitle={`Oil changes by odometer. Intervals come from the truck type, else the truck's own. A reading older than ${STALE_READING_DAYS} days is a lower bound.`}
        actions={
          <>
            <TruckTypesDialog types={typeOptions} editable={editable} />
            {editable && <LinkButton href={oilHref({ ...keep, log: 1 })}><Droplet />Log oil change</LinkButton>}
          </>
        }
      />

      {logOpen && (
        <Card className="mb-4" title="Log oil change" icon={<Droplet />}
          actions={<Link href={closeHref} aria-label="Close" className={buttonClass("ghost", "sm")}><X /></Link>}>
          <OilLogForm
            trucks={all.map(({ t }) => ({ id: t.id, unitNumber: t.unitNumber, detail: `${t.make} ${t.model}${t.driver ? ` · ${t.driver.name}` : ""}`, odometerKm: t.odometerKm, odometerAt: t.odometerAt?.toISOString() ?? null, lastPmKm: t.lastPmKm }))}
            vendors={vendors} money={money} now={f.dateTimeInput(now)} defaultTruckId={str(sp.truck) ?? null} cancelHref={closeHref} />
        </Card>
      )}

      {bookId && (
        <Card className="mb-4" title={bookRow ? `Book an oil change for ${bookRow.t.unitNumber}` : "Book an oil change"} icon={<CalendarPlus />}
          actions={<Link href={closeHref} aria-label="Close" className={buttonClass("ghost", "sm")}><X /></Link>}>
          {!bookRow ? (
            <p className="text-[13px] text-fg-muted">That truck is not on the board (it may be inactive or removed). Pick another one below.</p>
          ) : bookRow.booked ? (
            <p className="text-[13px] text-fg-muted">
              Already booked: <Link href={workOrderHref(bookRow.booked.id)} className="num font-medium text-fg hover:underline">{roLabel(bookRow.booked.number)}</Link> for {f.date(bookRow.booked.scheduledAt)}
              {bookRow.booked.vendorRef ? ` at ${bookRow.booked.vendorRef.name}` : bookRow.booked.vendor ? ` at ${bookRow.booked.vendor}` : ""}.
            </p>
          ) : (
            <ActionForm action={bookOilChange} className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 lg:items-end">
              <input type="hidden" name="truckId" value={bookRow.t.id} />
              <p className="text-[12px] text-fg-muted sm:col-span-2 lg:col-span-4">
                {statusLine(bookRow.s, f)}{bookRow.t.driver ? ` · ${bookRow.t.driver.name}` : ""}
              </p>
              <Field label="Booked for" required><Input type="date" name="scheduledAt" required defaultValue={f.dateInput(now)} min={f.dateInput(now)} className="num" /></Field>
              <div className="lg:col-span-2">
                <span className="mb-1 block text-[12px] font-medium text-fg-muted">Shop</span>
                {/* The shop typed on the board carries over; pick a vendor to link it properly. */}
                <VendorPicker vendors={vendors} legacyName={bookRow.t.oilShop} />
              </div>
              <Field label="Promised back"><Input type="date" name="promisedAt" min={f.dateInput(now)} className="num" /></Field>
              <Field label="Note for the shop" className="sm:col-span-2 lg:col-span-3"><Textarea name="description" rows={1} placeholder="Anything else to look at while it is in" /></Field>
              <SubmitButton pendingText="Booking…">Book oil change</SubmitButton>
            </ActionForm>
          )}
        </Card>
      )}

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        {tile("overdue", <Stat label="Overdue" value={count("overdue")} tone={count("overdue") ? "danger" : "ok"} hint={count("overdue") ? `${f.dist(overdueBy)} past due in total` : "no truck past its interval"} />)}
        {tile("due", <Stat label={`Due within ${f.dist(OIL_DUE_SOON)}`} value={count("due")} tone={count("due") ? "warn" : "neutral"} hint="book the shop this week" />)}
        {tile("ok", <Stat label="On schedule" value={count("ok")} tone="ok" hint="fresh reading, plenty left" />)}
        {tile("stale", <Stat label="No recent reading" value={count("stale")} tone={count("stale") ? "info" : "neutral"} hint={`odometer older than ${STALE_READING_DAYS} days: get a reading`} />)}
        {tile("all", <Stat label="All trucks" value={all.length} hint={count("unknown") ? `${count("unknown")} with no oil change recorded` : "every truck has a last oil change"} />)}
      </div>

      <Card className="mt-4" flush>
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-4 py-3">
          <p className="text-[13px] font-medium text-fg">
            {view === "all" ? "Every truck in service" : view === "unknown" ? "No oil change recorded" : SERVICE_STATE_LABELS[VIEW_STATES[view]![0]]}
            <span className="num ml-2 font-normal text-fg-subtle">{rows.length}</span>
            {view !== "all" && <Link href={oilHref({ q: str(sp.q) })} className="ml-3 text-[12px] font-normal text-fg-muted hover:text-fg">Show all</Link>}
            {view === "all" && count("unknown") > 0 && <Link href={oilHref({ view: "unknown" })} className="ml-3 text-[12px] font-normal text-fg-muted hover:text-fg">{count("unknown")} with no oil change recorded</Link>}
          </p>
          <SearchBox action="/maintenance/oil" q={str(sp.q)} keep={keep} placeholder="Search unit, driver, type" />
        </div>
        {/* Editors type the shop and the last oil change straight into the row; the row works out the rest. */}
        <Table head={["Unit", "Odometer", "Interval", "Used", "Due at", "Status", "Shop", "Last change"]} empty={rows.length === 0}
          emptyTitle={all.length ? "Nothing matches" : "No trucks in service"}
          emptyDescription={all.length ? "Clear the search or pick another tile." : "Trucks appear here once they are added to the fleet."}>
          {rows.map(({ t, booked }) => (
            // Keyed by the saved values, so a row starts fresh from the server after each save.
            <OilRow key={`${t.id}:${t.lastPmKm ?? ""}:${t.oilShop ?? ""}:${t.odometerKm}`} editable={editable} highlighted={bookId === t.id}
              now={now.toISOString()} types={typeOptions}
              t={{
                id: t.id, unitNumber: t.unitNumber, driverName: t.driver?.name ?? null,
                odometerKm: t.odometerKm, odometerAt: t.odometerAt?.toISOString() ?? null,
                pmIntervalKm: t.pmIntervalKm, lastPmKm: t.lastPmKm, lastPmAt: t.lastPmAt?.toISOString() ?? null, nextServiceKm: t.nextServiceKm,
                truckTypeId: t.truckTypeId, truckType: t.truckType ? { name: t.truckType.name, oilIntervalKm: t.truckType.oilIntervalKm } : null,
                oilShop: t.oilShop,
                booked: booked ? {
                  id: booked.id, number: booked.number, inShop: booked.status === "IN_PROGRESS", scheduledAt: booked.scheduledAt.toISOString(),
                  vendor: booked.vendorRef ? { id: booked.vendorRef.id, name: booked.vendorRef.name } : null, vendorName: booked.vendor,
                } : null,
              }} />
          ))}
        </Table>
      </Card>
    </>
  );
}

/** "4,043 mi over" · "672 mi left" · "≥ 8,092 mi used as of Sep 24" · "Log the last oil change". */
function statusLine(s: ReturnType<typeof serviceStatus>, f: Awaited<ReturnType<typeof getFormat>>) {
  switch (s.state) {
    case "overdue": return `${f.dist(-(s.left ?? 0))} over${s.stale ? " (at least)" : ""}`;
    case "due_now":
    case "due_soon":
    case "ok": return `${f.dist(s.left)} left`;
    case "no_reading": return s.used != null ? `≥ ${f.dist(s.used)} used${s.readingAt ? ` as of ${f.day(s.readingAt)}` : ""}` : "Get a reading";
    case "unknown": return "No oil change recorded yet";
  }
}
