interface Metric {
  label: string;
  value: number | string;
}

interface MetricsRowProps {
  metrics: Metric[];
}

export function MetricsRow({ metrics }: MetricsRowProps) {
  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
      {metrics.map((m) => (
        <div
          key={m.label}
          className="bg-panel rounded-xl border border-line p-4 shadow-card"
        >
          <div className="text-2xl font-bold text-ink">{m.value}</div>
          <div className="text-xs text-muted mt-1">{m.label}</div>
        </div>
      ))}
    </div>
  );
}
