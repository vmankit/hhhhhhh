import { NextRequest, NextResponse } from "next/server";
import {
  exchangeCodeForTokens,
  fetchGoogleUserInfo,
  saveAccountTokens,
} from "@/lib/googleHealth";
import { createSessionCookieValue, SESSION_COOKIE_NAME } from "@/lib/session";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const code = searchParams.get("code");
  const state = searchParams.get("state");
  const error = searchParams.get("error");
  const expectedState = req.cookies.get("mhl_oauth_state")?.value;

  const base = process.env.APP_BASE_URL ?? "";

  if (error) {
    return NextResponse.redirect(`${base}/?auth_error=${encodeURIComponent(error)}`);
  }
  if (!code || !state || state !== expectedState) {
    return NextResponse.redirect(`${base}/?auth_error=invalid_state`);
  }

  try {
    const tokens = await exchangeCodeForTokens(code);
    const userInfo = await fetchGoogleUserInfo(tokens.access_token);

    await saveAccountTokens({
      googleSub: userInfo.sub,
      email: userInfo.email,
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token,
      expiresInSeconds: tokens.expires_in,
      scope: tokens.scope,
    });

    const res = NextResponse.redirect(`${base}/?connected=1`);
    res.cookies.set(SESSION_COOKIE_NAME, createSessionCookieValue(userInfo.sub), {
      httpOnly: true,
      secure: true,
      sameSite: "lax",
      maxAge: 60 * 60 * 24 * 180, // 180 days
      path: "/",
    });
    res.cookies.delete("mhl_oauth_state");
    return res;
  } catch (err: any) {
    console.error("OAuth callback error:", err);
    return NextResponse.redirect(
      `${base}/?auth_error=${encodeURIComponent(err.message ?? "unknown_error")}`
    );
  }
}
