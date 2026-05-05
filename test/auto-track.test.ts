import { describe, it, expect, beforeAll, beforeEach, afterAll, afterEach } from 'vitest';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { execSync } from 'node:child_process';
import { runInit } from '../src/commands/init.js';
import { runTrack } from '../src/commands/track.js';
import { runSync } from '../src/commands/sync.js';
import {
  runHookPostCheckout,
  runHookReferenceTransaction,
} from '../src/commands/hook.js';
import {
  branchCreationMarkersFromReferenceTransaction,
  deriveAutoTrackTicket,
} from '../src/auto-track.js';
import { type State, StateSchema, initialState, type TicketState } from '../src/state.js';
import {
  setupTestAppData,
  makeTempGitRepo,
  cleanup,
  resolveTestSprintDir,
} from './helpers.js';

let teardown: () => void;
beforeAll(() => {
  ({ teardown } = setupTestAppData());
});
afterAll(() => teardown());

const GIT_AUTHOR = ['-c', 'user.email=test@test.com', '-c', 'user.name=Test'];
const ZERO_SHA = '0'.repeat(40);

function makeCommit(dir: string, message: string): string {
  const file = join(dir, `${Date.now()}-${Math.random().toString(36).slice(2)}.txt`);
  writeFileSync(file, message);
  execSync('git add .', { cwd: dir, stdio: 'pipe' });
  execSync(`git ${GIT_AUTHOR.join(' ')} commit -m "${message}"`, { cwd: dir, stdio: 'pipe' });
  return execSync('git rev-parse HEAD', { cwd: dir, stdio: 'pipe' }).toString().trim();
}

function checkout(dir: string, args: string): void {
  execSync(`git checkout ${args}`, { cwd: dir, stdio: 'pipe' });
}

function currentBranch(dir: string): string {
  return execSync('git rev-parse --abbrev-ref HEAD', { cwd: dir, stdio: 'pipe' })
    .toString()
    .trim();
}

function readState(sprintDir: string): State {
  return StateSchema.parse(JSON.parse(readFileSync(join(sprintDir, 'state.json'), 'utf8')));
}

function ticket(id: string, branch: string): TicketState {
  return {
    id,
    title: 'Existing work',
    branch,
    status: 'in_progress',
    commits: [],
    evidence: [],
    sessions: [],
    notes: {
      blocker: [],
      followup: [],
      decision: [],
      discovery: [],
      risk: [],
      context: [],
    },
    lastUpdatedAt: new Date().toISOString(),
  };
}

describe('branch creation markers', () => {
  it('extracts local branch creations from committed reference transactions', () => {
    const markers = branchCreationMarkersFromReferenceTransaction(
      'committed',
      '123',
      `${ZERO_SHA} ${'a'.repeat(40)} refs/heads/AUTH-123-session-expiry\n`,
    );
    expect(markers).toHaveLength(1);
    expect(markers[0]).toMatchObject({
      branch: 'AUTH-123-session-expiry',
      sha: 'a'.repeat(40),
      gitProcessId: '123',
    });
  });

  it('ignores non-committed states and branch updates', () => {
    expect(
      branchCreationMarkersFromReferenceTransaction(
        'prepared',
        '123',
        `${ZERO_SHA} ${'a'.repeat(40)} refs/heads/AUTH-123-session-expiry\n`,
      ),
    ).toHaveLength(0);
    expect(
      branchCreationMarkersFromReferenceTransaction(
        'committed',
        '123',
        `${'b'.repeat(40)} ${'a'.repeat(40)} refs/heads/AUTH-123-session-expiry\n`,
      ),
    ).toHaveLength(0);
  });
});

describe('auto-track derivation', () => {
  it('derives Jira ticket and title from branch names', () => {
    expect(deriveAutoTrackTicket('AUTH-123-session-expiry', initialState())).toEqual({
      ticket: 'AUTH-123',
      title: 'session expiry',
    });
  });

  it('derives deterministic synthetic IDs and human titles without Jira IDs', () => {
    const derived = deriveAutoTrackTicket('feature/session-expiry', initialState());
    expect(derived?.ticket).toMatch(/^BRANCH-[A-F0-9]{8}$/);
    expect(derived?.title).toBe('session expiry');
    expect(deriveAutoTrackTicket('feature/session-expiry', initialState())?.ticket).toBe(
      derived?.ticket,
    );
  });

  it('skips Jira tickets that already exist on another branch', () => {
    const state = initialState();
    state.tickets['AUTH-123'] = ticket('AUTH-123', 'other-branch');
    expect(deriveAutoTrackTicket('AUTH-123-session-expiry', state)).toBeUndefined();
  });

  it('extends synthetic hashes when the short derived ID collides', () => {
    const branch = 'feature/session-expiry';
    const hash = createHash('sha256').update(branch).digest('hex').toUpperCase();
    const state = initialState();
    state.tickets[`BRANCH-${hash.slice(0, 8)}`] = ticket(
      `BRANCH-${hash.slice(0, 8)}`,
      'other-branch',
    );
    const derived = deriveAutoTrackTicket(branch, state);
    expect(derived?.ticket).toBe(`BRANCH-${hash.slice(0, 12)}`);
  });

  it('does not derive tickets for protected branches', () => {
    for (const branch of [
      'main',
      'master',
      'develop',
      'dev',
      'trunk',
      'release/1.0',
      'hotfix/session',
    ]) {
      expect(deriveAutoTrackTicket(branch, initialState())).toBeUndefined();
    }
  });
});

