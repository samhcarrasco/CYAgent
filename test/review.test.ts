import { describe, it, expect, beforeAll, beforeEach, afterAll, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { runTrack } from '../src/commands/track.js';
import { runNote } from '../src/commands/note.js';
import { runDone } from '../src/commands/done.js';
import { runUnblock } from '../src/commands/unblock.js';
import { runReview } from '../src/commands/review.js';
import { appendEvent, createEvent } from '../src/events.js';
import { readConfig, writeConfig } from '../src/config.js';
import { CyaError } from '../src/errors.js';
import {
  setupTestAppData,
  makeTestRepo,
  makeTempGitRepo,
  cleanup,
  resolveTestSprintDir,
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

// ── commit messages ────────────────────────────────────────────────────────────

describe('runReview — commit messages', () => {
  let repoDir: string;
  let sprintDir: string;

  beforeEach(async () => {
    ({ repoDir, sprintDir } = await setup());
    await runTrack('AUTH-123', 'Fix session expiry', repoDir);
  });
  afterEach(() => cleanup(repoDir));

  it('shows commit message under the ticket when a commit is recorded', async () => {
    await appendEvent(
      sprintDir,
      createEvent({
        type: 'commit_observed',
        repoPath: repoDir,
        branch: 'main',
        source: 'user',
        ticket: 'AUTH-123',
        payload: {
          sha: 'abc1234def5678901234abc1234def567890',
          shortSha: 'abc1234',
          message: 'Fix token refresh logic',
          committedAt: new Date().toISOString(),
          branch: 'main',
        },
      }),
    );
    const cap = captureConsole();
    await runReview({ since: SINCE, until: TODAY, noAi: true }, repoDir);
    cap.restore();
    const out = cap.lines.join('\n');
    expect(out).toContain('abc1234');
    expect(out).toContain('Fix token refresh logic');
  });

  it('caps commit list at 5 and shows omitted count', async () => {
    // Record 7 commits for the ticket
    for (let i = 1; i <= 7; i++) {
      await appendEvent(
        sprintDir,
        createEvent({
          type: 'commit_observed',
          repoPath: repoDir,
          branch: 'main',
          source: 'user',
          ticket: 'AUTH-123',
          payload: {
            sha: `${'a'.repeat(36)}${String(i).padStart(4, '0')}`,
            shortSha: `aaa000${i}`,
            message: `Commit number ${i}`,
            committedAt: new Date().toISOString(),
            branch: 'main',
          },
        }),
      );
    }
    const cap = captureConsole();
    await runReview({ since: SINCE, until: TODAY, noAi: true }, repoDir);
    cap.restore();
    const out = cap.lines.join('\n');
    // "2 more commits" or similar
    expect(out).toMatch(/\d+ more commit/);
  });

  it('--no-ai still renders commit messages', async () => {
    await appendEvent(
      sprintDir,
      createEvent({
        type: 'commit_observed',
        repoPath: repoDir,
        branch: 'main',
        source: 'user',
        ticket: 'AUTH-123',
        payload: {
          sha: 'bbb1234def5678901234bbb1234def567890',
          shortSha: 'bbb1234',
          message: 'Refactor session store',
          committedAt: new Date().toISOString(),
          branch: 'main',
        },
      }),
    );
    const cap = captureConsole();
    await runReview({ since: SINCE, until: TODAY, noAi: true }, repoDir);
    cap.restore();
    const out = cap.lines.join('\n');
    expect(out).toContain('bbb1234');
    expect(out).toContain('Refactor session store');
  });
});

// ── diff evidence ──────────────────────────────────────────────────────────────

describe('runReview — diff evidence', () => {
  let repoDir: string;
  let sprintDir: string;

  beforeEach(async () => {
    ({ repoDir, sprintDir } = await setup());
    await runTrack('TEST-1', 'Test ticket', repoDir);
  });
  afterEach(() => cleanup(repoDir));

  it('no Implementation Evidence section when allowDiffSummarization is false', async () => {
    await appendEvent(
      sprintDir,
      createEvent({
        type: 'commit_observed',
        repoPath: repoDir,
        branch: 'main',
        source: 'user',
        ticket: 'TEST-1',
        payload: {
          sha: 'ccc1234def5678901234ccc1234def567890',
          shortSha: 'ccc1234',
          message: 'Add feature',
          committedAt: new Date().toISOString(),
          branch: 'main',
        },
      }),
    );
    const cap = captureConsole();
    await runReview({ since: SINCE, until: TODAY, noAi: true }, repoDir);
    cap.restore();
    expect(cap.lines.join('\n')).not.toContain('## Implementation Evidence');
  });

  it('shows Implementation Evidence section when allowDiffSummarization is true and commits exist', async () => {
    // Create a real git commit so git evidence can be collected
    writeFileSync(join(repoDir, 'index.ts'), 'export const x = 1;\n');
    execSync('git add index.ts', { cwd: repoDir, stdio: 'pipe' });
    execSync(
      'git -c user.email=test@test.com -c user.name=Test commit -m "Add index.ts"',
      { cwd: repoDir, stdio: 'pipe' },
    );
    const sha = execSync('git rev-parse HEAD', { cwd: repoDir, encoding: 'utf8' }).trim();

    await appendEvent(
      sprintDir,
      createEvent({
        type: 'commit_observed',
        repoPath: repoDir,
        branch: 'main',
        source: 'user',
        ticket: 'TEST-1',
        payload: {
          sha,
          shortSha: sha.slice(0, 7),
          message: 'Add index.ts',
          committedAt: new Date().toISOString(),
          branch: 'main',
        },
      }),
    );

    // Enable diff summarization
    const cfg = readConfig(sprintDir);
    await writeConfig(sprintDir, {
      ...cfg,
      privacy: { ...cfg.privacy, allowDiffSummarization: true },
    });

    const cap = captureConsole();
    await runReview({ since: SINCE, until: TODAY, noAi: true }, repoDir);
    cap.restore();
    expect(cap.lines.join('\n')).toContain('## Implementation Evidence');
  });
});
