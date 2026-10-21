"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState, useSyncExternalStore, type FormEvent, type KeyboardEvent, type ReactNode } from "react";
import { Chat, useChat, type UseChatHelpers } from "@ai-sdk/react";
import { DefaultChatTransport, getToolName, isToolUIPart } from "ai";
import { ArrowUp, Check, CircleAlert, CircleMinus, CornerDownLeft, LoaderCircle, RotateCcw, Sparkles, Square, X } from "lucide-react";
import { cn, IconButton, Kbd } from "@/components/ui";
import type { FleetAgentUIMessage } from "@/lib/assistant/agent";
import {
  ASSISTANT_API, MAX_TEXT_CHARS, NOT_CONFIGURED_MESSAGE, assistantChatId, describeAssistantError, dropUnsettledToolCalls,
  parseAssistantInfo, safeInternalHref, toolLabel, type AssistantErrorKind, type AssistantInfo, type AssistantRequestScope, type ToolActivityState,
} from "@/lib/assistant/shared";
import { ACTIVE_COOKIE, parseWorkspaceKey } from "@/lib/workspace-shared";

import { readOpen, subscribeOpen, writeOpen } from "./open-store";

type ChatHelpers = UseChatHelpers<FleetAgentUIMessage>;

/** The account and company a conversation belongs to. */
type Workspace = { companyId: string | null; userId: string | null };

/** The workspace this browser works in, from the fo_active cookie: the fallback when the layout passes no ids. */
function workspaceFromCookie(): Workspace {
  try {
    const raw = document.cookie.split("; ").find((c) => c.startsWith(`${ACTIVE_COOKIE}=`))?.slice(ACTIVE_COOKIE.length + 1);
    const ref = parseWorkspaceKey(raw);
    return { companyId: ref?.companyId ?? null, userId: ref?.userId ?? null };
  } catch {
    return { companyId: null, userId: null };
  }
}

/**
 * Conversations live in memory for the life of the tab, one per account and company, and are never persisted.
 * Switching company shows that company's conversation (empty the first time); switching back restores the old one.
 * Each conversation tells the API which company it belongs to, so a stale one is refused instead of mixing companies.
 */
const chats = new Map<string, Chat<FleetAgentUIMessage>>();
function chatFor(ws: Workspace) {
  const id = assistantChatId(ws.companyId, ws.userId);
  let chat = chats.get(id);
  if (!chat) {
    const scope: AssistantRequestScope = { ...(ws.companyId ? { companyId: ws.companyId } : {}), ...(ws.userId ? { userId: ws.userId } : {}) };
    chat = new Chat<FleetAgentUIMessage>({ id, transport: new DefaultChatTransport({ api: ASSISTANT_API, body: scope }) });
    chats.set(id, chat);
  }
  return chat;
}

