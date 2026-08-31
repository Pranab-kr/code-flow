import { inngest } from '../client';
import { createServiceClient } from '@/lib/supabase/server';
import { ORPHAN_RETENTION_DAYS } from '@/lib/layout/overrides';

/**
 * Delete layout overrides that have been orphaned longer than the retention
 * window.
 *
 * The retention exists because a node can vanish for a single parse when the
 * source is briefly unparseable; this job is what stops those rows accumulating
 * forever once a node is genuinely gone for good.
 */
export const gcOverrides = inngest.createFunction(
  {
    id: 'gc-orphaned-overrides',
    // Off-peak and off the hour, so it does not pile onto every other cron.
    triggers: [{ cron: '17 4 * * *' }],
  },
  async ({ step }) => {
    const deleted = await step.run('delete-expired', async () => {
      const db = createServiceClient();
      const cutoff = new Date(
        Date.now() - ORPHAN_RETENTION_DAYS * 86_400_000,
      ).toISOString();
      const { data } = await db
        .from('layout_overrides')
        .delete()
        .lt('orphaned_at', cutoff)
        .select('id');
      return data?.length ?? 0;
    });
    return { deleted };
  },
);
