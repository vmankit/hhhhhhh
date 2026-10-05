import { Pool, QueryResultRow } from "pg";

// Reuse a single pool across hot reloads / lambda invocations.
declare global {
  // eslint-disable-next-line no-var
  var __pgPool: Pool | undefined;
}

function createPool() {
  const connectionString = process.env.POSTGRES_URL;
  if (!connectionString) {
    throw new Error(
      "POSTGRES_URL is not set. Add it in your Vercel project's Environment Variables (see README)."
    );
  }
  return new Pool({
    connectionString,
    ssl: connectionString.includes("sslmode=disable")
      ? false
      : { rejectUnauthorized: false },
    max: 5,
  });
}

export const pool = global.__pgPool ?? createPool();
if (process.env.NODE_ENV !== "production") {
  global.__pgPool = pool;
}

export async function query<T extends QueryResultRow = any>(text: string, params?: any[]) {
  const client = await pool.connect();
  try {
    const res = await client.query<T>(text, params);
    return res;
  } finally {
    client.release();
  }
}
