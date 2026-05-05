import { describe, it, expect, beforeAll, beforeEach, afterAll, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { runTrack } from '../src/commands/track.js';
import { runNote } from '../src/commands/note.js';
import { runDone } from '../src/commands/done.js';
import { runUnblock } from '../src/commands/unblock.js';
import { runReview } from '../src/commands/review.js';
import { CyaError } from '../src/errors.js';
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

function captureConsole(): { lines: string[]; restore: () => void } {
  const lines: string[] = [];
  const spy = vi.spyOn(console, 'log').mockImplementation((msg: string) => {
    lines.push(...String(msg).split('\n'));
  });
  return { lines, restore: () => spy.mockRestore() };
}

const TODAY = new Date().toISOString().slice(0, 10);
const SINCE = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

async function setup(): Promise<{ repoDir: string; sprintDir: string }> {
  return makeTestRepo();
}

// ── empty range ────────────────────────────────────────────────────────────────

describe('runReview — no activity', () => {
  let repoDir: string;

  beforeEach(async () => ({ repoDir } = await setup()));
  afterEach(() => cleanup(repoDir));

  it('prints no-activity message when no events in range', async () => {
    await runTrack('AUTH-123', 'Fix session expiry', repoDir);
    const cap = captureConsole();
    await runReview({ since: '2000-01-01', until: '2000-01-02' }, repoDir);
    cap.restore();
    expect(cap.lines.join('\n')).toContain('No activity found');
  });
});

// ── completed tickets ──────────────────────────────────────────────────────────

describe('runReview — completed tickets', () => {
  let repoDir: string;
  let sprintDir: string;

  beforeEach(async () => {
    ({ repoDir, sprintDir } = await setup());
    await runTrack('AUTH-123', 'Fix session expiry', repoDir);
    await runDone('AUTH-123', { note: 'Merged' }, repoDir);
  });
  afterEach(() => cleanup(repoDir));

  it('shows completed ticket in Completed section', async () => {
    const cap = captureConsole();
    await runReview({ since: SINCE, until: TODAY }, repoDir);
    cap.restore();
    const out = cap.lines.join('\n');
    expect(out).toContain('## Completed');
    expect(out).toContain('AUTH-123');
  });

  it('completed ticket not in In Progress', async () => {
    const cap = captureConsole();
    await runReview({ since: SINCE, until: TODAY }, repoDir);
    cap.restore();
    const out = cap.lines.join('\n');
    const completedIdx = out.indexOf('## Completed');
    const inProgressIdx = out.indexOf('## In Progress');
    const inProgressSection = out.slice(inProgressIdx, out.indexOf('##', inProgressIdx + 1));
    expect(inProgressSection).not.toContain('AUTH-123');
    expect(completedIdx).toBeLessThan(inProgressIdx);
  });

  it('saves review file to .sprint/ with Mon_DD_YY slug', async () => {
    const cap = captureConsole();
    await runReview({ since: SINCE, until: TODAY }, repoDir);
    cap.restore();
    const files = cap.lines.find((l) => l.startsWith('Saved to'));
    expect(files).toBeDefined();
    expect(files).toMatch(/review-[A-Z][a-z]{2}_\d{2}_\d{2}-to-[A-Z][a-z]{2}_\d{2}_\d{2}\.md/);
  });
});

// ── in-progress tickets ────────────────────────────────────────────────────────

describe('runReview — in-progress tickets', () => {
  let repoDir: string;

  beforeEach(async () => {
    ({ repoDir } = await setup());
    await runTrack('AUTH-123', 'Fix session expiry', repoDir);
  });
  afterEach(() => cleanup(repoDir));

  it('shows in-progress ticket in In Progress section', async () => {
    const cap = captureConsole();
    await runReview({ since: SINCE, until: TODAY }, repoDir);
    cap.restore();
    const out = cap.lines.join('\n');
    expect(out).toContain('## In Progress');
    expect(out).toContain('AUTH-123');
  });
});

// ── decisions ─────────────────────────────────────────────────────────────────

describe('runReview — decisions', () => {
  let repoDir: string;

  beforeEach(async () => {
    ({ repoDir } = await setup());
    await runTrack('AUTH-123', 'Fix session expiry', repoDir);
    await runNote('AUTH-123', 'Chose Redis over in-memory', 'decision', repoDir);
  });
  afterEach(() => cleanup(repoDir));

  it('shows decision note in Key Decisions section', async () => {
    const cap = captureConsole();
    await runReview({ since: SINCE, until: TODAY }, repoDir);
    cap.restore();
    const out = cap.lines.join('\n');
    expect(out).toContain('## Key Decisions');
    expect(out).toContain('Chose Redis over in-memory');
  });
});

// ── blockers ──────────────────────────────────────────────────────────────────

describe('runReview — blockers', () => {
  let repoDir: string;

  beforeEach(async () => {
    ({ repoDir } = await setup());
    await runTrack('AUTH-123', 'Fix session expiry', repoDir);
    await runNote('AUTH-123', 'Waiting for staging credentials', 'blocker', repoDir);
  });
  afterEach(() => cleanup(repoDir));

  it('shows blocker in Blockers section', async () => {
    const cap = captureConsole();
    await runReview({ since: SINCE, until: TODAY }, repoDir);
    cap.restore();
    const out = cap.lines.join('\n');
    expect(out).toContain('## Blockers');
    expect(out).toContain('Waiting for staging credentials');
  });

  it('resolved blocker shows ✓ resolved', async () => {
    await runUnblock('AUTH-123', { note: 'Got creds' }, repoDir);
    const cap = captureConsole();
    await runReview({ since: SINCE, until: TODAY }, repoDir);
    cap.restore();
    expect(cap.lines.join('\n')).toContain('resolved');
  });

  it('ongoing blocker shows ⚠ ongoing', async () => {
    const cap = captureConsole();
    await runReview({ since: SINCE, until: TODAY }, repoDir);
    cap.restore();
    expect(cap.lines.join('\n')).toContain('ongoing');
  });
});

// ── activity counts ────────────────────────────────────────────────────────────

describe('runReview — activity section', () => {
  let repoDir: string;

  beforeEach(async () => {
    ({ repoDir } = await setup());
    await runTrack('AUTH-123', 'Fix session expiry', repoDir);
  });
  afterEach(() => cleanup(repoDir));

  it('shows activity section with ticket count', async () => {
    const cap = captureConsole();
    await runReview({ since: SINCE, until: TODAY }, repoDir);
    cap.restore();
    const out = cap.lines.join('\n');
    expect(out).toContain('## Activity');
    expect(out).toContain('ticket');
  });
});

// ── date range validation ──────────────────────────────────────────────────────

describe('runReview — date validation', () => {
  let repoDir: string;

  beforeEach(async () => ({ repoDir } = await setup()));
  afterEach(() => cleanup(repoDir));

  it('throws invalid-date for bad --since', async () => {
    const err = await runReview({ since: 'not-a-date', until: TODAY }, repoDir).catch((e) => e);
    expect(err).toBeInstanceOf(CyaError);
    expect((err as CyaError).code).toBe('invalid-date');
  });

  it('throws invalid-date for bad --until', async () => {
    const err = await runReview({ since: SINCE, until: 'not-a-date' }, repoDir).catch((e) => e);
    expect(err).toBeInstanceOf(CyaError);
    expect((err as CyaError).code).toBe('invalid-date');
  });

  it('throws invalid-range when since > until', async () => {
    const err = await runReview({ since: TODAY, until: SINCE }, repoDir).catch((e) => e);
    expect(err).toBeInstanceOf(CyaError);
    expect((err as CyaError).code).toBe('invalid-range');
  });

  it('default range (no options) runs without error', async () => {
    await runTrack('AUTH-123', 'Fix session expiry', repoDir);
    await expect(runReview({}, repoDir)).resolves.not.toThrow();
  });
});

// ── error handling ─────────────────────────────────────────────────────────────

describe('runReview — errors', () => {
  it('throws not-initialized when .sprint missing', async () => {
    const bare = makeTempGitRepo();
    try {
      const err = await runReview({}, bare).catch((e) => e);
      expect(err).toBeInstanceOf(CyaError);
      expect((err as CyaError).code).toBe('not-initialized');
    } finally {
      cleanup(bare);
    }
  });

  it('throws not-a-git-repo outside git repo', async () => {
    const notRepo = mkdtempSync(join(tmpdir(), 'cya-review-norep-'));
    try {
      const err = await runReview({}, notRepo).catch((e) => e);
      expect(err).toBeInstanceOf(CyaError);
      expect((err as CyaError).code).toBe('not-a-git-repo');
    } finally {
      cleanup(notRepo);
    }
  });
});
