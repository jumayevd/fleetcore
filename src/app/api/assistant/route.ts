import { NextResponse } from "next/server";
import { APICallError, createAgentUIStreamResponse, NoSuchModelError } from "ai";
import { getCurrentUser } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { assistantModelId, createFleetAgent, isAssistantConfigured } from "@/lib/assistant/agent";
import { prepareHistory } from "@/lib/assistant/history";
import { NOT_CONFIGURED_CODE, NOT_CONFIGURED_MESSAGE, introFor, promptsFor, type AssistantErrorBody, type AssistantInfo } from "@/lib/assistant/shared";

export const dynamic = "force-dynamic";
/** Tool round trips plus a long answer can take a while on a cold model. */
export const maxDuration = 60;

const NO_STORE = { "cache-control": "no-store" };

const fail = (status: number, error: string, code?: string) =>
  NextResponse.json<AssistantErrorBody>({ error, code }, { status, headers: NO_STORE });

/** What the user sees when the model call or a tool fails. Never leaks stack traces or provider payloads. */
function describe(error: unknown): string {
  if (APICallError.isInstance(error)) {
    if (error.statusCode === 401 || error.statusCode === 403) return "The AI Gateway rejected the credentials — check AI_GATEWAY_API_KEY.";
    if (error.statusCode === 429) return "The model is rate limited right now. Try again in a minute.";
    if (error.statusCode && error.statusCode >= 500) return "The model provider is having trouble. Try again in a moment.";
  }
  if (NoSuchModelError.isInstance(error)) return `The model "${assistantModelId()}" isn't available on the gateway — check ASSISTANT_MODEL.`;
  const msg = error instanceof Error ? error.message : "";
  if (/AI_GATEWAY_API_KEY|OIDC|api key|unauthori[sz]ed/i.test(msg)) return "The AI Gateway rejected the credentials — check AI_GATEWAY_API_KEY.";
  if (/abort/i.test(msg)) return "The answer was stopped.";
  return "The assistant couldn't finish that answer. Try again, or ask it a different way.";
}

/**
 * GET /api/assistant — what the panel shows before the first question: whether the gateway is
 * configured, plus the intro and suggested prompts this role can actually get answers to.
 * 401 signed out · 403 role lacks assistant.use.
 */
export async function GET() {
  const user = await getCurrentUser();
  if (!user) return fail(401, "Sign in required", "UNAUTHENTICATED");
  if (!can(user.role, "assistant.use")) return fail(403, "Your role can't use the fleet assistant", "FORBIDDEN");
  return NextResponse.json<AssistantInfo>(
    { configured: isAssistantConfigured(), intro: introFor(user.role), prompts: promptsFor(user.role) },
    { headers: NO_STORE },
  );
}

/**
 * POST /api/assistant — body `{ messages: UIMessage[] }` from `useChat`.
 * Streams a UI message stream (text, tool activity, finish) for the Fleet Assistant.
 * 401 signed out · 403 role lacks assistant.use · 503 no gateway credentials · 400 bad body.
 */
export async function POST(req: Request) {
  const user = await getCurrentUser();
  if (!user) return fail(401, "Sign in required", "UNAUTHENTICATED");
  if (!can(user.role, "assistant.use")) return fail(403, "Your role can't use the fleet assistant", "FORBIDDEN");
  if (!isAssistantConfigured()) return fail(503, NOT_CONFIGURED_MESSAGE, NOT_CONFIGURED_CODE);

  let body: { messages?: unknown };
  try {
    body = (await req.json()) as { messages?: unknown };
  } catch {
    return fail(400, "Send JSON with a messages array", "BAD_REQUEST");
  }
  const messages = Array.isArray(body?.messages) ? body.messages : null;
  if (!messages || messages.length === 0) return fail(400, "Send at least one message", "BAD_REQUEST");
  // Recent window from a user turn, without tool calls cut off by Stop, old tool results stubbed, long text cut.
  const uiMessages = prepareHistory(messages);
  if (!uiMessages) return fail(400, "The conversation payload isn't valid. Clear the chat and try again.", "BAD_REQUEST");
  if (uiMessages.length === 0) return fail(400, "Send a message from the user", "BAD_REQUEST");

  const agent = createFleetAgent({ role: user.role, name: user.name });
  try {
    return await createAgentUIStreamResponse({
      agent,
      uiMessages,
      // Stop in the panel, or a closed tab, ends the tool loop instead of letting it run (and bill) to the end.
      abortSignal: req.signal,
      sendReasoning: false,
      headers: NO_STORE,
      onError: (error) => {
        console.error("[assistant]", user.email, error instanceof Error ? error.message : error);
        return describe(error);
      },
    });
  } catch (error) {
    // Thrown before the stream starts: malformed UI messages, model resolution, provider setup.
    console.error("[assistant] failed to start", user.email, error);
    const msg = error instanceof Error ? error.message : "";
    if (/invalid|validation|parts|role/i.test(msg) && !/api key/i.test(msg)) return fail(400, "The conversation payload isn't valid. Clear the chat and try again.", "BAD_REQUEST");
    return fail(500, describe(error), "ASSISTANT_ERROR");
  }
}
