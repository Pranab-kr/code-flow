'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { createServerClient } from '@/lib/supabase/server';
import { EVENTS, inngest } from '@/lib/inngest/client';
import type { Language } from '@/lib/ir/types';

const MAX_SOURCE_BYTES = 100_000;
const MAX_SOURCE_LINES = 2000;

const STARTER: Record<Language, string> = {
  python: `def binary_search(arr, target):
    lo = 0
    hi = len(arr) - 1
    while lo <= hi:
        mid = (lo + hi) // 2
        if arr[mid] == target:
            return mid
        elif arr[mid] < target:
            lo = mid + 1
        else:
            hi = mid - 1
    return -1
`,
  cpp: `int binary_search(int* arr, int n, int target) {
    int lo = 0;
    int hi = n - 1;
    while (lo <= hi) {
        int mid = (lo + hi) / 2;
        if (arr[mid] == target) return mid;
        else if (arr[mid] < target) lo = mid + 1;
        else hi = mid - 1;
    }
    return -1;
}
`,
  java: `class Search {
    int binarySearch(int[] arr, int target) {
        int lo = 0;
        int hi = arr.length - 1;
        while (lo <= hi) {
            int mid = (lo + hi) / 2;
            if (arr[mid] == target) return mid;
            else if (arr[mid] < target) lo = mid + 1;
            else hi = mid - 1;
        }
        return -1;
    }
}
`,
  javascript: `function binarySearch(arr, target) {
  let lo = 0;
  let hi = arr.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (arr[mid] === target) return mid;
    else if (arr[mid] < target) lo = mid + 1;
    else hi = mid - 1;
  }
  return -1;
}
`,
};

function isLanguage(v: string): v is Language {
  return v === 'python' || v === 'cpp' || v === 'java' || v === 'javascript';
}

/**
 * Ask the durable pipeline to re-derive this snapshot's graph.
 *
 * Never throws. The snapshot is already saved by the time this runs, and the
 * user's diagram on screen came from their own local parse — so an unreachable
 * queue must not turn a successful save into an error. It marks the snapshot
 * 'failed' with a reason instead, which is the honest state: the source is
 * stored, the server-side analysis genuinely did not happen.
 *
 * This is the normal path in local development, where there is no event key and
 * no Inngest dev server running.
 */
async function queueAnalysis(snapshotId: string, projectId: string): Promise<void> {
  try {
    await inngest.send({
      name: EVENTS.codeSubmitted,
      data: { snapshotId, projectId },
    });
  } catch (err) {
    const supabase = await createServerClient();
    await supabase
      .from('snapshots')
      .update({
        status: 'failed',
        error: `Analysis could not be queued: ${
          err instanceof Error ? err.message : String(err)
        }`,
      })
      .eq('id', snapshotId);
  }
}

export async function createProject(formData: FormData): Promise<{ error?: string }> {
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const raw = String(formData.get('language') ?? 'python');
  const language: Language = isLanguage(raw) ? raw : 'python';
  const title = String(formData.get('title') ?? '').trim() || 'Untitled';

  const { data: project, error } = await supabase
    .from('projects')
    .insert({ user_id: user.id, title, language })
    .select('id')
    .single();
  if (error) return { error: 'Could not create that project. Try again.' };

  // Seed a snapshot so the canvas is never empty on first open — an empty canvas
  // gives a learner nothing to react to.
  // 'queued', not 'ready': the server has not derived a graph yet, and claiming
  // otherwise would make the status field meaningless.
  const { data: snapshot } = await supabase
    .from('snapshots')
    .insert({ project_id: project.id, source: STARTER[language], language, status: 'queued' })
    .select('id')
    .single();

  if (snapshot) {
    await supabase
      .from('projects')
      .update({ current_snapshot_id: snapshot.id })
      .eq('id', project.id);
    await queueAnalysis(snapshot.id, project.id);
  }

  revalidatePath('/projects');
  redirect(`/projects/${project.id}`);
}

/**
 * Persist an edit.
 *
 * The client sends SOURCE ONLY (spec §14.5). A client-computed graph is a
 * spoofable value, and the server has to reason about the graph later — for AI
 * grounding now and execution traces in P3 — so it derives its own.
 */
export async function saveSource(
  // The project id is pinned server-side. Language travels with source because a
  // paste can switch both, and the snapshot must record the parser actually used.
  projectId: string,
  language: string,
  source: string,
): Promise<{ ok?: true; error?: string; snapshotId?: string }> {
  if (!isLanguage(language)) return { error: 'Choose Python, C++, Java, or JavaScript.' };
  if (source.length > MAX_SOURCE_BYTES) {
    return { error: `That is over the ${MAX_SOURCE_BYTES / 1000}KB limit for one snapshot.` };
  }
  if (source.split('\n').length > MAX_SOURCE_LINES) {
    return { error: `That is over the ${MAX_SOURCE_LINES}-line limit for one snapshot.` };
  }

  const supabase = await createServerClient();

  // RLS already scopes this insert; failing here means not signed in.
  const { data: snapshot, error } = await supabase
    .from('snapshots')
    .insert({ project_id: projectId, source, language, status: 'queued' })
    .select('id')
    .single();
  if (error) {
    // Say what is still true: their local diagram is current either way.
    return { error: 'Could not save. Your diagram on screen is still up to date.' };
  }

  await supabase
    .from('projects')
    .update({
      current_snapshot_id: snapshot.id,
      language,
      updated_at: new Date().toISOString(),
    })
    .eq('id', projectId);

  await queueAnalysis(snapshot.id, projectId);

  // ok:true reports the SAVE, which succeeded. Whether the analysis queued is a
  // separate concern, recorded on the snapshot rather than shown as a save error.
  //
  // The id goes back so the client can follow THIS snapshot's server-side status.
  // Every edit mints a new row, so a client holding only the id it loaded with
  // would sit watching a snapshot that stopped being current several edits ago.
  return { ok: true, snapshotId: snapshot.id };
}

/**
 * Re-queue analysis for a snapshot that failed.
 *
 * What the retry affordance on a `failed` status calls. Deliberately re-sends the
 * event rather than creating a new snapshot: the source is already stored and
 * unchanged, so a second row would be history that records no edit.
 *
 * Sets `queued` first, so the indicator moves the moment the user clicks even if
 * the queue takes a while to pick the job up. RLS scopes the update, so this
 * cannot touch another user's snapshot.
 */
export async function retryAnalysis(
  projectId: string,
  snapshotId: string,
): Promise<{ ok?: true; error?: string }> {
  const supabase = await createServerClient();

  const { error } = await supabase
    .from('snapshots')
    .update({ status: 'queued', error: null })
    .eq('id', snapshotId)
    .eq('project_id', projectId);
  if (error) return { error: 'Could not retry that analysis.' };

  await queueAnalysis(snapshotId, projectId);
  return { ok: true };
}

export async function deleteProject(projectId: string): Promise<void> {
  const supabase = await createServerClient();
  await supabase.from('projects').delete().eq('id', projectId);
  revalidatePath('/projects');
  redirect('/projects');
}
