import { query } from "./db";
import { encrypt, decrypt } from "./crypto";

// ---------------------------------------------------------------------------
// Google Health API integration
//
// Google Fit's APIs are being fully shut down in 2026 (REST API sign-ups
// already closed in 2024; full shutdown Sept-Oct 2026). Their replacement,
// the Google Health API (GA'd March 2026, https://developers.google.com/health),
// is a cloud REST API reachable from any server — exactly what we need for a
// Vercel-hosted app. It is the only currently-supported Google surface that
// lets a plain web backend WRITE workout data to a user's Google account.
// Health Connect, by contrast, is an on-device Android data store with no
// cloud endpoint — a serverless web app cannot write to it directly, so it
// is not usable here.
// ---------------------------------------------------------------------------

const AUTH_ENDPOINT = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";
const USERINFO_ENDPOINT = "https://openidconnect.googleapis.com/v1/userinfo";
const HEALTH_API_BASE = "https://health.googleapis.com/v4";

// Write-only scope for exercise data, plus openid/email so we can identify
// the account. Read scope is intentionally omitted: this app only ever
// writes, per least-privilege.
export const GOOGLE_HEALTH_SCOPES = [
  "openid",
  "email",
  "https://www.googleapis.com/auth/googlehealth.activity_and_fitness.writeonly",
].join(" ");

function getRedirectUri(): string {
  const base = process.env.APP_BASE_URL;
  if (!base) {
    throw new Error("APP_BASE_URL is not set (e.g. https://your-app.vercel.app)");
  }
  return `${base.replace(/\/$/, "")}/api/auth/google/callback`;
}

export function buildAuthUrl(state: string): string {
  const params = new URLSearchParams({
    client_id: must("GOOGLE_CLIENT_ID"),
    redirect_uri: getRedirectUri(),
    response_type: "code",
    access_type: "offline", // required to get a refresh_token
    prompt: "consent", // force refresh_token on every login, not just the first
    scope: GOOGLE_HEALTH_SCOPES,
    state,
  });
  return `${AUTH_ENDPOINT}?${params.toString()}`;
}

function must(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`${name} is not set`);
  return v;
}

export async function exchangeCodeForTokens(code: string) {
  const res = await fetch(TOKEN_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: must("GOOGLE_CLIENT_ID"),
      client_secret: must("GOOGLE_CLIENT_SECRET"),
      redirect_uri: getRedirectUri(),
      grant_type: "authorization_code",
    }),
  });
  if (!res.ok) {
    throw new Error(`Token exchange failed: ${res.status} ${await res.text()}`);
  }
  return res.json() as Promise<{
    access_token: string;
    refresh_token?: string;
    expires_in: number;
    scope: string;
    id_token?: string;
  }>;
}

export async function fetchGoogleUserInfo(accessToken: string) {
  const res = await fetch(USERINFO_ENDPOINT, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) throw new Error("Failed to fetch Google user info");
  return res.json() as Promise<{ sub: string; email?: string }>;
}

export async function saveAccountTokens(params: {
  googleSub: string;
  email?: string;
  accessToken: string;
  refreshToken?: string;
  expiresInSeconds: number;
  scope: string;
}) {
  const expiresAt = new Date(Date.now() + params.expiresInSeconds * 1000);
  const accessEnc = encrypt(params.accessToken);
  const refreshEnc = params.refreshToken ? encrypt(params.refreshToken) : null;

  await query(
    `INSERT INTO google_accounts (google_sub, email, access_token_enc, refresh_token_enc, access_token_expires_at, granted_scopes, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, now())
     ON CONFLICT (google_sub) DO UPDATE SET
       email = EXCLUDED.email,
       access_token_enc = EXCLUDED.access_token_enc,
       -- Keep the old refresh token if Google didn't issue a new one on this login.
       refresh_token_enc = COALESCE(EXCLUDED.refresh_token_enc, google_accounts.refresh_token_enc),
       access_token_expires_at = EXCLUDED.access_token_expires_at,
       granted_scopes = EXCLUDED.granted_scopes,
       updated_at = now()`,
    [
      params.googleSub,
      params.email ?? null,
      accessEnc,
      refreshEnc,
      expiresAt.toISOString(),
      params.scope,
    ]
  );
}

type AccountRow = {
  id: number;
  google_sub: string;
  email: string | null;
  access_token_enc: string;
  refresh_token_enc: string | null;
  access_token_expires_at: string;
  granted_scopes: string;
};

