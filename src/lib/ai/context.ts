/**
 * Grounded chat context: a deterministic, token-budgeted text summary of the
 * user's source plus its derived control-flow graph.
 *
 * This lives in src/lib/ai/ (not src/lib/ir/) so it may import IR *types*.
 * It never imports IR logic, React, Next, or DOM globals — the caller hands it
 * an already-parsed ProgramIR, ideally re-derived on the server.
 */
import type { FunctionGraph, ProgramIR } from '@/lib/ir/types';

/** Source excerpt budget: enough for a real file, small enough to leave room. */
const MAX_SOURCE_CHARS = 8000;
/** Per-function caps so one giant function cannot eat the whole window. */
const MAX_NODES_PER_FUNCTION = 120;
const MAX_EDGES_PER_FUNCTION = 200;
/** Hard ceiling on the returned string. Must stay under the 24k plan budget. */
const MAX_TOTAL_CHARS = 23_000;
const TRUNCATION_MARKER = '…[truncated]';

function truncate(text: string, budget: number): string {
  if (text.length <= budget) return text;
  return text.slice(0, budget - TRUNCATION_MARKER.length) + TRUNCATION_MARKER;
}

function summarizeFunction(fn: FunctionGraph): string {
  const lines: string[] = [];
  const params = fn.params.length > 0 ? `(${fn.params.join(', ')})` : '()';
  lines.push(`## Function ${fn.name}${params}`);
  lines.push(`Graph id: ${fn.id}`);
  lines.push(`Entry: ${fn.entryId}`);
  lines.push(`Exits: ${fn.exitIds.join(', ')}`);

  const shownNodes = fn.nodes.slice(0, MAX_NODES_PER_FUNCTION);
  lines.push(`Nodes (${fn.nodes.length}):`);
  for (const node of shownNodes) {
    const loop = node.meta?.loopKind !== undefined ? ` loop:${node.meta.loopKind}` : '';
    lines.push(
      `- ${node.id} [${node.kind}] ${node.label} (lines ${node.span.startLine}-${node.span.endLine})${loop}`,
    );
  }
  if (fn.nodes.length > shownNodes.length) {
    lines.push(TRUNCATION_MARKER);
  }

  const shownEdges = fn.edges.slice(0, MAX_EDGES_PER_FUNCTION);
  lines.push(`Edges (${fn.edges.length}):`);
  for (const edge of shownEdges) {
    lines.push(`- ${edge.source} --${edge.kind}--> ${edge.target}`);
  }
  if (fn.edges.length > shownEdges.length) {
    lines.push(TRUNCATION_MARKER);
  }
  return lines.join('\n');
}

/**
 * Render source + structural graph summary as plain text for the chat model.
 * Deterministic: no timestamps, no random ids, fixed caps. Never embeds the
 * raw IR json — node/edge counts and labels carry the structure instead.
 */
export function buildContext(ir: ProgramIR, source: string, selectedNodeId?: string): string {
  const parts: string[] = [];

  parts.push('# Code under discussion');
  parts.push('```' + ir.language);
  parts.push(truncate(source, MAX_SOURCE_CHARS));
  parts.push('```');

  parts.push('# Control-flow summary');
  if (ir.functions.length === 0) {
    parts.push('(no functions found)');
  }
  for (const fn of ir.functions) {
    parts.push(summarizeFunction(fn));
  }

  if (selectedNodeId !== undefined) {
    const selected = ir.functions.flatMap((fn) => fn.nodes).find((n) => n.id === selectedNodeId);
    if (selected !== undefined) {
      const loop = selected.meta?.loopKind !== undefined ? ` loop:${selected.meta.loopKind}` : '';
      parts.push(
        `Selected node: ${selected.id} [${selected.kind}] ${selected.label} ` +
          `(lines ${selected.span.startLine}-${selected.span.endLine})${loop}`,
      );
    } else {
      parts.push(`Selected node: ${selectedNodeId} (not found in graph)`);
    }
  }

  const errors = ir.diagnostics.filter((d) => d.severity === 'error');
  if (errors.length > 0) {
    parts.push(`Syntax errors: ${errors.length} found; the code may not parse as written.`);
    for (const d of errors) {
      parts.push(`- syntax error (lines ${d.span.startLine}-${d.span.endLine}): ${d.message}`);
    }
  }
  const warnings = ir.diagnostics.filter((d) => d.severity === 'warning');
  if (warnings.length > 0) {
    parts.push(`Warnings: ${warnings.length}`);
    for (const d of warnings) {
      parts.push(`- warning (lines ${d.span.startLine}-${d.span.endLine}): ${d.message}`);
    }
  }

  return truncate(parts.join('\n'), MAX_TOTAL_CHARS);
}
