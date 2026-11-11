import { NextResponse, type NextRequest } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { saveMailbox } from "@/lib/mail/accounts";
import { MailError, exchangeCode, mailboxAddress, providerFromSlug } from "@/lib/mail/providers";
import { MAIL_STATE_COOKIE, openState, siteOrigin, withMailResult } from "@/lib/mail/oauth-state";

export const dynamic = "force-dynamic";

/** Where Google / Microsoft send the person back with a code. Checks the state, keeps the tokens, returns to the page. */
export async function GET(req: NextRequest, ctx: RouteContext<"/api/mail/callback/[provider]">) {
  const origin = await siteOrigin();
  const q = req.nextUrl.searchParams;
  const saved = openState(req.cookies.get(MAIL_STATE_COOKIE)?.value);
  const provider = providerFromSlug((await ctx.params).provider);
  const user = await getCurrentUser();
  const back = (result: string) => {
    const res = NextResponse.redirect(new URL(withMailResult(saved?.returnTo ?? "/dashboard", result, provider ?? undefined), origin));
    res.cookies.set(MAIL_STATE_COOKIE, "", { path: "/api/mail/", maxAge: 0 });
    return res;
  };

  if (!saved || !provider || saved.provider !== provider || q.get("state") !== saved.state) return back("expired");
  if (!user || user.id !== saved.userId) return back("wrong-account");
  if (q.get("error")) return back(q.get("error") === "access_denied" ? "denied" : "failed");
  const code = q.get("code");
  if (!code) return back("failed");

  try {
    const tokens = await exchangeCode(provider, code, origin);
    const email = await mailboxAddress(provider, tokens.accessToken);
    await saveMailbox(user.id, provider, email, tokens);
    return back("connected");
  } catch (e) {
    console.error("[mail] connect failed", provider, e instanceof Error ? e.message : e);
    return back(e instanceof MailError && /offline/.test(e.message) ? "no-offline" : "failed");
  }
}
