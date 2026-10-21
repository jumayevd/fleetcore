"use client";

import dynamic from "next/dynamic";
import { usePathname } from "next/navigation";
import { useState, useSyncExternalStore } from "react";
import { LoaderCircle, Sparkles } from "lucide-react";
import { cn } from "@/components/ui";
import { readOpen, subscribeOpen, writeOpen } from "./open-store";

const BUTTON = "flex h-11 w-11 items-center justify-center rounded-full bg-primary text-on-primary shadow-float transition-[background-color,transform] duration-150 hover:bg-primary-hover active:scale-95";

// The chat (AI SDK, markdown rendering, tool views) is ~90 KB gzipped. It downloads on the first click, not
// with every page; until then a spinner stands in for the launcher.
const AssistantChat = dynamic(() => import("./chat").then((m) => m.AssistantChat), {
  ssr: false,
  loading: () => (
    <div className="fixed bottom-4 right-4 z-[45] print:hidden">
      <span className={cn(BUTTON, "cursor-progress")} aria-label="Opening fleet assistant"><LoaderCircle className="h-5 w-5 animate-spin" /></span>
    </div>
  ),
});

/**
 * Fleet Assistant launcher (bottom-right), mounted once in the app layout; `enabled` is the role's assistant.use
 * permission. Hidden on print and on /login. Once opened, the chat stays mounted so closing keeps the conversation.
 *
 * `companyId` (the active company, `user.company.id`) and `userId` key the conversation: each company keeps its own,
 * and switching company never shows another company's chat. Without them the panel falls back to the workspace cookie
 * read when it first opens, and the API refuses a question whose conversation belongs to another company.
 */
export function AssistantLauncher({ enabled, companyId, userId }: { enabled: boolean; companyId?: string; userId?: string }) {
  const path = usePathname();
  const open = useSyncExternalStore(subscribeOpen, readOpen, () => false);
  const [loaded, setLoaded] = useState(false);
  // Derived state: the first time the panel is open (click or restored from the session), keep the chat loaded.
  if (open && !loaded) setLoaded(true);
  if (!enabled || path === "/login" || path.startsWith("/login/")) return null;
  if (loaded || open) return <AssistantChat companyId={companyId} userId={userId} />;
  return (
    <div className="fixed bottom-4 right-4 z-[45] print:hidden">
      <button type="button" onClick={() => writeOpen(true)} aria-label="Open fleet assistant" title="Fleet assistant" className={BUTTON}>
        <Sparkles className="h-5 w-5" />
      </button>
    </div>
  );
}
