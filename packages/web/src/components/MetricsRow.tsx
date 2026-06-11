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
          className="rounded-lg border border-line bg-panel/85 p-4 shadow-card"
        >
          <div className="text-2xl font-semibold text-ink">{m.value}</div>
          <div className="mt-1 text-xs text-muted">{m.label}</div>
        </div>
      ))}
    </div>
  );
}
