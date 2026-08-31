import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // We maintain AGENTS.md by hand (it points at CLAUDE.md as the canonical guide).
  // Next regenerates its own on dev/build, which silently overwrites ours.
  agentRules: false,

  // Vercel uploads public/ to the CDN but does NOT place it on a serverless
  // function's filesystem, so the Inngest job's `parseToIR` hit
  //   ENOENT: open 'public/grammars/tree-sitter-python.wasm'
  // in production while working locally, where cwd is the repo root.
  // Tracing the wasm in puts it beside the function so the same cwd-relative
  // path resolves in both places.
  outputFileTracingIncludes: {
    '/api/inngest': ['./public/grammars/**'],
  },
};

export default nextConfig;
