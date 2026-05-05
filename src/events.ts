import { z } from 'zod';
import { existsSync } from 'node:fs';
import { readFile, appendFile } from 'node:fs/promises';
import { join } from 'node:path';
import { CyaError } from './errors.js';

// ── Source ────────────────────────────────────────────────────────────────────

export const EventSourceSchema = z.enum(['user', 'git', 'gh', 'cmd', 'system', 'git-hook', 'watcher', 'claude-code']);

// ── Command status ────────────────────────────────────────────────────────────

export const CommandStatusSchema = z.enum(['passed', 'failed']);
export type CommandStatus = z.infer<typeof CommandStatusSchema>;
export type EventSource = z.infer<typeof EventSourceSchema>;

// ── Note kind (here because it is an event-payload field; state.ts imports it) ─

export const NoteKindSchema = z.enum([
  'blocker',
  'followup',
  'decision',
  'discovery',
  'risk',
  'context',
]);
export type NoteKind = z.infer<typeof NoteKindSchema>;

// ── Shared base fields ────────────────────────────────────────────────────────

const EventBaseSchema = z.object({
  id: z.string().min(1),
  timestamp: z.string().datetime(),
  repoPath: z.string().min(1),
  branch: z.string().optional(),
  ticket: z.string().optional(),
  source: EventSourceSchema,
});

// ── Typed event schemas ───────────────────────────────────────────────────────

export const TrackStartedEventSchema = EventBaseSchema.extend({
  type: z.literal('track_started'),
  ticket: z.string().min(1),
  payload: z.object({
    title: z.string().min(1),
    baselineSha: z.string().min(1).optional(),
  }),
});

export const NoteAddedEventSchema = EventBaseSchema.extend({
  type: z.literal('note_added'),
  ticket: z.string().min(1),
  payload: z.object({
    kind: NoteKindSchema,
    text: z.string().min(1),
  }),
});

export const CommitObservedEventSchema = EventBaseSchema.extend({
  type: z.literal('commit_observed'),
  payload: z.object({
    sha: z.string().min(1),
    shortSha: z.string().min(1),
    message: z.string().min(1),
    authorName: z.string().optional(),
    authorEmail: z.string().optional(),
    committedAt: z.string(),
    branch: z.string().min(1),
    filesChanged: z.number().int().optional(),
  }),
});

export const CommandRecordedEventSchema = EventBaseSchema.extend({
  type: z.literal('command_recorded'),
  ticket: z.string().min(1),
  payload: z.object({
    command: z.string().min(1),
    status: CommandStatusSchema,
    exitCode: z.number().int().optional(),
  }),
});

export const CommitAssignedEventSchema = EventBaseSchema.extend({
  type: z.literal('commit_assigned'),
  ticket: z.string().min(1),
  payload: z.object({
    sha: z.string().min(1),
    shortSha: z.string().min(1),
  }),
});

export const AgentHooksInstalledEventSchema = EventBaseSchema.extend({
  type: z.literal('agent_hooks_installed'),
  payload: z.object({
    hooks: z.array(z.string()),
  }),
});

export const AgentHooksUninstalledEventSchema = EventBaseSchema.extend({
  type: z.literal('agent_hooks_uninstalled'),
  payload: z.object({
    hooks: z.array(z.string()),
  }),
});

export const SessionSummaryEventSchema = EventBaseSchema.extend({
  type: z.literal('session_summary'),
  ticket: z.string().min(1),
  payload: z.object({
    summary: z.string().min(1).max(2000),
    sessionId: z.string().optional(),
    durationMs: z.number().int().optional(),
  }),
});

export const TicketDoneEventSchema = EventBaseSchema.extend({
  type: z.literal('ticket_done'),
  ticket: z.string().min(1),
  payload: z.object({
    note: z.string().optional(),
  }),
});

export const TicketUnblockedEventSchema = EventBaseSchema.extend({
  type: z.literal('ticket_unblocked'),
  ticket: z.string().min(1),
  payload: z.object({
    note: z.string().optional(),
  }),
});

