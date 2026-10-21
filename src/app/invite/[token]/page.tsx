import Link from "next/link";
import { rootDb } from "@/lib/db-root";
import { getSessionContext, listWorkspaces } from "@/lib/session";
import { ROLE_HINTS, ROLE_LABELS, isRole } from "@/lib/constants";
import { LinkButton } from "@/components/ui";
import { CompanyBadge } from "@/components/workspace-switcher";
import { AuthCard, AuthFrame } from "../../login/frame";
import { AcceptInviteButton } from "../../select/forms";

export const metadata = { title: "Invitation" };

/**
 * An invitation link. Signed in with the invited email → one click to join. Otherwise: sign in (or create an account)
 * with that email; the invite travels along and is accepted on the way in.
 */
export default async function InvitePage({ params }: PageProps<"/invite/[token]">) {
  const { token } = await params;
  const [invite, ctx] = await Promise.all([
    rootDb.invite.findUnique({ where: { token }, include: { company: { select: { name: true, color: true } }, invitedBy: { select: { name: true } } } }),
    getSessionContext(),
  ]);
  const usable = invite && !invite.acceptedAt && invite.expiresAt > new Date() ? invite : null;

  if (!usable) {
    return (
      <AuthFrame>
        <AuthCard title="This invitation can't be used" subtitle="It has expired, was withdrawn, or has already been accepted.">
          <p className="mt-4 text-[13px] text-fg-muted">Ask the person who invited you for a new link. If you already joined, just sign in.</p>
          <div className="mt-5 flex gap-2">
            <LinkButton href="/login">Sign in</LinkButton>
            <LinkButton href="/signup" variant="secondary">Create an account</LinkButton>
          </div>
        </AuthCard>
      </AuthFrame>
    );
  }

  const accounts = await listWorkspaces(ctx.accounts);
  const match = accounts.find((a) => a.email.toLowerCase() === usable.email.toLowerCase());
  const already = match?.companies.some((c) => c.id === usable.companyId);
  const role = isRole(usable.role) ? usable.role : "SPECIALIST";
  const q = `invite=${encodeURIComponent(usable.token)}`;

  return (
    <AuthFrame>
      <AuthCard title={`Join ${usable.company.name}`}
        subtitle={<>{usable.invitedBy?.name ?? "A member"} invited <span className="font-medium text-fg">{usable.email}</span>.</>}>
        <div className="mt-5 flex items-center gap-3 rounded-lg bg-raised p-3 ring-1 ring-inset ring-line">
          <CompanyBadge name={usable.company.name} color={usable.company.color} size={40} />
          <div className="min-w-0">
            <p className="truncate text-[14px] font-semibold text-fg">{usable.company.name}</p>
            <p className="text-[12px] text-fg-muted">{ROLE_LABELS[role]} · {ROLE_HINTS[role].toLowerCase()}</p>
          </div>
        </div>
        {match ? (
          already ? (
            <div className="mt-5 space-y-3">
              <p className="text-[13px] text-fg-muted">{match.email} is already a member of {usable.company.name}.</p>
              <LinkButton href="/select">Open your companies</LinkButton>
            </div>
          ) : (
            <div className="mt-5 flex items-center justify-between gap-3">
              <p className="min-w-0 truncate text-[13px] text-fg-muted">Signed in as {match.email}</p>
              <AcceptInviteButton token={usable.token} userId={match.userId} />
            </div>
          )
        ) : (
          <div className="mt-5 space-y-3">
            <p className="text-[13px] text-fg-muted">
              {accounts.length
                ? <>You&apos;re signed in as {accounts.map((a) => a.email).join(", ")}. Add the invited account to accept — your other accounts stay signed in.</>
                : "Sign in with this email, or create your account if you're new to FleetCore."}
            </p>
            <div className="flex flex-wrap gap-2">
              <LinkButton href={`/login?add=1&${q}`}>{accounts.length ? `Sign in as ${usable.email}` : "Sign in and join"}</LinkButton>
              <LinkButton href={`/signup?${q}`} variant="secondary">Create an account</LinkButton>
            </div>
          </div>
        )}
        <p className="mt-5 border-t border-line pt-4 text-[11px] text-fg-subtle">
          Expires {usable.expiresAt.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}. Not expecting this? You can ignore it. <Link href="/login" className="hover:underline">Sign in</Link>
        </p>
      </AuthCard>
    </AuthFrame>
  );
}
