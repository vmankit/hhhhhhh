"use client";

import { useState } from "react";
import { ACTIVITY_TYPES, WorkoutRecord } from "@/lib/workouts";

const LABELS: Record<string, string> = Object.fromEntries(
  ACTIVITY_TYPES.map((a) => [a.value, a.label])
);

function formatDate(iso: string) {
  const d = new Date(iso);
  return d.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
}

export default function WorkoutRow({
  workout,
  onRetried,
}: {
  workout: WorkoutRecord;
  onRetried: () => void;
}) {
  const [retrying, setRetrying] = useState(false);

  async function retry() {
    setRetrying(true);
    try {
      await fetch(`/api/workouts/${workout.id}/sync`, { method: "POST" });
    } finally {
      setRetrying(false);
      onRetried();
    }
  }

  return (
    <div className="flex items-start justify-between rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
      <div className="min-w-0">
        <p className="font-medium">{LABELS[workout.activity_type] ?? workout.activity_type}</p>
        <p className="text-sm text-gray-500">
          {workout.distance_km ? `${Number(workout.distance_km).toFixed(2)} km · ` : ""}
          {workout.duration_minutes} min
        </p>
        <p className="text-sm text-gray-500">{formatDate(workout.start_time)}</p>
        {workout.sync_status === "failed" && workout.sync_error && (
          <p className="mt-1 max-w-xs truncate text-xs text-red-600" title={workout.sync_error}>
            {workout.sync_error}
          </p>
        )}
      </div>

      <div className="flex flex-shrink-0 flex-col items-end gap-2">
        <StatusBadge status={workout.sync_status} />
        {workout.sync_status === "failed" && (
          <button
            onClick={retry}
            disabled={retrying}
            className="text-xs font-medium text-brand-600 hover:underline disabled:opacity-60"
          >
            {retrying ? "Retrying..." : "Retry sync"}
          </button>
        )}
      </div>
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, { label: string; cls: string }> = {
    synced: { label: "✓ Synced", cls: "bg-green-50 text-green-700" },
    pending: { label: "⏳ Pending", cls: "bg-amber-50 text-amber-700" },
    failed: { label: "✕ Failed", cls: "bg-red-50 text-red-700" },
  };
  const s = map[status] ?? map.pending;
  return (
    <span className={`whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-medium ${s.cls}`}>
      {s.label}
    </span>
  );
}
