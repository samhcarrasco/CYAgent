import type { State, TicketState } from './state.js';

export function renderTicket(t: TicketState): string {
  const lines: string[] = [`# ${t.id}: ${t.title}`, ''];
  lines.push(`**Status:** ${t.status}`);
  if (t.branch) lines.push(`**Branch:** ${t.branch}`);
  lines.push(`**Last Updated:** ${t.lastUpdatedAt}`, '', '## Commits', '');
  if (t.commits.length === 0) {
    lines.push('_none_');
  } else {
    for (const c of t.commits) lines.push(`- \`${c.shortSha}\` ${c.message}`);
  }
  lines.push('', '## Evidence', '');
  if (t.evidence.length === 0) {
    lines.push('_none_');
  } else {
    for (const e of t.evidence) {
      const icon = e.status === 'passed' ? '✓' : '✗';
      const exitPart = e.exitCode !== undefined ? ` (exit ${e.exitCode})` : '';
      lines.push(`- ${icon} \`${e.command}\` — ${e.status}${exitPart}`);
    }
  }
  lines.push('', '## Sessions', '');
  if (t.sessions.length === 0) {
    lines.push('_none_');
  } else {
    for (const s of t.sessions) {
      const ts = s.timestamp.replace('T', ' ').slice(0, 16);
      lines.push(`- [${ts}] ${s.summary}`);
    }
  }

  lines.push('', '## Notes', '');

  for (const kind of [
    'blocker',
    'followup',
    'decision',
    'discovery',
    'risk',
    'context',
  ] as const) {
    lines.push(`### ${capitalize(kind)}`);
    const entries = t.notes[kind];
    if (entries.length === 0) {
      lines.push('_none_');
    } else {
      for (const e of entries) lines.push(`- ${e.text}`);
    }
    lines.push('');
  }

  return lines.join('\n');
}

export function renderSprint(state: State): string {
  const tickets = Object.values(state.tickets);
  const inProgress = tickets.filter((t) => t.status === 'in_progress');
  const blocked = tickets.filter((t) => t.status === 'blocked');
  const done = tickets.filter((t) => t.status === 'done');

  const lines: string[] = ['# Sprint', ''];

  lines.push('## In Progress');
  if (inProgress.length === 0) {
    lines.push('_none_');
  } else {
    for (const t of inProgress) {
      lines.push(`- ${t.id}: ${t.title}${t.branch ? ` (${t.branch})` : ''}`);
    }
  }
  lines.push('');

  lines.push('## Done');
  if (done.length === 0) {
    lines.push('_none_');
  } else {
    for (const t of done) lines.push(`- ${t.id}: ${t.title}`);
  }
  lines.push('');

  lines.push('## Evidence');
  const allEvidence = tickets.flatMap((t) =>
    t.evidence.map((e) => ({ ticketId: t.id, ...e })),
  );
  if (allEvidence.length === 0) {
    lines.push('_none_');
  } else {
    for (const e of allEvidence) {
      const icon = e.status === 'passed' ? '✓' : '✗';
      lines.push(`- ${e.ticketId}: ${icon} \`${e.command}\` — ${e.status}`);
    }
  }
  lines.push('');

  lines.push('## Blockers');
  if (blocked.length === 0) {
    lines.push('_none_');
  } else {
    for (const t of blocked) {
      lines.push(`- ${t.id}: ${t.title}`);
      const lastBlocker = t.notes.blocker.at(-1);
      if (lastBlocker) lines.push(`  Blocker: ${lastBlocker.text}`);
    }
  }
  lines.push('');

  lines.push('## Unassigned Commits');
  if (state.unassignedCommits.length === 0) {
    lines.push('_none_');
  } else {
    for (const c of state.unassignedCommits) lines.push(`- \`${c.shortSha}\` ${c.message}`);
    lines.push('', '_Run `cya assign <sha> <ticket>` to attach._');
  }
  lines.push('');

  return lines.join('\n');
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
