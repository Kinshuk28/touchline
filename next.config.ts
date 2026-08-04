import type { NextConfig } from 'next';

const config: NextConfig = {
  images: {
    remotePatterns: [
      { protocol: 'https', hostname: 'crests.football-data.org' },
      { protocol: 'https', hostname: 'resources.premierleague.com' },
    ],
  },
  // Next 16 dev server otherwise writes AGENTS.md/CLAUDE.md scaffolding files
  // into the repo root on every `next dev`; not part of this task's scope.
  agentRules: false,
};

export default config;
