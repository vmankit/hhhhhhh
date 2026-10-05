import { NextResponse } from "next/server";
import { getAccount } from "@/lib/googleHealth";
import { getSessionGoogleSub } from "@/lib/session";

export const dynamic = "force-dynamic";

export async function GET() {
  const sub = getSessionGoogleSub();
  if (!sub) {
    return NextResponse.json({ connected: false });
  }
  const account = await getAccount();
  if (!account || account.google_sub !== sub) {
    return NextResponse.json({ connected: false });
  }
  return NextResponse.json({
    connected: true,
    email: account.email,
    hasRefreshToken: Boolean(account.refresh_token_enc),
  });
}
