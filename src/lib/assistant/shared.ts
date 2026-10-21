/**
 * Fleet Assistant — client-safe constants and helpers. No server imports here: the launcher
 * ("use client") imports from this file, and so do the agent and the API route.
 */
import { isToolUIPart, type UIMessage } from "ai";
import { can, type Permission } from "@/lib/permissions";

export const ASSISTANT_API = "/api/assistant";
/** sessionStorage key for the panel's open state (survives navigation and reloads, not a new tab). */
/** Stable chat id so the conversation survives closing and reopening the panel. */
export const ASSISTANT_CHAT_ID = "fleet-assistant";

export const NOT_CONFIGURED_CODE = "NOT_CONFIGURED";
export const NOT_CONFIGURED_MESSAGE = "Assistant isn't configured — add AI_GATEWAY_API_KEY";

/** Longest question the composer accepts; the API cuts any longer text part to this before it reaches the model. */
export const MAX_TEXT_CHARS = 4000;

/** JSON body the API returns when it cannot stream an answer. */
export type AssistantErrorBody = { error: string; code?: string };

/** "a", "a and b", "a, b and c". */
const joinList = (items: string[]) => (items.length < 2 ? items.join("") : `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`);

/* ------------------------------------------------------------------ */
/* Welcome: role-aware intro and suggested prompts (GET /api/assistant) */
/* ------------------------------------------------------------------ */

/** Each prompt is offered only to roles that hold the permission its answer needs. First matches win. */
const SUGGESTED_PROMPTS: readonly { text: string; perm: Permission }[] = [
  { text: "Which trucks are idle right now?", perm: "fleet.view" },
  { text: "What's running late?", perm: "loads.view" },
  { text: "What can we invoice today?", perm: "finance.view" },
  { text: "Who is on hold and why?", perm: "drivers.view" },
  { text: "Trucks overdue for PM", perm: "fleet.view" },
  { text: "Which invoices are overdue?", perm: "finance.view" },
  { text: "How is this week going against goal?", perm: "loads.view" },
  { text: "Which claims are still open?", perm: "claims.view" },
];
const MAX_PROMPTS = 5;
export const promptsFor = (role: string) => SUGGESTED_PROMPTS.filter((p) => can(role, p.perm)).slice(0, MAX_PROMPTS).map((p) => p.text);

const TOPICS: [Permission, string][] = [["fleet.view", "trucks"], ["drivers.view", "drivers"], ["loads.view", "loads"], ["claims.view", "claims"], ["finance.view", "money"]];
const GENERIC_INTRO = "Answers from the live FleetOps database, with read-only lookups.";
/** "Trucks, drivers, loads and claims — …": only what this role can actually ask about. */
export function introFor(role: string) {
  const list = joinList(TOPICS.filter(([perm]) => can(role, perm)).map(([, topic]) => topic));
  return list ? `${list.charAt(0).toUpperCase()}${list.slice(1)} — answered from the live database with read-only lookups.` : GENERIC_INTRO;
}

/** GET /api/assistant: what the panel needs before the first question. */
export type AssistantInfo = { configured: boolean; intro: string; prompts: string[] };

/** Read the GET body defensively; anything unreadable falls back to a generic welcome (the POST reports real problems). */
export function parseAssistantInfo(v: unknown): AssistantInfo {
  const o = (typeof v === "object" && v !== null ? v : {}) as Partial<Record<keyof AssistantInfo, unknown>>;
  return {
    configured: o.configured !== false,
    intro: typeof o.intro === "string" && o.intro ? o.intro : GENERIC_INTRO,
    prompts: Array.isArray(o.prompts) ? o.prompts.filter((p): p is string => typeof p === "string").slice(0, MAX_PROMPTS) : [],
  };
}

/* ------------------------------------------------------------------ */
/* Tool activity lines                                                 */
/* ------------------------------------------------------------------ */

/** Quiet activity lines shown in the chat while / after a tool runs, and when it fails. */
const TOOL_LABELS: Record<string, { doing: string; done: string; fail: string }> = {
  fleetStatus: { doing: "Checking fleet status", done: "Checked fleet status", fail: "Couldn't check fleet status" },
  listTrucks: { doing: "Looking up trucks", done: "Looked up trucks", fail: "Couldn't look up trucks" },
  listDrivers: { doing: "Looking up drivers", done: "Looked up drivers", fail: "Couldn't look up drivers" },
  lateLoads: { doing: "Checking what's running late", done: "Checked what's running late", fail: "Couldn't check what's running late" },
  loadsByStatus: { doing: "Listing loads", done: "Listed loads", fail: "Couldn't list loads" },
  findLoad: { doing: "Opening the load", done: "Opened the load", fail: "Couldn't open the load" },
  billingQueue: { doing: "Checking the billing queue", done: "Checked the billing queue", fail: "Couldn't check the billing queue" },
  receivables: { doing: "Checking receivables", done: "Checked receivables", fail: "Couldn't check receivables" },
  openClaims: { doing: "Checking open claims", done: "Checked open claims", fail: "Couldn't check open claims" },
  maintenanceDue: { doing: "Checking service due", done: "Checked service due", fail: "Couldn't check service due" },
  weeklyProduction: { doing: "Reading the weekly board", done: "Read the weekly board", fail: "Couldn't read the weekly board" },
  alerts: { doing: "Reading alerts", done: "Read alerts", fail: "Couldn't read alerts" },
  searchEverything: { doing: "Searching FleetOps", done: "Searched FleetOps", fail: "Couldn't search FleetOps" },
};

