'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { createServerClient } from '@/lib/supabase/server';
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
  // cpp and java have no adapter yet (Plan 3). Their starters exist so the seed
  // path is uniform, but the picker must not offer them until the adapters land.
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
};

function isLanguage(v: string): v is Language {
  return v === 'python' || v === 'cpp' || v === 'java';
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
  const { data: snapshot } = await supabase
    .from('snapshots')
    .insert({ project_id: project.id, source: STARTER[language], language, status: 'ready' })
    .select('id')
    .single();

  if (snapshot) {
    await supabase
      .from('projects')
      .update({ current_snapshot_id: snapshot.id })
      .eq('id', project.id);
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
  projectId: string,
  source: string,
  language: string,
): Promise<{ ok?: true; error?: string }> {
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
    .insert({ project_id: projectId, source, language, status: 'ready' })
    .select('id')
    .single();
  if (error) {
    // Say what is still true: their local diagram is current either way.
    return { error: 'Could not save. Your diagram on screen is still up to date.' };
  }

  await supabase
    .from('projects')
    .update({ current_snapshot_id: snapshot.id, updated_at: new Date().toISOString() })
    .eq('id', projectId);

  return { ok: true };
}

export async function deleteProject(projectId: string): Promise<void> {
  const supabase = await createServerClient();
  await supabase.from('projects').delete().eq('id', projectId);
  revalidatePath('/projects');
  redirect('/projects');
}
