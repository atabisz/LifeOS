// Configuration for bug bounty tracker

import { homedir } from 'os';
import { join } from 'path';

const BOUNTY_ROOT = join(homedir(), '.claude', 'skills', 'hacking', 'bug-bounties');

export const CONFIG = {
  // GitHub repository
  repo: {
    owner: 'arkadiyt',
    name: 'bounty-targets-data',
  },

  // Data file paths in the repository
  files: {
    domains_txt: 'domains.txt',
    hackerone: 'data/hackerone_data.json',
    bugcrowd: 'data/bugcrowd_data.json',
    intigriti: 'data/intigriti_data.json',
    yeswehack: 'data/yeswehack_data.json',
  },

  // Local paths
  paths: {
    root: BOUNTY_ROOT,
    state: join(BOUNTY_ROOT, 'state.json'),
    cache: join(BOUNTY_ROOT, 'cache'),
    logs: join(BOUNTY_ROOT, 'logs'),
  },

  // GitHub API
  api: {
    base: 'https://api.github.com',
    raw_base: 'https://raw.githubusercontent.com',
  },

  // Cache settings
  cache: {
    max_age_days: 30,
    metadata_file: 'programs_metadata.json',
    recent_changes_file: 'recent_changes.json',
  },
} as const;
