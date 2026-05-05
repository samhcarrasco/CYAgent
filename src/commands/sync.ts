import { existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { requireSprintDir, getBranchName } from '../paths.js';
import { createEvent, appendEvent, readEvents } from '../events.js';
import { atomicWrite } from '../io.js';
import { reduceAll } from '../reduce.js';
import { renderTicket, renderSprint } from '../render.js';
import { getGitLog } from '../git.js';
import { isProtectedBranch } from '../auto-track.js';

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

  // Collect SHAs already recorded across all tickets and unassigned commits.
  const knownShas = new Set<string>();
  for (const ticket of Object.values(existingState.tickets)) {
    for (const commit of ticket.commits) knownShas.add(commit.sha);
  }
  for (const commit of existingState.unassignedCommits) knownShas.add(commit.sha);

  // Find the one ticket whose branch matches the current branch.
  const matching = Object.values(existingState.tickets).filter((t) => t.branch === branch);
  let targetTicketId: string | undefined;
  let targetBaselineSha: string | undefined;
  if (matching.length === 1) {
    targetTicketId = matching[0].id;
    targetBaselineSha = matching[0].baselineSha;
  } else if (matching.length === 0) {
    if (source === 'git-hook' && isProtectedBranch(branch)) {
      if (!quiet) {
        console.log(
          `sync: branch "${branch}" is protected and not associated with any tracked ticket. Skipping automatic sync.`,
        );
      }
      return;
    }
    console.log(
      `sync: branch "${branch}" not associated with any tracked ticket. Commits unassigned.`,
    );
  } else {
    console.log(
      `sync: branch "${branch}" matches multiple tickets. Commits unassigned.`,
    );
  }

  const gitCommits = getGitLog(
    repoRoot,
    targetBaselineSha ? `${targetBaselineSha}..HEAD` : undefined,
  );
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
  if (!quiet) {
    console.log(
      `sync: recorded ${newCommits.length} new commit${newCommits.length === 1 ? '' : 's'}${label}.`,
    );
  }
}
