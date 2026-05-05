import { describe, it, expect, beforeAll, beforeEach, afterAll, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { runTrack } from '../src/commands/track.js';
import { runNote } from '../src/commands/note.js';
import { runUnblock } from '../src/commands/unblock.js';
import { CyaError } from '../src/errors.js';
import { StateSchema } from '../src/state.js';
import { SprintEventSchema } from '../src/events.js';
import {
  setupTestAppData,
  makeTestRepo,
  makeTempGitRepo,
  makeTempDir,
  cleanup,
  resolveTestSprintDir,
} from './helpers.js';
import { runInit } from '../src/commands/init.js';

let teardown: () => void;
beforeAll(() => {
  ({ teardown } = setupTestAppData());
});
afterAll(() => teardown());

function readState(sprintDir: string) {
  return StateSchema.parse(JSON.parse(readFileSync(join(sprintDir, 'state.json'), 'utf8')));
}

function readRawEvents(sprintDir: string): unknown[] {
  return readFileSync(join(sprintDir, 'events.jsonl'), 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((l) => JSON.parse(l));
}

async function setupBlocked(): Promise<{ repoDir: string; sprintDir: string }> {
  const { repoDir, sprintDir } = await makeTestRepo();
  await runTrack('AUTH-123', 'Fix session expiry', repoDir);
  await runNote('AUTH-123', 'Waiting for staging credentials', 'blocker', repoDir);
  return { repoDir, sprintDir };
}

// ── event appended ─────────────────────────────────────────────────────────────

describe('runUnblock — event', () => {
  let repoDir: string;
  let sprintDir: string;

  beforeEach(async () => ({ repoDir, sprintDir } = await setupBlocked()));
  afterEach(() => cleanup(repoDir));

  it('appends ticket_unblocked event', async () => {
    await runUnblock('AUTH-123', {}, repoDir);
    const events = readRawEvents(sprintDir);
    expect(events.at(-1)).toMatchObject({ type: 'ticket_unblocked', ticket: 'AUTH-123' });
  });

  it('ticket_unblocked passes SprintEventSchema', async () => {
    await runUnblock('AUTH-123', {}, repoDir);
    const events = readRawEvents(sprintDir);
    expect(() => SprintEventSchema.parse(events.at(-1))).not.toThrow();
  });

  it('stores optional note in context notes', async () => {
    await runUnblock('AUTH-123', { note: 'Credentials received' }, repoDir);
    const state = readState(sprintDir);
    const ctx = state.tickets['AUTH-123']!.notes.context;
    expect(ctx.some((n) => n.text === 'Credentials received')).toBe(true);
  });
});

// ── state changes ──────────────────────────────────────────────────────────────

describe('runUnblock — state', () => {
  let repoDir: string;
  let sprintDir: string;

  beforeEach(async () => ({ repoDir, sprintDir } = await setupBlocked()));
  afterEach(() => cleanup(repoDir));

  it('changes status blocked → in_progress', async () => {
    await runUnblock('AUTH-123', {}, repoDir);
    const state = readState(sprintDir);
    expect(state.tickets['AUTH-123']!.status).toBe('in_progress');
  });

  it('ticket moves to In Progress in SPRINT.md', async () => {
    await runUnblock('AUTH-123', {}, repoDir);
    const md = readFileSync(join(sprintDir, 'SPRINT.md'), 'utf8');
    const inProgressSection = md.split('## In Progress')[1]?.split('##')[0] ?? '';
    expect(inProgressSection).toContain('AUTH-123');
  });

  it('ticket removed from Blockers in SPRINT.md', async () => {
    await runUnblock('AUTH-123', {}, repoDir);
    const md = readFileSync(join(sprintDir, 'SPRINT.md'), 'utf8');
    const blockersSection = md.split('## Blockers')[1]?.split('##')[0] ?? '';
    expect(blockersSection).not.toContain('AUTH-123');
  });

  it('historical blocker notes remain in ticket state', async () => {
    await runUnblock('AUTH-123', {}, repoDir);
    const state = readState(sprintDir);
    expect(state.tickets['AUTH-123']!.notes.blocker).toHaveLength(1);
    expect(state.tickets['AUTH-123']!.notes.blocker[0]!.text).toBe('Waiting for staging credentials');
  });

  it('historical blocker notes remain in ticket markdown', async () => {
    await runUnblock('AUTH-123', {}, repoDir);
    const md = readFileSync(join(sprintDir, 'tickets', 'AUTH-123.md'), 'utf8');
    expect(md).toContain('Waiting for staging credentials');
  });
});

// ── no-op on non-blocked ──────────────────────────────────────────────────────

describe('runUnblock — non-blocked ticket', () => {
  let repoDir: string;
  let sprintDir: string;

  beforeEach(async () => {
    ({ repoDir, sprintDir } = await makeTestRepo());
    await runTrack('AUTH-123', 'Fix session expiry', repoDir);
  });
  afterEach(() => cleanup(repoDir));

  it('no-op when ticket already in_progress (no new event)', async () => {
    const eventsBefore = readRawEvents(sprintDir).length;
    await runUnblock('AUTH-123', {}, repoDir);
    const eventsAfter = readRawEvents(sprintDir).length;
    expect(eventsAfter).toBe(eventsBefore);
  });

  it('status stays in_progress after no-op unblock', async () => {
    await runUnblock('AUTH-123', {}, repoDir);
    const state = readState(sprintDir);
    expect(state.tickets['AUTH-123']!.status).toBe('in_progress');
  });
});

// ── error handling ─────────────────────────────────────────────────────────────

describe('runUnblock — errors', () => {
  let repoDir: string;

  beforeEach(async () => ({ repoDir } = await setupBlocked()));
  afterEach(() => cleanup(repoDir));

  it('throws unknown-ticket for untracked ticket', async () => {
    const err = await runUnblock('UNKNOWN-99', {}, repoDir).catch((e) => e);
    expect(err).toBeInstanceOf(CyaError);
    expect((err as CyaError).code).toBe('unknown-ticket');
  });

  it('throws not-initialized when .sprint missing', async () => {
    const bare = makeTempGitRepo();
    try {
      const err = await runUnblock('AUTH-123', {}, bare).catch((e) => e);
      expect(err).toBeInstanceOf(CyaError);
      expect((err as CyaError).code).toBe('not-initialized');
    } finally {
      cleanup(bare);
    }
  });

  it('throws not-a-git-repo outside git repo', async () => {
    const notRepo = makeTempDir();
    try {
      const err = await runUnblock('AUTH-123', {}, notRepo).catch((e) => e);
      expect(err).toBeInstanceOf(CyaError);
      expect((err as CyaError).code).toBe('not-a-git-repo');
    } finally {
      cleanup(notRepo);
    }
  });
});
