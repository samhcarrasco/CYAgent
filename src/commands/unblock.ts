import { existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { requireSprintDir } from '../paths.js';
import { CyaError } from '../errors.js';
import { createEvent, appendEvent, readEvents } from '../events.js';
import { atomicWrite } from '../io.js';
import { reduceAll } from '../reduce.js';
import { renderTicket, renderSprint } from '../render.js';

export async function runUnblock(
  ticket: string,
  options: { note?: string } = {},
  cwd = process.cwd(),
): Promise<void> {
  if (!ticket || /\s/.test(ticket)) {
    throw new CyaError('invalid-ticket', `Invalid ticket ID: "${ticket}"`);
  }

  const { repoRoot, sprintDir } = requireSprintDir(cwd);

  const existingEvents = await readEvents(sprintDir);
  const existingState = reduceAll(existingEvents);
  const existing = existingState.tickets[ticket];
  if (!existing) {
    throw new CyaError(
      'unknown-ticket',
      `Ticket "${ticket}" not found. Run: cya track ${ticket} "<title>"`,
    );
  }

  if (existing.status !== 'blocked') {
    console.log(`${ticket} is not blocked (status: ${existing.status}). No change.`);
    return;
  }

  const event = createEvent({
    type: 'ticket_unblocked',
    repoPath: repoRoot,
    source: 'user',
    ticket,
    payload: { note: options.note },
  });

  await appendEvent(sprintDir, event);

  const events = await readEvents(sprintDir);
  const state = reduceAll(events);

  const ticketsDir = join(sprintDir, 'tickets');
  if (!existsSync(ticketsDir)) mkdirSync(ticketsDir);

  await atomicWrite(join(sprintDir, 'state.json'), JSON.stringify(state, null, 2) + '\n');
  await atomicWrite(join(ticketsDir, `${ticket}.md`), renderTicket(state.tickets[ticket]!));
  await atomicWrite(join(sprintDir, 'SPRINT.md'), renderSprint(state));

  console.log(`${ticket} unblocked`);
}
