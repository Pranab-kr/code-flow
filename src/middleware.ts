import { type NextRequest } from 'next/server';
import { updateSession } from '@/lib/supabase/middleware';

export async function middleware(request: NextRequest) {
  return updateSession(request);
}

export const config = {
  // `grammars` and `wasm` are excluded deliberately: running an auth round trip
  // in front of a 3MB wasm fetch is pure added latency.
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|grammars|.*\\.(?:svg|png|jpg|jpeg|gif|webp|woff2?|wasm)$).*)',
  ],
};
