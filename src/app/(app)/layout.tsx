import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { after } from "next/server";
import { syncCompanyEld } from "@/lib/eld/sync";
import { requireUser } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { getSessionContext, listWorkspaces } from "@/lib/session";
import { NAV_COOKIE } from "@/lib/nav";
import { normalizeLocale } from "@/lib/locale";
import { AppShell } from "@/components/app-shell";
import { AssistantLauncher } from "@/components/assistant/launcher";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  // Members who aren't owners give their personal details once before they work here.
  if (user.role !== "OWNER" && !user.profileComplete) redirect("/profile");
  const [{ accounts }, jar] = await Promise.all([getSessionContext(), cookies()]);
  const workspaces = await listWorkspaces(accounts);
  const navOpen = jar.get(NAV_COOKIE)?.value !== "rail";
  const active = { userId: user.id, companyId: user.company.id, companyName: user.company.name, color: user.company.color, role: user.role, email: user.email };
  // ELD positions refresh while people use the app: at most once a minute per company, after the page is sent.
  const companyId = user.company.id;
  after(() => syncCompanyEld(companyId).catch((e) => console.error("eld sync failed", e)));

  return (
    // Keyed by company: switching company remounts the shell, so no state (open menus, drafts) crosses over.
    // The bell and nav counts load in the browser (GET /api/shell), so they never hold up or race the page.
    <AppShell key={active.companyId + active.userId} user={{ name: user.name, email: user.email, role: user.role }} active={active} accounts={workspaces} locale={normalizeLocale(user.company)}
      navOpen={navOpen}>
      {user.platform && (
        <div className="mb-4 flex flex-wrap items-center justify-between gap-2 rounded-lg bg-accent-soft px-3 py-2 text-[12.5px] text-accent-text">
          <span>You&apos;re in {user.company.name} as platform owner, with an owner&apos;s rights. You aren&apos;t a member, and what you change is in its audit log.</span>
          <Link href="/platform" className="inline-flex items-center gap-1 font-medium hover:underline"><ArrowLeft className="h-3.5 w-3.5" />Platform console</Link>
        </div>
      )}
      {children}
      {/* One conversation per account × company: switching company never shows another company's chat. */}
      <AssistantLauncher enabled={can(user.role, "assistant.use")} companyId={user.company.id} userId={user.id} />
    </AppShell>
  );
}
