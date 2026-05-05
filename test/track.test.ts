import { describe, it, expect, beforeAll, beforeEach, afterAll, afterEach } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { execSync } from 'node:child_process';
import { runTrack } from '../src/commands/track.js';
import { runInit } from '../src/commands/init.js';
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

// ── Helpers ───────────────────────────────────────────────────────────────────

let teardown: () => void;
beforeAll(() => {
  ({ teardown } = setupTestAppData());
});
afterAll(() => teardown());

async function initRepo(): Promise<{ repoDir: string; sprintDir: string }> {
  return makeTestRepo();
}

// ── event creation ────────────────────────────────────────────────────────────

describe('runTrack — event creation', () => {
  let repoDir: string;
  let sprintDir: string;

  beforeEach(async () => {
    ({ repoDir, sprintDir } = await initRepo());
  });

  afterEach(() => cleanup(repoDir));

  it('appends a track_started event to events.jsonl', async () => {
    await runTrack('AUTH-123', 'Fix session expiry', repoDir);

    const lines = readFileSync(join(sprintDir, 'events.jsonl'), 'utf8')
      .split('\n')
      .filter(Boolean);
    expect(lines.length).toBe(1);
    expect(JSON.parse(lines[0]).type).toBe('track_started');
  });

  it('event contains correct ticket, title, and source', async () => {
    await runTrack('AUTH-123', 'Fix session expiry', repoDir);

    const raw = JSON.parse(
      readFileSync(join(sprintDir, 'events.jsonl'), 'utf8').trim(),
    );
    expect(raw.ticket).toBe('AUTH-123');
    expect(raw.payload.title).toBe('Fix session expiry');
    expect(raw.source).toBe('user');
  });

  it('event passes schema validation', async () => {
    await runTrack('AUTH-123', 'Fix session expiry', repoDir);

    const raw = JSON.parse(
      readFileSync(join(sprintDir, 'events.jsonl'), 'utf8').trim(),
    );
    expect(() => SprintEventSchema.parse(raw)).not.toThrow();
  });

  it('event has non-empty id and valid ISO timestamp', async () => {
    await runTrack('AUTH-123', 'Fix session expiry', repoDir);

    const raw = JSON.parse(
      readFileSync(join(sprintDir, 'events.jsonl'), 'utf8').trim(),
    );
    expect(raw.id.length).toBeGreaterThan(0);
    expect(new Date(raw.timestamp).toISOString()).toBe(raw.timestamp);
  });

  it('tracking a second distinct ticket appends a second event', async () => {
    await runTrack('AUTH-123', 'Fix session expiry', repoDir);
    await runTrack('INFRA-7', 'Upgrade Node', repoDir);

    const lines = readFileSync(join(sprintDir, 'events.jsonl'), 'utf8')
      .split('\n')
      .filter(Boolean);
    expect(lines.length).toBe(2);
  });
});

// ── state update ──────────────────────────────────────────────────────────────

describe('runTrack — state update', () => {
  let repoDir: string;
  let sprintDir: string;

  beforeEach(async () => {
    ({ repoDir, sprintDir } = await initRepo());
  });

  afterEach(() => cleanup(repoDir));

  it('writes state.json with ticket as in_progress', async () => {
    await runTrack('AUTH-123', 'Fix session expiry', repoDir);

    const state = StateSchema.parse(
      JSON.parse(readFileSync(join(sprintDir, 'state.json'), 'utf8')),
    );
    expect(state.tickets['AUTH-123']?.status).toBe('in_progress');
  });

  it('ticket state has correct id and title', async () => {
    await runTrack('AUTH-123', 'Fix session expiry', repoDir);

    const state = StateSchema.parse(
      JSON.parse(readFileSync(join(sprintDir, 'state.json'), 'utf8')),
    );
    expect(state.tickets['AUTH-123'].id).toBe('AUTH-123');
    expect(state.tickets['AUTH-123'].title).toBe('Fix session expiry');
  });

  it('ticket notes start empty across all kinds', async () => {
    await runTrack('AUTH-123', 'Fix session expiry', repoDir);

    const state = StateSchema.parse(
      JSON.parse(readFileSync(join(sprintDir, 'state.json'), 'utf8')),
    );
    const { notes } = state.tickets['AUTH-123'];
    for (const kind of [
      'blocker',
      'followup',
      'decision',
      'discovery',
      'risk',
      'context',
    ] as const) {
      expect(notes[kind]).toEqual([]);
    }
  });

  it('ticket commits start empty', async () => {
    await runTrack('AUTH-123', 'Fix session expiry', repoDir);

    const state = StateSchema.parse(
      JSON.parse(readFileSync(join(sprintDir, 'state.json'), 'utf8')),
    );
    expect(state.tickets['AUTH-123'].commits).toEqual([]);
  });

  it('records the current HEAD as a baseline when commits already exist', async () => {
    const repoDir = makeTempGitRepo();
    execSync('git -c user.email=t@t.t -c user.name=T commit --allow-empty -m init', {
      cwd: repoDir,
      stdio: 'pipe',
    });
    const baselineSha = execSync('git rev-parse HEAD', { cwd: repoDir, stdio: 'pipe' })
      .toString()
      .trim();
    await runInit({}, repoDir);
    await runTrack('AUTH-123', 'Fix session expiry', repoDir);

    const raw = JSON.parse(
      readFileSync(join(resolveTestSprintDir(repoDir), 'events.jsonl'), 'utf8').trim(),
    );
    cleanup(repoDir);
    expect(raw.payload.baselineSha).toBe(baselineSha);
  });
});

