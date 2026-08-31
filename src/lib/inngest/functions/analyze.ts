import { NonRetriableError } from 'inngest';
import { EVENTS, inngest, type CodeSubmittedData } from '../client';
import { createServiceClient } from '@/lib/supabase/server';
import { parseToIR } from '@/lib/ir/parse';
import { layoutProgram } from '@/lib/layout/elk';
import { IR_VERSION, type Language } from '@/lib/ir/types';

/**
 * Re-parse a snapshot AUTHORITATIVELY and store the derived graph.
 *
 * The client already computed a graph locally for display, and that one is never
 * uploaded or trusted (spec §14.5): it is a value a client could forge, and the
 * server has to reason about the graph itself — for AI grounding now, execution
 * traces in P3. So the server derives its own from the stored source, using the
 * identical portable IR module the browser worker runs.
 *
 * Uses the service-role client because it runs with no user session. Every read
 * and write is scoped by snapshot id, which the event carries.
 */
export const analyze = inngest.createFunction(
  // inngest 4.x takes (options, handler): the trigger lives INSIDE options, where
  // 3.x passed it as a separate second argument.
  {
    id: 'analyze-snapshot',
    retries: 3,
    triggers: [{ event: EVENTS.codeSubmitted }],
  },
  async ({ event, step }) => {
    const { snapshotId } = event.data as CodeSubmittedData;
    const db = createServiceClient();

    const snapshot = await step.run('load-snapshot', async () => {
      const { data, error } = await db
        .from('snapshots')
        .select('id, source, language, project_id')
        .eq('id', snapshotId)
        .single();
      // A deleted snapshot will never appear, so retrying is pointless.
      if (error || !data) {
        throw new NonRetriableError(`snapshot ${snapshotId} not found`);
      }
      return data;
    });

    await step.run('mark-parsing', async () => {
      await db.from('snapshots').update({ status: 'parsing' }).eq('id', snapshotId);
    });

    try {
      const { ir, layout } = await step.run('parse-and-layout', async () => {
        // baseUrl 'public': in Node, Language.load reads a path relative to cwd,
        // which is the repo root. Verified in Next's node runtime.
        const parsed = await parseToIR(snapshot.source, snapshot.language as Language, {
          baseUrl: 'public',
        });
        const laid = await layoutProgram(parsed.functions);
        return { ir: parsed, layout: laid };
      });

      await step.run('write-graph', async () => {
        await db
          .from('graphs')
          .upsert(
            { snapshot_id: snapshotId, ir, layout, ir_version: IR_VERSION },
            { onConflict: 'snapshot_id' },
          );
        // A syntax error is NOT a job failure: tree-sitter is error-tolerant, so a
        // partial graph is a real result. `status: ready` with diagnostics attached
        // is the honest outcome — the canvas shows what it could derive (spec §11).
        await db
          .from('snapshots')
          .update({ status: 'ready', error: null })
          .eq('id', snapshotId);
      });

      return {
        ok: true,
        functions: ir.functions.length,
        diagnostics: ir.diagnostics.length,
      };
    } catch (err) {
      // Record why before rethrowing, so the UI can say more than "it broke".
      await step.run('mark-failed', async () => {
        await db
          .from('snapshots')
          .update({
            status: 'failed',
            error: err instanceof Error ? err.message : String(err),
          })
          .eq('id', snapshotId);
      });
      throw err;
    }
  },
);
