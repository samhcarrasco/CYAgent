import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { requireSprintDir, getBranchName } from '../paths.js';
import { createEvent, appendEvent, readEvents } from '../events.js';
import { atomicWrite } from '../io.js';
import { reduceAll } from '../reduce.js';
import { renderTicket, renderSprint } from '../render.js';

interface RawCommit {
  sha: string;
  shortSha: string;
  message: string;
  authorName: string | undefined;
  authorEmail: string | undefined;
  committedAt: string;
}

// spawnSync bypasses the shell — safe on Windows (no % expansion).
function getGitLog(repoRoot: string): RawCommit[] {
  // Fields separated by \x1f (unit separator), one commit per line.
  const result = spawnSync('git', ['log', '--format=%H\x1f%h\x1f%s\x1f%an\x1f%ae\x1f%at'], {
    cwd: repoRoot,
    encoding: 'utf8',
  });
  if (result.status !== 0 || !result.stdout) return [];

  const commits: RawCommit[] = [];
  for (const line of result.stdout.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const [sha, shortSha, message, authorName, authorEmail, unixTs] = trimmed.split('\x1f');
    if (!sha || !unixTs) continue;
    commits.push({
      sha,
      shortSha,
      message,
      authorName: authorName || undefined,
      authorEmail: authorEmail || undefined,
      committedAt: new Date(parseInt(unixTs, 10) * 1000).toISOString(),
    });
  }
  return commits;
}

export interface SyncOptions {
  source?: 'user' | 'git-hook' | 'watcher' | 'claude-code';
  quiet?: boolean;
}

export async function runSync(cwd = process.cwd(), opts: SyncOptions = {}): Promise<void> {
  const source = opts.source ?? 'user';
  const quiet = opts.quiet ?? false;
  const { repoRoot, sprintDir } = requireSprintDir(cwd);

  const branch = getBranchName(repoRoot);
  if (!branch) {
    console.log('sync: no branch detected (detached HEAD or no commits). Nothing to sync.');
    return;
  }

  const existingEvents = await readEvents(sprintDir);
  const existingState = reduceAll(existingEvents);

  // Collect SHAs already recorded across all tickets.
  const knownShas = new Set<string>();
  for (const ticket of Object.values(existingState.tickets)) {
    for (const commit of ticket.commits) knownShas.add(commit.sha);
  }

  // Find the one ticket whose branch matches the current branch.
  const matching = Object.values(existingState.tickets).filter((t) => t.branch === branch);
  let targetTicketId: string | undefined;
  if (matching.length === 1) {
    targetTicketId = matching[0].id;
  } else if (matching.length === 0) {
    console.log(
      `sync: branch "${branch}" not associated with any tracked ticket. Commits unassigned.`,
    );
  } else {
    console.log(
      `sync: branch "${branch}" matches multiple tickets. Commits unassigned.`,
    );
  }

  const gitCommits = getGitLog(repoRoot);
  // git log is newest-first; append oldest-first so events are chronological.
  const newCommits = gitCommits.filter((c) => !knownShas.has(c.sha)).reverse();

  if (newCommits.length === 0) {
    if (!quiet) console.log('sync: no new commits.');
    return;
  }

  for (const commit of newCommits) {
    const event = createEvent({
      type: 'commit_observed',
      repoPath: repoRoot,
      branch,
      source,
      ticket: targetTicketId,
      payload: {
        sha: commit.sha,
        shortSha: commit.shortSha,
        message: commit.message,
        authorName: commit.authorName,
        authorEmail: commit.authorEmail,
        committedAt: commit.committedAt,
        branch,
      },
    });
    await appendEvent(sprintDir, event);
  }

  const events = await readEvents(sprintDir);
  const state = reduceAll(events);

  const ticketsDir = join(sprintDir, 'tickets');
  if (!existsSync(ticketsDir)) mkdirSync(ticketsDir);

  await atomicWrite(join(sprintDir, 'state.json'), JSON.stringify(state, null, 2) + '\n');

  if (targetTicketId && state.tickets[targetTicketId]) {
    await atomicWrite(
      join(ticketsDir, `${targetTicketId}.md`),
      renderTicket(state.tickets[targetTicketId]),
    );
  }

  await atomicWrite(join(sprintDir, 'SPRINT.md'), renderSprint(state));

  const label = targetTicketId ? ` on ${targetTicketId}` : ' (unassigned)';
  if (!quiet) console.log(`sync: recorded ${newCommits.length} new commit${newCommits.length === 1 ? '' : 's'}${label}.`);
}
