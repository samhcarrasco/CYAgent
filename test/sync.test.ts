import { describe, it, expect, beforeAll, beforeEach, afterAll, afterEach } from 'vitest';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { execSync } from 'node:child_process';
import { runSync } from '../src/commands/sync.js';
import { runTrack } from '../src/commands/track.js';
import { runInit } from '../src/commands/init.js';
import { CyaError } from '../src/errors.js';
import { StateSchema } from '../src/state.js';
import { appendEvent, createEvent } from '../src/events.js';
import {
  setupTestAppData,
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

const GIT_AUTHOR = ['-c', 'user.email=test@test.com', '-c', 'user.name=Test'];

function makeCommit(dir: string, message: string): string {
  const file = join(dir, `${Date.now()}-${Math.random().toString(36).slice(2)}.txt`);
  writeFileSync(file, message);
  execSync('git add .', { cwd: dir, stdio: 'pipe' });
  execSync(`git ${GIT_AUTHOR.join(' ')} commit -m "${message}"`, { cwd: dir, stdio: 'pipe' });
  return execSync('git rev-parse HEAD', { cwd: dir, stdio: 'pipe' }).toString().trim();
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

// ── sync with no commits ──────────────────────────────────────────────────────

describe('runSync — no commits', () => {
  let repoDir: string;

  afterEach(() => cleanup(repoDir));

  it('returns cleanly when repo has no commits (no branch)', async () => {
    repoDir = makeTempGitRepo();
    await runInit({}, repoDir);
    await expect(runSync(repoDir)).resolves.not.toThrow();
  });

  it('appends no events when repo has no commits', async () => {
    repoDir = makeTempGitRepo();
    await runInit({}, repoDir);
    await runSync(repoDir);
    const events = readEvents(resolveTestSprintDir(repoDir));
    expect(events.filter((e) => e.type === 'commit_observed')).toHaveLength(0);
  });

  it('returns cleanly when all commits already recorded', async () => {
    repoDir = makeTempGitRepo();
    makeCommit(repoDir, 'initial');
    await runInit({}, repoDir);
    await runTrack('AUTH-123', 'Fix session expiry', repoDir);
    await runSync(repoDir); // first sync
    await expect(runSync(repoDir)).resolves.not.toThrow(); // second sync — no new commits
  });
});

// ── sync observes commits ─────────────────────────────────────────────────────

describe('runSync — observes commits', () => {
  let repoDir: string;
  let sprintDir: string;

  beforeEach(async () => {
    repoDir = makeTempGitRepo();
    makeCommit(repoDir, 'initial commit');
    await runInit({}, repoDir);
    await runTrack('AUTH-123', 'Fix session expiry', repoDir);
    sprintDir = resolveTestSprintDir(repoDir);
  });

  afterEach(() => cleanup(repoDir));

  it('sync observes one commit', async () => {
    makeCommit(repoDir, 'add regression test');
    await runSync(repoDir);
    const events = readEvents(sprintDir);
    expect(events.filter((e) => e.type === 'commit_observed')).toHaveLength(1);
  });

  it('sync observes multiple commits', async () => {
    makeCommit(repoDir, 'first change');
    makeCommit(repoDir, 'second change');
    makeCommit(repoDir, 'third change');
    await runSync(repoDir);
    const events = readEvents(sprintDir);
    expect(events.filter((e) => e.type === 'commit_observed')).toHaveLength(3);
  });

  it('commit_observed event has correct sha and message', async () => {
    const sha = makeCommit(repoDir, 'add regression test');
    await runSync(repoDir);
    const events = readEvents(sprintDir);
    const commitEvents = events.filter((e) => e.type === 'commit_observed');
    const latest = commitEvents.find((e) => e.payload.sha === sha);
    expect(latest).toBeDefined();
    expect(latest.payload.message).toBe('add regression test');
  });

  it('commit_observed event has branch field', async () => {
    makeCommit(repoDir, 'some work');
    await runSync(repoDir);
    const events = readEvents(sprintDir);
    const commitEvent = events.find((e) => e.type === 'commit_observed');
    expect(typeof commitEvent.payload.branch).toBe('string');
    expect(commitEvent.payload.branch.length).toBeGreaterThan(0);
  });
});

// ── deduplication ─────────────────────────────────────────────────────────────

describe('runSync — deduplication', () => {
  let repoDir: string;
  let sprintDir: string;

  beforeEach(async () => {
    repoDir = makeTempGitRepo();
    makeCommit(repoDir, 'initial commit');
    await runInit({}, repoDir);
    await runTrack('AUTH-123', 'Fix session expiry', repoDir);
    sprintDir = resolveTestSprintDir(repoDir);
  });

  afterEach(() => cleanup(repoDir));

  it('running sync twice does not duplicate commit events', async () => {
    makeCommit(repoDir, 'add test');
    await runSync(repoDir);
    await runSync(repoDir);
    const events = readEvents(sprintDir);
    const shas = events
      .filter((e) => e.type === 'commit_observed')
      .map((e) => e.payload.sha);
    const unique = new Set(shas);
    expect(shas.length).toBe(unique.size);
  });

  it('second sync with new commits only appends new ones', async () => {
    makeCommit(repoDir, 'first work');
    await runSync(repoDir);
    const countAfterFirst = readEvents(sprintDir).filter(
      (e) => e.type === 'commit_observed',
    ).length;

    makeCommit(repoDir, 'second work');
    await runSync(repoDir);
    const countAfterSecond = readEvents(sprintDir).filter(
      (e) => e.type === 'commit_observed',
    ).length;

    expect(countAfterSecond).toBe(countAfterFirst + 1);
  });
});

// ── ticket attachment ─────────────────────────────────────────────────────────

describe('runSync — ticket attachment', () => {
  let repoDir: string;
  let sprintDir: string;

  beforeEach(async () => {
    repoDir = makeTempGitRepo();
    makeCommit(repoDir, 'initial commit'); // must commit first so branch exists
    await runInit({}, repoDir);
    await runTrack('AUTH-123', 'Fix session expiry', repoDir);
    sprintDir = resolveTestSprintDir(repoDir);
  });

  afterEach(() => cleanup(repoDir));

  it('attaches commit to tracked ticket on matching branch', async () => {
    makeCommit(repoDir, 'add session expiry regression test');
    await runSync(repoDir);
    const state = readState(sprintDir);
    expect(state.tickets['AUTH-123'].commits.length).toBeGreaterThan(0);
  });

  it('commit in state has correct sha and message', async () => {
    const sha = makeCommit(repoDir, 'add session expiry regression test');
    await runSync(repoDir);
    const state = readState(sprintDir);
    const commit = state.tickets['AUTH-123'].commits.find((c) => c.sha === sha);
    expect(commit).toBeDefined();
    expect(commit?.message).toBe('add session expiry regression test');
  });

  it('commit appears in ticket markdown', async () => {
    makeCommit(repoDir, 'add session expiry regression test');
    await runSync(repoDir);
    const md = readFileSync(join(sprintDir, 'tickets', 'AUTH-123.md'), 'utf8');
    expect(md).toContain('## Commits');
    expect(md).toContain('add session expiry regression test');
  });

  it('lastSyncAt is set after sync', async () => {
    makeCommit(repoDir, 'some work');
    await runSync(repoDir);
    const state = readState(sprintDir);
    expect(state.lastSyncAt).not.toBeNull();
  });
});

// ── track before first commit ─────────────────────────────────────────────────

describe('runSync — track before first commit', () => {
  it('associates commits with ticket when tracked before any commits exist', async () => {
    const repoDir = makeTempGitRepo(); // git init, no commits yet
    await runInit({}, repoDir);
    await runTrack('AUTH-123', 'Fix session expiry', repoDir);
    // Now make the first commit — branch exists but didn't when track ran
    makeCommit(repoDir, 'initial work');
    await runSync(repoDir);
    const state = readState(resolveTestSprintDir(repoDir));
    cleanup(repoDir);
    expect(state.tickets['AUTH-123'].commits.length).toBeGreaterThan(0);
  });

  it('ticket markdown contains commit after track-before-first-commit flow', async () => {
    const repoDir = makeTempGitRepo();
    await runInit({}, repoDir);
    await runTrack('AUTH-123', 'Fix session expiry', repoDir);
    makeCommit(repoDir, 'fix: session expiry regression');
    await runSync(repoDir);
    const sd = resolveTestSprintDir(repoDir);
    const md = readFileSync(join(sd, 'tickets', 'AUTH-123.md'), 'utf8');
    cleanup(repoDir);
    expect(md).toContain('fix: session expiry regression');
  });
});

// ── baseline behavior ────────────────────────────────────────────────────────

describe('runSync — baselines', () => {
  it('manual tracking after an initial commit records only later commits', async () => {
    const repoDir = makeTempGitRepo();
    makeCommit(repoDir, 'initial commit');
    await runInit({}, repoDir);
    await runTrack('AUTH-123', 'Fix session expiry', repoDir);

    makeCommit(repoDir, 'post-baseline work');
    await runSync(repoDir);

    const state = readState(resolveTestSprintDir(repoDir));
    cleanup(repoDir);
    expect(state.tickets['AUTH-123'].commits.map((c) => c.message)).toEqual([
      'post-baseline work',
    ]);
  });

  it('legacy track_started events without a baseline keep historical sync behavior', async () => {
    const repoDir = makeTempGitRepo();
    makeCommit(repoDir, 'initial commit');
    await runInit({}, repoDir);
    const sprintDir = resolveTestSprintDir(repoDir);
    const branch = execSync('git rev-parse --abbrev-ref HEAD', {
      cwd: repoDir,
      stdio: 'pipe',
    }).toString().trim();

    await appendEvent(
      sprintDir,
      createEvent({
        type: 'track_started',
        repoPath: repoDir,
        source: 'user',
        ticket: 'LEGACY-1',
        branch,
        payload: { title: 'Legacy work' },
      }),
    );

    makeCommit(repoDir, 'new legacy work');
    await runSync(repoDir);

    const state = readState(sprintDir);
    cleanup(repoDir);
    expect(state.tickets['LEGACY-1'].commits.map((c) => c.message)).toContain(
      'initial commit',
    );
    expect(state.tickets['LEGACY-1'].commits.map((c) => c.message)).toContain(
      'new legacy work',
    );
  });
});

// ── error handling ────────────────────────────────────────────────────────────

describe('runSync — error handling', () => {
  it('throws not-a-git-repo when not in a git repository', async () => {
    const notARepo = makeTempDir();
    try {
      const err = await runSync(notARepo).catch((e) => e);
      expect(err).toBeInstanceOf(CyaError);
      expect((err as CyaError).code).toBe('not-a-git-repo');
    } finally {
      cleanup(notARepo);
    }
  });

  it('throws not-initialized when .sprint is missing', async () => {
    const bareRepo = makeTempGitRepo();
    try {
      const err = await runSync(bareRepo).catch((e) => e);
      expect(err).toBeInstanceOf(CyaError);
      expect((err as CyaError).code).toBe('not-initialized');
    } finally {
      cleanup(bareRepo);
    }
  });
});

// ── sync --source / --quiet ───────────────────────────────────────────────────

describe('runSync — source and quiet flags', () => {
  let repoDir: string;
  let sprintDir: string;

  beforeEach(async () => {
    repoDir = makeTempGitRepo();
    makeCommit(repoDir, 'initial commit');
    await runInit({}, repoDir);
    await runTrack('AUTH-123', 'Fix session expiry', repoDir);
    sprintDir = resolveTestSprintDir(repoDir);
  });

  afterEach(() => cleanup(repoDir));

  it('--source git-hook writes events with source git-hook', async () => {
    makeCommit(repoDir, 'hook-triggered work');
    await runSync(repoDir, { source: 'git-hook' });
    const events = readEvents(sprintDir);
    const hookEvents = events.filter(
      (e) => e.type === 'commit_observed' && e.source === 'git-hook',
    );
    expect(hookEvents.length).toBeGreaterThan(0);
  });

  it('--source watcher writes events with source watcher', async () => {
    makeCommit(repoDir, 'watcher-triggered work');
    await runSync(repoDir, { source: 'watcher' });
    const events = readEvents(sprintDir);
    const watchEvents = events.filter(
      (e) => e.type === 'commit_observed' && e.source === 'watcher',
    );
    expect(watchEvents.length).toBeGreaterThan(0);
  });

  it('--source claude-code writes events with source claude-code', async () => {
    makeCommit(repoDir, 'claude-code-triggered work');
    await runSync(repoDir, { source: 'claude-code' });
    const events = readEvents(sprintDir);
    const claudeEvents = events.filter(
      (e) => e.type === 'commit_observed' && e.source === 'claude-code',
    );
    expect(claudeEvents.length).toBeGreaterThan(0);
  });

  it('--quiet suppresses console output on success', async () => {
    makeCommit(repoDir, 'quiet work');
    const logs: string[] = [];
    const orig = console.log;
    console.log = (...args) => { logs.push(args.join(' ')); };
    try {
      await runSync(repoDir, { quiet: true });
    } finally {
      console.log = orig;
    }
    expect(logs).toHaveLength(0);
  });

  it('default runSync(cwd) still works without options', async () => {
    makeCommit(repoDir, 'default sync');
    await expect(runSync(repoDir)).resolves.not.toThrow();
  });
});

// ── unassigned via sync ───────────────────────────────────────────────────────

describe('runSync — unassigned commits in state', () => {
  it('puts commits on unmatched branch into state.unassignedCommits', async () => {
    const repoDir = makeTempGitRepo();
    makeCommit(repoDir, 'initial');
    await runInit({}, repoDir);
    // No tickets tracked — commits go unassigned
    makeCommit(repoDir, 'orphan commit');
    await runSync(repoDir);
    const state = readState(resolveTestSprintDir(repoDir));
    cleanup(repoDir);
    expect(state.unassignedCommits.length).toBeGreaterThan(0);
  });
});

// ── stubs ─────────────────────────────────────────────────────────────────────

describe('CLI stubs', () => {
  it('review, standup, sync, assign, hooks, agent are all real commands (not stubs)', () => {
    const src = readFileSync(
      new URL('../src/cli.ts', import.meta.url).pathname.replace(/^\/([A-Z]:)/, '$1'),
      'utf8',
    );
    const notYetMatch = src.match(/const notYet\s*=\s*\[([^\]]*)\]/);
    const notYet = notYetMatch?.[1] ?? '';
    expect(notYet).not.toContain("'review'");
    expect(notYet).not.toContain("'standup'");
    expect(notYet).not.toContain("'sync'");
    expect(notYet).not.toContain("'assign'");
    expect(notYet).not.toContain("'hooks'");
    expect(notYet).not.toContain("'agent'");
  });
});
