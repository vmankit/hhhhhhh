import crypto from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { query } from "@/lib/db";
import { computeIdempotencyKey } from "@/lib/workouts";
import { attemptSync } from "@/lib/sync";

export const dynamic = "force-dynamic";

// Receiver for mcnaveen/health-connect-webhook (HC Webhook Android app).
// Configure the app with this URL and a custom header
//   Authorization: Bearer <WEBHOOK_SECRET>
// The payload is { timestamp, app_version, <data_type>: [records...] }.

function authorized(req: NextRequest): boolean {
  const secret = process.env.WEBHOOK_SECRET;
  if (!secret) return false;
  const got = req.headers.get("authorization") ?? "";
  const want = `Bearer ${secret}`;
  const a = Buffer.from(got);
  const b = Buffer.from(want);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function mapExerciseType(raw: unknown): string {
  const t = String(raw ?? "").toLowerCase();
  if (t.includes("run")) return "running";
  if (t.includes("walk")) return "walking";
  if (t.includes("bik") || t.includes("cycl")) return "cycling";
  if (t.includes("hik")) return "hiking";
  if (t.includes("swim")) return "swimming";
  if (t.includes("strength") || t.includes("weight")) return "strength_training";
  return "other";
}

export async function POST(req: NextRequest) {
  if (!process.env.WEBHOOK_SECRET) {
    return NextResponse.json({ error: "WEBHOOK_SECRET is not configured" }, { status: 500 });
  }
  if (!authorized(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: Record<string, any>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return NextResponse.json({ error: "Expected a JSON object" }, { status: 400 });
  }

  const counts = { workouts: 0, duplicates: 0, samples: 0, skipped: 0 };
  const toSync: string[] = [];

  for (const [key, value] of Object.entries(body)) {
    if (key === "timestamp" || key === "app_version" || !Array.isArray(value)) continue;

    if (key === "exercise") {
      for (const ex of value) {
        const start = new Date(ex?.start_time);
        const end = new Date(ex?.end_time);
        if (isNaN(start.getTime()) || isNaN(end.getTime()) || end <= start) {
          counts.skipped++;
          continue;
        }
        const activity = mapExerciseType(ex.type);
        const durationMinutes = Math.max(
          1,
          Math.round(Number(ex.duration_seconds ?? (end.getTime() - start.getTime()) / 1000) / 60)
        );
        const distanceKm =
          ex.distance_meters != null && Number.isFinite(Number(ex.distance_meters))
            ? Number(ex.distance_meters) / 1000
            : null;
        const idem = computeIdempotencyKey({
          activityType: activity,
          startTimeIso: start.toISOString(),
          durationMinutes,
          distanceKm,
        });
        const res = await query(
          `INSERT INTO workouts
             (activity_type, distance_km, duration_minutes, notes, start_time, end_time, idempotency_key, source)
           VALUES ($1,$2,$3,$4,$5,$6,$7,'health_connect')
           ON CONFLICT (idempotency_key) DO NOTHING
           RETURNING id`,
          [activity, distanceKm, durationMinutes, ex.type ? `Health Connect: ${ex.type}` : null,
           start.toISOString(), end.toISOString(), idem]
        );
        if (res.rows[0]) {
          counts.workouts++;
          toSync.push(res.rows[0].id);
        } else {
          counts.duplicates++;
        }
      }
      continue;
    }

    // Everything else (steps, heart_rate, sleep, ...) is stored as raw samples.
    for (const rec of value) {
      const hash = crypto.createHash("sha256").update(`${key}|${JSON.stringify(rec)}`).digest("hex");
      const t = new Date(rec?.start_time ?? rec?.time);
      const res = await query(
        `INSERT INTO health_samples (data_type, start_time, payload, record_hash)
         VALUES ($1,$2,$3,$4) ON CONFLICT (record_hash) DO NOTHING RETURNING id`,
        [key, isNaN(t.getTime()) ? null : t.toISOString(), JSON.stringify(rec), hash]
      );
      if (res.rows[0]) counts.samples++;
      else counts.duplicates++;
    }
  }

  // Push new exercise sessions to Google Health (failures are recorded per row; retry in the UI).
  for (const id of toSync) await attemptSync(id);

  return NextResponse.json({ ok: true, ...counts }, { status: 200 });
}
