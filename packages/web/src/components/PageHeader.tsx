import type { ReactNode } from "react";

interface PageHeaderProps {
  title: string;
  description?: string;
  eyebrow?: string;
  actions?: ReactNode;
}

export function PageHeader({ title, description, eyebrow, actions }: PageHeaderProps) {
  return (
    <div className="rounded-lg border border-line bg-panel/85 px-5 py-4 shadow-card">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0">
          {eyebrow && (
            <div className="mb-2 text-xs font-semibold uppercase tracking-[0.18em] text-accent-2">
              {eyebrow}
            </div>
          )}
          <h1 className="text-2xl font-semibold text-ink">{title}</h1>
          {description && (
            <p className="mt-2 max-w-3xl text-sm leading-6 text-muted">{description}</p>
          )}
        </div>
        {actions && <div className="flex shrink-0 flex-wrap items-center justify-end gap-2">{actions}</div>}
      </div>
    </div>
  );
}
