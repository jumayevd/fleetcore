import { MessageSquare } from "lucide-react";
import { requireUser } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { db } from "@/lib/db";
import { ago, dateTime, toLocalInput } from "@/lib/format";
import { Card, EmptyState, InfoTip, LinkButton, PageHeader, Segmented, cn } from "@/components/ui";
import { AnnouncementForm } from "./form";
import { AnnouncementItem } from "./item";
import { expiresSoon, isExpired, type AnnouncementDTO } from "./shared";

export const metadata = { title: "Announcements" };

/** Most announcements listed at once (pinned first, then newest). */
const LIST_LIMIT = 200;

/** Current = no expiry or expiring later than `now`; the sidebar badge uses the same rule. */
const currentWhere = (now: Date) => ({ OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] });

/**
 * Company announcements: pinned first, then recent; expired ones hidden unless asked for.
 * Everyone with chat.view reads; owner / admin (announcements.manage) post, edit, pin and delete.
 */
export default async function AnnouncementsPage({ searchParams }: PageProps<"/announcements">) {
  const user = await requireUser("chat.view");
  const sp = await searchParams;
  const showExpired = sp.expired === "1";
  const manage = can(user.role, "announcements.manage");
  const loadLinks = can(user.role, "loads.view");

  // Expired rows are only read when asked for; the counts come from the database.
  const now = new Date();
  const [rows, liveCount, expiredCount] = await Promise.all([
    db.announcement.findMany({
      where: showExpired ? {} : currentWhere(now),
      orderBy: [{ pinned: "desc" }, { createdAt: "desc" }],
      take: LIST_LIMIT,
      include: { author: { select: { name: true } } },
    }),
    db.announcement.count({ where: currentWhere(now) }),
    db.announcement.count({ where: { expiresAt: { lte: now } } }),
  ]);
  const at = now.getTime();
  const toDTO = (a: (typeof rows)[number]): AnnouncementDTO => ({
    id: a.id, title: a.title, body: a.body, pinned: a.pinned, author: a.author?.name ?? "Former user",
    createdLabel: dateTime(a.createdAt), agoLabel: ago(a.createdAt),
    expiresInput: toLocalInput(a.expiresAt), expiresLabel: a.expiresAt ? dateTime(a.expiresAt) : null,
    expired: isExpired(a.expiresAt, at), expiresSoon: expiresSoon(a.expiresAt, at),
  });

  const live = rows.filter((a) => !isExpired(a.expiresAt, at));
  const pinned = live.filter((a) => a.pinned).map(toDTO);
  const recent = live.filter((a) => !a.pinned).map(toDTO);
  const old = rows.filter((a) => isExpired(a.expiresAt, at)).sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime()).map(toDTO);
  const groups = [
    { key: "pinned", label: "Pinned", items: pinned },
    { key: "recent", label: "Recent", items: recent },
    { key: "expired", label: "Expired", items: old },
  ].filter((g) => g.items.length);
  const total = pinned.length + recent.length + old.length;
  const available = liveCount + (showExpired ? expiredCount : 0);

  return (
    <>
      <PageHeader
        eyebrow="Team"
        title="Announcements"
        actions={
          <>
            <Segmented active={showExpired ? "all" : "live"} items={[
              { key: "live", href: "/announcements", label: "Current", count: liveCount },
              { key: "all", href: "/announcements?expired=1", label: "Show expired", count: expiredCount },
            ]} />
            <LinkButton href="/chat" variant="secondary"><MessageSquare />Open chat</LinkButton>
          </>
        }
      />

      <div className={cn("grid gap-4", manage ? "xl:grid-cols-[minmax(0,1fr)_360px]" : "max-w-3xl")}>
        <div className="space-y-3">
          {total === 0 ? (
            <Card>
              <EmptyState
                title={showExpired ? "No announcements yet" : "No current announcements"}
                description={manage
                  ? "Post the first one with the form — pin it so it stays at the top for everyone, drivers included."
                  : expiredCount ? "Everything posted so far has expired. Use “Show expired” to read it." : "Nothing to read right now. Pinned announcements show here first when the team posts them."}
              />
            </Card>
          ) : (
            groups.map((g) => (
              <section key={g.key} className="space-y-2" aria-label={g.label}>
                {groups.length > 1 && <p className="eyebrow pt-1">{g.label} <span className="num">{g.items.length}</span></p>}
                {g.items.map((a) => <AnnouncementItem key={a.id} a={a} canManage={manage} loadLinks={loadLinks} />)}
              </section>
            ))
          )}
          {total > 0 && total < available && (
            <p className="px-1 text-[11px] text-fg-subtle">
              Showing the latest <span className="num">{total}</span> of <span className="num">{available}</span> announcements.
            </p>
          )}
        </div>
        {manage && (
          <div className="space-y-4 xl:sticky xl:top-16 xl:self-start">
            <Card title={
              <span className="flex items-center gap-1.5">New announcement
                <InfoTip>Pinned announcements stay at the top and count on the sidebar badge. Set an expiry for anything time-boxed (border queues, shop closures): it leaves the list after that time, so the list stays current without clean-up.</InfoTip>
              </span>
            }>
              <AnnouncementForm />
            </Card>
          </div>
        )}
      </div>
    </>
  );
}