describe('hook-driven auto-tracking', () => {
  let repoDir: string;
  let sprintDir: string;
  let baseSha: string;

  beforeEach(async () => {
    repoDir = makeTempGitRepo();
    baseSha = makeCommit(repoDir, 'initial commit');
    await runInit({}, repoDir);
    sprintDir = resolveTestSprintDir(repoDir);
  });

  afterEach(() => cleanup(repoDir));

  it('auto-tracks a branch created and checked out by the same git process', async () => {
    checkout(repoDir, '-b AUTH-123-session-expiry');
    await runHookReferenceTransaction(
      'committed',
      'pid-1',
      `${ZERO_SHA} ${baseSha} refs/heads/AUTH-123-session-expiry\n`,
      repoDir,
    );
    await runHookPostCheckout(baseSha, baseSha, '1', 'pid-1', repoDir, { quiet: true });

    const state = readState(sprintDir);
    expect(state.tickets['AUTH-123']).toMatchObject({
      title: 'session expiry',
      branch: 'AUTH-123-session-expiry',
      baselineSha: baseSha,
    });
    expect(state.tickets['AUTH-123'].commits).toHaveLength(0);
  });

  it('does not auto-track when the marker process does not match checkout', async () => {
    checkout(repoDir, '-b AUTH-123-session-expiry');
    await runHookReferenceTransaction(
      'committed',
      'pid-1',
      `${ZERO_SHA} ${baseSha} refs/heads/AUTH-123-session-expiry\n`,
      repoDir,
    );
    await runHookPostCheckout(baseSha, baseSha, '1', 'pid-2', repoDir, { quiet: true });

    const state = readState(sprintDir);
    expect(state.tickets['AUTH-123']).toBeUndefined();
  });

  it('does not auto-track without a matching branch creation marker', async () => {
    checkout(repoDir, '-b AUTH-123-session-expiry');
    await runHookPostCheckout(baseSha, baseSha, '1', 'pid-1', repoDir, { quiet: true });

    const state = readState(sprintDir);
    expect(state.tickets['AUTH-123']).toBeUndefined();
  });

  it('does not auto-track when switching to an existing branch', async () => {
    const startingBranch = currentBranch(repoDir);
    checkout(repoDir, '-b AUTH-123-session-expiry');
    checkout(repoDir, startingBranch);
    checkout(repoDir, 'AUTH-123-session-expiry');

    await runHookPostCheckout(baseSha, baseSha, '1', 'pid-1', repoDir, { quiet: true });

    const state = readState(sprintDir);
    expect(state.tickets['AUTH-123']).toBeUndefined();
  });

  it('auto-tracked branch baseline excludes inherited commits but records later work', async () => {
    checkout(repoDir, '-b AUTH-123-session-expiry');
    await runHookReferenceTransaction(
      'committed',
      'pid-1',
      `${ZERO_SHA} ${baseSha} refs/heads/AUTH-123-session-expiry\n`,
      repoDir,
    );
    await runHookPostCheckout(baseSha, baseSha, '1', 'pid-1', repoDir, { quiet: true });

    makeCommit(repoDir, 'post-baseline work');
    await runSync(repoDir, { quiet: true });

    const state = readState(sprintDir);
    expect(state.tickets['AUTH-123'].commits.map((c) => c.message)).toEqual([
      'post-baseline work',
    ]);
  });

  it('manual tracking still works on protected branches', async () => {
    checkout(repoDir, '-b dev');
    await runTrack('DEV-1', 'Protected branch work', repoDir);

    const state = readState(sprintDir);
    expect(state.tickets['DEV-1']).toMatchObject({
      title: 'Protected branch work',
      branch: 'dev',
    });
  });
});
