import { query } from "./db";
import {
  writeExerciseSession,
  HealthApiAuthError,
  HealthApiPermissionError,
} from "./googleHealth";

export async function attemptSync(workoutId: string): Promise<boolean> {
  const res = await query(`SELECT * FROM workouts WHERE id = $1`, [workoutId]);
  const workout = res.rows[0];
  if (!workout) return false;

  try {
    const { googleRecordId } = await writeExerciseSession(workout);
    await query(
      `UPDATE workouts
       SET sync_status = 'synced', google_record_id = $2, sync_error = NULL,
           sync_attempts = sync_attempts + 1, last_synced_at = now(), updated_at = now()
       WHERE id = $1`,
      [workoutId, googleRecordId]
    );
    return true;
  } catch (err: any) {
    let message = err.message ?? "Unknown sync error";
    if (err instanceof HealthApiAuthError) {
      message = `Not connected / token invalid: ${err.message}`;
    } else if (err instanceof HealthApiPermissionError) {
      message = `Permission denied: ${err.message}`;
    }
    await query(
      `UPDATE workouts
       SET sync_status = 'failed', sync_error = $2,
           sync_attempts = sync_attempts + 1, updated_at = now()
       WHERE id = $1`,
      [workoutId, message]
    );
    return false;
  }
}
