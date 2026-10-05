"use client";

import { useEffect, useState, useCallback } from "react";
import WorkoutForm from "./components/WorkoutForm";
import WorkoutRow from "./components/WorkoutRow";
import { WorkoutRecord } from "@/lib/workouts";

type AuthStatus = { connected: boolean; email?: string };

export default function Home() {
  const [auth, setAuth] = useState<AuthStatus | null>(null);
  const [workouts, setWorkouts] = useState<WorkoutRecord[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    const [authRes, workoutsRes] = await Promise.all([
      fetch("/api/auth/status").then((r) => r.json()),
      fetch("/api/workouts").then((r) => r.json()),
    ]);
    setAuth(authRes);
    setWorkouts(workoutsRes.workouts ?? []);
    setLoading(false);
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return (
    <main>
      <header className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-bold">Manual Health Logger</h1>
      </header>

      <ConnectionBanner auth={auth} />

      {!showForm && (
        <button
          onClick={() => setShowForm(true)}
          className="mb-6 w-full rounded-xl bg-brand-600 py-3 font-medium text-white shadow-sm hover:bg-brand-700 sm:w-auto sm:px-6"
        >
          + Add Workout
        </button>
      )}

      {showForm && (
        <div className="mb-6">
          <WorkoutForm
            onSaved={() => {
              setShowForm(false);
              refresh();
            }}
            onCancel={() => setShowForm(false)}
          />
        </div>
      )}

      <section>
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-gray-500">
          Recent Activity
        </h2>
        {loading ? (
          <p className="text-sm text-gray-500">Loading...</p>
        ) : workouts.length === 0 ? (
          <p className="text-sm text-gray-500">No workouts logged yet.</p>
        ) : (
          <div className="space-y-3">
            {workouts.map((w) => (
              <WorkoutRow key={w.id} workout={w} onRetried={refresh} />
            ))}
          </div>
        )}
      </section>
    </main>
  );
}

function ConnectionBanner({ auth }: { auth: AuthStatus | null }) {
  if (auth === null) return null;

  if (auth.connected) {
    return (
      <div className="mb-6 rounded-xl border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-800">
        Google Account: connected ✓ &nbsp;·&nbsp; Health API: connected ✓
        {auth.email ? ` (${auth.email})` : ""}
      </div>
    );
  }

  return (
    <div className="mb-6 flex items-center justify-between rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
      <span>Connect your Google account to sync workouts to Google Health.</span>
      <a
        href="/api/auth/google"
        className="ml-3 whitespace-nowrap rounded-lg bg-amber-600 px-3 py-1.5 font-medium text-white hover:bg-amber-700"
      >
        Connect
      </a>
    </div>
  );
}
