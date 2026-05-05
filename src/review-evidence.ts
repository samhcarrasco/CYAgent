import { spawnSync } from 'node:child_process';
import type { TicketState, TicketStatus } from './state.js';
import type { SprintEvent, CommandStatus } from './events.js';

// ── Caps ──────────────────────────────────────────────────────────────────────

export interface DiffEvidenceCaps {
  maxCommitsPerTicket: number;
  maxFilesPerCommit: number;
  maxExcerptFilesPerCommit: number;
  maxExcerptChars: number;
  maxExcerptChangedLines: number;
  maxTotalEvidenceChars: number;
  diffContextLines: number;
}

export const DEFAULT_CAPS: DiffEvidenceCaps = {
  maxCommitsPerTicket: 10,
  maxFilesPerCommit: 20,
  maxExcerptFilesPerCommit: 3,
  maxExcerptChars: 2000,
  maxExcerptChangedLines: 100,
  maxTotalEvidenceChars: 30000,
  diffContextLines: 3,
};

// ── Data structures ───────────────────────────────────────────────────────────

export interface ReviewCommitSummary {
  sha: string;
  shortSha: string;
  message: string;
  committedAt: string;
  observedAt: string;
  branch: string;
}

export interface ReviewTicketSummary {
  id: string;
  title: string;
  status: TicketStatus;
  commits: ReviewCommitSummary[];
  notes: TicketState['notes'];
  commandEvidence: Array<{ status: CommandStatus; command?: string }>;
}

export interface CommitImplementationEvidence {
  sha: string;
  shortSha: string;
  message: string;
  shortstat?: string;
  files: Array<{ path: string; status: string; additions?: number; deletions?: number }>;
  excerpts: Array<{ path: string; excerpt: string; truncated: boolean }>;
  omitted: { commits?: number; files?: number; excerpts?: number; skippedFiles?: number };
}

export interface ReviewImplementationEvidence {
  enabled: true;
  caps: DiffEvidenceCaps;
  tickets: Array<{ ticketId: string; commits: CommitImplementationEvidence[] }>;
}

// ── Constants ─────────────────────────────────────────────────────────────────

const SHA_RE = /^[0-9a-f]{4,64}$/i;

const SKIP_EXCERPT_PATTERNS: RegExp[] = [
  /package-lock\.json$/,
  /yarn\.lock$/,
  /pnpm-lock\.yaml$/,
  /Gemfile\.lock$/,
  /composer\.lock$/,
  /Cargo\.lock$/,
  /poetry\.lock$/i,
  /pipfile\.lock$/i,
  /node_modules[/\\]/,
  /(^|[/\\])dist[/\\]/,
  /(^|[/\\])build[/\\]/,
  /(^|[/\\])vendor[/\\]/,
  /__snapshots__[/\\]/,
  /\.snap$/,
  /\.min\.(js|css)$/,
  /\.generated\./,
  /__generated__[/\\]/,
];

const PREFER_EXCERPT_PATTERNS: RegExp[] = [
  /\.(ts|tsx|js|jsx|mjs|cjs)$/,
  /\.(py|go|rs|java|rb|php|cs|cpp|c|h|swift|kt|scala)$/,
  /\.(test|spec)\./,
  /(test|spec)[/\\]/,
  /\.(yaml|yml|json|toml|ini)$/,
  /Dockerfile/,
  /\.(sql)$/,
  /migration[/\\]/,
  /\.(md|mdx)$/,
];

