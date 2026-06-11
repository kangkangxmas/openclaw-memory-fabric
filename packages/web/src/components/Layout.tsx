import type { ReactNode } from "react";

interface LayoutProps {
  sidebar: ReactNode;
  children: ReactNode;
}

export function Layout({ sidebar, children }: LayoutProps) {
  return (
    <div className="mx-auto max-w-[1680px] px-5 pb-10">
      <div className="flex gap-5 pt-5">
        <aside className="sticky top-[76px] h-[calc(100vh-96px)] w-[320px] shrink-0 overflow-y-auto">
          {sidebar}
        </aside>
        <main className="min-w-0 flex-1 pb-10">{children}</main>
      </div>
    </div>
  );
}
