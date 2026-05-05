import { describe, it, expect, beforeAll, beforeEach, afterAll, afterEach } from 'vitest';
import { mkdtempSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { runTrack } from '../src/commands/track.js';
import { runNote } from '../src/commands/note.js';
import { runDone } from '../src/commands/done.js';
import { CyaError } from '../src/errors.js';
import { StateSchema } from '../src/state.js';
import { SprintEventSchema } from '../src/events.js';
import {
  setupTestAppData,
  makeTestRepo,
  makeTempGitRepo,
  cleanup,
} from './helpers.js';

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

async function setup(): Promise<{ repoDir: string; sprintDir: string }> {
  const { repoDir, sprintDir } = await makeTestRepo();
  await runTrack('AUTH-123', 'Fix session expiry', repoDir);
  return { repoDir, sprintDir };
}

// ── event appended ─────────────────────────────────────────────────────────────

describe('runDone — event', () => {
  let repoDir: string;
  let sprintDir: string;

  beforeEach(async () => ({ repoDir, sprintDir } = await setup()));
  afterEach(() => cleanup(repoDir));

  it('appends ticket_done event', async () => {
    await runDone('AUTH-123', {}, repoDir);
    const events = readRawEvents(sprintDir);
    expect(events.at(-1)).toMatchObject({ type: 'ticket_done', ticket: 'AUTH-123' });
  });

  it('ticket_done passes SprintEventSchema', async () => {
    await runDone('AUTH-123', {}, repoDir);
    const events = readRawEvents(sprintDir);
    expect(() => SprintEventSchema.parse(events.at(-1))).not.toThrow();
  });

  it('stores optional note in context notes', async () => {
    await runDone('AUTH-123', { note: 'Merged and verified' }, repoDir);
    const state = readState(sprintDir);
    const ctx = state.tickets['AUTH-123']!.notes.context;
    expect(ctx.some((n) => n.text === 'Merged and verified')).toBe(true);
  });

  it('no note added when note omitted', async () => {
    await runDone('AUTH-123', {}, repoDir);
    const state = readState(sprintDir);
    expect(state.tickets['AUTH-123']!.notes.context).toHaveLength(0);
  });
});

// ── state changes ──────────────────────────────────────────────────────────────

describe('runDone — state', () => {
  let repoDir: string;
  let sprintDir: string;

  beforeEach(async () => ({ repoDir, sprintDir } = await setup()));
  afterEach(() => cleanup(repoDir));

  it('sets ticket status to done', async () => {
    await runDone('AUTH-123', {}, repoDir);
    const state = readState(sprintDir);
    expect(state.tickets['AUTH-123']!.status).toBe('done');
  });

  it('done ticket disappears from In Progress in SPRINT.md', async () => {
    await runDone('AUTH-123', {}, repoDir);
    const md = readFileSync(join(sprintDir, 'SPRINT.md'), 'utf8');
    const inProgressSection = md.split('## In Progress')[1]?.split('##')[0] ?? '';
    expect(inProgressSection).not.toContain('AUTH-123');
  });

  it('done ticket appears in Done section in SPRINT.md', async () => {
    await runDone('AUTH-123', {}, repoDir);
    const md = readFileSync(join(sprintDir, 'SPRINT.md'), 'utf8');
    const doneSection = md.split('## Done')[1]?.split('##')[0] ?? '';
    expect(doneSection).toContain('AUTH-123');
  });

  it('done ticket not in Blockers section', async () => {
    await runNote('AUTH-123', 'Blocked on creds', 'blocker', repoDir);
    await runDone('AUTH-123', {}, repoDir);
    const md = readFileSync(join(sprintDir, 'SPRINT.md'), 'utf8');
    const blockersSection = md.split('## Blockers')[1]?.split('##')[0] ?? '';
    expect(blockersSection).not.toContain('AUTH-123');
  });

  it('ticket markdown shows status done', async () => {
    await runDone('AUTH-123', {}, repoDir);
    const md = readFileSync(join(sprintDir, 'tickets', 'AUTH-123.md'), 'utf8');
    expect(md).toContain('**Status:** done');
  });
});

// ── error handling ─────────────────────────────────────────────────────────────

describe('runDone — errors', () => {
  let repoDir: string;

  beforeEach(async () => ({ repoDir } = await setup()));
  afterEach(() => cleanup(repoDir));

  it('throws unknown-ticket for untracked ticket', async () => {
    const err = await runDone('UNKNOWN-99', {}, repoDir).catch((e) => e);
    expect(err).toBeInstanceOf(CyaError);
    expect((err as CyaError).code).toBe('unknown-ticket');
  });

  it('throws not-initialized when .sprint missing', async () => {
    const bare = makeTempGitRepo();
    try {
      const err = await runDone('AUTH-123', {}, bare).catch((e) => e);
      expect(err).toBeInstanceOf(CyaError);
      expect((err as CyaError).code).toBe('not-initialized');
    } finally {
      cleanup(bare);
    }
  });

  it('throws not-a-git-repo outside git repo', async () => {
    const notRepo = mkdtempSync(join(tmpdir(), 'cya-done-norep-'));
    try {
      const err = await runDone('AUTH-123', {}, notRepo).catch((e) => e);
      expect(err).toBeInstanceOf(CyaError);
      expect((err as CyaError).code).toBe('not-a-git-repo');
    } finally {
      cleanup(notRepo);
    }
  });
});
