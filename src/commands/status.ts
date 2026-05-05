import { requireSprintDir } from '../paths.js';
import { readEvents } from '../events.js';
import { reduceAll } from '../reduce.js';

export async function runStatus(cwd = process.cwd()): Promise<void> {
  const { sprintDir } = requireSprintDir(cwd);

  const events = await readEvents(sprintDir);
  const state = reduceAll(events);

  const tickets = Object.values(state.tickets);
  const inProgress = tickets.filter((t) => t.status === 'in_progress');
  const blocked = tickets.filter((t) => t.status === 'blocked');
  const done = tickets.filter((t) => t.status === 'done');

  const lines: string[] = ['CYA status', ''];

  lines.push('In progress:');
  if (inProgress.length === 0) {
    lines.push('  none');
  } else {
    for (const t of inProgress) lines.push(`  - ${t.id} ${t.title}`);
  }
  lines.push('');

  lines.push('Blocked:');
  if (blocked.length === 0) {
    lines.push('  none');
  } else {
    for (const t of blocked) {
      lines.push(`  - ${t.id} ${t.title}`);
      const lastBlocker = t.notes.blocker.at(-1);
      if (lastBlocker) lines.push(`    Blocker: ${lastBlocker.text}`);
    }
  }
  lines.push('');

  lines.push('Done:');
  if (done.length === 0) {
    lines.push('  none');
  } else {
    for (const t of done) lines.push(`  - ${t.id} ${t.title}`);
  }
  lines.push('');

  const unassignedCount = state.unassignedCommits.length;
  lines.push('Unassigned commits:');
  if (unassignedCount === 0) {
    lines.push('  none');
  } else {
    lines.push(
      `  ${unassignedCount} commit${unassignedCount === 1 ? '' : 's'}. Run \`cya assign <sha> <ticket>\`.`,
    );
  }
  lines.push('');

  const suggestions: string[] = [];
  if (inProgress.length > 0 || done.length > 0) {
    suggestions.push('cya standup');
  }
  if (inProgress.length > 0) {
    suggestions.push(`cya note <ticket> "<update>" --type context`);
  }
  if (unassignedCount > 0) {
    suggestions.push(`cya assign <sha> <ticket>`);
  }
  if (suggestions.length > 0) {
    lines.push('Next:');
    for (const s of suggestions) lines.push(`  - ${s}`);
  }

  console.log(lines.join('\n'));
}
