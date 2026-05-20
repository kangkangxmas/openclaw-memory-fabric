import type { ReactNode } from "react";

interface LayoutProps {
  sidebar: ReactNode;
  children: ReactNode;
}

export function Layout({ sidebar, children }: LayoutProps) {
  return (
    <div className="mx-auto max-w-[1440px] px-4 pb-8">
      <div className="flex gap-6 mt-2">
        <aside className="w-[340px] shrink-0 sticky top-2 self-start max-h-[calc(100vh-72px)] overflow-y-auto">
          {sidebar}
        </aside>
        <main className="flex-1 min-w-0">{children}</main>
      </div>
    </div>
  );
}