export async function getAccount(): Promise<AccountRow | null> {
  // Single-user app: just grab the one row.
  const res = await query<AccountRow>(
    `SELECT * FROM google_accounts ORDER BY updated_at DESC LIMIT 1`
  );
  return res.rows[0] ?? null;
}

/** Returns a valid (refreshed if necessary) access token for the connected account. */
export async function getValidAccessToken(): Promise<string> {
  const account = await getAccount();
  if (!account) {
    throw new HealthApiAuthError("No Google account connected. Sign in first.");
  }

  const expiresAt = new Date(account.access_token_expires_at).getTime();
  const isExpiringSoon = expiresAt - Date.now() < 60_000; // refresh if <60s left

  if (!isExpiringSoon) {
    return decrypt(account.access_token_enc);
  }

  if (!account.refresh_token_enc) {
    throw new HealthApiAuthError(
      "Access token expired and no refresh token is stored. Please reconnect your Google account."
    );
  }

  const refreshToken = decrypt(account.refresh_token_enc);
  const res = await fetch(TOKEN_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: must("GOOGLE_CLIENT_ID"),
      client_secret: must("GOOGLE_CLIENT_SECRET"),
      refresh_token: refreshToken,
      grant_type: "refresh_token",
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    if (res.status === 400 || res.status === 401) {
      throw new HealthApiAuthError(
        "Google refresh token was rejected (likely revoked). Please reconnect your Google account."
      );
    }
    throw new Error(`Token refresh failed: ${res.status} ${body}`);
  }

  const tokens = (await res.json()) as {
    access_token: string;
    expires_in: number;
    scope?: string;
  };

  await saveAccountTokens({
    googleSub: account.google_sub,
    email: account.email ?? undefined,
    accessToken: tokens.access_token,
    refreshToken: undefined, // Google usually doesn't reissue a refresh_token here
    expiresInSeconds: tokens.expires_in,
    scope: tokens.scope ?? account.granted_scopes,
  });

  return tokens.access_token;
}

export class HealthApiAuthError extends Error {}
export class HealthApiPermissionError extends Error {}

// Maps our internal activity types to Google Health API ExerciseType values.
// (See https://developers.google.com/health/data-types/workouts)
const ACTIVITY_TYPE_MAP: Record<string, string> = {
  running: "RUNNING",
  walking: "WALKING",
  cycling: "BIKING",
  hiking: "HIKING",
  swimming: "SWIMMING_OPEN_WATER",
  strength_training: "STRENGTH_TRAINING",
  other: "OTHER_WORKOUT",
};

export function mapActivityType(internal: string): string {
  return ACTIVITY_TYPE_MAP[internal] ?? "OTHER_WORKOUT";
}

export async function writeExerciseSession(workout: {
  id: string;
  activity_type: string;
  start_time: string; // ISO
  end_time: string; // ISO
  distance_km: string | number | null;
  calories: number | null;
  notes: string | null;
}): Promise<{ googleRecordId: string }> {
  const accessToken = await getValidAccessToken();

  const dataPoint: Record<string, any> = {
    startTime: new Date(workout.start_time).toISOString(),
    endTime: new Date(workout.end_time).toISOString(),
    exercise: {
      activityType: mapActivityType(workout.activity_type),
    },
    // Use our own idempotency key as the Google-side client id too, so a
    // retried write after a network failure can't create a duplicate on
    // Google's side either.
    metadata: {
      clientId: workout.id,
    },
  };

  if (workout.distance_km != null) {
    dataPoint.exercise.distanceMeters = Math.round(Number(workout.distance_km) * 1000);
  }
  if (workout.calories != null) {
    dataPoint.exercise.totalCaloriesBurned = workout.calories;
  }
  if (workout.notes) {
    dataPoint.exercise.notes = workout.notes.slice(0, 500);
  }

  const res = await fetch(
    `${HEALTH_API_BASE}/users/me/dataTypes/exercise/dataPoints`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(dataPoint),
    }
  );

  if (res.status === 401) {
    throw new HealthApiAuthError("Google rejected the access token (401). Try reconnecting.");
  }
  if (res.status === 403) {
    throw new HealthApiPermissionError(
      "Google denied permission (403). The connected account may not have granted the activity_and_fitness write scope."
    );
  }
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Google Health API write failed: ${res.status} ${body}`);
  }

  const json = (await res.json()) as { dataPointId?: string; id?: string };
  const googleRecordId = json.dataPointId ?? json.id;
  if (!googleRecordId) {
    throw new Error("Google Health API returned no data point id.");
  }
  return { googleRecordId };
}