// ── markdown output ───────────────────────────────────────────────────────────

describe('runTrack — markdown output', () => {
  let repoDir: string;
  let sprintDir: string;

  beforeEach(async () => {
    ({ repoDir, sprintDir } = await initRepo());
  });

  afterEach(() => cleanup(repoDir));

  it('creates tickets/AUTH-123.md', async () => {
    await runTrack('AUTH-123', 'Fix session expiry', repoDir);

    expect(existsSync(join(sprintDir, 'tickets', 'AUTH-123.md'))).toBe(true);
  });

  it('ticket markdown contains id and title', async () => {
    await runTrack('AUTH-123', 'Fix session expiry', repoDir);

    const content = readFileSync(join(sprintDir, 'tickets', 'AUTH-123.md'), 'utf8');
    expect(content).toContain('AUTH-123');
    expect(content).toContain('Fix session expiry');
  });

  it('SPRINT.md lists ticket under In Progress', async () => {
    await runTrack('AUTH-123', 'Fix session expiry', repoDir);

    const content = readFileSync(join(sprintDir, 'SPRINT.md'), 'utf8');
    expect(content).toContain('## In Progress');
    expect(content).toContain('AUTH-123');
    expect(content).toContain('Fix session expiry');
  });

  it('two tracked tickets both appear in SPRINT.md', async () => {
    await runTrack('AUTH-123', 'Fix session expiry', repoDir);
    await runTrack('INFRA-7', 'Upgrade Node', repoDir);

    const content = readFileSync(join(sprintDir, 'SPRINT.md'), 'utf8');
    expect(content).toContain('AUTH-123');
    expect(content).toContain('INFRA-7');
  });
});

// ── idempotency ───────────────────────────────────────────────────────────────

describe('runTrack — idempotency', () => {
  let repoDir: string;
  let sprintDir: string;

  beforeEach(async () => {
    ({ repoDir, sprintDir } = await initRepo());
  });

  afterEach(() => cleanup(repoDir));

  it('tracking same ticket twice does not error', async () => {
    await expect(runTrack('AUTH-123', 'Fix session expiry', repoDir)).resolves.not.toThrow();
    await expect(runTrack('AUTH-123', 'Updated title', repoDir)).resolves.not.toThrow();
  });

  it('re-tracking updates title to the latest value', async () => {
    await runTrack('AUTH-123', 'Original title', repoDir);
    await runTrack('AUTH-123', 'Updated title', repoDir);

    const state = StateSchema.parse(
      JSON.parse(readFileSync(join(sprintDir, 'state.json'), 'utf8')),
    );
    expect(state.tickets['AUTH-123'].title).toBe('Updated title');
  });

  it('re-tracking appends a second event rather than overwriting', async () => {
    await runTrack('AUTH-123', 'Original title', repoDir);
    await runTrack('AUTH-123', 'Updated title', repoDir);

    const lines = readFileSync(join(sprintDir, 'events.jsonl'), 'utf8')
      .split('\n')
      .filter(Boolean);
    expect(lines.length).toBe(2);
  });
});

// ── error handling ────────────────────────────────────────────────────────────

describe('runTrack — error handling', () => {
  let repoDir: string;

  beforeEach(async () => {
    ({ repoDir } = await initRepo());
  });

  afterEach(() => cleanup(repoDir));

  it('throws not-initialized when .sprint is missing', async () => {
    const bareRepo = makeTempGitRepo();
    try {
      const err = await runTrack('AUTH-123', 'Title', bareRepo).catch((e) => e);
      expect(err).toBeInstanceOf(CyaError);
      expect((err as CyaError).code).toBe('not-initialized');
    } finally {
      cleanup(bareRepo);
    }
  });

  it('throws not-a-git-repo when not in a git repository', async () => {
    const notARepo = makeTempDir();
    try {
      const err = await runTrack('AUTH-123', 'Title', notARepo).catch((e) => e);
      expect(err).toBeInstanceOf(CyaError);
      expect((err as CyaError).code).toBe('not-a-git-repo');
    } finally {
      cleanup(notARepo);
    }
  });

  it('throws invalid-ticket for an empty ticket id', async () => {
    const err = await runTrack('', 'Title', repoDir).catch((e) => e);
    expect(err).toBeInstanceOf(CyaError);
    expect((err as CyaError).code).toBe('invalid-ticket');
  });

  it('throws invalid-ticket for a ticket id containing whitespace', async () => {
    const err = await runTrack('AUTH 123', 'Title', repoDir).catch((e) => e);
    expect(err).toBeInstanceOf(CyaError);
    expect((err as CyaError).code).toBe('invalid-ticket');
  });

  it('throws invalid-title for an empty title', async () => {
    const err = await runTrack('AUTH-123', '', repoDir).catch((e) => e);
    expect(err).toBeInstanceOf(CyaError);
    expect((err as CyaError).code).toBe('invalid-title');
  });

  it('throws invalid-title for a whitespace-only title', async () => {
    const err = await runTrack('AUTH-123', '   ', repoDir).catch((e) => e);
    expect(err).toBeInstanceOf(CyaError);
    expect((err as CyaError).code).toBe('invalid-title');
  });
});
