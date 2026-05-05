import { existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { requireSprintDir } from '../paths.js';
import { CyaError } from '../errors.js';
import { createEvent, appendEvent, readEvents } from '../events.js';
import { atomicWrite } from '../io.js';
import { reduceAll } from '../reduce.js';
import { renderTicket, renderSprint } from '../render.js';

export interface SessionNoteOptions {
  source?: 'claude-code' | 'user';
  sessionId?: string;
  durationMs?: number;
}

export async function runSessionNote(
  ticket: string,
  summary: string,
  opts: SessionNoteOptions = {},
  cwd = process.cwd(),
): Promise<void> {
  if (!ticket || /\s/.test(ticket)) {
    throw new CyaError('invalid-ticket', `Invalid ticket ID: "${ticket}"`);
  }
  const trimmed = summary?.trim() ?? '';
  if (!trimmed) {
    throw new CyaError('invalid-summary', 'Summary must not be empty');
  }
  if (trimmed.length > 2000) {
    throw new CyaError('summary-too-long', 'Summary exceeds 2000 character limit');
  }

  const source = opts.source ?? 'claude-code';

  const { repoRoot, sprintDir } = requireSprintDir(cwd);

  const existingEvents = await readEvents(sprintDir);
  const existingState = reduceAll(existingEvents);
  if (!existingState.tickets[ticket]) {
    throw new CyaError(
      'unknown-ticket',
      `Ticket "${ticket}" not found. Run: cya track ${ticket} "<title>"`,
    );
  }

  const event = createEvent({
    type: 'session_summary',
    repoPath: repoRoot,
    source,
    ticket,
    payload: {
      summary: trimmed,
      sessionId: opts.sessionId,
      durationMs: opts.durationMs,
    },
  });

  await appendEvent(sprintDir, event);

  const events = await readEvents(sprintDir);
  const state = reduceAll(events);

  const ticketsDir = join(sprintDir, 'tickets');
  if (!existsSync(ticketsDir)) mkdirSync(ticketsDir);

  await atomicWrite(join(sprintDir, 'state.json'), JSON.stringify(state, null, 2) + '\n');
  await atomicWrite(join(ticketsDir, `${ticket}.md`), renderTicket(state.tickets[ticket]));
  await atomicWrite(join(sprintDir, 'SPRINT.md'), renderSprint(state));

  console.log(`session note added to ${ticket}`);
}
