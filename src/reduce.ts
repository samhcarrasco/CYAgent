import type { SprintEvent } from './events.js';
import { type State, type TicketState, initialState } from './state.js';

export function reduce(state: State, event: SprintEvent): State {
  switch (event.type) {
    case 'track_started': {
      const existing = state.tickets[event.ticket];
      const ticket: TicketState = {
        id: event.ticket,
        title: event.payload.title,
        branch: event.branch,
        status: 'in_progress',
        commits: existing?.commits ?? [],
        evidence: existing?.evidence ?? [],
        sessions: existing?.sessions ?? [],
        notes: existing?.notes ?? emptyNotes(),
        lastUpdatedAt: event.timestamp,
      };
      return {
        ...state,
        tickets: { ...state.tickets, [event.ticket]: ticket },
      };
    }
    case 'note_added': {
      const existing = state.tickets[event.ticket];
      if (!existing) return state;
      const entry = { id: event.id, timestamp: event.timestamp, text: event.payload.text };
      const kind = event.payload.kind;
      const updatedTicket: TicketState = {
        ...existing,
        notes: { ...existing.notes, [kind]: [...existing.notes[kind], entry] },
        status: kind === 'blocker' ? 'blocked' : existing.status,
        lastUpdatedAt: event.timestamp,
      };
      return { ...state, tickets: { ...state.tickets, [event.ticket]: updatedTicket } };
    }
    case 'commit_observed': {
      const now = event.timestamp;
      const source = (event.source === 'git-hook' || event.source === 'watcher' || event.source === 'user' || event.source === 'claude-code')
        ? event.source
        : 'user';
      const newState = { ...state, lastSyncAt: now, lastSyncSource: source };
      const ticketId = event.ticket;
      const entry = {
        sha: event.payload.sha,
        shortSha: event.payload.shortSha,
        message: event.payload.message,
        authorName: event.payload.authorName,
        authorEmail: event.payload.authorEmail,
        committedAt: event.payload.committedAt,
        branch: event.payload.branch,
      };
      if (!ticketId || !state.tickets[ticketId]) {
        // Unassigned — add to unassignedCommits if not already present.
        const alreadyUnassigned = newState.unassignedCommits.some((c) => c.sha === entry.sha);
        const alreadyTicketed = Object.values(newState.tickets).some((t) =>
          t.commits.some((c) => c.sha === entry.sha),
        );
        if (alreadyUnassigned || alreadyTicketed) return newState;
        return { ...newState, unassignedCommits: [...newState.unassignedCommits, entry] };
      }
      const ticket = state.tickets[ticketId];
      return {
        ...newState,
        tickets: {
          ...newState.tickets,
          [ticketId]: { ...ticket, commits: [...ticket.commits, entry], lastUpdatedAt: now },
        },
      };
    }
    case 'commit_assigned': {
      const ticketId = event.ticket;
      const ticket = state.tickets[ticketId];
      if (!ticket) return state;
      const sha = event.payload.sha;
      const unassigned = state.unassignedCommits.find((c) => c.sha === sha);
      // Idempotent: if sha already on ticket, no-op.
      if (ticket.commits.some((c) => c.sha === sha)) return state;
      // If not in unassigned list (unknown sha), no-op.
      if (!unassigned) return state;
      const now = event.timestamp;
      return {
        ...state,
        unassignedCommits: state.unassignedCommits.filter((c) => c.sha !== sha),
        tickets: {
          ...state.tickets,
          [ticketId]: {
            ...ticket,
            commits: [...ticket.commits, unassigned],
            lastUpdatedAt: now,
          },
        },
      };
    }
    case 'ticket_done': {
      const existing = state.tickets[event.ticket];
      if (!existing) return state;
      const notes = event.payload.note
        ? {
            ...existing.notes,
            context: [
              ...existing.notes.context,
              { id: event.id, timestamp: event.timestamp, text: event.payload.note },
            ],
          }
        : existing.notes;
      return {
        ...state,
        tickets: {
          ...state.tickets,
          [event.ticket]: { ...existing, status: 'done', notes, lastUpdatedAt: event.timestamp },
        },
      };
    }
    case 'ticket_unblocked': {
      const existing = state.tickets[event.ticket];
      if (!existing || existing.status !== 'blocked') return state;
      const notes = event.payload.note
        ? {
            ...existing.notes,
            context: [
              ...existing.notes.context,
              { id: event.id, timestamp: event.timestamp, text: event.payload.note },
            ],
          }
        : existing.notes;
      return {
        ...state,
        tickets: {
          ...state.tickets,
          [event.ticket]: {
            ...existing,
            status: 'in_progress',
            notes,
            lastUpdatedAt: event.timestamp,
          },
        },
      };
    }
    case 'agent_hooks_installed':
    case 'agent_hooks_uninstalled':
      return state;
    case 'session_summary': {
      const existing = state.tickets[event.ticket];
      if (!existing) return state;
      const entry = {
        id: event.id,
        timestamp: event.timestamp,
        source: 'claude-code' as const,
        summary: event.payload.summary,
        sessionId: event.payload.sessionId,
        durationMs: event.payload.durationMs,
      };
      return {
        ...state,
        tickets: {
          ...state.tickets,
          [event.ticket]: {
            ...existing,
            sessions: [...existing.sessions, entry],
            lastUpdatedAt: event.timestamp,
          },
        },
      };
    }
    case 'command_recorded': {
      const existing = state.tickets[event.ticket];
      if (!existing) return state;
      const entry = {
        id: event.id,
        timestamp: event.timestamp,
        command: event.payload.command,
        status: event.payload.status,
        exitCode: event.payload.exitCode,
      };
      return {
        ...state,
        tickets: {
          ...state.tickets,
          [event.ticket]: {
            ...existing,
            evidence: [...existing.evidence, entry],
            lastUpdatedAt: event.timestamp,
          },
        },
      };
    }
    default:
      return state;
  }
}

export function reduceAll(events: SprintEvent[]): State {
  return events.reduce(reduce, initialState());
}

function emptyNotes(): TicketState['notes'] {
  return {
    blocker: [],
    followup: [],
    decision: [],
    discovery: [],
    risk: [],
    context: [],
  };
}
