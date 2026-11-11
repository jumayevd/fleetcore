import { randomBytes } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { authorizeUrl, isConfigured, providerFromSlug } from "@/lib/mail/providers";
import { MAIL_STATE_COOKIE, MAIL_STATE_TTL_S, safeReturn, sealState, siteOrigin, withMailResult } from "@/lib/mail/oauth-state";

export const dynamic = "force-dynamic";

/** GET /api/mail/connect/google?returnTo=/vendors/x → the provider's consent screen (see src/lib/mail/oauth-state.ts). */
export async function GET(req: NextRequest, ctx: RouteContext<"/api/mail/connect/[provider]">) {
  const origin = await siteOrigin();
  const user = await getCurrentUser();
  if (!user) return NextResponse.redirect(new URL("/login", origin));
  const returnTo = safeReturn(req.nextUrl.searchParams.get("returnTo"));
  const provider = providerFromSlug((await ctx.params).provider);
  if (!provider || !isConfigured(provider)) return NextResponse.redirect(new URL(withMailResult(returnTo, "unavailable"), origin));

  const state = randomBytes(24).toString("base64url");
  const res = NextResponse.redirect(authorizeUrl(provider, origin, state, user.email));
  res.cookies.set(MAIL_STATE_COOKIE, sealState({ state, provider, userId: user.id, returnTo }), {
    httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/api/mail/", maxAge: MAIL_STATE_TTL_S,
  });
  return res;
}