const REDACT_PATTERNS: RegExp[] = [
  /\b(api[_-]?key|api[_-]?secret|access[_-]?token|auth[_-]?token|password|passwd|secret|private[_-]?key|client[_-]?secret)\s*[:=]\s*['"]?[A-Za-z0-9+/._\-]{8,}['"]?/gi,
  /-----BEGIN [A-Z ]+ KEY-----[\s\S]*?-----END [A-Z ]+ KEY-----/g,
  /ey[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g,
  /\b[0-9a-f]{40,}\b/gi,
  /['"][A-Za-z0-9+/]{40,}={0,2}['"]/g,
  /[a-z][a-z0-9+.-]*:\/\/[^:@\s]+:[^@\s]+@[^\s]+/gi,
  /\b(export\s+)?(AWS_SECRET_ACCESS_KEY|GITHUB_TOKEN|STRIPE_SECRET|DATABASE_URL|REDIS_URL|MONGO_URL)\s*=\s*\S+/gi,
];

// ── Pure helpers (exported for testing) ──────────────────────────────────────

export function redactSecrets(text: string): string {
  let result = text;
  for (const pattern of REDACT_PATTERNS) {
    result = result.replace(pattern, '[REDACTED]');
  }
  return result;
}

export function shouldSkipExcerpt(filePath: string): boolean {
  return SKIP_EXCERPT_PATTERNS.some((p) => p.test(filePath));
}

export function excerptPriority(filePath: string): number {
  for (let i = 0; i < PREFER_EXCERPT_PATTERNS.length; i++) {
    if (PREFER_EXCERPT_PATTERNS[i]!.test(filePath)) return i;
  }
  return PREFER_EXCERPT_PATTERNS.length;
}

export function parseNameStatus(
  output: string,
): Array<{ path: string; status: string }> {
  const results: Array<{ path: string; status: string }> = [];
  for (const line of output.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const parts = trimmed.split('\t');
    if (parts.length < 2) continue;
    const status = parts[0]!;
    // For renames (R100\told\tnew), use the last part as canonical path.
    const path = parts[parts.length - 1]!;
    if (status && path) results.push({ path, status: status.slice(0, 1) });
  }
  return results;
}

export function parseNumstat(
  output: string,
): Map<string, { additions: number; deletions: number }> {
  const map = new Map<string, { additions: number; deletions: number }>();
  for (const line of output.split('\n')) {
    const parts = line.trim().split('\t');
    if (parts.length < 3) continue;
    const additions = parseInt(parts[0]!, 10);
    const deletions = parseInt(parts[1]!, 10);
    const path = parts[2]!;
    if (!isNaN(additions) && !isNaN(deletions) && path) {
      map.set(path, { additions, deletions });
    }
  }
  return map;
}

// ── Ticket summary builder ────────────────────────────────────────────────────

export function buildTicketSummaries(
  activeTickets: TicketState[],
  inRangeEvents: SprintEvent[],
  allowCommandOutput: boolean,
): ReviewTicketSummary[] {
  const shaToObservedAt = new Map<string, string>();
  for (const e of inRangeEvents) {
    if (e.type === 'commit_observed' || e.type === 'commit_assigned') {
      shaToObservedAt.set(e.payload.sha, e.timestamp);
    }
  }

  return activeTickets.map((t) => {
    const commits: ReviewCommitSummary[] = [];
    for (const c of t.commits) {
      const observedAt = shaToObservedAt.get(c.sha);
      if (observedAt) {
        commits.push({
          sha: c.sha,
          shortSha: c.shortSha,
          message: c.message,
          committedAt: c.committedAt,
          observedAt,
          branch: c.branch,
        });
      }
    }

    const commandEvidence = t.evidence.map((e) =>
      allowCommandOutput
        ? { status: e.status, command: e.command }
        : { status: e.status },
    );

    return {
      id: t.id,
      title: t.title,
      status: t.status,
      commits,
      notes: t.notes,
      commandEvidence,
    };
  });
}

// ── Git evidence collector ────────────────────────────────────────────────────

export function collectReviewEvidence(
  repoRoot: string,
  tickets: ReviewTicketSummary[],
  caps: DiffEvidenceCaps = DEFAULT_CAPS,
): ReviewImplementationEvidence | null {
  const ticketResults: ReviewImplementationEvidence['tickets'] = [];
  let totalChars = 0;

  outer: for (const ticket of tickets) {
    const capped = ticket.commits.slice(0, caps.maxCommitsPerTicket);
    const omittedCommitCount = ticket.commits.length - capped.length;
    const commitEvidence: CommitImplementationEvidence[] = [];

    for (let i = 0; i < capped.length; i++) {
      const commit = capped[i]!;
      if (!SHA_RE.test(commit.sha)) continue;
      if (totalChars >= caps.maxTotalEvidenceChars) break outer;

      let ev: CommitImplementationEvidence | null;
      try {
        ev = gatherCommitEvidence(repoRoot, commit, caps, totalChars);
      } catch {
        continue;
      }
      if (ev === null) continue;

      for (const ex of ev.excerpts) totalChars += ex.excerpt.length;

      // Attach total-cap hit flag on last commit for the ticket
      if (i === capped.length - 1 && omittedCommitCount > 0) {
        ev.omitted.commits = omittedCommitCount;
      }
      commitEvidence.push(ev);
    }

    if (commitEvidence.length > 0) {
      ticketResults.push({ ticketId: ticket.id, commits: commitEvidence });
    }
  }

  return ticketResults.length > 0 ? { enabled: true, caps, tickets: ticketResults } : null;
}

function gatherCommitEvidence(
  repoRoot: string,
  commit: ReviewCommitSummary,
  caps: DiffEvidenceCaps,
  currentTotalChars: number,
): CommitImplementationEvidence | null {
  const omitted: CommitImplementationEvidence['omitted'] = {};

  // Shortstat
  const shortstatResult = spawnSync(
    'git',
    ['show', '--shortstat', '--format=', '--no-ext-diff', '--no-color', commit.sha],
    { cwd: repoRoot, encoding: 'utf8' },
  );
  const shortstat =
    shortstatResult.status === 0 ? shortstatResult.stdout.trim() || undefined : undefined;

  // Name-status
  const nameStatusResult = spawnSync(
    'git',
    ['diff-tree', '--no-commit-id', '--name-status', '-r', '-M', '--root', commit.sha],
    { cwd: repoRoot, encoding: 'utf8' },
  );
  if (nameStatusResult.status !== 0) return null;

  // Numstat
  const numstatResult = spawnSync(
    'git',
    ['diff-tree', '--no-commit-id', '--numstat', '-r', '-M', '--root', commit.sha],
    { cwd: repoRoot, encoding: 'utf8' },
  );
  const numstatMap =
    numstatResult.status === 0 ? parseNumstat(numstatResult.stdout) : new Map();

  // Parse files
  const parsedFiles = parseNameStatus(nameStatusResult.stdout);
  const allFiles = parsedFiles.map((f) => {
    const nums = numstatMap.get(f.path) as { additions: number; deletions: number } | undefined;
    return {
      path: f.path,
      status: f.status,
      additions: nums?.additions,
      deletions: nums?.deletions,
    };
  });

  const cappedFiles = allFiles.slice(0, caps.maxFilesPerCommit);
  if (allFiles.length > caps.maxFilesPerCommit) {
    omitted.files = allFiles.length - caps.maxFilesPerCommit;
  }

  // Excerpt candidates: not deleted, not skipped, sorted by signal priority
  const skipCount = cappedFiles.filter((f) => shouldSkipExcerpt(f.path)).length;
  if (skipCount > 0) omitted.skippedFiles = skipCount;

  const excerptCandidates = cappedFiles
    .filter((f) => f.status !== 'D' && !shouldSkipExcerpt(f.path))
    .sort((a, b) => excerptPriority(a.path) - excerptPriority(b.path));

  const excerpts: CommitImplementationEvidence['excerpts'] = [];
  let excerptIdx = 0;

  for (const file of excerptCandidates) {
    if (excerptIdx >= caps.maxExcerptFilesPerCommit) {
      omitted.excerpts =
        (omitted.excerpts ?? 0) + (excerptCandidates.length - excerptIdx);
      break;
    }
    if (currentTotalChars + excerpts.reduce((s, e) => s + e.excerpt.length, 0) >= caps.maxTotalEvidenceChars) {
      break;
    }

    const diffResult = spawnSync(
      'git',
      [
        'show',
        '--format=',
        '--no-ext-diff',
        '--no-color',
        `--unified=${caps.diffContextLines}`,
        commit.sha,
        '--',
        file.path,
      ],
      { cwd: repoRoot, encoding: 'utf8' },
    );
    if (diffResult.status !== 0) {
      excerptIdx++;
      continue;
    }

    let raw = diffResult.stdout;

    // Cap by changed lines
    const lines = raw.split('\n');
    let changedLineCount = 0;
    const keptLines: string[] = [];
    for (const line of lines) {
      keptLines.push(line);
      if (line.startsWith('+') || line.startsWith('-')) changedLineCount++;
      if (changedLineCount >= caps.maxExcerptChangedLines) break;
    }
    raw = keptLines.join('\n');

    // Cap by chars
    let truncated = false;
    if (raw.length > caps.maxExcerptChars) {
      raw = raw.slice(0, caps.maxExcerptChars);
      truncated = true;
    }

    const excerpt = redactSecrets(raw);
    excerpts.push({ path: file.path, excerpt, truncated });
    excerptIdx++;
  }

  return {
    sha: commit.sha,
    shortSha: commit.shortSha,
    message: commit.message,
    shortstat,
    files: cappedFiles,
    excerpts,
    omitted,
  };
}
