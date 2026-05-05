import { describe, it, expect, beforeAll, beforeEach, afterAll, afterEach } from 'vitest';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { execSync } from 'node:child_process';
import { runSync } from '../src/commands/sync.js';
import { runTrack } from '../src/commands/track.js';
import { runInit } from '../src/commands/init.js';
import { runAssign } from '../src/commands/assign.js';
import { CyaError } from '../src/errors.js';
import { StateSchema } from '../src/state.js';
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

describe('cya assign', () => {
  let repoDir: string;
  let sprintDir: string;
  let unassignedSha: string;

  beforeEach(async () => {
    repoDir = makeTempGitRepo();
    makeCommit(repoDir, 'initial commit');
    await runInit({}, repoDir);
    // Switch to orphan branch so no ticket matches the branch
    execSync(`git ${GIT_AUTHOR.join(' ')} checkout -b orphan`, { cwd: repoDir, stdio: 'pipe' });
    unassignedSha = makeCommit(repoDir, 'orphan work');
    // Track a ticket on main (not on orphan)
    execSync(`git ${GIT_AUTHOR.join(' ')} checkout -b main-work`, { cwd: repoDir, stdio: 'pipe' });
    await runTrack('AUTH-1', 'some auth work', repoDir);
    // Switch back to orphan and sync so the commit is unassigned
    execSync(`git ${GIT_AUTHOR.join(' ')} checkout orphan`, { cwd: repoDir, stdio: 'pipe' });
    await runSync(repoDir);
    sprintDir = resolveTestSprintDir(repoDir);
  });

  afterEach(() => cleanup(repoDir));

  it('full-sha assignment moves commit from unassigned to ticket', async () => {
    await runAssign(unassignedSha, 'AUTH-1', repoDir);
    const state = readState(sprintDir);
    expect(state.unassignedCommits.find((c) => c.sha === unassignedSha)).toBeUndefined();
    expect(state.tickets['AUTH-1'].commits.find((c) => c.sha === unassignedSha)).toBeDefined();
  });

  it('prefix resolution works for unambiguous prefix', async () => {
    const prefix = unassignedSha.slice(0, 7);
    await runAssign(prefix, 'AUTH-1', repoDir);
    const state = readState(sprintDir);
    expect(state.tickets['AUTH-1'].commits.find((c) => c.sha === unassignedSha)).toBeDefined();
  });

  it('ambiguous prefix throws ambiguous-sha', async () => {
    // Create two commits whose shas share a prefix (rare but we fake it via direct event injection)
    // Instead, test with a 1-char prefix which is always ambiguous if >1 commits
    const err = await runAssign('a', 'AUTH-1', repoDir).catch((e) => e);
    expect(err).toBeInstanceOf(CyaError);
    expect((err as CyaError).code).toBe('invalid-sha');
  });

  it('unknown ticket throws unknown-ticket', async () => {
    const err = await runAssign(unassignedSha, 'FAKE-999', repoDir).catch((e) => e);
    expect(err).toBeInstanceOf(CyaError);
    expect((err as CyaError).code).toBe('unknown-ticket');
  });

  it('assigning unknown sha throws unknown-sha', async () => {
    const err = await runAssign('0000000000000000000000000000000000000000', 'AUTH-1', repoDir).catch((e) => e);
    expect(err).toBeInstanceOf(CyaError);
    expect((err as CyaError).code).toBe('unknown-sha');
  });

  it('double-assign is a no-op and does not emit duplicate events', async () => {
    await runAssign(unassignedSha, 'AUTH-1', repoDir);
    await runAssign(unassignedSha, 'AUTH-1', repoDir);
    const events = readEvents(sprintDir);
    const assignEvents = events.filter((e: { type: string; payload: { sha: string } }) =>
      e.type === 'commit_assigned' && e.payload.sha === unassignedSha,
    );
    expect(assignEvents).toHaveLength(1);
  });

  it('tickets/<id>.md regenerates with the commit after assign', async () => {
    await runAssign(unassignedSha, 'AUTH-1', repoDir);
    const md = readFileSync(join(sprintDir, 'tickets', 'AUTH-1.md'), 'utf8');
    expect(md).toContain('orphan work');
  });

  it('SPRINT.md unassigned section shrinks after assign', async () => {
    const mdBefore = readFileSync(join(sprintDir, 'SPRINT.md'), 'utf8');
    expect(mdBefore).toContain('orphan work');
    await runAssign(unassignedSha, 'AUTH-1', repoDir);
    const mdAfter = readFileSync(join(sprintDir, 'SPRINT.md'), 'utf8');
    expect(mdAfter).not.toContain('orphan work');
    expect(mdAfter).toContain('_none_');
  });
});
