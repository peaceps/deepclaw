'use client';

import { useRef } from 'react';
import {initI18n} from '@/i18n';
import { Sidebar } from './Sidebar';
import type { DeepclawConfig } from '@deepclaw/config';

interface RootLayoutProps {
  lang: string;
  manager: DeepclawConfig['manager'];
  children: React.ReactNode;
}

export function RootLayout({ manager, lang, children }: RootLayoutProps) {
  const i18nInitRef = useRef<boolean | null>(null);
  if (i18nInitRef.current === null) {
      initI18n(lang);
      i18nInitRef.current = true;
  }

  return (
    <>
      <Sidebar
        manager={manager}
      />
      <main className="flex-1 overflow-hidden w-full h-full pt-[57px] lg:pt-0">{children}</main>
    </>
  );
}
