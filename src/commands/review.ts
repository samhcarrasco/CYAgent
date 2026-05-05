import { join } from 'node:path';
import { requireSprintDir } from '../paths.js';
import { CyaError } from '../errors.js';
import { readEvents } from '../events.js';
import { atomicWrite } from '../io.js';
import { reduceAll } from '../reduce.js';
import { readConfig } from '../config.js';
import type { Config } from '../config.js';
import { summarizeReview } from '../ai.js';
import {
  buildTicketSummaries,
  collectReviewEvidence,
  DEFAULT_CAPS,
} from '../review-evidence.js';
import type { ReviewTicketSummary, ReviewImplementationEvidence } from '../review-evidence.js';

export type ReviewOptions = {
  since?: string;
  until?: string;
  noAi?: boolean;
};

const TEMPLATE_COMMIT_CAP = 5;

export async function runReview(options: ReviewOptions = {}, cwd = process.cwd()): Promise<void> {
  const { repoRoot, sprintDir } = requireSprintDir(cwd);

  const untilDate = options.until ? new Date(options.until) : new Date();
  const sinceDate = options.since
    ? new Date(options.since)
    : new Date(untilDate.getTime() - 90 * 24 * 60 * 60 * 1000);

  if (isNaN(sinceDate.getTime())) {
    throw new CyaError('invalid-date', `Invalid --since date: "${options.since}"`);
  }
  if (isNaN(untilDate.getTime())) {
    throw new CyaError('invalid-date', `Invalid --until date: "${options.until}"`);
  }
  if (sinceDate > untilDate) {
    throw new CyaError('invalid-range', '--since must be before --until');
  }

  untilDate.setUTCHours(23, 59, 59, 999);

  const allEvents = await readEvents(sprintDir);
  const state = reduceAll(allEvents);

  const inRange = allEvents.filter((e) => {
    const t = new Date(e.timestamp);
    return t >= sinceDate && t <= untilDate;
  });

  if (inRange.length === 0) {
    console.log('No activity found in this period.');
    return;
  }

  // ── Aggregate ──────────────────────────────────────────────────────────────

  const activeTicketIds = new Set(
    inRange.map((e) => e.ticket).filter((t): t is string => !!t),
  );

  const doneIds = new Set(
    inRange.filter((e) => e.type === 'ticket_done').map((e) => e.ticket!),
  );

  const activeTickets = [...activeTicketIds]
    .map((id) => state.tickets[id])
    .filter((t): t is NonNullable<typeof t> => !!t);

  // ── Config (best-effort; failures skip evidence and AI) ───────────────────

  let config: Config | null = null;
  try {
    config = readConfig(sprintDir);
  } catch {
    // proceed without config-dependent features
  }

  // ── Structured ticket summaries ────────────────────────────────────────────

  const ticketSummaries: ReviewTicketSummary[] = buildTicketSummaries(
    activeTickets,
    inRange,
    config?.privacy.allowCommandOutput ?? false,
  );

  const completedSummaries = ticketSummaries.filter((t) => doneIds.has(t.id));
  const inProgressSummaries = ticketSummaries.filter(
    (t) => !doneIds.has(t.id) && t.status !== 'done',
  );

  const decisionsInRange = inRange.filter(
    (e) =>
      e.type === 'note_added' &&
      (e as { payload: { kind: string } }).payload.kind === 'decision',
  );

  const blockersInRange = inRange.filter(
    (e) =>
      e.type === 'note_added' &&
      (e as { payload: { kind: string } }).payload.kind === 'blocker',
  );

  const unblockedIds = new Set(
    inRange.filter((e) => e.type === 'ticket_unblocked').map((e) => e.ticket!),
  );

  const passedCount = inRange.filter(
    (e) =>
      e.type === 'command_recorded' &&
      (e as { payload: { status: string } }).payload.status === 'passed',
  ).length;

  const failedCount = inRange.filter(
    (e) =>
      e.type === 'command_recorded' &&
      (e as { payload: { status: string } }).payload.status === 'failed',
  ).length;

  const commitCount = inRange.filter(
    (e) => e.type === 'commit_observed' || e.type === 'commit_assigned',
  ).length;

  const sessionCount = inRange.filter((e) => e.type === 'session_summary').length;

  // ── Git evidence (opt-in via privacy.allowDiffSummarization) ──────────────

  let implementationEvidence: ReviewImplementationEvidence | undefined;
  if (config?.privacy.allowDiffSummarization && ticketSummaries.length > 0) {
    try {
      const ev = collectReviewEvidence(repoRoot, ticketSummaries, DEFAULT_CAPS);
      if (ev) implementationEvidence = ev;
    } catch {
      // evidence failures are non-fatal
    }
  }

  // ── Render ─────────────────────────────────────────────────────────────────

  const sinceStr = sinceDate.toISOString().slice(0, 10);
  const untilStr = untilDate.toISOString().slice(0, 10);
  const sinceSlug = toSlug(sinceDate);
  const untilSlug = toSlug(untilDate);

  const lines: string[] = [`# Performance Review: ${sinceStr} to ${untilStr}`, ''];

  lines.push('## Completed');
  if (completedSummaries.length === 0) {
    lines.push('_none_');
  } else {
    for (const t of completedSummaries) {
      lines.push(`- **${t.id}**: ${t.title}`);
      for (const l of renderCommits(t.commits)) lines.push(l);
    }
  }
  lines.push('');

  lines.push('## In Progress');
  if (inProgressSummaries.length === 0) {
    lines.push('_none_');
  } else {
    for (const t of inProgressSummaries) {
      const statusTag = t.status === 'blocked' ? ' _(blocked)_' : '';
      lines.push(`- **${t.id}**: ${t.title}${statusTag}`);
      for (const l of renderCommits(t.commits)) lines.push(l);
    }
  }
  lines.push('');

  lines.push('## Key Decisions');
  if (decisionsInRange.length === 0) {
    lines.push('_none_');
  } else {
    for (const e of decisionsInRange) {
      const date = e.timestamp.slice(0, 10);
      const text = (e as { payload: { text: string } }).payload.text;
      lines.push(`- **${e.ticket}** [${date}]: ${text}`);
    }
  }
  lines.push('');

  lines.push('## Blockers');
  if (blockersInRange.length === 0) {
    lines.push('_none_');
  } else {
    for (const e of blockersInRange) {
      const text = (e as { payload: { text: string } }).payload.text;
      const ticket = state.tickets[e.ticket!];
      const resolved =
        unblockedIds.has(e.ticket!) || (ticket && ticket.status !== 'blocked');
      const tag = resolved ? '✓ resolved' : '⚠ ongoing';
      lines.push(`- **${e.ticket}** [${tag}]: ${text}`);
    }
  }
  lines.push('');

  lines.push('## Evidence');
  if (passedCount === 0 && failedCount === 0) {
    lines.push('_none_');
  } else {
    if (passedCount > 0)
      lines.push(`- ${passedCount} test/build run${passedCount === 1 ? '' : 's'} passed`);
    if (failedCount > 0)
      lines.push(`- ${failedCount} test/build run${failedCount === 1 ? '' : 's'} failed`);
  }
  lines.push('');

  lines.push('## Activity');
  lines.push(`- ${commitCount} commit${commitCount === 1 ? '' : 's'} recorded`);
  lines.push(`- ${activeTicketIds.size} ticket${activeTicketIds.size === 1 ? '' : 's'} touched`);
  if (sessionCount > 0) lines.push(`- ${sessionCount} session${sessionCount === 1 ? '' : 's'} logged`);
  lines.push('');

  if (implementationEvidence) {
    for (const l of renderImplementationEvidence(implementationEvidence)) lines.push(l);
  }

  const output = lines.join('\n');

  // ── AI narrative ───────────────────────────────────────────────────────────

  let finalOutput = output;
  if (!options.noAi && config?.ai.enabled) {
    try {
      const result = await summarizeReview(config, {
        since: sinceStr,
        until: untilStr,
        templateOutput: output,
        privacy: config.privacy,
        tickets: ticketSummaries,
        implementationEvidence,
      });
      if (result.kind === 'summary') {
        finalOutput = `${result.text}\n\n---\n\n${output}`;
      }
    } catch {
      // fall through to template output
    }
  }

  const slug = `${sinceSlug}-to-${untilSlug}`;
  const outPath = join(sprintDir, `review-${slug}.md`);
  await atomicWrite(outPath, finalOutput);

  console.log(finalOutput);
  console.log(`Saved to ${outPath}`);
}

