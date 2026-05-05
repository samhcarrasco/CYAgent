import { describe, it, expect, beforeAll, beforeEach, afterAll, afterEach, vi } from 'vitest';
import { runInit } from '../src/commands/init.js';
import { runTrack } from '../src/commands/track.js';
import { runNote } from '../src/commands/note.js';
import { runDone } from '../src/commands/done.js';
import { runUnblock } from '../src/commands/unblock.js';
import { runStatus } from '../src/commands/status.js';
import { CyaError } from '../src/errors.js';
import { setupTestAppData, makeTempGitRepo, makeTempDir, cleanup } from './helpers.js';

let teardown: () => void;
beforeAll(() => {
  ({ teardown } = setupTestAppData());
});
afterAll(() => teardown());

function captureConsole(): { lines: string[]; restore: () => void } {
  const lines: string[] = [];
  const spy = vi.spyOn(console, 'log').mockImplementation((msg: string) => {
    lines.push(...msg.split('\n'));
  });
  return { lines, restore: () => spy.mockRestore() };
}

// ── empty state ────────────────────────────────────────────────────────────────

describe('runStatus — empty state', () => {
  let repoDir: string;

  beforeEach(async () => {
    repoDir = makeTempGitRepo();
    await runInit({}, repoDir);
  });
  afterEach(() => cleanup(repoDir));

  it('runs without error on empty sprint', async () => {
    await expect(runStatus(repoDir)).resolves.not.toThrow();
  });

  it('output contains section headers', async () => {
    const cap = captureConsole();
    await runStatus(repoDir);
    cap.restore();
    const out = cap.lines.join('\n');
    expect(out).toContain('In progress:');
    expect(out).toContain('Blocked:');
    expect(out).toContain('Done:');
    expect(out).toContain('Unassigned commits:');
  });

  it('shows none for all sections when empty', async () => {
    const cap = captureConsole();
    await runStatus(repoDir);
    cap.restore();
    const out = cap.lines.join('\n');
    expect(out).toContain('none');
  });
});

// ── in-progress tickets ────────────────────────────────────────────────────────

describe('runStatus — in-progress', () => {
  let repoDir: string;

  beforeEach(async () => {
    repoDir = makeTempGitRepo();
    await runInit({}, repoDir);
    await runTrack('AUTH-123', 'Fix session expiry', repoDir);
  });
  afterEach(() => cleanup(repoDir));

  it('shows in-progress ticket', async () => {
    const cap = captureConsole();
    await runStatus(repoDir);
    cap.restore();
    const out = cap.lines.join('\n');
    expect(out).toContain('AUTH-123');
    expect(out).toContain('Fix session expiry');
  });
});

// ── blocked tickets ────────────────────────────────────────────────────────────

describe('runStatus — blocked', () => {
  let repoDir: string;

  beforeEach(async () => {
    repoDir = makeTempGitRepo();
    await runInit({}, repoDir);
    await runTrack('AUTH-123', 'Fix session expiry', repoDir);
    await runNote('AUTH-123', 'Waiting for staging credentials', 'blocker', repoDir);
  });
  afterEach(() => cleanup(repoDir));

  it('shows blocked ticket in Blocked section', async () => {
    const cap = captureConsole();
    await runStatus(repoDir);
    cap.restore();
    const out = cap.lines.join('\n');
    expect(out).toContain('Blocked:');
    expect(out).toContain('AUTH-123');
  });

  it('shows last blocker note', async () => {
    const cap = captureConsole();
    await runStatus(repoDir);
    cap.restore();
    const out = cap.lines.join('\n');
    expect(out).toContain('Waiting for staging credentials');
  });

  it('blocked ticket not in In Progress', async () => {
    const cap = captureConsole();
    await runStatus(repoDir);
    cap.restore();
    const lines = cap.lines.join('\n');
    const inProgressIdx = lines.indexOf('In progress:');
    const blockedIdx = lines.indexOf('Blocked:');
    const inProgressSection = lines.slice(inProgressIdx, blockedIdx);
    expect(inProgressSection).not.toContain('AUTH-123');
  });
});

// ── done tickets ───────────────────────────────────────────────────────────────

describe('runStatus — done', () => {
  let repoDir: string;

  beforeEach(async () => {
    repoDir = makeTempGitRepo();
    await runInit({}, repoDir);
    await runTrack('AUTH-123', 'Fix session expiry', repoDir);
    await runDone('AUTH-123', {}, repoDir);
  });
  afterEach(() => cleanup(repoDir));

  it('shows done ticket in Done section', async () => {
    const cap = captureConsole();
    await runStatus(repoDir);
    cap.restore();
    const out = cap.lines.join('\n');
    expect(out).toContain('Done:');
    expect(out).toContain('AUTH-123');
  });

  it('done ticket not in In Progress', async () => {
    const cap = captureConsole();
    await runStatus(repoDir);
    cap.restore();
    const lines = cap.lines.join('\n');
    const inProgressIdx = lines.indexOf('In progress:');
    const blockedIdx = lines.indexOf('Blocked:');
    const inProgressSection = lines.slice(inProgressIdx, blockedIdx);
    expect(inProgressSection).not.toContain('AUTH-123');
  });
});

// ── unblocked then done workflow ───────────────────────────────────────────────

describe('runStatus — full workflow', () => {
  let repoDir: string;

  beforeEach(async () => {
    repoDir = makeTempGitRepo();
    await runInit({}, repoDir);
    await runTrack('AUTH-123', 'Fix session expiry', repoDir);
    await runNote('AUTH-123', 'Waiting for creds', 'blocker', repoDir);
    await runUnblock('AUTH-123', { note: 'Got creds' }, repoDir);
    await runDone('AUTH-123', { note: 'Merged' }, repoDir);
  });
  afterEach(() => cleanup(repoDir));

  it('shows AUTH-123 in Done after full workflow', async () => {
    const cap = captureConsole();
    await runStatus(repoDir);
    cap.restore();
    const out = cap.lines.join('\n');
    const doneIdx = out.indexOf('Done:');
    const afterDone = out.slice(doneIdx);
    expect(afterDone).toContain('AUTH-123');
  });
});

// ── error handling ─────────────────────────────────────────────────────────────

describe('runStatus — errors', () => {
  it('throws not-initialized when .sprint missing', async () => {
    const bare = makeTempGitRepo();
    try {
      const err = await runStatus(bare).catch((e) => e);
      expect(err).toBeInstanceOf(CyaError);
      expect((err as CyaError).code).toBe('not-initialized');
    } finally {
      cleanup(bare);
    }
  });

  it('throws not-a-git-repo outside git repo', async () => {
    const notRepo = makeTempDir();
    try {
      const err = await runStatus(notRepo).catch((e) => e);
      expect(err).toBeInstanceOf(CyaError);
      expect((err as CyaError).code).toBe('not-a-git-repo');
    } finally {
      cleanup(notRepo);
    }
  });
});
