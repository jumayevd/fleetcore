"use client";

import dynamic from "next/dynamic";
import { usePathname } from "next/navigation";
import { useState, useSyncExternalStore } from "react";
import { LoaderCircle, Sparkles } from "lucide-react";
import { cn } from "@/components/ui";
import { ASSISTANT_DOCK, readOpen, subscribeOpen, writeOpen } from "./open-store";

// The chat (AI SDK, markdown rendering, tool views) is ~90 KB gzipped. It downloads on the first click, not
// with every page; until then a small "opening" card stands where the panel will be.
const AssistantChat = dynamic(() => import("./chat").then((m) => m.AssistantChat), {
  ssr: false,
  loading: () => (
    <div className={cn(ASSISTANT_DOCK, "z-[45]")}>
      <span className="flex items-center gap-2 rounded-lg border border-line bg-overlay px-3 py-2 text-[12px] text-fg-muted shadow-float" aria-label="Opening fleet assistant">
        <LoaderCircle className="h-4 w-4 animate-spin" />Opening the assistant…
      </span>
    </div>
  ),
});

/** The assistant's button in the top bar (app-shell): opens and closes the panel. */
export function AssistantButton() {
  const open = useSyncExternalStore(subscribeOpen, readOpen, () => false);
  return (
    <button id="assistant-toggle" type="button" onClick={() => writeOpen(!open)} aria-label={open ? "Close fleet assistant" : "Open fleet assistant"} aria-expanded={open}
      title="Fleet assistant"
      className={cn("inline-flex h-8 items-center gap-1.5 rounded-md px-2 text-[13px] font-medium text-accent-text transition-colors hover:bg-accent-soft", open && "bg-accent-soft")}>
      <Sparkles className="h-4 w-4" /><span className="hidden md:inline">Assistant</span>
    </button>
  );
}

/**
 * Fleet Assistant panel, mounted once in the app layout; `enabled` is the role's assistant.use permission. Opened from
 * the button in the top bar (AssistantButton). Hidden on print and on /login. Once opened, the chat stays mounted so
 * closing keeps the conversation.
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
  return loaded || open ? <AssistantChat companyId={companyId} userId={userId} /> : null;
}
