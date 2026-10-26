import { CheckCircle2, CircleAlert, KeyRound, Plug, RefreshCw } from "lucide-react";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { getFormat } from "@/lib/format-server";
import { ago } from "@/lib/format";
import { PROVIDER } from "@/lib/eld/sync";
import { connectEld, disconnectEld, syncEldNow } from "@/app/actions/eld";
import { ActionForm, SubmitButton } from "@/components/forms";
import { ActionButton } from "@/components/shop/action-button";
import { Badge, Card, Chip, DL, Disclosure, Field, InfoTip, Input, PageHeader, Table } from "@/components/ui";
import { MatchSelect, TimeBasisSelect } from "./controls";

export const metadata = { title: "Integrations" };

/** The token form: used to connect, and to replace a token. */
function TokenForm({ replace }: { replace: boolean }) {
  return (
    <ActionForm action={connectEld} className="space-y-3">
      <Field label="TrackPro API token" required
        hint="FleetCore checks it with TrackPro before saving, stores it encrypted and never shows it again.">
        <Input name="token" type="password" required autoComplete="off" spellCheck={false} placeholder="Paste the token TrackPro gave your company" className="num" />
      </Field>
      <SubmitButton pendingText="Checking with TrackPro…"><KeyRound />{replace ? "Replace token" : "Connect TrackPro"}</SubmitButton>
    </ActionForm>
  );
}