/** `stopped`: the call was cut off (Stop pressed, or the stream ended) before it returned. */
export type ToolActivityState = "doing" | "done" | "error" | "stopped";

export function toolLabel(name: string, state: ToolActivityState) {
  const l = TOOL_LABELS[name];
  const human = name.replace(/([A-Z])/g, " $1").toLowerCase().trim();
  const doing = l?.doing ?? `Running ${human}`;
  if (state === "error") return l?.fail ?? `Couldn't run ${human}`;
  if (state === "stopped") return `Stopped ${doing.charAt(0).toLowerCase()}${doing.slice(1)}`;
  if (state === "done") return l?.done ?? `Ran ${human}`;
  return `${doing}…`;
}

/* ------------------------------------------------------------------ */
/* Transcript hygiene                                                  */
/* ------------------------------------------------------------------ */

/** True unless the part is a tool call that never got its result (or error / denial). */
function isSettledPart(part: UIMessage["parts"][number]) {
  if (!isToolUIPart(part)) return true;
  return (part.state === "output-available" && part.preliminary !== true) || part.state === "output-error" || part.state === "output-denied";
}

/**
 * Drop tool calls that never got a result (Stop pressed mid-call) and assistant messages left with nothing
 * in them. Resent as-is, such a call makes every later model call fail with "tool result is missing".
 */
export function dropUnsettledToolCalls<M extends UIMessage>(messages: M[]): M[] {
  const out: M[] = [];
  for (const m of messages) {
    if (m.role !== "assistant") { out.push(m); continue; }
    const parts = m.parts.filter(isSettledPart);
    if (!parts.some((p) => p.type !== "step-start")) continue;
    out.push(parts.length === m.parts.length ? m : { ...m, parts });
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* Links in answers                                                    */
/* ------------------------------------------------------------------ */

/** First path segments an answer may link to: the app's own pages. */
const LINK_ROOTS = new Set(["loads", "drivers", "fleet", "customers", "claims", "finance", "maintenance", "dispatch", "dashboard", "tracking", "reports", "chat"]);

/**
 * An href written by the model becomes a link only when it is a plain path inside the app: a single
 * leading slash (not protocol-relative `//host` or `/\host`), no backslashes, whitespace or control
 * characters, and a known first segment. Tool results carry text other users typed, so anything else
 * is rendered as plain text.
 */
export function safeInternalHref(href: string): string | null {
  if (!href.startsWith("/") || href.startsWith("//") || /[\\\s]/.test(href)) return null;
  if ([...href].some((c) => c.charCodeAt(0) < 32 || c.charCodeAt(0) === 127)) return null;
  const root = href.slice(1).split(/[/?#]/, 1)[0];
  return LINK_ROOTS.has(root) ? href : null;
}

/* ------------------------------------------------------------------ */
/* Errors                                                              */
/* ------------------------------------------------------------------ */

export type AssistantErrorKind = "not-configured" | "unauthorised" | "generic";

/**
 * Turn a transport / stream error into something the panel can show. The HTTP transport puts the
 * response body in `error.message` (and `responseBody`), so a JSON error from the route is parsed here.
 */
export function describeAssistantError(error: unknown): { kind: AssistantErrorKind; message: string } {
  const raw = (error as { responseBody?: string } | undefined)?.responseBody
    ?? (error instanceof Error ? error.message : typeof error === "string" ? error : "");
  const body = parseErrorBody(raw);
  if (body?.code === NOT_CONFIGURED_CODE || /AI_GATEWAY_API_KEY/i.test(raw)) {
    return { kind: "not-configured", message: NOT_CONFIGURED_MESSAGE };
  }
  const status = (error as { statusCode?: number } | undefined)?.statusCode;
  if (status === 401 || status === 403 || body?.code === "FORBIDDEN" || body?.code === "UNAUTHENTICATED") {
    return { kind: "unauthorised", message: body?.error ?? "Your session can't use the assistant. Sign in again." };
  }
  if (body?.error) return { kind: "generic", message: body.error };
  // Stream errors arrive as plain text written by the route's onError (already user-safe).
  if (raw && raw.length <= 200 && !/^\s*[{[<]/.test(raw) && !/fetch|network|TypeError/i.test(raw)) return { kind: "generic", message: raw };
  return { kind: "generic", message: "The assistant couldn't answer that. Try again in a moment." };
}

function parseErrorBody(raw: string): AssistantErrorBody | null {
  if (!raw || raw[0] !== "{") return null;
  try {
    const v = JSON.parse(raw) as Partial<AssistantErrorBody>;
    return typeof v?.error === "string" ? { error: v.error, code: typeof v.code === "string" ? v.code : undefined } : null;
  } catch {
    return null;
  }
}
