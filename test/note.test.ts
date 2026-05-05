import { describe, it, expect, beforeAll, beforeEach, afterAll, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { runNote } from '../src/commands/note.js';
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

describe('runNote — event', () => {
  let repoDir: string;
  let sprintDir: string;

  beforeEach(async () => {
    ({ repoDir, sprintDir } = await initAndTrack());
  });

  afterEach(() => cleanup(repoDir));

  it('appends a note_added event to events.jsonl', async () => {
    await runNote('AUTH-123', 'Root cause found', 'discovery', repoDir);

    const events = readEvents(sprintDir);
    expect(events.length).toBe(2);
    expect(events[1].type).toBe('note_added');
  });

  it('note_added event passes schema validation', async () => {
    await runNote('AUTH-123', 'Root cause found', 'discovery', repoDir);

    const events = readEvents(sprintDir);
    expect(() => SprintEventSchema.parse(events[1])).not.toThrow();
  });

  it('note_added event has correct ticket, kind, and text', async () => {
    await runNote('AUTH-123', 'Root cause found', 'discovery', repoDir);

    const events = readEvents(sprintDir);
    const ev = events[1];
    expect(ev.ticket).toBe('AUTH-123');
    expect(ev.payload.kind).toBe('discovery');
    expect(ev.payload.text).toBe('Root cause found');
  });
});

// ── notes grouped by type ─────────────────────────────────────────────────────

describe('runNote — notes grouped by type', () => {
  let repoDir: string;
  let sprintDir: string;

  beforeEach(async () => {
    ({ repoDir, sprintDir } = await initAndTrack());
  });

  afterEach(() => cleanup(repoDir));

  it('discovery note appears in notes.discovery', async () => {
    await runNote('AUTH-123', 'Stale cache', 'discovery', repoDir);
    const state = readState(sprintDir);
    expect(state.tickets['AUTH-123'].notes.discovery).toHaveLength(1);
    expect(state.tickets['AUTH-123'].notes.discovery[0].text).toBe('Stale cache');
  });

  it('decision note appears in notes.decision', async () => {
    await runNote('AUTH-123', 'Use Redis', 'decision', repoDir);
    const state = readState(sprintDir);
    expect(state.tickets['AUTH-123'].notes.decision).toHaveLength(1);
  });

  it('risk note appears in notes.risk', async () => {
    await runNote('AUTH-123', 'May affect prod', 'risk', repoDir);
    const state = readState(sprintDir);
    expect(state.tickets['AUTH-123'].notes.risk).toHaveLength(1);
  });

  it('context note appears in notes.context', async () => {
    await runNote('AUTH-123', 'Legacy system', 'context', repoDir);
    const state = readState(sprintDir);
    expect(state.tickets['AUTH-123'].notes.context).toHaveLength(1);
  });

  it('followup note appears in notes.followup', async () => {
    await runNote('AUTH-123', 'Check staging', 'followup', repoDir);
    const state = readState(sprintDir);
    expect(state.tickets['AUTH-123'].notes.followup).toHaveLength(1);
  });

  it('blocker note appears in notes.blocker', async () => {
    await runNote('AUTH-123', 'Need credentials', 'blocker', repoDir);
    const state = readState(sprintDir);
    expect(state.tickets['AUTH-123'].notes.blocker).toHaveLength(1);
  });

  it('notes of other kinds stay empty when only one kind added', async () => {
    await runNote('AUTH-123', 'Stale cache', 'discovery', repoDir);
    const state = readState(sprintDir);
    const { notes } = state.tickets['AUTH-123'];
    expect(notes.blocker).toHaveLength(0);
    expect(notes.followup).toHaveLength(0);
    expect(notes.decision).toHaveLength(0);
    expect(notes.risk).toHaveLength(0);
    expect(notes.context).toHaveLength(0);
  });

  it('multiple notes of same kind all appear', async () => {
    await runNote('AUTH-123', 'First discovery', 'discovery', repoDir);
    await runNote('AUTH-123', 'Second discovery', 'discovery', repoDir);
    const state = readState(sprintDir);
    expect(state.tickets['AUTH-123'].notes.discovery).toHaveLength(2);
  });
});

// ── blocker behavior ──────────────────────────────────────────────────────────

describe('runNote — blocker status', () => {
  let repoDir: string;
  let sprintDir: string;

  beforeEach(async () => {
    ({ repoDir, sprintDir } = await initAndTrack());
  });

  afterEach(() => cleanup(repoDir));

  it('blocker note changes ticket status to blocked', async () => {
    await runNote('AUTH-123', 'Need credentials', 'blocker', repoDir);
    const state = readState(sprintDir);
    expect(state.tickets['AUTH-123'].status).toBe('blocked');
  });

  it('non-blocker note does not change status from in_progress', async () => {
    await runNote('AUTH-123', 'Stale cache', 'discovery', repoDir);
    const state = readState(sprintDir);
    expect(state.tickets['AUTH-123'].status).toBe('in_progress');
  });

  it('blocked ticket appears in SPRINT.md Blockers section', async () => {
    await runNote('AUTH-123', 'Need credentials', 'blocker', repoDir);
    const content = readFileSync(join(sprintDir, 'SPRINT.md'), 'utf8');
    expect(content).toContain('## Blockers');
    expect(content).toContain('AUTH-123');
  });

  it('blocked ticket is removed from In Progress section in SPRINT.md', async () => {
    await runNote('AUTH-123', 'Need credentials', 'blocker', repoDir);
    const content = readFileSync(join(sprintDir, 'SPRINT.md'), 'utf8');
    const inProgressSection = content.split('## In Progress')[1]?.split('##')[0] ?? '';
    expect(inProgressSection).not.toContain('AUTH-123');
  });
});

// ── markdown output ───────────────────────────────────────────────────────────

describe('runNote — markdown output', () => {
  let repoDir: string;
  let sprintDir: string;

  beforeEach(async () => {
    ({ repoDir, sprintDir } = await initAndTrack());
  });

  afterEach(() => cleanup(repoDir));

  it('followup note appears in ticket markdown', async () => {
    await runNote('AUTH-123', 'Check staging Redis', 'followup', repoDir);
    const content = readFileSync(join(sprintDir, 'tickets', 'AUTH-123.md'), 'utf8');
    expect(content).toContain('Check staging Redis');
    expect(content).toContain('### Followup');
  });

  it('discovery note appears in ticket markdown', async () => {
    await runNote('AUTH-123', 'Root cause found', 'discovery', repoDir);
    const content = readFileSync(join(sprintDir, 'tickets', 'AUTH-123.md'), 'utf8');
    expect(content).toContain('Root cause found');
  });
});

// ── error handling ────────────────────────────────────────────────────────────

describe('runNote — error handling', () => {
  let repoDir: string;

  beforeEach(async () => {
    ({ repoDir } = await initAndTrack());
  });

  afterEach(() => cleanup(repoDir));

  it('throws unknown-ticket for a ticket that has not been tracked', async () => {
    const err = await runNote('UNKNOWN-99', 'some note', 'discovery', repoDir).catch((e) => e);
    expect(err).toBeInstanceOf(CyaError);
    expect((err as CyaError).code).toBe('unknown-ticket');
  });

  it('throws invalid-note-type for an unrecognized type', async () => {
    const err = await runNote('AUTH-123', 'some note', 'invalid-type', repoDir).catch((e) => e);
    expect(err).toBeInstanceOf(CyaError);
    expect((err as CyaError).code).toBe('invalid-note-type');
  });

  it('throws invalid-note-type when --type is missing', async () => {
    const err = await runNote('AUTH-123', 'some note', undefined, repoDir).catch((e) => e);
    expect(err).toBeInstanceOf(CyaError);
    expect((err as CyaError).code).toBe('invalid-note-type');
  });

  it('throws invalid-note for empty note text', async () => {
    const err = await runNote('AUTH-123', '', 'discovery', repoDir).catch((e) => e);
    expect(err).toBeInstanceOf(CyaError);
    expect((err as CyaError).code).toBe('invalid-note');
  });

  it('throws invalid-note for whitespace-only note text', async () => {
    const err = await runNote('AUTH-123', '   ', 'discovery', repoDir).catch((e) => e);
    expect(err).toBeInstanceOf(CyaError);
    expect((err as CyaError).code).toBe('invalid-note');
  });

  it('throws not-initialized when .sprint is missing', async () => {
    const bareRepo = makeTempGitRepo();
    try {
      const err = await runNote('AUTH-123', 'some note', 'discovery', bareRepo).catch((e) => e);
      expect(err).toBeInstanceOf(CyaError);
      expect((err as CyaError).code).toBe('not-initialized');
    } finally {
      cleanup(bareRepo);
    }
  });

  it('throws not-a-git-repo when not in a git repository', async () => {
    const notARepo = makeTempDir();
    try {
      const err = await runNote('AUTH-123', 'some note', 'discovery', notARepo).catch((e) => e);
      expect(err).toBeInstanceOf(CyaError);
      expect((err as CyaError).code).toBe('not-a-git-repo');
    } finally {
      cleanup(notARepo);
    }
  });
});

// ── stubs remain ─────────────────────────────────────────────────────────────

describe('CLI stubs', () => {
  it('review, sync, standup, note are real commands (not stubs)', () => {
    const src = readFileSync(
      new URL('../src/cli.ts', import.meta.url).pathname.replace(/^\/([A-Z]:)/, '$1'),
      'utf8',
    );
    const notYetMatch = src.match(/const notYet\s*=\s*\[([^\]]*)\]/);
    const notYet = notYetMatch?.[1] ?? '';
    expect(notYet).not.toContain("'review'");
    expect(notYet).not.toContain("'standup'");
    expect(notYet).not.toContain("'note'");
  });
});
