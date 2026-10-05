import { NextResponse } from "next/server";
import crypto from "crypto";
import { buildAuthUrl } from "@/lib/googleHealth";

export const dynamic = "force-dynamic";

export async function GET() {
  const state = crypto.randomBytes(16).toString("hex");
  const url = buildAuthUrl(state);
  const res = NextResponse.redirect(url);
  // CSRF protection for the OAuth callback.
  res.cookies.set("mhl_oauth_state", state, {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    maxAge: 600,
    path: "/",
  });
  return res;
}
