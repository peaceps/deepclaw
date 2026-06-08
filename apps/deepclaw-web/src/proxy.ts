import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import {isConfigValid} from '@/server/database';

export function proxy(request: NextRequest) {
  const valid = isConfigValid();
  if (!valid && request.nextUrl.pathname !== '/settings') {
    return NextResponse.redirect(new URL('/settings', request.url));
  }
  return NextResponse.next();
}

export const config = {
  matcher: ['/agents/:path*', '/chat/:path*', '/org/:path*', '/tasks/:path*', ]
};
