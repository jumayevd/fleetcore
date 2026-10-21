import { isToolUIPart, type UIMessage } from "ai";
import { MAX_TEXT_CHARS, dropUnsettledToolCalls } from "./shared";

/** Only the recent messages go to the model; the client keeps the full transcript. */
const HISTORY_LIMIT = 30;
/** Tool results from this many recent assistant turns go to the model in full; older ones become a stub. */
const FULL_RESULT_TURNS = 2;

/** What an older tool result is replaced with (a list result can be 6–20 KB and would be resent every turn). */
const OMITTED_RESULT = {
  omitted: true,
  note: "Older lookup result removed to keep the conversation short. Call the tool again if you need these details.",
} as const;

const isPart = (p: unknown) => typeof p === "object" && p !== null && typeof (p as { type?: unknown }).type === "string";
const isMessage = (m: unknown): m is UIMessage =>
  typeof m === "object" && m !== null && typeof (m as { role?: unknown }).role === "string"
  && Array.isArray((m as { parts?: unknown }).parts) && (m as { parts: unknown[] }).parts.every(isPart);

/**
 * Shape the client's transcript for the model:
 * - keep the last HISTORY_LIMIT messages, starting on a user turn (providers reject a transcript that opens with the assistant);
 * - drop tool calls that never got a result (Stop pressed mid-call) — resent, they fail every later answer;
 * - replace tool results older than the last FULL_RESULT_TURNS assistant turns with a short stub;
 * - cut any text part longer than MAX_TEXT_CHARS.
 * Returns null when the payload is not a list of UI messages; [] when it holds no user message. The AI SDK
 * validates the remaining details (part shapes, tool inputs) when the agent runs.
 */
export function prepareHistory(raw: unknown[]): UIMessage[] | null {
  if (!raw.every(isMessage)) return null;
  const windowed = dropUnsettledToolCalls(raw.slice(-HISTORY_LIMIT));
  const firstUser = windowed.findIndex((m) => m.role === "user");
  if (firstUser < 0) return [];
  const messages = windowed.slice(firstUser);

  const assistantTurns = messages.flatMap((m, i) => (m.role === "assistant" ? [i] : []));
  const fullFrom = assistantTurns.length > FULL_RESULT_TURNS ? assistantTurns[assistantTurns.length - FULL_RESULT_TURNS] : 0;

  return messages.map((m, i) => {
    let changed = false;
    const parts = m.parts.map((p) => {
      if (p.type === "text" && p.text.length > MAX_TEXT_CHARS) {
        changed = true;
        return { ...p, text: `${p.text.slice(0, MAX_TEXT_CHARS)} [cut: too long]` };
      }
      if (i < fullFrom && isToolUIPart(p) && p.state === "output-available") {
        changed = true;
        return { ...p, output: OMITTED_RESULT };
      }
      return p;
    });
    return changed ? { ...m, parts } : m;
  });
}