// ── Render helpers ─────────────────────────────────────────────────────────

function renderCommits(commits: ReviewTicketSummary['commits']): string[] {
  if (commits.length === 0) return [];
  const shown = commits.slice(0, TEMPLATE_COMMIT_CAP);
  const omitted = commits.length - shown.length;
  const lines = shown.map((c) => `  - \`${c.shortSha}\` ${c.message}`);
  if (omitted > 0) lines.push(`  - _${omitted} more commit${omitted === 1 ? '' : 's'}_`);
  return lines;
}

function renderImplementationEvidence(ev: ReviewImplementationEvidence): string[] {
  const lines: string[] = [];
  lines.push('## Implementation Evidence');
  lines.push('_Derived from git history. Enabled by `privacy.allowDiffSummarization`._');
  lines.push('');
  for (const ticket of ev.tickets) {
    lines.push(`### ${ticket.ticketId}`);
    for (const commit of ticket.commits) {
      lines.push(`**${commit.shortSha}** ${commit.message}`);
      if (commit.shortstat) lines.push(commit.shortstat);
      for (const f of commit.files) {
        const stats =
          f.additions !== undefined && f.deletions !== undefined
            ? ` (+${f.additions} −${f.deletions})`
            : '';
        lines.push(`- ${f.status} ${f.path}${stats}`);
      }
      const omissions: string[] = [];
      if (commit.omitted.files) omissions.push(`${commit.omitted.files} more files`);
      if (commit.omitted.skippedFiles)
        omissions.push(`${commit.omitted.skippedFiles} lockfiles/generated skipped`);
      if (omissions.length) lines.push(`_${omissions.join(', ')}_`);
    }
    const lastCommit = ticket.commits[ticket.commits.length - 1];
    if (lastCommit?.omitted.commits) {
      const n = lastCommit.omitted.commits;
      lines.push(`_${n} more commit${n === 1 ? '' : 's'} not shown_`);
    }
    lines.push('');
  }
  return lines;
}

const MONTHS = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
];

function toSlug(d: Date): string {
  const mon = MONTHS[d.getUTCMonth()];
  const day = String(d.getUTCDate()).padStart(2, '0');
  const yr = String(d.getUTCFullYear()).slice(2);
  return `${mon}_${day}_${yr}`;
}
