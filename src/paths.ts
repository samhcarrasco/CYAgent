import { existsSync, readFileSync } from 'node:fs';
import { writeFile, mkdir } from 'node:fs/promises';
import { dirname, join, normalize } from 'node:path';
import { execSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { homedir } from 'node:os';
import { CyaError } from './errors.js';

export function findGitRoot(startDir: string): string | null {
  let current = startDir;
  while (true) {
    if (existsSync(join(current, '.git'))) return current;
    const parent = dirname(current);
    if (parent === current) return null;
    current = parent;
  }
}

export function getBranchName(repoRoot: string): string | undefined {
  // Primary: git command works when commits exist.
  try {
    const raw = execSync('git rev-parse --abbrev-ref HEAD', {
      cwd: repoRoot,
      stdio: 'pipe',
    })
      .toString()
      .trim();
    if (raw && raw !== 'HEAD') return raw;
  } catch {
    // no commits yet — fall through
  }
  // Fallback: read .git/HEAD directly (works before the first commit).
  try {
    const content = readFileSync(join(repoRoot, '.git', 'HEAD'), 'utf8').trim();
    const match = content.match(/^ref: refs\/heads\/(.+)$/);
    if (match?.[1]) return match[1];
  } catch {
    // ignore
  }
  return undefined;
}

export function getAppDataRoot(
  platform = process.platform,
  env: Record<string, string | undefined> = process.env,
  homeDir = homedir(),
): string {
  const override = env['CYA_DATA_HOME'];
  if (override) return override;
  if (platform === 'win32') {
    const base = env['LOCALAPPDATA'] ?? join(homeDir, 'AppData', 'Local');
    return join(base, 'cya');
  }
  if (platform === 'darwin') {
    return join(homeDir, 'Library', 'Application Support', 'cya');
  }
  const base = env['XDG_STATE_HOME'] ?? join(homeDir, '.local', 'state');
  return join(base, 'cya');
}

export function normalizeRepoRoot(repoRoot: string): string {
  const n = normalize(repoRoot);
  if (process.platform === 'win32') return n.toLowerCase();
  return n;
}

function getOriginUrl(repoRoot: string): string | undefined {
  try {
    return execSync('git remote get-url origin', { cwd: repoRoot, stdio: 'pipe' })
      .toString()
      .trim();
  } catch {
    return undefined;
  }
}

export function getRepoIdentity(repoRoot: string): string {
  const normalized = normalizeRepoRoot(repoRoot);
  const origin = getOriginUrl(repoRoot);
  return origin ? `${normalized}\n${origin}` : normalized;
}

export function getRepoId(identity: string): string {
  return createHash('sha256').update(identity).digest('hex').slice(0, 12);
}

export function getAppDataSprintDir(repoRoot: string, appDataRoot: string): string {
  const identity = getRepoIdentity(repoRoot);
  const repoId = getRepoId(identity);
  return join(appDataRoot, 'repos', repoId);
}

// ── Index management ──────────────────────────────────────────────────────────

export interface RepoIndexEntry {
  repoId: string;
  repoRoot: string;
  originUrl?: string;
  storageMode: 'app-data' | 'repo';
  createdAt: string;
  updatedAt: string;
}

interface RepoIndex {
  repos: Record<string, RepoIndexEntry>;
}

export function getIndexPath(appDataRoot: string): string {
  return join(appDataRoot, 'repos', 'index.json');
}

function readIndexSync(appDataRoot: string): RepoIndex {
  try {
    const raw = readFileSync(getIndexPath(appDataRoot), 'utf8');
    return JSON.parse(raw) as RepoIndex;
  } catch {
    return { repos: {} };
  }
}

export async function registerInIndex(
  repoRoot: string,
  storageMode: 'app-data' | 'repo',
  appDataRoot: string,
): Promise<{ repoId: string; sprintDir: string }> {
  const identity = getRepoIdentity(repoRoot);
  const repoId = getRepoId(identity);
  const normalizedRoot = normalizeRepoRoot(repoRoot);
  const originUrl = getOriginUrl(repoRoot);

  const sprintDir =
    storageMode === 'app-data'
      ? join(appDataRoot, 'repos', repoId)
      : join(repoRoot, '.sprint');

  const index = readIndexSync(appDataRoot);
  const now = new Date().toISOString();
  const existing = index.repos[normalizedRoot];

  index.repos[normalizedRoot] = {
    repoId,
    repoRoot: normalizedRoot,
    ...(originUrl !== undefined ? { originUrl } : {}),
    storageMode,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  };

  const indexPath = getIndexPath(appDataRoot);
  await mkdir(dirname(indexPath), { recursive: true });
  await writeFile(indexPath, JSON.stringify(index, null, 2) + '\n', 'utf8');

  return { repoId, sprintDir };
}

// ── Sprint dir resolution ─────────────────────────────────────────────────────

export type StorageMode = 'app-data' | 'repo';

// Keep for backward compat — used by init.ts for explicit repo-local mode.
export function getSprintDir(repoRoot: string): string {
  return join(repoRoot, '.sprint');
}

export function requireSprintDir(cwd: string): { repoRoot: string; sprintDir: string } {
  const repoRoot = findGitRoot(cwd);
  if (!repoRoot) {
    throw new CyaError(
      'not-a-git-repo',
      'Not inside a git repository. Run git init first.',
    );
  }

  const appDataRoot = getAppDataRoot();
  const normalizedRoot = normalizeRepoRoot(repoRoot);

  // 1. Indexed entry — most reliable, survives origin URL changes.
  const index = readIndexSync(appDataRoot);
  const entry = index.repos[normalizedRoot];
  if (entry) {
    const sprintDir =
      entry.storageMode === 'app-data'
        ? join(appDataRoot, 'repos', entry.repoId)
        : join(repoRoot, '.sprint');
    if (existsSync(sprintDir)) {
      return { repoRoot, sprintDir };
    }
  }

  // 2. Computed app-data dir — index missing but dir exists.
  const identity = getRepoIdentity(repoRoot);
  const repoId = getRepoId(identity);
  const computedSprintDir = join(appDataRoot, 'repos', repoId);
  if (existsSync(computedSprintDir)) {
    return { repoRoot, sprintDir: computedSprintDir };
  }

  // 3. Legacy repo-local fallback.
  const legacySprintDir = join(repoRoot, '.sprint');
  if (existsSync(legacySprintDir)) {
    return { repoRoot, sprintDir: legacySprintDir };
  }

  throw new CyaError('not-initialized', 'No sprint storage found. Run cya init first.');
}
