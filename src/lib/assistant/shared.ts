/**
 * Fleet Assistant — client-safe constants and helpers. No server imports here: the launcher
 * ("use client") imports from this file, and so do the agent and the API route.
 */
import { isToolUIPart, type UIMessage } from "ai";
import { can, type Permission } from "@/lib/permissions";

export const ASSISTANT_API = "/api/assistant";
/** Base id of the in-memory conversation; one conversation per company (see assistantChatId). */
export const ASSISTANT_CHAT_ID = "fleet-assistant";
/** One conversation per signed-in account and company, so switching company never shows another company's chat. */
export const assistantChatId = (companyId: string | null, userId?: string | null) => `${ASSISTANT_CHAT_ID}:${userId ?? "-"}:${companyId ?? "-"}`;

export const NOT_CONFIGURED_CODE = "NOT_CONFIGURED";
export const NOT_CONFIGURED_MESSAGE = "Assistant isn't configured — add AI_GATEWAY_API_KEY";
/** The panel's conversation belongs to another company (or account) than the one this browser now works in. */
export const COMPANY_CHANGED_CODE = "COMPANY_CHANGED";

/** Longest question the composer accepts; the API cuts any longer text part to this before it reaches the model. */
export const MAX_TEXT_CHARS = 4000;

/** JSON body the API returns when it cannot stream an answer. */
export type AssistantErrorBody = { error: string; code?: string };

/** What the panel sends with every question: the company (and account) its conversation belongs to. */
export type AssistantRequestScope = { companyId?: string; userId?: string };

/** "a", "a and b", "a, b and c". */
const joinList = (items: string[]) => (items.length < 2 ? items.join("") : `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`);

/* ------------------------------------------------------------------ */
/* Welcome: role-aware intro and suggested prompts (GET /api/assistant) */
/* ------------------------------------------------------------------ */

/** Each prompt is offered only to roles that hold the permission its answer needs. First matches win. */
const SUGGESTED_PROMPTS: readonly { text: string; perm: Permission }[] = [
  { text: "Which trucks are overdue for PM?", perm: "fleet.view" },
  { text: "What paperwork expires this month?", perm: "fleet.view" },
  { text: "Cost per km by truck last quarter", perm: "reports.view" },
  { text: "Which work orders are overdue?", perm: "fleet.view" },
  { text: "Which drivers have a licence or medical expiring?", perm: "drivers.view" },
  { text: "Which leased trucks are near their mileage cap?", perm: "fleet.view" },
];
const MAX_PROMPTS = 5;
export const promptsFor = (role: string) => SUGGESTED_PROMPTS.filter((p) => can(role, p.perm)).slice(0, MAX_PROMPTS).map((p) => p.text);

const TOPICS: [Permission, string][] = [
  ["fleet.view", "trucks"], ["fleet.view", "trailers"], ["fleet.view", "PM and work orders"], ["fleet.view", "paperwork"],
  ["drivers.view", "drivers"], ["reports.view", "costs"],
];
const GENERIC_INTRO = "Answers from live fleet data, with read-only lookups.";
/** "Trucks, trailers, … and costs in Silk Road Freight — …": only what this role can actually ask about. */
export function introFor(role: string, company?: string | null) {
  const list = joinList(TOPICS.filter(([perm]) => can(role, perm)).map(([, topic]) => topic));
  if (!list) return GENERIC_INTRO;
  return `${list.charAt(0).toUpperCase()}${list.slice(1)}${company ? ` in ${company}` : ""}, answered from live data with read-only lookups.`;
}

/** GET /api/assistant: what the panel needs before the first question. */
export type AssistantInfo = { configured: boolean; companyId: string | null; company: string | null; intro: string; prompts: string[] };

