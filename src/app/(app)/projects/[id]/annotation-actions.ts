'use server';

import { createServerClient } from '@/lib/supabase/server';
import { MAX_ANNOTATION_BODY, type Annotation } from '@/lib/annotations';

interface NewNote {
  body: string;
  x: number;
  y: number;
  nodeId: string | null;
}

function cleanBody(body: unknown): string | null {
  if (typeof body !== 'string') return null;
  if (body.length > MAX_ANNOTATION_BODY) return null;
  return body;
}

function cleanCoord(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

type Row = {
  id: string;
  node_id: string | null;
  body: string;
  x: number;
  y: number;
};

function toAnnotation(r: Row): Annotation {
  return { id: r.id, nodeId: r.node_id, body: r.body, x: r.x, y: r.y };
}

/**
 * Create a sticky note. RLS scopes the insert to projects the caller owns —
 * writing into someone else's project fails here, and that error is real.
 */
export async function createAnnotation(
  projectId: string,
  input: NewNote,
): Promise<{ ok?: true; error?: string; annotation?: Annotation }> {
  const body = cleanBody(input.body);
  const x = cleanCoord(input.x);
  const y = cleanCoord(input.y);
  const nodeId = input.nodeId;
  if (body === null || x === null || y === null) return { error: 'That note is not valid.' };
  if (nodeId !== null && typeof nodeId !== 'string') return { error: 'That note is not valid.' };

  const supabase = await createServerClient();
  const { data, error } = await supabase
    .from('annotations')
    .insert({ project_id: projectId, node_id: nodeId, body, x, y })
    .select('id, node_id, body, x, y')
    .single();
  if (error || !data) return { error: 'Could not add that note.' };
  return { ok: true, annotation: toAnnotation(data as Row) };
}

/** Save note text on blur. The note keeps its position. */
export async function updateAnnotationBody(
  projectId: string,
  annotationId: string,
  body: string,
): Promise<{ ok?: true; error?: string }> {
  const clean = cleanBody(body);
  if (clean === null) return { error: 'That note is not valid.' };
  const supabase = await createServerClient();
  const { error } = await supabase
    .from('annotations')
    .update({ body: clean })
    .eq('id', annotationId)
    .eq('project_id', projectId);
  if (error) return { error: 'Could not save that note.' };
  return { ok: true };
}

/** Persist a dragged note. Anchored or free-floating — position is position. */
export async function moveAnnotation(
  projectId: string,
  annotationId: string,
  x: number,
  y: number,
): Promise<{ ok?: true; error?: string }> {
  const cx = cleanCoord(x);
  const cy = cleanCoord(y);
  if (cx === null || cy === null) return { error: 'That note is not valid.' };
  const supabase = await createServerClient();
  const { error } = await supabase
    .from('annotations')
    .update({ x: cx, y: cy })
    .eq('id', annotationId)
    .eq('project_id', projectId);
  if (error) return { error: 'Could not save that note position.' };
  return { ok: true };
}

export async function deleteAnnotation(
  projectId: string,
  annotationId: string,
): Promise<{ ok?: true; error?: string }> {
  const supabase = await createServerClient();
  const { error } = await supabase
    .from('annotations')
    .delete()
    .eq('id', annotationId)
    .eq('project_id', projectId);
  if (error) return { error: 'Could not delete that note.' };
  return { ok: true };
}
