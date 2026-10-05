import { NextRequest, NextResponse } from "next/server";
import { query } from "@/lib/db";
import { attemptSync } from "@/lib/sync";
import { getSessionGoogleSub } from "@/lib/session";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  if (!getSessionGoogleSub()) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }
  const existing = await query(`SELECT id FROM workouts WHERE id = $1`, [params.id]);
  if (existing.rows.length === 0) {
    return NextResponse.json({ error: "Workout not found" }, { status: 404 });
  }
  const synced = await attemptSync(params.id);
  const final = await query(`SELECT * FROM workouts WHERE id = $1`, [params.id]);
  return NextResponse.json({ workout: final.rows[0], synced });
}
