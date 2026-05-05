import { describe, it, expect } from 'vitest';
import { TicketDoneEventSchema, TicketUnblockedEventSchema, SprintEventSchema } from '../src/events.js';

const BASE = {
  id: 'test-id',
  timestamp: '2024-01-01T00:00:00.000Z',
  repoPath: '/repo',
  source: 'user' as const,
  ticket: 'AUTH-123',
};

describe('ticket_done event schema', () => {
  it('accepts minimal valid event', () => {
    const ev = { ...BASE, type: 'ticket_done', payload: {} };
    expect(() => TicketDoneEventSchema.parse(ev)).not.toThrow();
  });

  it('accepts event with note', () => {
    const ev = { ...BASE, type: 'ticket_done', payload: { note: 'Merged and verified' } };
    expect(() => TicketDoneEventSchema.parse(ev)).not.toThrow();
  });

  it('rejects missing ticket', () => {
    const { ticket: _, ...rest } = BASE;
    const ev = { ...rest, type: 'ticket_done', payload: {} };
    expect(() => TicketDoneEventSchema.parse(ev)).toThrow();
  });

  it('rejects empty ticket', () => {
    const ev = { ...BASE, ticket: '', type: 'ticket_done', payload: {} };
    expect(() => TicketDoneEventSchema.parse(ev)).toThrow();
  });

  it('passes SprintEventSchema discriminated union', () => {
    const ev = { ...BASE, type: 'ticket_done', payload: {} };
    expect(() => SprintEventSchema.parse(ev)).not.toThrow();
  });
});

describe('ticket_unblocked event schema', () => {
  it('accepts minimal valid event', () => {
    const ev = { ...BASE, type: 'ticket_unblocked', payload: {} };
    expect(() => TicketUnblockedEventSchema.parse(ev)).not.toThrow();
  });

  it('accepts event with note', () => {
    const ev = { ...BASE, type: 'ticket_unblocked', payload: { note: 'Credentials received' } };
    expect(() => TicketUnblockedEventSchema.parse(ev)).not.toThrow();
  });

  it('rejects missing ticket', () => {
    const { ticket: _, ...rest } = BASE;
    const ev = { ...rest, type: 'ticket_unblocked', payload: {} };
    expect(() => TicketUnblockedEventSchema.parse(ev)).toThrow();
  });

  it('passes SprintEventSchema discriminated union', () => {
    const ev = { ...BASE, type: 'ticket_unblocked', payload: {} };
    expect(() => SprintEventSchema.parse(ev)).not.toThrow();
  });

  it('rejects malformed payload (non-string note)', () => {
    const ev = { ...BASE, type: 'ticket_unblocked', payload: { note: 123 } };
    expect(() => TicketUnblockedEventSchema.parse(ev)).toThrow();
  });
});
