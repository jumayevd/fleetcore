import Link from "next/link";
import { notFound } from "next/navigation";
import { endOfDay } from "date-fns";
import { getCurrentUser, requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { CLAIM_TYPE_LABELS } from "@/lib/constants";
import { toLocalInput } from "@/lib/format";
import { saveClaim } from "@/app/actions/claims";
import { Badge, PageHeader } from "@/components/ui";
import { ClaimForm } from "../../claim-form";
import { claimFormOptions } from "../../options";
import { allowedClaimTransitions, claimStatusLabel, type ClaimDefaults, type ClaimStatus } from "../../shared";

export async function generateMetadata({ params }: PageProps<"/claims/[id]/edit">) {
  if (!(await getCurrentUser())) return {};
  const c = await db.claim.findUnique({ where: { id: (await params).id }, select: { number: true } });
  return { title: c ? `Edit ${c.number}` : "Not found" };
}

export default async function EditClaimPage({ params }: PageProps<"/claims/[id]/edit">) {
  await requireUser("claims.edit");
  const { id } = await params;
  const claim = await db.claim.findUnique({ where: { id } });
  if (!claim) notFound();
  const options = await claimFormOptions(claim);
  const defaults: ClaimDefaults = {
    type: claim.type, severity: claim.severity, fault: claim.fault, status: claim.status,
    incidentAt: toLocalInput(claim.incidentAt), location: claim.location, description: claim.description,
    amountClaimed: claim.amountClaimed, amountSettled: claim.amountSettled,
    loadId: claim.loadId, driverId: claim.driverId, truckId: claim.truckId, trailerId: claim.trailerId, customerId: claim.customerId, assignedToId: claim.assignedToId,
  };
  const statusOptions: ClaimStatus[] = [claim.status as ClaimStatus, ...allowedClaimTransitions(claim.status)];

  return (
    <>
      <PageHeader
        eyebrow={<><Link href="/claims" className="hover:text-fg">Claims</Link> / <Link href={`/claims/${id}`} className="num hover:text-fg">{claim.number}</Link></>}
        title={<span className="flex flex-wrap items-center gap-2">Edit <span className="num">{claim.number}</span><Badge value={claim.status} label={claimStatusLabel(claim.status)} dot /></span>}
        subtitle={`${CLAIM_TYPE_LABELS[claim.type] ?? claim.type} · changes are written to the audit log and the team is told when the status moves.`}
      />
      <ClaimForm action={saveClaim.bind(null, id)} options={options} defaults={defaults} mode="edit" statusOptions={statusOptions} cancelHref={`/claims/${id}`}
        maxIncident={toLocalInput(endOfDay(new Date()))} />
    </>
  );
}
