import { existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { requireSprintDir } from '../paths.js';
import { CyaError } from '../errors.js';
import { createEvent, appendEvent, readEvents } from '../events.js';
import { atomicWrite } from '../io.js';
import { reduceAll } from '../reduce.js';
import { renderTicket, renderSprint } from '../render.js';

export async function runAssign(shaPrefix: string, ticket: string, cwd = process.cwd()): Promise<void> {
  if (!shaPrefix || shaPrefix.length < 4) {
    throw new CyaError('invalid-sha', 'SHA must be at least 4 characters.');
  }
  if (!ticket || /\s/.test(ticket)) {
    throw new CyaError('invalid-ticket', `Invalid ticket ID: "${ticket}"`);
  }

  const { repoRoot, sprintDir } = requireSprintDir(cwd);

  const events = await readEvents(sprintDir);
  const state = reduceAll(events);

  if (!state.tickets[ticket]) {
    throw new CyaError('unknown-ticket', `Ticket "${ticket}" is not tracked. Run cya track first.`);
  }

  // Idempotent: if already on this ticket (by prefix or full sha), no-op.
  const alreadyOnTicket = state.tickets[ticket].commits.find((c) => c.sha.startsWith(shaPrefix));
  if (alreadyOnTicket) {
    console.log(`assign: ${alreadyOnTicket.shortSha} already on ${ticket}, nothing to do.`);
    return;
  }

  // Resolve sha prefix against unassigned commits.
  const matches = state.unassignedCommits.filter((c) => c.sha.startsWith(shaPrefix));
  if (matches.length === 0) {
    throw new CyaError('unknown-sha', `No unassigned commit matching "${shaPrefix}".`);
  }
  if (matches.length > 1) {
    throw new CyaError('ambiguous-sha', `"${shaPrefix}" matches ${matches.length} commits. Use a longer prefix.`);
  }
  const commit = matches[0];

  const event = createEvent({
    type: 'commit_assigned',
    repoPath: repoRoot,
    source: 'user',
    ticket,
    payload: { sha: commit.sha, shortSha: commit.shortSha },
  });
  await appendEvent(sprintDir, event);

  const newEvents = await readEvents(sprintDir);
  const newState = reduceAll(newEvents);

  const ticketsDir = join(sprintDir, 'tickets');
  if (!existsSync(ticketsDir)) mkdirSync(ticketsDir);

  await atomicWrite(join(ticketsDir, `${ticket}.md`), renderTicket(newState.tickets[ticket]));
  await atomicWrite(join(sprintDir, 'state.json'), JSON.stringify(newState, null, 2) + '\n');
  await atomicWrite(join(sprintDir, 'SPRINT.md'), renderSprint(newState));

  console.log(`assign: ${commit.shortSha} → ${ticket}`);
}
