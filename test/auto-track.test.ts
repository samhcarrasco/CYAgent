import { describe, it, expect, beforeAll, beforeEach, afterAll, afterEach } from 'vitest';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { execSync } from 'node:child_process';
import { runInit } from '../src/commands/init.js';
import { runTrack } from '../src/commands/track.js';
import { runSync } from '../src/commands/sync.js';
import { runDone } from '../src/commands/done.js';
import {
  runHookPostCheckout,
  runHookReferenceTransaction,
} from '../src/commands/hook.js';
import { readEvents } from '../src/events.js';
import {
  branchCreationMarkersFromReferenceTransaction,
  branchDeletionsFromReferenceTransaction,
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

  it('derives branch-name ticket IDs and human titles without Jira IDs', () => {
    expect(deriveAutoTrackTicket('feature/session-expiry', initialState())).toEqual({
      ticket: 'feature/session-expiry',
      title: 'session expiry',
    });
  });

  it('skips Jira tickets that already exist on another branch', () => {
    const state = initialState();
    state.tickets['AUTH-123'] = ticket('AUTH-123', 'other-branch');
    expect(deriveAutoTrackTicket('AUTH-123-session-expiry', state)).toBeUndefined();
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

  it('auto-tracks branches without a Jira-style ticket ID using the branch name', async () => {
    checkout(repoDir, '-b feature/session-expiry');
    await runHookReferenceTransaction(
      'committed',
      'pid-1',
      `${ZERO_SHA} ${baseSha} refs/heads/feature/session-expiry\n`,
      repoDir,
    );
    await runHookPostCheckout(baseSha, baseSha, '1', 'pid-1', repoDir, { quiet: true });

    let state = readState(sprintDir);
    expect(state.tickets['feature/session-expiry']).toMatchObject({
      title: 'session expiry',
      branch: 'feature/session-expiry',
      baselineSha: baseSha,
    });
    expect(existsSync(join(sprintDir, 'tickets', 'feature%2Fsession-expiry.md'))).toBe(true);

    makeCommit(repoDir, 'branch-name ticket work');
    await runSync(repoDir, { quiet: true });

    state = readState(sprintDir);
    expect(state.tickets['feature/session-expiry'].commits.map((c) => c.message)).toEqual([
      'branch-name ticket work',
    ]);
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

describe('branch deletion parser', () => {
  it('returns branch name for committed local branch deletion', () => {
    const branches = branchDeletionsFromReferenceTransaction(
      'committed',
      `${'a'.repeat(40)} ${ZERO_SHA} refs/heads/AUTH-123-session-expiry\n`,
    );
    expect(branches).toEqual(['AUTH-123-session-expiry']);
  });

  it('returns branch name for Git for Windows zero-old deletion records', () => {
    const branches = branchDeletionsFromReferenceTransaction(
      'committed',
      `${ZERO_SHA} ${ZERO_SHA} refs/heads/AUTH-123-session-expiry\n`,
    );
    expect(branches).toEqual(['AUTH-123-session-expiry']);
  });

  it('returns nothing for non-committed state', () => {
    expect(
      branchDeletionsFromReferenceTransaction(
        'prepared',
        `${'a'.repeat(40)} ${ZERO_SHA} refs/heads/AUTH-123-session-expiry\n`,
      ),
    ).toHaveLength(0);
  });

  it('returns nothing for a branch creation (oldSha is zero)', () => {
    expect(
      branchDeletionsFromReferenceTransaction(
        'committed',
        `${ZERO_SHA} ${'a'.repeat(40)} refs/heads/AUTH-123-session-expiry\n`,
      ),
    ).toHaveLength(0);
  });

  it('returns nothing for a branch update (both SHAs nonzero)', () => {
    expect(
      branchDeletionsFromReferenceTransaction(
        'committed',
        `${'b'.repeat(40)} ${'a'.repeat(40)} refs/heads/AUTH-123-session-expiry\n`,
      ),
    ).toHaveLength(0);
  });

  it('returns nothing for tag refs', () => {
    expect(
      branchDeletionsFromReferenceTransaction(
        'committed',
        `${'a'.repeat(40)} ${ZERO_SHA} refs/tags/v1.0.0\n`,
      ),
    ).toHaveLength(0);
  });

  it('returns nothing for remote refs', () => {
    expect(
      branchDeletionsFromReferenceTransaction(
        'committed',
        `${'a'.repeat(40)} ${ZERO_SHA} refs/remotes/origin/AUTH-123-session-expiry\n`,
      ),
    ).toHaveLength(0);
  });

  it('returns nothing for malformed lines', () => {
    expect(
      branchDeletionsFromReferenceTransaction('committed', 'not-a-valid-line\n'),
    ).toHaveLength(0);
  });
});

describe('hook-driven branch deletion auto-close', () => {
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

  it('marks matching open ticket done when its branch is deleted', async () => {
    checkout(repoDir, '-b AUTH-123-session-expiry');
    await runTrack('AUTH-123', 'session expiry', repoDir, { quiet: true });

    await runHookReferenceTransaction(
      'committed',
      'pid-del',
      `${'a'.repeat(40)} ${ZERO_SHA} refs/heads/AUTH-123-session-expiry\n`,
      repoDir,
    );

    const state = readState(sprintDir);
    expect(state.tickets['AUTH-123']!.status).toBe('done');

    const ctx = state.tickets['AUTH-123']!.notes.context;
    expect(ctx.some((n) => n.text.includes('AUTH-123-session-expiry') && n.text.includes('deleted'))).toBe(true);

    const events = await readEvents(sprintDir);
    const last = events.at(-1)!;
    expect(last.type).toBe('ticket_done');
    expect(last.source).toBe('git-hook');
  });

  it('appends no ticket_done event when deleted branch is not tracked', async () => {
    const eventsBefore = await readEvents(sprintDir);

    await runHookReferenceTransaction(
      'committed',
      'pid-del',
      `${'a'.repeat(40)} ${ZERO_SHA} refs/heads/untracked-branch\n`,
      repoDir,
    );

    const eventsAfter = await readEvents(sprintDir);
    expect(eventsAfter.filter((e) => e.type === 'ticket_done')).toHaveLength(0);
    expect(eventsAfter).toHaveLength(eventsBefore.length);
  });

  it('appends no duplicate ticket_done when ticket is already done', async () => {
    checkout(repoDir, '-b AUTH-123-session-expiry');
    await runTrack('AUTH-123', 'session expiry', repoDir, { quiet: true });
    await runDone('AUTH-123', { quiet: true }, repoDir);

    const eventsBefore = await readEvents(sprintDir);
    const doneCountBefore = eventsBefore.filter((e) => e.type === 'ticket_done').length;

    await runHookReferenceTransaction(
      'committed',
      'pid-del',
      `${'a'.repeat(40)} ${ZERO_SHA} refs/heads/AUTH-123-session-expiry\n`,
      repoDir,
    );

    const eventsAfter = await readEvents(sprintDir);
    const doneCountAfter = eventsAfter.filter((e) => e.type === 'ticket_done').length;
    expect(doneCountAfter).toBe(doneCountBefore);
  });
});
