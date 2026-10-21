import Link from "next/link";
import { rootDb } from "@/lib/db-root";
import { ROLE_LABELS, isRole } from "@/lib/constants";
import { AuthCard, AuthFrame } from "../login/frame";
import { SignupForm } from "./signup-form";

export const metadata = { title: "Create an account" };

export default async function SignupPage({ searchParams }: PageProps<"/signup">) {
  const sp = await searchParams;
  const token = typeof sp.invite === "string" ? sp.invite : undefined;
  const invite = token ? await rootDb.invite.findUnique({ where: { token }, include: { company: { select: { name: true } } } }) : null;
  const usable = invite && !invite.acceptedAt && invite.expiresAt > new Date() ? invite : null;
  const role = usable && isRole(usable.role) ? ROLE_LABELS[usable.role].toLowerCase() : null;

  return (
    <AuthFrame>
      <AuthCard
        title={usable ? `Join ${usable.company.name}` : "Create your account"}
        subtitle={usable
          ? <>You were invited as {role}. Create your FleetOps account for <span className="font-medium text-fg">{usable.email}</span>.</>
          : "Set up your account and your first company. You can add more companies, or join others, any time."}>
        {token && !usable && (
          <p className="mt-4 rounded-md bg-warn-soft px-3 py-2 text-[12px] text-warn">This invitation link has expired or was already used. You can still create an account with your own company.</p>
        )}
        <SignupForm invite={usable ? { token: usable.token, email: usable.email } : null} />
        <p className="mt-5 border-t border-line pt-4 text-[12px] text-fg-muted">
          Already have an account?{" "}
          <Link href={usable ? `/login?invite=${encodeURIComponent(usable.token)}` : "/login"} className="font-medium text-accent-text hover:underline">Sign in</Link>
        </p>
      </AuthCard>
    </AuthFrame>
  );
}
