import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, readdir, readFile, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { State } from './state.js';

export interface BranchCreationMarker {
  branch: string;
  sha: string;
  gitProcessId: string;
  ref: string;
  createdAt: string;
}

export interface DerivedAutoTrackTicket {
  ticket: string;
  title: string;
}

const ZERO_SHA = /^0{40}$/;
const JIRA_TICKET_RE = /([A-Z][A-Z0-9]+-\d+)/;
const SYNTHETIC_PREFIX = 'BRANCH-';
const MARKER_MAX_AGE_MS = 10 * 60 * 1000;

export function branchMarkerDir(repoRoot: string): string {
  return join(repoRoot, '.git', 'cya', 'branch-creations');
}

export function isProtectedBranch(branch: string): boolean {
  return (
    branch === 'main' ||
    branch === 'master' ||
    branch === 'develop' ||
    branch === 'dev' ||
    branch === 'trunk' ||
    branch.startsWith('release/') ||
    branch.startsWith('hotfix/')
  );
}

export function deriveAutoTrackTicket(
  branch: string,
  state: State,
): DerivedAutoTrackTicket | undefined {
  if (isProtectedBranch(branch)) return undefined;
  if (Object.values(state.tickets).some((ticket) => ticket.branch === branch)) {
    return undefined;
  }

  const jiraMatch = branch.match(JIRA_TICKET_RE);
  if (jiraMatch?.[1]) {
    const ticket = jiraMatch[1];
    const existing = state.tickets[ticket];
    if (existing && existing.branch !== branch) return undefined;
    return {
      ticket,
      title: titleFromBranch(branch, ticket),
    };
  }

  const hash = createHash('sha256').update(branch).digest('hex').toUpperCase();
  const title = titleFromBranch(branch);
  for (let length = 8; length <= hash.length; length += 4) {
    const ticket = `${SYNTHETIC_PREFIX}${hash.slice(0, length)}`;
    const existing = state.tickets[ticket];
    if (!existing || existing.branch === branch) {
      return { ticket, title };
    }
  }

  return undefined;
}

export async function recordBranchCreationMarker(
  repoRoot: string,
  marker: BranchCreationMarker,
): Promise<void> {
  const dir = branchMarkerDir(repoRoot);
  await mkdir(dir, { recursive: true });
  await writeFile(markerPath(repoRoot, marker), JSON.stringify(marker) + '\n', 'utf8');
}

export async function consumeBranchCreationMarker(
  repoRoot: string,
  branch: string,
  sha: string,
  gitProcessId: string,
): Promise<BranchCreationMarker | undefined> {
  const dir = branchMarkerDir(repoRoot);
  if (!existsSync(dir)) return undefined;

  let entries: string[];
  try {
    entries = await readdir(dir);
  } catch {
    return undefined;
  }

  for (const entry of entries) {
    if (!entry.endsWith('.json')) continue;
    const path = join(dir, entry);
    const marker = await readMarker(path);
    if (!marker) continue;
    if (isExpired(marker)) {
      await unlinkMarker(path);
      continue;
    }
    if (
      marker.branch === branch &&
      marker.sha.toLowerCase() === sha.toLowerCase() &&
      marker.gitProcessId === gitProcessId
    ) {
      await unlinkMarker(path);
      return marker;
    }
  }

  return undefined;
}

export function branchDeletionsFromReferenceTransaction(
  state: string,
  stdin: string,
): string[] {
  if (state !== 'committed') return [];

  const branches: string[] = [];
  for (const line of stdin.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const [oldSha, newSha, ref] = trimmed.split(/\s+/);
    if (!oldSha || !newSha || !ref) continue;
    if (!ZERO_SHA.test(newSha)) continue;
    if (!ref.startsWith('refs/heads/')) continue;
    branches.push(ref.slice('refs/heads/'.length));
  }

  return branches;
}

export function branchCreationMarkersFromReferenceTransaction(
  state: string,
  gitProcessId: string,
  stdin: string,
): BranchCreationMarker[] {
  if (state !== 'committed') return [];

  const markers: BranchCreationMarker[] = [];
  for (const line of stdin.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const [oldSha, newSha, ref] = trimmed.split(/\s+/);
    if (!oldSha || !newSha || !ref) continue;
    if (!ZERO_SHA.test(oldSha)) continue;
    if (ZERO_SHA.test(newSha)) continue;
    if (!ref.startsWith('refs/heads/')) continue;

    markers.push({
      branch: ref.slice('refs/heads/'.length),
      sha: newSha,
      gitProcessId,
      ref,
      createdAt: new Date().toISOString(),
    });
  }

  return markers;
}

function isExpired(marker: BranchCreationMarker): boolean {
  const createdAt = Date.parse(marker.createdAt);
  if (!Number.isFinite(createdAt)) return true;
  return Date.now() - createdAt > MARKER_MAX_AGE_MS;
}

function titleFromBranch(branch: string, ticket?: string): string {
  const lastSegment = branch.split('/').filter(Boolean).at(-1) ?? branch;
  let raw = lastSegment;
  if (ticket) {
    const ticketIndex = raw.indexOf(ticket);
    raw = ticketIndex >= 0 ? raw.slice(ticketIndex + ticket.length) : raw.replace(ticket, '');
  }
  const humanized = raw
    .replace(/^[\W_]+/, '')
    .replace(/[\W_]+$/g, '')
    .replace(/[-_./]+/g, ' ')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .trim()
    .toLowerCase();
  return humanized || 'branch work';
}

function markerPath(repoRoot: string, marker: BranchCreationMarker): string {
  const hash = createHash('sha256')
    .update(`${marker.gitProcessId}\0${marker.branch}\0${marker.sha}`)
    .digest('hex');
  return join(branchMarkerDir(repoRoot), `${hash}.json`);
}

async function readMarker(path: string): Promise<BranchCreationMarker | undefined> {
  try {
    const raw = await readFile(path, 'utf8');
    const parsed = JSON.parse(raw) as Partial<BranchCreationMarker>;
    if (
      typeof parsed.branch === 'string' &&
      typeof parsed.sha === 'string' &&
      typeof parsed.gitProcessId === 'string' &&
      typeof parsed.ref === 'string' &&
      typeof parsed.createdAt === 'string'
    ) {
      return parsed as BranchCreationMarker;
    }
  } catch {
    return undefined;
  }
  return undefined;
}

async function unlinkMarker(path: string): Promise<void> {
  try {
    await unlink(path);
  } catch {
    // Marker cleanup is best-effort; a stale marker can only match its PID/SHA/branch tuple.
  }
}
