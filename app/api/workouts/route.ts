import { NextRequest, NextResponse } from "next/server";
import { query } from "@/lib/db";
import {
  computeIdempotencyKey,
  toStartEndIso,
  ACTIVITY_TYPES,
  WorkoutInput,
} from "@/lib/workouts";
import { attemptSync } from "@/lib/sync";
import { getSessionGoogleSub } from "@/lib/session";

export const dynamic = "force-dynamic";

export async function GET() {
  if (!getSessionGoogleSub()) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }
  const res = await query(
    `SELECT * FROM workouts ORDER BY start_time DESC LIMIT 200`
  );
  return NextResponse.json({ workouts: res.rows });
}

const VALID_ACTIVITY_TYPES = new Set(ACTIVITY_TYPES.map((a) => a.value));

export async function POST(req: NextRequest) {
  if (!getSessionGoogleSub()) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }
  let body: WorkoutInput;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  // --- Validation ---
  if (!body.activityType || !VALID_ACTIVITY_TYPES.has(body.activityType)) {
    return NextResponse.json({ error: "Invalid or missing activityType" }, { status: 400 });
  }
  if (!body.date || !/^\d{4}-\d{2}-\d{2}$/.test(body.date)) {
    return NextResponse.json({ error: "Invalid or missing date (expected YYYY-MM-DD)" }, { status: 400 });
  }
  if (!body.startTime || !/^\d{2}:\d{2}$/.test(body.startTime)) {
    return NextResponse.json({ error: "Invalid or missing startTime (expected HH:mm)" }, { status: 400 });
  }
  const duration = Number(body.durationMinutes);
  if (!Number.isFinite(duration) || duration <= 0 || duration > 24 * 60) {
    return NextResponse.json({ error: "durationMinutes must be a positive number of minutes" }, { status: 400 });
  }
  let distanceKm: number | null = null;
  if (body.distanceKm !== undefined && body.distanceKm !== null && body.distanceKm !== ("" as any)) {
    distanceKm = Number(body.distanceKm);
    if (!Number.isFinite(distanceKm) || distanceKm < 0) {
      return NextResponse.json({ error: "distanceKm must be a non-negative number" }, { status: 400 });
    }
  }
  let calories: number | null = null;
  if (body.calories !== undefined && body.calories !== null && body.calories !== ("" as any)) {
    calories = Math.round(Number(body.calories));
    if (!Number.isFinite(calories) || calories < 0) {
      return NextResponse.json({ error: "calories must be a non-negative number" }, { status: 400 });
    }
  }

  let startIso: string, endIso: string;
  try {
    ({ startIso, endIso } = toStartEndIso(body.date, body.startTime, duration));
  } catch {
    return NextResponse.json({ error: "Invalid date/time combination" }, { status: 400 });
  }

  const idempotencyKey = computeIdempotencyKey({
    activityType: body.activityType,
    startTimeIso: startIso,
    durationMinutes: duration,
    distanceKm,
  });

  // --- Insert (or detect duplicate) ---
  let workoutId: string;
  try {
    const insertRes = await query(
      `INSERT INTO workouts
        (activity_type, distance_km, duration_minutes, calories, notes, start_time, end_time, idempotency_key)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
       RETURNING id`,
      [
        body.activityType,
        distanceKm,
        duration,
        calories,
        body.notes?.slice(0, 1000) ?? null,
        startIso,
        endIso,
        idempotencyKey,
      ]
    );
    workoutId = insertRes.rows[0].id;
  } catch (err: any) {
    if (err.code === "23505") {
      // unique_violation on idempotency_key -> this exact workout already exists.
      const existing = await query(`SELECT * FROM workouts WHERE idempotency_key = $1`, [idempotencyKey]);
      return NextResponse.json(
        { duplicate: true, workout: existing.rows[0] },
        { status: 200 }
      );
    }
    console.error("Insert workout failed:", err);
    return NextResponse.json({ error: "Failed to save workout" }, { status: 500 });
  }

  // --- Attempt immediate sync to Google Health API ---
  const synced = await attemptSync(workoutId);
  const final = await query(`SELECT * FROM workouts WHERE id = $1`, [workoutId]);
  return NextResponse.json({ workout: final.rows[0], synced }, { status: 201 });
}

