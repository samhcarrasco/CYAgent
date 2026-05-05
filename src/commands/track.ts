import { existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { requireSprintDir, getBranchName } from '../paths.js';
import { CyaError } from '../errors.js';
import { createEvent, appendEvent, readEvents } from '../events.js';
import { atomicWrite } from '../io.js';
import { reduceAll } from '../reduce.js';
import { renderTicket, renderSprint } from '../render.js';
import { getHeadSha } from '../git.js';
import { ticketMarkdownPath } from '../ticket-paths.js';

export interface TrackOptions {
  source?: 'user' | 'git-hook';
  baselineSha?: string;
  quiet?: boolean;
}

export async function runTrack(
  ticket: string,
  title: string,
  cwd = process.cwd(),
  options: TrackOptions = {},
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
  const existingEvents = await readEvents(sprintDir);
  const existingState = reduceAll(existingEvents);
  const existingTicket = existingState.tickets[ticket];
  const baselineSha = existingTicket
    ? existingTicket.baselineSha
    : options.baselineSha ?? getHeadSha(repoRoot);
  const payload: { title: string; baselineSha?: string } = { title: trimmedTitle };
  if (baselineSha) payload.baselineSha = baselineSha;

  const event = createEvent({
    type: 'track_started',
    repoPath: repoRoot,
    source: options.source ?? 'user',
    ticket,
    branch,
    payload,
  });

  await appendEvent(sprintDir, event);

  const events = await readEvents(sprintDir);
  const state = reduceAll(events);

  const ticketsDir = join(sprintDir, 'tickets');
  if (!existsSync(ticketsDir)) mkdirSync(ticketsDir);

  await atomicWrite(join(sprintDir, 'state.json'), JSON.stringify(state, null, 2) + '\n');

  const ticketState = state.tickets[ticket];
  await atomicWrite(ticketMarkdownPath(ticketsDir, ticket), renderTicket(ticketState));
  await atomicWrite(join(sprintDir, 'SPRINT.md'), renderSprint(state));

  if (!options.quiet) console.log(`tracking ${ticket}: ${trimmedTitle}`);
}
