import type { State, TicketState } from './state.js';

export type StandupFormat = 'markdown' | 'slack';

interface Section {
  title: string;
  items: string[];
}

export function generateStandup(state: State, format: StandupFormat = 'markdown'): string {
  const tickets = Object.values(state.tickets);

  // Done: passed commands + commits
  const doneItems: string[] = [];
  for (const t of tickets) {
    for (const e of t.evidence.filter((e) => e.status === 'passed')) {
      doneItems.push(`${t.id}: \`${e.command}\` ✓`);
    }
    for (const c of t.commits) {
      doneItems.push(`${t.id}: ${c.shortSha} ${c.message}`);
    }
  }

  // In Progress: in_progress tickets with context (discovery notes + failed evidence)
  const inProgressItems: string[] = [];
  for (const t of tickets.filter((t) => t.status === 'in_progress')) {
    const lines: string[] = [`${t.id}: ${t.title}`];
    for (const n of t.notes.discovery) {
      lines.push(`  - discovery: ${n.text}`);
    }
    for (const e of t.evidence.filter((e) => e.status === 'failed')) {
      lines.push(`  - \`${e.command}\` ✗`);
    }
    inProgressItems.push(lines.join('\n'));
  }

  // Blockers: blocked-status tickets + any ticket with blocker notes
  const blockerItems: string[] = [];
  const seen = new Set<string>();
  for (const t of tickets) {
    if (t.status !== 'blocked' && t.notes.blocker.length === 0) continue;
    if (seen.has(t.id)) continue;
    seen.add(t.id);
    if (t.notes.blocker.length > 0) {
      for (const n of t.notes.blocker) {
        blockerItems.push(`${t.id}: ${n.text}`);
      }
    } else {
      blockerItems.push(`${t.id}: ${t.title}`);
    }
  }

  const sections: Section[] = [
    { title: 'Done', items: doneItems },
    { title: 'In Progress', items: inProgressItems },
    { title: 'Blockers', items: blockerItems },
  ];

  return format === 'slack' ? renderSlack(sections) : renderMarkdown(sections);
}

function renderMarkdown(sections: Section[]): string {
  const lines: string[] = [];
  for (const s of sections) {
    lines.push(`## ${s.title}`, '');
    if (s.items.length === 0) {
      lines.push('_none_');
    } else {
      for (const item of s.items) {
        const [first, ...rest] = item.split('\n');
        lines.push(`- ${first}`);
        for (const sub of rest) lines.push(sub);
      }
    }
    lines.push('');
  }
  return lines.join('\n').trimEnd() + '\n';
}

function renderSlack(sections: Section[]): string {
  const lines: string[] = [];
  for (const s of sections) {
    lines.push(`*${s.title}*`);
    if (s.items.length === 0) {
      lines.push('_none_');
    } else {
      for (const item of s.items) {
        const [first, ...rest] = item.split('\n');
        lines.push(`• ${first}`);
        for (const sub of rest) lines.push(sub);
      }
    }
    lines.push('');
  }
  return lines.join('\n').trimEnd() + '\n';
}
