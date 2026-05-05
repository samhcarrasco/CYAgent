import { describe, it, expect, beforeAll, beforeEach, afterAll, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { execSync } from 'node:child_process';
import { runTrack } from '../src/commands/track.js';
import { runSessionNote } from '../src/commands/session-note.js';
import { CyaError } from '../src/errors.js';
import { StateSchema } from '../src/state.js';
import {
  setupTestAppData,
  makeTestRepo,
  cleanup,
  resolveTestSprintDir,
} from './helpers.js';

let teardown: () => void;
beforeAll(() => {
  ({ teardown } = setupTestAppData());
});
afterAll(() => teardown());

function readState(repoDir: string) {
  const sprintDir = resolveTestSprintDir(repoDir);
  return StateSchema.parse(JSON.parse(readFileSync(join(sprintDir, 'state.json'), 'utf8')));
}

function readEvents(repoDir: string) {
  const sprintDir = resolveTestSprintDir(repoDir);
  return readFileSync(join(sprintDir, 'events.jsonl'), 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((l) => JSON.parse(l));
}

describe('runSessionNote', () => {
  let repoDir: string;

  beforeEach(async () => {
    ({ repoDir } = await makeTestRepo());
    await runTrack('AUTH-123', 'Fix session expiry', repoDir);
  });

  afterEach(() => cleanup(repoDir));

  it('appends session_summary event to events.jsonl', async () => {
    await runSessionNote('AUTH-123', 'Refactored token refresh.', {}, repoDir);
    const events = readEvents(repoDir);
    const sessionEvents = events.filter((e) => e.type === 'session_summary');
    expect(sessionEvents).toHaveLength(1);
    expect(sessionEvents[0].payload.summary).toBe('Refactored token refresh.');
  });

  it('defaults source to claude-code', async () => {
    await runSessionNote('AUTH-123', 'Worked on auth.', {}, repoDir);
    const events = readEvents(repoDir);
    const ev = events.find((e) => e.type === 'session_summary');
    expect(ev.source).toBe('claude-code');
  });

  it('accepts source user', async () => {
    await runSessionNote('AUTH-123', 'Manual note.', { source: 'user' }, repoDir);
    const events = readEvents(repoDir);
    const ev = events.find((e) => e.type === 'session_summary');
    expect(ev.source).toBe('user');
  });

  it('updates ticket markdown with Sessions section', async () => {
    await runSessionNote('AUTH-123', 'Session work done.', {}, repoDir);
    const sprintDir = resolveTestSprintDir(repoDir);
    const md = readFileSync(join(sprintDir, 'tickets', 'AUTH-123.md'), 'utf8');
    expect(md).toContain('## Sessions');
    expect(md).toContain('Session work done.');
  });

  it('sessionId and durationMs round-trip through state', async () => {
    await runSessionNote(
      'AUTH-123',
      'Session with metadata.',
      { sessionId: 'sess-abc', durationMs: 3600000 },
      repoDir,
    );
    const state = readState(repoDir);
    const session = state.tickets['AUTH-123'].sessions[0];
    expect(session.sessionId).toBe('sess-abc');
    expect(session.durationMs).toBe(3600000);
  });

  it('throws invalid-summary on empty summary', async () => {
    const err = await runSessionNote('AUTH-123', '   ', {}, repoDir).catch((e) => e);
    expect(err).toBeInstanceOf(CyaError);
    expect((err as CyaError).code).toBe('invalid-summary');
  });

  it('throws summary-too-long on summary over 2000 chars', async () => {
    const long = 'a'.repeat(2001);
    const err = await runSessionNote('AUTH-123', long, {}, repoDir).catch((e) => e);
    expect(err).toBeInstanceOf(CyaError);
    expect((err as CyaError).code).toBe('summary-too-long');
  });

  it('throws unknown-ticket when ticket not tracked', async () => {
    const err = await runSessionNote('UNKNOWN-99', 'Some work.', {}, repoDir).catch((e) => e);
    expect(err).toBeInstanceOf(CyaError);
    expect((err as CyaError).code).toBe('unknown-ticket');
  });

  it('trims whitespace from summary', async () => {
    await runSessionNote('AUTH-123', '  trimmed note  ', {}, repoDir);
    const events = readEvents(repoDir);
    const ev = events.find((e) => e.type === 'session_summary');
    expect(ev.payload.summary).toBe('trimmed note');
  });
});
