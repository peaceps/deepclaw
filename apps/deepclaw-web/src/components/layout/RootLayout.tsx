'use client';

import { useState } from 'react';
import { Sidebar } from './Sidebar';

interface RootLayoutProps {
  children: React.ReactNode;
}

export function RootLayout({ children }: RootLayoutProps) {
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);

  return (
    <>
      <Sidebar
        collapsed={sidebarCollapsed}
        onToggle={() => setSidebarCollapsed(!sidebarCollapsed)}
      />
      <main className="flex-1 overflow-hidden w-full lg:h-screen h-[calc(100vh-57px)]">{children}</main>
    </>
  );
}
