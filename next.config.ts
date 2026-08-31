import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // We maintain AGENTS.md by hand (it points at CLAUDE.md as the canonical guide).
  // Next regenerates its own on dev/build, which silently overwrites ours.
  agentRules: false,
};

export default nextConfig;
