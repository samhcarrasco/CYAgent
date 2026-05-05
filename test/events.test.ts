import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  createEvent,
  validateEvent,
  appendEvent,
  readEvents,
  type EventInput,
} from '../src/events.js';
import { CyaError } from '../src/errors.js';

// ── Fixtures ──────────────────────────────────────────────────────────────────

const trackInput: EventInput = {
  type: 'track_started',
  repoPath: '/home/user/myrepo',
  source: 'user',
  ticket: 'AUTH-123',
  branch: 'feature/auth-session-fix',
  payload: { title: 'Session expiry regression' },
};

const noteInput: EventInput = {
  type: 'note_added',
  repoPath: '/home/user/myrepo',
  source: 'user',
  ticket: 'AUTH-123',
  payload: { kind: 'discovery', text: 'Redis evicts mid-session' },
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeTempSprintDir(): { root: string; sprintDir: string } {
  const root = mkdtempSync(join(tmpdir(), 'cya-ev-test-'));
  const sprintDir = join(root, '.sprint');
  mkdirSync(sprintDir);
  writeFileSync(join(sprintDir, 'events.jsonl'), '', 'utf8');
  return { root, sprintDir };
}

// ── createEvent ───────────────────────────────────────────────────────────────

describe('createEvent', () => {
  it('adds a non-empty string id', () => {
    const event = createEvent(trackInput);
    expect(typeof event.id).toBe('string');
    expect(event.id.length).toBeGreaterThan(0);
  });

  it('adds an ISO 8601 timestamp', () => {
    const before = new Date().toISOString();
    const event = createEvent(trackInput);
    const after = new Date().toISOString();
    expect(event.timestamp >= before).toBe(true);
    expect(event.timestamp <= after).toBe(true);
  });

  it('preserves all input fields on track_started', () => {
    const event = createEvent(trackInput);
    expect(event.type).toBe('track_started');
    expect(event.repoPath).toBe('/home/user/myrepo');
    expect(event.source).toBe('user');
    expect(event.ticket).toBe('AUTH-123');
    expect(event.branch).toBe('feature/auth-session-fix');
    expect(event.payload).toEqual({ title: 'Session expiry regression' });
  });

  it('preserves all input fields on note_added', () => {
    const event = createEvent(noteInput);
    expect(event.type).toBe('note_added');
    expect(event.payload).toEqual({ kind: 'discovery', text: 'Redis evicts mid-session' });
  });

  it('produces a unique id on each call', () => {
    const ids = new Set(Array.from({ length: 10 }, () => createEvent(trackInput).id));
    expect(ids.size).toBe(10);
  });
});

// ── validateEvent ─────────────────────────────────────────────────────────────

describe('validateEvent', () => {
  it('accepts a valid track_started event', () => {
    const event = createEvent(trackInput);
    expect(() => validateEvent(event)).not.toThrow();
    expect(validateEvent(event)).toMatchObject({ type: 'track_started' });
  });

  it('accepts a valid note_added event', () => {
    const event = createEvent(noteInput);
    expect(() => validateEvent(event)).not.toThrow();
    expect(validateEvent(event)).toMatchObject({ type: 'note_added' });
  });

  it('rejects an object missing required base fields', () => {
    expect(() => validateEvent({ type: 'track_started', payload: { title: 'x' } })).toThrow(
      CyaError,
    );
  });

  it('rejects an unknown event type', () => {
    const raw = {
      id: crypto.randomUUID(),
      ts: new Date().toISOString(),
      type: 'unknown_type',
      repo: '/',
      source: 'user',
      payload: {},
    };
    expect(() => validateEvent(raw)).toThrow(CyaError);
  });

  it('rejects null', () => {
    expect(() => validateEvent(null)).toThrow(CyaError);
  });

  it('rejects a plain string', () => {
    expect(() => validateEvent('not-an-event')).toThrow(CyaError);
  });

  it('rejects note_added with an invalid kind value', () => {
    const raw = {
      ...createEvent(noteInput),
      payload: { kind: 'invalid-kind', text: 'some text' },
    };
    expect(() => validateEvent(raw)).toThrow(CyaError);
  });

  it('throws CyaError with code invalid-event', () => {
    try {
      validateEvent({ type: 'track_started' });
      expect.fail('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(CyaError);
      expect((err as CyaError).code).toBe('invalid-event');
    }
  });
});

// ── appendEvent ───────────────────────────────────────────────────────────────

describe('appendEvent', () => {
  let sprintDir: string;
  let root: string;

  beforeEach(() => {
    ({ root, sprintDir } = makeTempSprintDir());
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('writes one event as a single JSON line', async () => {
    const event = createEvent(trackInput);
    await appendEvent(sprintDir, event);

    const content = readFileSync(join(sprintDir, 'events.jsonl'), 'utf8');
    const lines = content.trim().split('\n');
    expect(lines.length).toBe(1);
    expect(JSON.parse(lines[0])).toEqual(event);
  });

  it('appends a second event after the first without overwriting', async () => {
    const e1 = createEvent(trackInput);
    const e2 = createEvent(noteInput);
    await appendEvent(sprintDir, e1);
    await appendEvent(sprintDir, e2);

    const content = readFileSync(join(sprintDir, 'events.jsonl'), 'utf8');
    const lines = content.trim().split('\n');
    expect(lines.length).toBe(2);
    expect(JSON.parse(lines[0])).toEqual(e1);
    expect(JSON.parse(lines[1])).toEqual(e2);
  });

  it('preserves earlier events after a second append', async () => {
    const e1 = createEvent(trackInput);
    await appendEvent(sprintDir, e1);
    const e2 = createEvent(noteInput);
    await appendEvent(sprintDir, e2);

    const content = readFileSync(join(sprintDir, 'events.jsonl'), 'utf8');
    expect(content).toContain(e1.id);
    expect(content).toContain(e2.id);
  });

  it('each appended event is on its own line', async () => {
    const e1 = createEvent(trackInput);
    const e2 = createEvent(noteInput);
    await appendEvent(sprintDir, e1);
    await appendEvent(sprintDir, e2);

    const content = readFileSync(join(sprintDir, 'events.jsonl'), 'utf8');
    // Trailing newline means split gives one empty string at end
    const nonEmpty = content.split('\n').filter((l) => l.trim() !== '');
    expect(nonEmpty.length).toBe(2);
    // Each line must be independently valid JSON
    for (const line of nonEmpty) {
      expect(() => JSON.parse(line)).not.toThrow();
    }
  });

  it('throws CyaError with code events-not-found when events.jsonl is absent', async () => {
    rmSync(join(sprintDir, 'events.jsonl'));
    const event = createEvent(trackInput);
    try {
      await appendEvent(sprintDir, event);
      expect.fail('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(CyaError);
      expect((err as CyaError).code).toBe('events-not-found');
    }
  });
});

// ── Additional event types ────────────────────────────────────────────────────

describe('additional event types', () => {
  const baseFields = {
    id: crypto.randomUUID(),
    timestamp: new Date().toISOString(),
    repoPath: '/home/user/repo',
    source: 'user' as const,
  };

  it('validates commit_assigned event', () => {
    const raw = {
      ...baseFields,
      type: 'commit_assigned',
      ticket: 'AUTH-1',
      payload: { sha: 'a'.repeat(40), shortSha: 'abc1234' },
    };
    expect(() => validateEvent(raw)).not.toThrow();
  });

  it('validates agent_hooks_installed event', () => {
    const raw = {
      ...baseFields,
      type: 'agent_hooks_installed',
      payload: { hooks: ['post-commit', 'post-merge'] },
    };
    expect(() => validateEvent(raw)).not.toThrow();
  });

  it('validates agent_hooks_uninstalled event', () => {
    const raw = {
      ...baseFields,
      type: 'agent_hooks_uninstalled',
      payload: { hooks: ['post-commit'] },
    };
    expect(() => validateEvent(raw)).not.toThrow();
  });

  it('accepts git-hook as source', () => {
    const raw = {
      ...baseFields,
      source: 'git-hook',
      type: 'agent_hooks_installed',
      payload: { hooks: [] },
    };
    expect(() => validateEvent(raw)).not.toThrow();
  });

  it('accepts watcher as source', () => {
    const raw = {
      ...baseFields,
      source: 'watcher',
      type: 'agent_hooks_installed',
      payload: { hooks: [] },
    };
    expect(() => validateEvent(raw)).not.toThrow();
  });

  it('rejects commit_assigned with missing ticket', () => {
    const raw = {
      ...baseFields,
      type: 'commit_assigned',
      payload: { sha: 'a'.repeat(40), shortSha: 'abc1234' },
    };
    expect(() => validateEvent(raw)).toThrow(CyaError);
  });
});

// ── readEvents ────────────────────────────────────────────────────────────────

describe('readEvents', () => {
  let sprintDir: string;
  let root: string;

  beforeEach(() => {
    ({ root, sprintDir } = makeTempSprintDir());
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('returns an empty array for an empty events.jsonl', async () => {
    const events = await readEvents(sprintDir);
    expect(events).toEqual([]);
  });

  it('returns events in file order', async () => {
    const e1 = createEvent(trackInput);
    const e2 = createEvent(noteInput);
    await appendEvent(sprintDir, e1);
    await appendEvent(sprintDir, e2);

    const events = await readEvents(sprintDir);
    expect(events.length).toBe(2);
    expect(events[0].id).toBe(e1.id);
    expect(events[1].id).toBe(e2.id);
  });

  it('round-trips event data without loss', async () => {
    const e = createEvent(trackInput);
    await appendEvent(sprintDir, e);

    const [read] = await readEvents(sprintDir);
    expect(read).toEqual(e);
  });

  it('returns all events when many are appended', async () => {
    for (let i = 0; i < 20; i++) {
      await appendEvent(sprintDir, createEvent(i % 2 === 0 ? trackInput : noteInput));
    }
    const events = await readEvents(sprintDir);
    expect(events.length).toBe(20);
  });

  it('throws CyaError with code invalid-jsonl on a malformed JSON line', async () => {
    writeFileSync(join(sprintDir, 'events.jsonl'), 'not valid json\n', 'utf8');
    try {
      await readEvents(sprintDir);
      expect.fail('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(CyaError);
      expect((err as CyaError).code).toBe('invalid-jsonl');
      expect((err as CyaError).message).toContain('line 1');
    }
  });

  it('includes the correct line number in invalid-jsonl errors', async () => {
    const e = createEvent(trackInput);
    writeFileSync(
      join(sprintDir, 'events.jsonl'),
      JSON.stringify(e) + '\n' + 'bad json\n',
      'utf8',
    );
    try {
      await readEvents(sprintDir);
      expect.fail('should have thrown');
    } catch (err) {
      expect((err as CyaError).message).toContain('line 2');
    }
  });

  it('throws CyaError with code invalid-event-shape on valid JSON with wrong shape', async () => {
    writeFileSync(
      join(sprintDir, 'events.jsonl'),
      JSON.stringify({ type: 'track_started', id: 'x' }) + '\n',
      'utf8',
    );
    try {
      await readEvents(sprintDir);
      expect.fail('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(CyaError);
      expect((err as CyaError).code).toBe('invalid-event-shape');
    }
  });

  it('throws CyaError with code events-not-found when events.jsonl is absent', async () => {
    rmSync(join(sprintDir, 'events.jsonl'));
    try {
      await readEvents(sprintDir);
      expect.fail('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(CyaError);
      expect((err as CyaError).code).toBe('events-not-found');
    }
  });
});
