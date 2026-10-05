import crypto from "crypto";

export const ACTIVITY_TYPES = [
  { value: "running", label: "Running" },
  { value: "walking", label: "Walking" },
  { value: "cycling", label: "Cycling" },
  { value: "hiking", label: "Hiking" },
  { value: "swimming", label: "Swimming" },
  { value: "strength_training", label: "Strength training" },
  { value: "other", label: "Other" },
] as const;

export type ActivityType = (typeof ACTIVITY_TYPES)[number]["value"];

export interface WorkoutInput {
  activityType: ActivityType;
  distanceKm?: number | null;
  durationMinutes: number;
  date: string; // YYYY-MM-DD
  startTime: string; // HH:mm (24h) from <input type=time>
  calories?: number | null;
  notes?: string | null;
}

export interface WorkoutRecord {
  id: string;
  activity_type: ActivityType;
  distance_km: string | null;
  duration_minutes: number;
  calories: number | null;
  notes: string | null;
  start_time: string;
  end_time: string;
  sync_status: "pending" | "synced" | "failed";
  google_record_id: string | null;
  sync_error: string | null;
  sync_attempts: number;
  last_synced_at: string | null;
  created_at: string;
}

/**
 * Deterministic idempotency key = sha256(activityType|startTimeISO|durationMinutes|distanceKm).
 * Submitting the exact same workout twice (e.g. double-click, retry after a
 * flaky connection) produces the same key, so the DB's UNIQUE constraint
 * rejects the duplicate instead of creating a second row.
 */
export function computeIdempotencyKey(params: {
  activityType: string;
  startTimeIso: string;
  durationMinutes: number;
  distanceKm?: number | null;
}): string {
  const raw = [
    params.activityType,
    params.startTimeIso,
    params.durationMinutes,
    params.distanceKm ?? "none",
  ].join("|");
  return crypto.createHash("sha256").update(raw).digest("hex");
}

export function toStartEndIso(date: string, startTime: string, durationMinutes: number) {
  // date: "2026-10-05", startTime: "20:30" -> interpreted in the server's
  // local time zone. For a personal single-user tool this is fine; if you
  // deploy across time zones, send a UTC offset from the client instead.
  const start = new Date(`${date}T${startTime}:00`);
  if (isNaN(start.getTime())) {
    throw new Error("Invalid date/time");
  }
  const end = new Date(start.getTime() + durationMinutes * 60_000);
  return { startIso: start.toISOString(), endIso: end.toISOString() };
}
