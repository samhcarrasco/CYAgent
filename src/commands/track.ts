import { existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { requireSprintDir, getBranchName } from '../paths.js';
import { CyaError } from '../errors.js';
import { createEvent, appendEvent, readEvents } from '../events.js';
import { atomicWrite } from '../io.js';
import { reduceAll } from '../reduce.js';
import { renderTicket, renderSprint } from '../render.js';

export async function runTrack(
  ticket: string,
  title: string,
  cwd = process.cwd(),
): Promise<void> {
  if (!ticket || /\s/.test(ticket)) {
    throw new CyaError('invalid-ticket', `Invalid ticket ID: "${ticket}"`);
  }
  const trimmedTitle = title?.trim() ?? '';
  if (!trimmedTitle) {
    throw new CyaError('invalid-title', 'Title must not be empty');
  }

  const { repoRoot, sprintDir } = requireSprintDir(cwd);

  const branch = getBranchName(repoRoot);

  const event = createEvent({
    type: 'track_started',
    repoPath: repoRoot,
    source: 'user',
    ticket,
    branch,
    payload: { title: trimmedTitle },
  });

  await appendEvent(sprintDir, event);

  const events = await readEvents(sprintDir);
  const state = reduceAll(events);

  const ticketsDir = join(sprintDir, 'tickets');
  if (!existsSync(ticketsDir)) mkdirSync(ticketsDir);

  await atomicWrite(join(sprintDir, 'state.json'), JSON.stringify(state, null, 2) + '\n');

  const ticketState = state.tickets[ticket];
  await atomicWrite(join(ticketsDir, `${ticket}.md`), renderTicket(ticketState));
  await atomicWrite(join(sprintDir, 'SPRINT.md'), renderSprint(state));

  console.log(`tracking ${ticket}: ${trimmedTitle}`);
}
