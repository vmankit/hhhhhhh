import crypto from "crypto";
import { cookies } from "next/headers";

// This app is single-user (it's your personal workout logger). The session
// cookie only proves "this browser completed Google OAuth"; it contains no
// access/refresh tokens. Those live only in the database, encrypted.

const COOKIE_NAME = "mhl_session";

function getSecret(): string {
  const secret = process.env.SESSION_SECRET;
  if (!secret) {
    throw new Error(
      "SESSION_SECRET is not set. Generate one with: openssl rand -hex 32"
    );
  }
  return secret;
}

function sign(value: string): string {
  const hmac = crypto.createHmac("sha256", getSecret());
  hmac.update(value);
  return hmac.digest("hex");
}

export function createSessionCookieValue(googleSub: string): string {
  const payload = `${googleSub}.${Date.now()}`;
  const sig = sign(payload);
  return `${Buffer.from(payload).toString("base64url")}.${sig}`;
}

export function verifySessionCookieValue(cookieValue: string): string | null {
  const [payloadB64, sig] = cookieValue.split(".");
  if (!payloadB64 || !sig) return null;
  const payload = Buffer.from(payloadB64, "base64url").toString("utf8");
  const expected = sign(payload);
  if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) {
    return null;
  }
  const [googleSub] = payload.split(".");
  return googleSub ?? null;
}

export const SESSION_COOKIE_NAME = COOKIE_NAME;

export function getSessionGoogleSub(): string | null {
  const value = cookies().get(COOKIE_NAME)?.value;
  if (!value) return null;
  return verifySessionCookieValue(value);
}