/** Fetch GET /api/assistant when the panel opens, once per workspace; null until it answers. */
function useAssistantInfo(open: boolean, key: string) {
  const [state, setState] = useState<{ key: string; info: AssistantInfo } | null>(null);
  const info = state?.key === key ? state.info : null;
  useEffect(() => {
    if (!open || info) return;
    let live = true;
    fetch(ASSISTANT_API, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((body: unknown) => { if (live) setState({ key, info: parseAssistantInfo(body) }); })
      .catch(() => { if (live) setState({ key, info: parseAssistantInfo(null) }); });
    return () => { live = false; };
  }, [open, info, key]);
  return info;
}

/**
 * The chat itself (AI SDK, markdown, tools). Loaded by launcher.tsx only once the panel has been opened, then kept
 * mounted so closing the panel keeps the conversation. Whether the AI Gateway is configured, the active company, and
 * the intro and prompts this role can use, come from GET /api/assistant when the panel opens.
 */
export function AssistantChat({ companyId, userId }: { companyId?: string | null; userId?: string | null }) {
  const open = useSyncExternalStore(subscribeOpen, readOpen, () => false);
  const [fromCookie] = useState(workspaceFromCookie);
  // The layout's ids win (they change when the company does); the cookie, read once, is the fallback.
  const sameAsCookie = companyId != null && fromCookie.companyId === companyId;
  const wsCompany = companyId ?? fromCookie.companyId;
  const wsUser = userId ?? (companyId == null || sameAsCookie ? fromCookie.userId : null);
  const ws = useMemo<Workspace>(() => ({ companyId: wsCompany, userId: wsUser }), [wsCompany, wsUser]);
  const key = assistantChatId(ws.companyId, ws.userId);
  // The conversation lives outside the panel, so closing the panel (or switching company and back) keeps it.
  const instance = useMemo(() => chatFor(ws), [ws]);
  const chat = useChat<FleetAgentUIMessage>({ chat: instance });
  const info = useAssistantInfo(open, key);
  // GET answers for the company this browser works in now; another tab may have switched it since this page loaded.
  const switched = info?.companyId && ws.companyId && info.companyId !== ws.companyId
    ? `This browser now works in ${info.company ?? "another company"}. Reload the page to ask about ${info.company ?? "it"}.`
    : null;
  const launcherRef = useRef<HTMLButtonElement>(null);
  const refocus = useRef(false);

  // Hand focus back to the launcher once the panel has closed (the button remounts when `open` flips).
  useEffect(() => {
    if (open || !refocus.current) return;
    refocus.current = false;
    launcherRef.current?.focus();
  }, [open]);
  const close = () => { refocus.current = true; writeOpen(false); };

  return (
    // Closed, and below lg, it stays under the mobile nav (z-50); page toasts (z-80), menus, dialogs and the
    // command palette (z-90+) sit above it. From lg up the open panel sits above toasts, still under menus and dialogs.
    <div className={cn("fixed bottom-4 right-4 print:hidden", open ? "z-[45] lg:z-[85]" : "z-[45]")}>
      {open ? (
        // Keyed by workspace: a company switch starts from that company's own draft, scroll and stop state.
        <AssistantPanel key={key} chat={chat} info={info} switched={switched} onClose={close} />
      ) : (
        <button ref={launcherRef} type="button" onClick={() => writeOpen(true)} aria-label="Open fleet assistant" title="Fleet assistant"
          className="flex h-11 w-11 items-center justify-center rounded-full bg-primary text-on-primary shadow-float transition-colors hover:bg-primary-hover">
          <Sparkles className="h-5 w-5" />
        </button>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Panel                                                               */
/* ------------------------------------------------------------------ */

const MAX_COMPOSER_PX = 120;
/** Follow new output only while the reader is within this distance of the bottom. */
const STICK_PX = 40;

function AssistantPanel({ chat, info, switched, onClose }: { chat: ChatHelpers; info: AssistantInfo | null; switched: string | null; onClose: () => void }) {
  const { messages, sendMessage, status, error, stop, regenerate, setMessages, clearError } = chat;
  const [input, setInput] = useState("");
  const [stopped, setStopped] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);
  const textRef = useRef<HTMLTextAreaElement>(null);
  const stick = useRef(true);

  const busy = status === "submitted" || status === "streaming";
  const problem: { kind: AssistantErrorKind; message: string } | null = error
    ? describeAssistantError(error)
    : switched ? { kind: "company-changed", message: switched }
      : info?.configured === false ? { kind: "not-configured", message: NOT_CONFIGURED_MESSAGE } : null;
  const blocked = problem?.kind === "not-configured" || problem?.kind === "unauthorised" || problem?.kind === "company-changed";
  // The company this conversation is about; unknown once the browser has moved to another one.
  const company = switched ? null : (info?.company ?? null);
  const last = messages[messages.length - 1];
  // "Thinking…" fills the gap before the first token or tool call of the reply.
  const thinking = busy && !(last?.role === "assistant" && last.parts.some((p) => (p.type === "text" && p.text.trim()) || (isToolUIPart(p) && p.state !== "output-available")));
  // Screen readers hear the finished answer (or the problem), not every streamed token.
  const announcement = busy ? "" : problem ? problem.message : last?.role === "assistant" ? plainText(last.parts.map((p) => (p.type === "text" ? p.text : "")).join("\n")) : "";

  useEffect(() => {
    const el = listRef.current;
    if (el && stick.current) el.scrollTop = el.scrollHeight;
  }, [messages, status, error, stopped, info]);
  const onScroll = () => {
    const el = listRef.current;
    if (el) stick.current = el.scrollHeight - el.scrollTop - el.clientHeight <= STICK_PX;
  };

  const send = (text: string) => {
    const t = text.trim();
    if (!t || busy || blocked) return;
    if (error) clearError();
    setStopped(false);
    stick.current = true;
    void sendMessage({ text: t.slice(0, MAX_TEXT_CHARS) });
    setInput("");
    if (textRef.current) textRef.current.style.height = "auto";
  };
  // A tool call cut off by Stop has no result; resent, it would break every later answer, so it is dropped here
  // (the API drops any that slip through too). Stop aborts first, so no late stream chunk can put it back.
  const halt = () => {
    void stop();
    setMessages((all) => dropUnsettledToolCalls(all));
    setStopped(true);
  };
  const reset = () => { void stop(); setMessages([]); clearError(); setStopped(false); setInput(""); textRef.current?.focus(); };
  const retry = () => { clearError(); setStopped(false); stick.current = true; void regenerate(); };

  const onInput = (e: FormEvent<HTMLTextAreaElement>) => {
    const el = e.currentTarget;
    setInput(el.value);
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, MAX_COMPOSER_PX)}px`;
  };
  const onComposerKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); send(input); }
  };
  // Escape closes the panel only when focus is inside it and nothing nearer handled the key
  // (popovers and the command palette keep their own Escape).
  const onPanelKeyDown = (e: KeyboardEvent<HTMLElement>) => {
    if (e.key === "Escape" && !e.defaultPrevented && !e.nativeEvent.isComposing) { e.preventDefault(); onClose(); }
  };

  return (
    <section role="dialog" aria-label="Fleet assistant" onKeyDown={onPanelKeyDown}
      className="flex h-[560px] max-h-[calc(100dvh-2rem)] w-[380px] max-w-[calc(100vw-2rem)] flex-col overflow-hidden rounded-lg border border-line bg-overlay shadow-float">
      <header className="flex h-11 shrink-0 items-center gap-2 border-b border-line px-3">
        <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-accent-soft text-accent-text"><Sparkles className="h-3.5 w-3.5" /></span>
        <div className="min-w-0 flex-1 leading-tight">
          <h2 className="truncate text-[13px] font-semibold text-fg">Fleet assistant</h2>
          <p className="truncate text-[11px] text-fg-subtle" title={company ?? undefined}>
            {busy ? "Working…" : info?.configured === false ? "Not configured" : company ? `${company} · live fleet data` : "Live fleet data"}
          </p>
        </div>
        {messages.length > 0 && <IconButton label="New conversation" onClick={reset}><RotateCcw /></IconButton>}
        <IconButton label="Close" onClick={onClose}><X /></IconButton>
      </header>

      <div ref={listRef} onScroll={onScroll} className="flex-1 space-y-3 overflow-y-auto px-3 py-3">
        {messages.length === 0 && <Welcome info={info} company={company} disabled={blocked} onPick={send} />}
        {messages.map((m, i) => <MessageView key={m.id} message={m} streaming={busy && i === messages.length - 1 && m.role === "assistant"} />)}
        {thinking && <ActivityLine state="doing" text="Thinking…" />}
        {stopped && !busy && <ActivityLine state="stopped" text="Stopped" />}
        {problem && (
          <div className={cn("flex items-start gap-2 rounded-md border px-3 py-2 text-[12px]",
            problem.kind === "generic" ? "border-danger/30 bg-danger-soft text-danger" : "border-warn/30 bg-warn-soft text-warn")}>
            <CircleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <div className="min-w-0 flex-1">
              <p className="font-medium">{problem.message}</p>
              {problem.kind === "not-configured" && <p className="mt-0.5 opacity-80">Set it in .env.local (or run vercel env pull) and restart the dev server.</p>}
            </div>
            {problem.kind === "generic" && (
              <button type="button" onClick={retry} className="shrink-0 font-medium underline-offset-2 hover:underline">Retry</button>
            )}
            {problem.kind === "company-changed" && (
              <button type="button" onClick={() => window.location.reload()} className="shrink-0 font-medium underline-offset-2 hover:underline">Reload</button>
            )}
          </div>
        )}
      </div>
      <p className="sr-only" role="status" aria-live="polite">{announcement}</p>

      <form onSubmit={(e) => { e.preventDefault(); send(input); }} className="shrink-0 border-t border-line p-2">
        <div className="flex items-end gap-1.5 rounded-md border border-line bg-surface px-2 py-1 transition-colors focus-within:border-accent focus-within:ring-2 focus-within:ring-accent/30">
          <textarea ref={textRef} rows={1} value={input} onChange={onInput} onKeyDown={onComposerKeyDown} autoFocus disabled={blocked} maxLength={MAX_TEXT_CHARS}
            placeholder={blocked ? "Assistant unavailable" : "Ask about the fleet…"} aria-label="Message the fleet assistant"
            className="max-h-[120px] min-h-7 flex-1 resize-none bg-transparent py-1 text-[13px] leading-5 text-fg outline-none placeholder:text-fg-faint disabled:opacity-50" />
          {busy ? (
            <button type="button" onClick={halt} aria-label="Stop" title="Stop"
              className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-line text-fg-muted transition-colors hover:bg-raised hover:text-fg">
              <Square className="h-3 w-3 fill-current" />
            </button>
          ) : (
            <button type="submit" disabled={!input.trim() || blocked} aria-label="Send" title="Send"
              className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-primary text-on-primary transition-colors hover:bg-primary-hover disabled:cursor-not-allowed disabled:opacity-40">
              <ArrowUp className="h-4 w-4" />
            </button>
          )}
        </div>
        <p className="mt-1.5 flex items-center justify-between px-0.5 text-[10px] text-fg-faint">
          <span>Read-only · check figures before acting</span>
          <span className="flex items-center gap-1"><Kbd>↵</Kbd> send · <Kbd>shift ↵</Kbd> newline</span>
        </p>
      </form>
    </section>
  );
}

function Welcome({ info, company, disabled, onPick }: { info: AssistantInfo | null; company: string | null; disabled: boolean; onPick: (text: string) => void }) {
  return (
    <div className="px-0.5 pt-1">
      <p className="text-[13px] font-medium text-fg">{company ? `Ask about ${company}` : "Ask about the fleet"}</p>
      <p className="mt-0.5 text-[12px] leading-snug text-fg-muted">{info?.intro ?? "Answers from live fleet data, with read-only lookups."}</p>
      {info ? (
        info.prompts.length > 0 && (
          <ul className="mt-3 space-y-1">
            {info.prompts.map((p) => (
              <li key={p}>
                <button type="button" onClick={() => onPick(p)} disabled={disabled}
                  className="group flex w-full items-center justify-between gap-2 rounded-md border border-line bg-surface px-2.5 py-1.5 text-left text-[12px] text-fg-muted transition-colors enabled:hover:border-line-strong enabled:hover:bg-raised enabled:hover:text-fg disabled:cursor-not-allowed disabled:opacity-50">
                  <span>{p}</span>
                  <CornerDownLeft className="h-3 w-3 shrink-0 text-fg-faint group-hover:text-fg-subtle" />
                </button>
              </li>
            ))}
          </ul>
        )
      ) : (
        <ul className="mt-3 space-y-1" aria-hidden>
          {[0, 1, 2].map((i) => <li key={i} className="h-[30px] animate-pulse rounded-md border border-line bg-sunken" />)}
        </ul>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Messages                                                            */
/* ------------------------------------------------------------------ */

/** A tool that answered `{ error }` (permission denied or the lookup failed) reads as failed, not done. */
const isErrorOutput = (o: unknown) => typeof o === "object" && o !== null && "error" in o;

function toolState(p: { state: string; output?: unknown }, streaming: boolean): ToolActivityState {
  if (p.state === "output-available") return isErrorOutput(p.output) ? "error" : "done";
  if (p.state === "output-error" || p.state === "output-denied") return "error";
  // Still waiting for a result: spinning while this reply streams, otherwise it was cut off.
  return streaming ? "doing" : "stopped";
}

function MessageView({ message: m, streaming }: { message: FleetAgentUIMessage; streaming: boolean }) {
  if (m.role === "user") {
    const text = m.parts.map((p) => (p.type === "text" ? p.text : "")).join("");
    return <div className="ml-auto w-fit max-w-[85%] whitespace-pre-wrap rounded-lg bg-sunken px-3 py-1.5 text-[13px] leading-snug text-fg">{text}</div>;
  }
  if (m.role !== "assistant") return null;

  // Consecutive tool calls collapse into one quiet activity block between text paragraphs.
  const blocks: ReactNode[] = [];
  let activity: ReactNode[] = [];
  const flush = () => {
    if (activity.length) blocks.push(<div key={`act-${blocks.length}`} className="flex flex-col gap-0.5 py-0.5">{activity}</div>);
    activity = [];
  };
  m.parts.forEach((p, i) => {
    if (isToolUIPart(p)) {
      const state = toolState(p, streaming);
      activity.push(<ActivityLine key={p.toolCallId} state={state} text={toolLabel(getToolName(p), state)} />);
      return;
    }
    if (p.type === "text" && p.text.trim()) { flush(); blocks.push(<RichText key={`t-${i}`} text={p.text} />); }
  });
  flush();
  if (!blocks.length) return null;

  return (
    <div className="flex gap-2">
      <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-md bg-accent-soft text-accent-text"><Sparkles className="h-3 w-3" /></span>
      <div className="min-w-0 flex-1 space-y-1.5">
        {blocks}
        {streaming && <span className="inline-block h-3.5 w-1.5 animate-pulse rounded-sm bg-accent align-text-bottom" aria-hidden />}
      </div>
    </div>
  );
}

const ACTIVITY_ICON = { doing: LoaderCircle, done: Check, error: CircleAlert, stopped: CircleMinus } satisfies Record<ToolActivityState, unknown>;

function ActivityLine({ state, text }: { state: ToolActivityState; text: string }) {
  const Icon = ACTIVITY_ICON[state];
  return (
    <div className={cn("flex items-center gap-1.5 text-[11px]", state === "error" ? "text-danger" : "text-fg-subtle")}>
      <Icon className={cn("h-3 w-3 shrink-0", state === "doing" && "animate-spin", state === "done" && "text-ok")} />
      <span>{text}</span>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Markdown-lite: paragraphs, bullets, **bold**, `code`, internal [links](/path). */
/* ------------------------------------------------------------------ */

/** Markdown-lite to plain text for the screen-reader announcement. */
const plainText = (md: string) =>
  md.replace(/\[([^\]\n]+)\]\([^)\s]*\)/g, "$1").replace(/\*\*([^*\n]+)\*\*/g, "$1").replace(/`([^`\n]+)`/g, "$1").replace(/^\s*(?:[-*•]|\d+[.)])\s+/gm, "").trim();

function inline(text: string, keyBase: string): ReactNode[] {
  // A link token needs a single leading slash: `//host` and `/\host` are not matched (they would leave the app).
  const re = /(\*\*[^*\n]+\*\*|`[^`\n]+`|\[[^\]\n]+\]\(\/(?![/\\])[^)\s]*\))/g;
  const out: ReactNode[] = [];
  let last = 0;
  let i = 0;
  for (let m = re.exec(text); m; m = re.exec(text)) {
    if (m.index > last) out.push(text.slice(last, m.index));
    const tok = m[0];
    const k = `${keyBase}-${i++}`;
    if (tok.startsWith("**")) out.push(<strong key={k} className="font-semibold text-fg">{tok.slice(2, -2)}</strong>);
    else if (tok.startsWith("`")) out.push(<code key={k} className="num rounded bg-sunken px-1 text-[12px]">{tok.slice(1, -1)}</code>);
    else {
      const link = /^\[([^\]]+)\]\((\/(?![/\\])[^)\s]*)\)$/.exec(tok);
      const href = link ? safeInternalHref(link[2]) : null;
      // Only known app pages become links; anything else keeps its label as plain text.
      if (link && href) out.push(<Link key={k} href={href} className="font-medium text-accent-text underline decoration-accent/40 underline-offset-2 hover:decoration-accent">{link[1]}</Link>);
      else out.push(link ? link[1] : tok);
    }
    last = m.index + tok.length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

function RichText({ text }: { text: string }) {
  const blocks: ReactNode[] = [];
  let list: { ordered: boolean; items: string[] } | null = null;
  const flush = () => {
    if (!list) return;
    const Tag = list.ordered ? "ol" : "ul";
    blocks.push(
      <Tag key={`l-${blocks.length}`} className={cn("my-0.5 space-y-0.5 pl-4", list.ordered ? "list-decimal marker:text-fg-subtle" : "list-disc marker:text-fg-faint")}>
        {list.items.map((it, i) => <li key={i} className="pl-0.5">{inline(it, `${blocks.length}-${i}`)}</li>)}
      </Tag>,
    );
    list = null;
  };
  for (const raw of text.replace(/\r/g, "").split("\n")) {
    const line = raw.trimEnd();
    const bullet = /^\s*[-*•]\s+(.*)$/.exec(line);
    const numbered = bullet ? null : /^\s*\d+[.)]\s+(.*)$/.exec(line);
    const item = bullet ?? numbered;
    if (item) {
      const ordered = Boolean(numbered);
      if (!list || list.ordered !== ordered) { flush(); list = { ordered, items: [] }; }
      list.items.push(item[1]);
      continue;
    }
    flush();
    if (!line.trim()) continue;
    const heading = /^#{1,6}\s+(.*)$/.exec(line);
    blocks.push(<p key={`p-${blocks.length}`} className={heading ? "font-semibold" : undefined}>{inline(heading ? heading[1] : line, `p${blocks.length}`)}</p>);
  }
  flush();
  return <div className="space-y-1.5 text-[13px] leading-[1.55] text-fg [overflow-wrap:anywhere]">{blocks}</div>;
}
