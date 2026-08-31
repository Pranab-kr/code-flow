import { notFound, redirect } from 'next/navigation';
import { createServerClient } from '@/lib/supabase/server';
import { Workbench } from '@/components/workbench/Workbench';
import { saveSource, retryAnalysis } from '../actions';
import { saveOverride } from './layout-actions';
import type { Language } from '@/lib/ir/types';

export default async function ProjectPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createServerClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  // RLS scopes this: someone else's id simply returns nothing, which is a 404
  // rather than a 403 — we do not confirm that another user's project exists.
  const { data: project } = await supabase
    .from('projects')
    .select('id, title, language, current_snapshot_id')
    .eq('id', id)
    .single();
  if (!project) notFound();

  const { data: snapshot } = project.current_snapshot_id
    ? await supabase
        .from('snapshots')
        .select('source')
        .eq('id', project.current_snapshot_id)
        .single()
    : { data: null };

  const { data: overrides } = await supabase
    .from('layout_overrides')
    .select('node_id, x, y')
    .eq('project_id', project.id)
    .is('orphaned_at', null);

  // Bind the ids server-side: the client should not be able to choose which
  // project it writes to, even though RLS would also stop it.
  //
  // .bind() on a server action, NOT an inline arrow. A closure defined here
  // cannot cross the server/client boundary -- React can only serialize a
  // reference to a "use server" function, so wrapping one in
  // `(s) => save(s, language)` throws at render and 500s the whole page.
  // Both the project id and the language are bound, leaving the client a
  // one-argument function that takes only the source.
  const language = project.language as Language;
  const save = saveSource.bind(null, project.id, language);
  const moveNode = saveOverride.bind(null, project.id);
  const retry = retryAnalysis.bind(null, project.id);

  return (
    <Workbench
      projectId={project.id}
      title={project.title}
      language={language}
      onSave={save}
      onNodeMoved={moveNode}
      onRetry={retry}
      initialSnapshotId={project.current_snapshot_id ?? undefined}
      initialSource={snapshot?.source ?? ''}
      initialOverrides={Object.fromEntries(
        (overrides ?? []).map((o) => [o.node_id, { x: o.x, y: o.y }]),
      )}
    />
  );
}
