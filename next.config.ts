import type { NextConfig } from 'next';

const config: NextConfig = {
  images: {
    remotePatterns: [
      { protocol: 'https', hostname: 'crests.football-data.org' },
      { protocol: 'https', hostname: 'resources.premierleague.com' },
      // news_items.image_url hosts, derived from the actual data (see
      // .superpowers/sdd/redesign-foundation-report.md for the query):
      // 87 BBC, 16+15+9 Sky Sports (365dm.com's three image subdomains).
      { protocol: 'https', hostname: 'ichef.bbci.co.uk' },
      { protocol: 'https', hostname: 'e0.365dm.com' },
      { protocol: 'https', hostname: 'e1.365dm.com' },
      { protocol: 'https', hostname: 'e2.365dm.com' },
    ],
  },
  // Next 16 dev server otherwise writes AGENTS.md/CLAUDE.md scaffolding files
  // into the repo root on every `next dev`; not part of this task's scope.
  agentRules: false,
};

export default config;
