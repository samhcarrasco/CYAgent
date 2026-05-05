import { describe, it, expect, beforeAll, beforeEach, afterAll, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { runRecordCommand } from '../src/commands/record-command.js';
import { runTrack } from '../src/commands/track.js';
import { CyaError } from '../src/errors.js';
import { StateSchema } from '../src/state.js';
import { SprintEventSchema } from '../src/events.js';
import {
  setupTestAppData,
  makeTestRepo,
  makeTempGitRepo,
  makeTempDir,
  cleanup,
} from './helpers.js';

// ── Helpers ───────────────────────────────────────────────────────────────────

let teardown: () => void;
beforeAll(() => {
  ({ teardown } = setupTestAppData());
});
afterAll(() => teardown());

async function initAndTrack(): Promise<{ repoDir: string; sprintDir: string }> {
  const { repoDir, sprintDir } = await makeTestRepo();
  await runTrack('AUTH-123', 'Fix session expiry', repoDir);
  return { repoDir, sprintDir };
}

function readState(sprintDir: string) {
  return StateSchema.parse(JSON.parse(readFileSync(join(sprintDir, 'state.json'), 'utf8')));
}

function readEvents(sprintDir: string) {
  return readFileSync(join(sprintDir, 'events.jsonl'), 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((l) => JSON.parse(l));
}

// ── event appended ────────────────────────────────────────────────────────────

describe('runRecordCommand — event', () => {
  let repoDir: string;
  let sprintDir: string;

  beforeEach(async () => {
    ({ repoDir, sprintDir } = await initAndTrack());
  });

  afterEach(() => cleanup(repoDir));

  it('appends a command_recorded event to events.jsonl', async () => {
    await runRecordCommand('pnpm test auth', 'passed', 'AUTH-123', undefined, repoDir);
    const events = readEvents(sprintDir);
    expect(events.length).toBe(2);
    expect(events[1].type).toBe('command_recorded');
  });

  it('command_recorded event passes schema validation', async () => {
    await runRecordCommand('pnpm test auth', 'passed', 'AUTH-123', undefined, repoDir);
    const events = readEvents(sprintDir);
    expect(() => SprintEventSchema.parse(events[1])).not.toThrow();
  });

  it('command_recorded event has correct ticket, command, and status', async () => {
    await runRecordCommand('pnpm test auth', 'passed', 'AUTH-123', undefined, repoDir);
    const events = readEvents(sprintDir);
    const ev = events[1];
    expect(ev.ticket).toBe('AUTH-123');
    expect(ev.payload.command).toBe('pnpm test auth');
    expect(ev.payload.status).toBe('passed');
  });
});

// ── state ─────────────────────────────────────────────────────────────────────

describe('runRecordCommand — state', () => {
  let repoDir: string;
  let sprintDir: string;

  beforeEach(async () => {
    ({ repoDir, sprintDir } = await initAndTrack());
  });

  afterEach(() => cleanup(repoDir));

  it('passed command appears in evidence with correct fields', async () => {
    await runRecordCommand('pnpm test auth', 'passed', 'AUTH-123', undefined, repoDir);
    const state = readState(sprintDir);
    expect(state.tickets['AUTH-123'].evidence).toHaveLength(1);
    expect(state.tickets['AUTH-123'].evidence[0].command).toBe('pnpm test auth');
    expect(state.tickets['AUTH-123'].evidence[0].status).toBe('passed');
  });

  it('failed command appears in evidence', async () => {
    await runRecordCommand('pnpm build', 'failed', 'AUTH-123', undefined, repoDir);
    const state = readState(sprintDir);
    expect(state.tickets['AUTH-123'].evidence[0].status).toBe('failed');
  });

  it('failed command does not mark ticket blocked', async () => {
    await runRecordCommand('pnpm test auth', 'failed', 'AUTH-123', undefined, repoDir);
    const state = readState(sprintDir);
    expect(state.tickets['AUTH-123'].status).toBe('in_progress');
  });

  it('multiple commands all appear in evidence', async () => {
    await runRecordCommand('pnpm test auth', 'passed', 'AUTH-123', undefined, repoDir);
    await runRecordCommand('pnpm build', 'failed', 'AUTH-123', undefined, repoDir);
    const state = readState(sprintDir);
    expect(state.tickets['AUTH-123'].evidence).toHaveLength(2);
  });

  it('exitCode stored when provided', async () => {
    await runRecordCommand('pnpm test auth', 'failed', 'AUTH-123', 1, repoDir);
    const state = readState(sprintDir);
    expect(state.tickets['AUTH-123'].evidence[0].exitCode).toBe(1);
  });
});

// ── markdown output ───────────────────────────────────────────────────────────

describe('runRecordCommand — markdown output', () => {
  let repoDir: string;
  let sprintDir: string;

  beforeEach(async () => {
    ({ repoDir, sprintDir } = await initAndTrack());
  });

  afterEach(() => cleanup(repoDir));

  it('command appears in ticket markdown with Evidence section', async () => {
    await runRecordCommand('pnpm test auth', 'passed', 'AUTH-123', undefined, repoDir);
    const content = readFileSync(join(sprintDir, 'tickets', 'AUTH-123.md'), 'utf8');
    expect(content).toContain('## Evidence');
    expect(content).toContain('pnpm test auth');
  });

  it('command appears in SPRINT.md evidence section', async () => {
    await runRecordCommand('pnpm test auth', 'passed', 'AUTH-123', undefined, repoDir);
    const content = readFileSync(join(sprintDir, 'SPRINT.md'), 'utf8');
    expect(content).toContain('## Evidence');
    expect(content).toContain('pnpm test auth');
  });

  it('passed command shows check icon in ticket markdown', async () => {
    await runRecordCommand('pnpm test auth', 'passed', 'AUTH-123', undefined, repoDir);
    const content = readFileSync(join(sprintDir, 'tickets', 'AUTH-123.md'), 'utf8');
    expect(content).toContain('✓');
  });

  it('failed command shows cross icon in ticket markdown', async () => {
    await runRecordCommand('pnpm build', 'failed', 'AUTH-123', undefined, repoDir);
    const content = readFileSync(join(sprintDir, 'tickets', 'AUTH-123.md'), 'utf8');
    expect(content).toContain('✗');
  });
});

// ── error handling ────────────────────────────────────────────────────────────

describe('runRecordCommand — error handling', () => {
  let repoDir: string;

  beforeEach(async () => {
    ({ repoDir } = await initAndTrack());
  });

  afterEach(() => cleanup(repoDir));

  it('throws unknown-ticket for a ticket that has not been tracked', async () => {
    const err = await runRecordCommand('pnpm test', 'passed', 'UNKNOWN-99', undefined, repoDir).catch((e) => e);
    expect(err).toBeInstanceOf(CyaError);
    expect((err as CyaError).code).toBe('unknown-ticket');
  });

  it('throws invalid-status for an unrecognized status', async () => {
    const err = await runRecordCommand('pnpm test', 'skipped', 'AUTH-123', undefined, repoDir).catch((e) => e);
    expect(err).toBeInstanceOf(CyaError);
    expect((err as CyaError).code).toBe('invalid-status');
  });

  it('throws invalid-status when --status is missing', async () => {
    const err = await runRecordCommand('pnpm test', undefined, 'AUTH-123', undefined, repoDir).catch((e) => e);
    expect(err).toBeInstanceOf(CyaError);
    expect((err as CyaError).code).toBe('invalid-status');
  });

  it('throws invalid-command for empty command text', async () => {
    const err = await runRecordCommand('', 'passed', 'AUTH-123', undefined, repoDir).catch((e) => e);
    expect(err).toBeInstanceOf(CyaError);
    expect((err as CyaError).code).toBe('invalid-command');
  });

  it('throws invalid-command for whitespace-only command', async () => {
    const err = await runRecordCommand('   ', 'passed', 'AUTH-123', undefined, repoDir).catch((e) => e);
    expect(err).toBeInstanceOf(CyaError);
    expect((err as CyaError).code).toBe('invalid-command');
  });

  it('throws not-initialized when .sprint is missing', async () => {
    const bareRepo = makeTempGitRepo();
    try {
      const err = await runRecordCommand('pnpm test', 'passed', 'AUTH-123', undefined, bareRepo).catch((e) => e);
      expect(err).toBeInstanceOf(CyaError);
      expect((err as CyaError).code).toBe('not-initialized');
    } finally {
      cleanup(bareRepo);
    }
  });

  it('throws not-a-git-repo when not in a git repository', async () => {
    const notARepo = makeTempDir();
    try {
      const err = await runRecordCommand('pnpm test', 'passed', 'AUTH-123', undefined, notARepo).catch((e) => e);
      expect(err).toBeInstanceOf(CyaError);
      expect((err as CyaError).code).toBe('not-a-git-repo');
    } finally {
      cleanup(notARepo);
    }
  });
});

// ── CLI stubs ─────────────────────────────────────────────────────────────────

describe('CLI stubs', () => {
  it('review, standup, record-command are real commands (not stubs)', () => {
    const src = readFileSync(
      new URL('../src/cli.ts', import.meta.url).pathname.replace(/^\/([A-Z]:)/, '$1'),
      'utf8',
    );
    const notYetMatch = src.match(/const notYet\s*=\s*\[([^\]]*)\]/);
    const notYet = notYetMatch?.[1] ?? '';
    expect(notYet).not.toContain("'review'");
    expect(notYet).not.toContain("'standup'");
    expect(notYet).not.toContain("'record-command'");
  });
});
