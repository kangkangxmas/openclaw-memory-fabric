import type { ReactNode } from "react";

interface LayoutProps {
  sidebar: ReactNode;
  children: ReactNode;
}

export function Layout({ sidebar, children }: LayoutProps) {
  return (
    <div className="w-full px-4 pb-10 sm:px-5 lg:px-6">
      <div className="grid min-w-0 gap-5 pt-5 lg:grid-cols-[320px_minmax(0,1fr)]">
        <aside className="min-w-0 lg:sticky lg:top-[76px] lg:h-[calc(100vh-96px)] lg:overflow-y-auto">
          {sidebar}
        </aside>
        <main className="min-w-0 pb-10">{children}</main>
      </div>
    </div>
  );
}