export default async function IntegrationsPage() {
  const me = await requireUser("company.manage");
  const f = await getFormat();
  const [conn, trucks] = await Promise.all([
    db.eldConnection.findFirst({
      where: { provider: PROVIDER },
      include: { units: { orderBy: [{ truckId: { sort: "asc", nulls: "first" } }, { unitNumber: "asc" }], include: { truck: { select: { id: true, unitNumber: true } } } } },
    }),
    db.truck.findMany({ orderBy: { unitNumber: "asc" }, select: { id: true, unitNumber: true } }),
  ]);
  const units = conn?.units ?? [];
  const matched = units.filter((u) => u.truckId).length;
  const linked = new Set(units.map((u) => u.truckId).filter(Boolean));
  const truckOptions = trucks.map((t) => ({ ...t, taken: linked.has(t.id) }));
  const healthy = conn && !conn.lastError;
  const unmatched = units.filter((u) => !u.truckId && u.matchMode === "AUTO").length;

  return (
    <>
      <PageHeader title="Integrations" subtitle={`Live data from the systems ${me.company.name} already uses.`} />

      <Card
        title={<span className="flex items-center gap-2"><Plug className="h-4 w-4 text-fg-muted" />TrackPro ELD</span>}
        actions={conn
          ? (healthy ? <Badge value="ACTIVE" tone="ok" label="Connected" dot /> : <Badge value="ERROR" tone="danger" label="Needs attention" dot />)
          : <Badge value="NONE" tone="neutral" label="Not connected" />}>
        <div className="space-y-4">
          <div className="grid gap-3 text-[12.5px] text-fg-muted sm:grid-cols-2">
            <div>
              <p className="font-medium text-fg">Comes in from TrackPro</p>
              <p>Position, place and heading of every truck, the time of the fix, fuel and DEF level, the driver logged in. Matched to your trucks by VIN, then unit number. Refreshed about every minute while anyone has FleetCore open.</p>
            </div>
            <div>
              <p className="font-medium text-fg">Worked out by FleetCore</p>
              <p>TrackPro&apos;s API sends no speed or odometer. Speed comes from the last two positions; miles driven since the last odometer reading are added up from GPS (straight line, so a little short of the road) and shown with ≈. Oil changes still go by real odometer readings.</p>
            </div>
          </div>

          {!conn && (
            <div className="rounded-md border border-line bg-sunken/40 p-4">
              <p className="mb-3 text-[12.5px] text-fg-muted">
                TrackPro issues the token to your company: ask TrackPro support (support@trackproeld.com) or your TrackPro admin for an <span className="font-medium text-fg">integration API token</span> for your carrier, then paste it here.
              </p>
              <TokenForm replace={false} />
            </div>
          )}

          {conn && (
            <>
              {conn.lastError && (
                <p role="alert" className="flex items-start gap-2 rounded-md bg-danger-soft px-3 py-2 text-[12.5px] text-danger">
                  <CircleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />{conn.lastError}
                </p>
              )}
              <DL cols={3} items={[
                ["Token", <span key="t" className="num">{conn.tokenHint}</span>],
                ["Last sync", conn.lastSyncAt ? <span key="s" title={f.dateTime(conn.lastSyncAt)}>{ago(conn.lastSyncAt)}</span> : "Not yet"],
                ["Last good sync", conn.lastSuccessAt ? <span key="g" className="inline-flex items-center gap-1"><CheckCircle2 className="h-3.5 w-3.5 text-ok" />{f.dateTime(conn.lastSuccessAt)}</span> : "—"],
                ["Trucks in TrackPro", <span key="v" className="num">{conn.vehicles}</span>],
                ["Matched to FleetCore", <span key="m" className="num">{matched} of {units.length}</span>],
                [
                  "TrackPro times read as",
                  <span key="b" className="inline-flex items-center gap-1.5">
                    <TimeBasisSelect value={conn.timeBasis} zone={f.zone()} />
                    <InfoTip>TrackPro sends times without a time zone. The first sync picks the reading that puts the newest position closest to now. Change it if positions look hours old or in the future.</InfoTip>
                  </span>,
                ],
              ]} />
              <div className="flex flex-wrap items-center gap-2">
                <ActionButton action={syncEldNow} variant="primary" size="md" pendingText="Syncing…" showOk><RefreshCw />Sync now</ActionButton>
                <ActionButton action={disconnectEld} variant="ghost" size="md" pendingText="Disconnecting…"
                  confirm="Disconnect TrackPro? The token and the list of ELD vehicles are removed; trucks keep the last position they got.">Disconnect</ActionButton>
              </div>
              <Disclosure title="Replace the token" icon={<KeyRound />}>
                <div className="px-4 pb-4"><TokenForm replace /></div>
              </Disclosure>
            </>
          )}
        </div>
      </Card>

      {conn && (
        <Card className="mt-4" flush title={<span className="flex items-center gap-2">ELD vehicles <span className="num text-[12px] font-normal text-fg-subtle">{units.length}</span></span>}
          actions={unmatched > 0 && <Chip tone="warn">{unmatched} not matched</Chip>}>
          {unmatched > 0 && (
            <p className="border-b border-line px-4 py-2 text-[12px] text-fg-muted">
              A vehicle matches a truck with the same VIN or unit number. Add the missing trucks under Trucks, or pick one here.
            </p>
          )}
          <Table head={["ELD vehicle", "Driver", "Last position", "Fuel · DEF", "Speed", "FleetCore truck"]} empty={units.length === 0}
            emptyTitle="No vehicles yet" emptyDescription="Sync now to load the trucks TrackPro shows for this token.">
            {units.map((u) => (
              <tr key={u.id}>
                <td>
                  <span className="num font-medium text-fg">{u.unitNumber ?? "—"}</span>
                  <p className="truncate text-[11px] text-fg-subtle">{[u.make, u.model].filter(Boolean).join(" ") || "—"}{u.vin ? <> · <span className="num">{u.vin}</span></> : null}</p>
                </td>
                <td className="text-[12.5px]">{u.driverName ?? <span className="text-fg-faint">—</span>}</td>
                <td className="whitespace-nowrap">
                  {u.fixAt ? <span className="num">{f.dateTime(u.fixAt)}</span> : <span className="text-fg-faint">No position</span>}
                  {u.place && <p className="max-w-56 truncate text-[11px] text-fg-subtle">{u.place}</p>}
                </td>
                <td className="num whitespace-nowrap text-[12.5px]">
                  {u.fuelPct != null ? `${Math.round(u.fuelPct)}%` : "—"}<span className="text-fg-subtle"> · {u.defPct != null ? `${Math.round(u.defPct)}%` : "—"}</span>
                </td>
                <td className="num whitespace-nowrap text-[12.5px]">{u.speed != null ? `≈ ${f.speed(u.speed)}` : <span className="text-fg-faint">—</span>}</td>
                <td>
                  <MatchSelect unitId={u.id} value={u.truckId} mode={u.matchMode} trucks={truckOptions} label={`FleetCore truck for ELD unit ${u.unitNumber ?? ""}`} />
                  <p className="mt-0.5 text-[11px] text-fg-subtle">
                    {u.truck ? <>{u.matchMode === "AUTO" ? "Matched" : "Picked"}: <span className="num">{u.truck.unitNumber}</span>{u.gpsDistance > 0 ? ` · ≈ +${f.dist(u.gpsDistance)} by GPS` : ""}</> : u.matchMode === "AUTO" ? "No truck with this VIN or unit number" : "Left out on purpose"}
                  </p>
                </td>
              </tr>
            ))}
          </Table>
        </Card>
      )}
    </>
  );
}