export const SprintEventSchema = z.discriminatedUnion('type', [
  TrackStartedEventSchema,
  NoteAddedEventSchema,
  CommitObservedEventSchema,
  CommandRecordedEventSchema,
  CommitAssignedEventSchema,
  AgentHooksInstalledEventSchema,
  AgentHooksUninstalledEventSchema,
  SessionSummaryEventSchema,
  TicketDoneEventSchema,
  TicketUnblockedEventSchema,
]);

export type TrackStartedEvent = z.infer<typeof TrackStartedEventSchema>;
export type NoteAddedEvent = z.infer<typeof NoteAddedEventSchema>;
export type CommitObservedEvent = z.infer<typeof CommitObservedEventSchema>;
export type CommandRecordedEvent = z.infer<typeof CommandRecordedEventSchema>;
export type CommitAssignedEvent = z.infer<typeof CommitAssignedEventSchema>;
export type AgentHooksInstalledEvent = z.infer<typeof AgentHooksInstalledEventSchema>;
export type AgentHooksUninstalledEvent = z.infer<typeof AgentHooksUninstalledEventSchema>;
export type SessionSummaryEvent = z.infer<typeof SessionSummaryEventSchema>;
export type TicketDoneEvent = z.infer<typeof TicketDoneEventSchema>;
export type TicketUnblockedEvent = z.infer<typeof TicketUnblockedEventSchema>;
export type SprintEvent = z.infer<typeof SprintEventSchema>;

// Input: everything except id and timestamp (those are added by createEvent).
export type EventInput =
  | Omit<TrackStartedEvent, 'id' | 'timestamp'>
  | Omit<NoteAddedEvent, 'id' | 'timestamp'>
  | Omit<CommitObservedEvent, 'id' | 'timestamp'>
  | Omit<CommandRecordedEvent, 'id' | 'timestamp'>
  | Omit<CommitAssignedEvent, 'id' | 'timestamp'>
  | Omit<AgentHooksInstalledEvent, 'id' | 'timestamp'>
  | Omit<AgentHooksUninstalledEvent, 'id' | 'timestamp'>
  | Omit<SessionSummaryEvent, 'id' | 'timestamp'>
  | Omit<TicketDoneEvent, 'id' | 'timestamp'>
  | Omit<TicketUnblockedEvent, 'id' | 'timestamp'>;

// ── Public API ────────────────────────────────────────────────────────────────

export function createEvent(input: EventInput): SprintEvent {
  return {
    ...input,
    id: crypto.randomUUID(),
    timestamp: new Date().toISOString(),
  } as SprintEvent;
}

export function validateEvent(raw: unknown): SprintEvent {
  const result = SprintEventSchema.safeParse(raw);
  if (!result.success) {
    const first = result.error.issues[0];
    const detail = first ? `${first.path.join('.') || 'root'}: ${first.message}` : result.error.message;
    throw new CyaError('invalid-event', `Invalid event — ${detail}`);
  }
  return result.data;
}

export async function appendEvent(sprintDir: string, event: SprintEvent): Promise<void> {
  const eventsPath = join(sprintDir, 'events.jsonl');
  if (!existsSync(eventsPath)) {
    throw new CyaError(
      'events-not-found',
      'events.jsonl not found. Run cya init first.',
    );
  }
  await appendFile(eventsPath, JSON.stringify(event) + '\n', 'utf8');
}

export async function readEvents(sprintDir: string): Promise<SprintEvent[]> {
  const eventsPath = join(sprintDir, 'events.jsonl');
  if (!existsSync(eventsPath)) {
    throw new CyaError(
      'events-not-found',
      'events.jsonl not found. Run cya init first.',
    );
  }

  const content = await readFile(eventsPath, 'utf8');
  const lines = content.split('\n').filter((l) => l.trim() !== '');
  if (lines.length === 0) return [];

  const events: SprintEvent[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();

    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      throw new CyaError(
        'invalid-jsonl',
        `events.jsonl line ${i + 1}: invalid JSON`,
      );
    }

    const result = SprintEventSchema.safeParse(parsed);
    if (!result.success) {
      const first = result.error.issues[0];
      const detail = first
        ? `${first.path.join('.') || 'root'}: ${first.message}`
        : result.error.message;
      throw new CyaError(
        'invalid-event-shape',
        `events.jsonl line ${i + 1}: invalid event shape — ${detail}`,
      );
    }

    events.push(result.data);
  }

  return events;
}