/** Read the GET body defensively; anything unreadable falls back to a generic welcome (the POST reports real problems). */
export function parseAssistantInfo(v: unknown): AssistantInfo {
  const o = (typeof v === "object" && v !== null ? v : {}) as Partial<Record<keyof AssistantInfo, unknown>>;
  const str = (x: unknown) => (typeof x === "string" && x ? x : null);
  return {
    configured: o.configured !== false,
    companyId: str(o.companyId),
    company: str(o.company),
    intro: str(o.intro) ?? GENERIC_INTRO,
    prompts: Array.isArray(o.prompts) ? o.prompts.filter((p): p is string => typeof p === "string").slice(0, MAX_PROMPTS) : [],
  };
}

/* ------------------------------------------------------------------ */
/* Tool activity lines                                                 */
/* ------------------------------------------------------------------ */

/** Quiet activity lines shown in the chat while / after a tool runs, and when it fails. */
const TOOL_LABELS: Record<string, { doing: string; done: string; fail: string }> = {
  fleetOverview: { doing: "Checking the fleet", done: "Checked the fleet", fail: "Couldn't check the fleet" },
  listTrucks: { doing: "Looking up trucks", done: "Looked up trucks", fail: "Couldn't look up trucks" },
  truckDetail: { doing: "Opening the truck", done: "Opened the truck", fail: "Couldn't open the truck" },
  listTrailers: { doing: "Looking up trailers", done: "Looked up trailers", fail: "Couldn't look up trailers" },
  maintenanceDue: { doing: "Checking PM due", done: "Checked PM due", fail: "Couldn't check PM due" },
  workOrders: { doing: "Looking up work orders", done: "Looked up work orders", fail: "Couldn't look up work orders" },
  expiringPaperwork: { doing: "Checking expiry dates", done: "Checked expiry dates", fail: "Couldn't check expiry dates" },
  complianceGaps: { doing: "Checking paperwork gaps", done: "Checked paperwork gaps", fail: "Couldn't check paperwork gaps" },
  fleetCosts: { doing: "Adding up costs", done: "Added up costs", fail: "Couldn't add up costs" },
  listDrivers: { doing: "Looking up drivers", done: "Looked up drivers", fail: "Couldn't look up drivers" },
  search: { doing: "Searching the fleet", done: "Searched the fleet", fail: "Couldn't search the fleet" },
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

/**
 * Pages an answer may link to, as path shapes (an id segment is a record page): /dashboard(/alerts), /fleet(/:id),
 * /fleet/trailers(/:id), /maintenance, /maintenance/work-orders(/:id), /drivers(/:id), /tracking, /reports.
 */
const LINK_PATHS: readonly RegExp[] = [
  /^\/dashboard(?:\/alerts)?$/,
  /^\/fleet(?:\/trailers)?(?:\/[A-Za-z0-9_-]+)?$/,
  /^\/maintenance(?:\/work-orders(?:\/[A-Za-z0-9_-]+)?)?$/,
  /^\/drivers(?:\/[A-Za-z0-9_-]+)?$/,
  /^\/tracking$/,
  /^\/reports$/,
];

/**
 * An href written by the model becomes a link only when it is a plain path inside the app: a single
 * leading slash (not protocol-relative `//host` or `/\host`), no backslashes, whitespace or control
 * characters, and the path is one of the fleet pages above. Tool results carry text other users typed,
 * so anything else is rendered as plain text.
 */
export function safeInternalHref(href: string): string | null {
  if (!href.startsWith("/") || href.startsWith("//") || /[\\\s]/.test(href)) return null;
  if ([...href].some((c) => c.charCodeAt(0) < 32 || c.charCodeAt(0) === 127)) return null;
  const path = href.split(/[?#]/, 1)[0];
  return LINK_PATHS.some((re) => re.test(path)) ? href : null;
}

/* ------------------------------------------------------------------ */
/* Errors                                                              */
/* ------------------------------------------------------------------ */

export type AssistantErrorKind = "not-configured" | "unauthorised" | "company-changed" | "generic";

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
  if (status === 409 || body?.code === COMPANY_CHANGED_CODE) {
    return { kind: "company-changed", message: body?.error ?? "This browser now works in another company. Reload to continue there." };
  }
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
