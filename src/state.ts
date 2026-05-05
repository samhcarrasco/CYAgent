import { z } from 'zod';
import { NoteKindSchema, CommandStatusSchema } from './events.js';

export { NoteKindSchema, CommandStatusSchema };
export type NoteKind = z.infer<typeof NoteKindSchema>;

export const TicketStatusSchema = z.enum(['in_progress', 'blocked', 'done']);
export type TicketStatus = z.infer<typeof TicketStatusSchema>;

export const NoteEntrySchema = z.object({
  id: z.string(),
  timestamp: z.string(),
  text: z.string(),
});

export const CommandEntrySchema = z.object({
  id: z.string(),
  timestamp: z.string(),
  command: z.string(),
  status: CommandStatusSchema,
  exitCode: z.number().int().optional(),
});

export const CommitEntrySchema = z.object({
  sha: z.string(),
  shortSha: z.string(),
  message: z.string(),
  authorName: z.string().optional(),
  authorEmail: z.string().optional(),
  committedAt: z.string(),
  branch: z.string(),
});

export const SessionEntrySchema = z.object({
  id: z.string(),
  timestamp: z.string(),
  source: z.literal('claude-code'),
  summary: z.string(),
  sessionId: z.string().optional(),
  durationMs: z.number().int().optional(),
});

export const TicketStateSchema = z.object({
  id: z.string(),
  title: z.string(),
  branch: z.string().optional(),
  baselineSha: z.string().optional(),
  status: TicketStatusSchema,
  commits: z.array(CommitEntrySchema),
  evidence: z.array(CommandEntrySchema),
  sessions: z.array(SessionEntrySchema),
  notes: z.object({
    blocker: z.array(NoteEntrySchema),
    followup: z.array(NoteEntrySchema),
    decision: z.array(NoteEntrySchema),
    discovery: z.array(NoteEntrySchema),
    risk: z.array(NoteEntrySchema),
    context: z.array(NoteEntrySchema),
  }),
  lastUpdatedAt: z.string(),
});

export const SyncSourceSchema = z.enum(['user', 'git-hook', 'watcher', 'claude-code']);

export const StateSchema = z.object({
  version: z.literal(2),
  lastSyncAt: z.string().nullable(),
  lastSyncSource: SyncSourceSchema.nullable(),
  tickets: z.record(TicketStateSchema),
  unassignedCommits: z.array(CommitEntrySchema),
});

export type CommandEntry = z.infer<typeof CommandEntrySchema>;
export type CommitEntry = z.infer<typeof CommitEntrySchema>;
export type SessionEntry = z.infer<typeof SessionEntrySchema>;
export type TicketState = z.infer<typeof TicketStateSchema>;
export type State = z.infer<typeof StateSchema>;

export function initialState(): State {
  return {
    version: 2,
    lastSyncAt: null,
    lastSyncSource: null,
    tickets: {},
    unassignedCommits: [],
  };
}
