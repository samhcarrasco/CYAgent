import { existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { requireSprintDir } from '../paths.js';
import { CyaError } from '../errors.js';
import { NoteKindSchema, createEvent, appendEvent, readEvents } from '../events.js';
import { atomicWrite } from '../io.js';
import { reduceAll } from '../reduce.js';
import { renderTicket, renderSprint } from '../render.js';
import type { NoteKind } from '../state.js';

export async function runNote(
  ticket: string,
  text: string,
  kind: string | undefined,
  cwd = process.cwd(),
): Promise<void> {
  if (!ticket || /\s/.test(ticket)) {
    throw new CyaError('invalid-ticket', `Invalid ticket ID: "${ticket}"`);
  }
  const trimmedText = text?.trim() ?? '';
  if (!trimmedText) {
    throw new CyaError('invalid-note', 'Note text must not be empty');
  }
  const kindResult = NoteKindSchema.safeParse(kind);
  if (!kindResult.success) {
    const valid = NoteKindSchema.options.join('|');
    throw new CyaError(
      'invalid-note-type',
      `Invalid note type: "${kind}". Must be one of: ${valid}`,
    );
  }
  const noteKind: NoteKind = kindResult.data;

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
    type: 'note_added',
    repoPath: repoRoot,
    source: 'user',
    ticket,
    payload: { kind: noteKind, text: trimmedText },
  });

  await appendEvent(sprintDir, event);

  const events = await readEvents(sprintDir);
  const state = reduceAll(events);

  const ticketsDir = join(sprintDir, 'tickets');
  if (!existsSync(ticketsDir)) mkdirSync(ticketsDir);

  await atomicWrite(join(sprintDir, 'state.json'), JSON.stringify(state, null, 2) + '\n');
  await atomicWrite(join(ticketsDir, `${ticket}.md`), renderTicket(state.tickets[ticket]));
  await atomicWrite(join(sprintDir, 'SPRINT.md'), renderSprint(state));

  console.log(`note [${noteKind}] added to ${ticket}`);
}
