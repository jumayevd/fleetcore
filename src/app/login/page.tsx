import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { rootDb } from "@/lib/db-root";
import { getSessionContext, listWorkspaces } from "@/lib/session";
import { HOME } from "@/lib/permissions";
import { ROLE_LABELS, isRole } from "@/lib/constants";
import { AuthCard, AuthFrame } from "./frame";
import { LoginForm } from "./login-form";

export const metadata = { title: "Sign in" };

const DEMO_ACCOUNTS = [
  { label: "Aziza · 2 companies", hint: "Owner of Silk Road Freight, specialist at Caspian Carriers", email: "aziza@demo.local" },
  { label: "Aziza · Nomad login", hint: "A second login, issued by Nomad Trucking", email: "aziza@nomadtrucking.demo" },
  { label: "Kamron · owner", hint: "Owner of Caspian Carriers", email: "owner@demo.local" },
  { label: "Dilnoza · view only", hint: "Read-only at Silk Road Freight", email: "viewer@demo.local" },
];

const str = (v: string | string[] | undefined) => (typeof v === "string" && v.trim() ? v.trim() : undefined);

export default async function LoginPage({ searchParams }: PageProps<"/login">) {
  const sp = await searchParams;
  const adding = str(sp.add) === "1";
  const token = str(sp.invite);
  const ctx = await getSessionContext();
  if (!adding && !token) {
    if (ctx.active) redirect(HOME);
    if (ctx.accounts.length) redirect("/select");
  }
  const [signedIn, invite] = await Promise.all([
    adding ? listWorkspaces(ctx.accounts) : Promise.resolve([]),
    token ? rootDb.invite.findUnique({ where: { token }, include: { company: { select: { name: true } } } }) : Promise.resolve(null),
  ]);
  const usable = invite && !invite.acceptedAt && invite.expiresAt > new Date() ? invite : null;
  const demo = process.env.DEMO_MODE === "true";
  const signupHref = usable ? `/signup?invite=${encodeURIComponent(usable.token)}` : "/signup";

  const title = usable ? `Join ${usable.company.name}` : adding ? "Add another account" : "Welcome back";
  const subtitle = usable
    ? <>Sign in as <span className="font-medium text-fg">{usable.email}</span> to join as {(isRole(usable.role) ? ROLE_LABELS[usable.role] : usable.role).toLowerCase()}.</>
    : adding
      ? <>Sign in with another email to work with another company&apos;s data. You stay signed in to {signedIn.map((a) => a.email).join(", ") || "your other accounts"}.</>
      : "Sign in to your fleet workspace.";

  return (
    <AuthFrame>
      {(adding || usable) && ctx.accounts.length > 0 && (
        <Link href={ctx.active ? HOME : "/select"} className="mb-4 inline-flex items-center gap-1.5 text-[12px] font-medium text-fg-muted hover:text-fg">
          <ArrowLeft className="h-3.5 w-3.5" />Back to FleetOps
        </Link>
      )}
      <AuthCard title={title} subtitle={subtitle}>
        {token && !usable && (
          <p className="mt-4 rounded-md bg-warn-soft px-3 py-2 text-[12px] text-warn">This invitation link has expired or was already used. Ask for a new one, or sign in normally.</p>
        )}
        <LoginForm
          demoAccounts={demo ? DEMO_ACCOUNTS : []}
          defaultEmail={usable?.email}
          invite={usable?.token}
          submitLabel={adding ? "Add account" : usable ? "Sign in and join" : "Sign in"}
        />
        <p className="mt-5 border-t border-line pt-4 text-[12px] text-fg-muted">
          {usable ? "No FleetOps account for this email yet? " : "New to FleetOps? "}
          <Link href={signupHref} className="font-medium text-accent-text hover:underline">{usable ? "Create one and join" : "Create an account"}</Link>
        </p>
      </AuthCard>
    </AuthFrame>
  );
}
