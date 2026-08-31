import { serve } from 'inngest/next';
import { inngest } from '@/lib/inngest/client';
import { analyze } from '@/lib/inngest/functions/analyze';
import { gcOverrides } from '@/lib/inngest/functions/gc-overrides';

// nodejs, not edge: parseToIR loads wasm from the filesystem and the service
// client needs node crypto.
export const runtime = 'nodejs';

export const { GET, POST, PUT } = serve({
  client: inngest,
  functions: [analyze, gcOverrides],
});
