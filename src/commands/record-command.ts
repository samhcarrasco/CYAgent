import { existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { requireSprintDir } from '../paths.js';
import { createEvent, appendEvent, readEvents } from '../events.js';
import { atomicWrite } from '../io.js';
import { reduceAll } from '../reduce.js';
import { renderTicket, renderSprint } from '../render.js';
import { CyaError } from '../errors.js';

export async function runRecordCommand(
  command: string,
  status: string | undefined,
  ticket: string | undefined,
  exitCode: number | undefined,
  cwd = process.cwd(),
): Promise<void> {
  const trimmedCommand = command?.trim() ?? '';
  if (!trimmedCommand) {
    throw new CyaError('invalid-command', 'Command must not be empty.');
  }

  if (!status || !['passed', 'failed'].includes(status)) {
    throw new CyaError(
      'invalid-status',
      `Status must be "passed" or "failed", got: ${status ?? '(missing)'}.`,
    );
  }

  const { repoRoot, sprintDir } = requireSprintDir(cwd);

  const existingEvents = await readEvents(sprintDir);
  const existingState = reduceAll(existingEvents);

  if (!ticket || !existingState.tickets[ticket]) {
    throw new CyaError(
      'unknown-ticket',
      `Ticket "${ticket ?? '(missing)'}" is not tracked. Run cya track first.`,
    );
  }

  const validStatus = status as 'passed' | 'failed';

  const event = createEvent({
    type: 'command_recorded',
    repoPath: repoRoot,
    source: 'cmd',
    ticket,
    payload: {
      command: trimmedCommand,
      status: validStatus,
      ...(exitCode !== undefined ? { exitCode } : {}),
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

  const icon = validStatus === 'passed' ? '✓' : '✗';
  console.log(`record-command: ${icon} "${trimmedCommand}" — ${validStatus} on ${ticket}.`);
}
