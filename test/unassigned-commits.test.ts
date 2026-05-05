import { describe, it, expect, beforeAll, beforeEach, afterAll, afterEach } from 'vitest';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { execSync } from 'node:child_process';
import { runSync } from '../src/commands/sync.js';
import { runTrack } from '../src/commands/track.js';
import { runInit } from '../src/commands/init.js';
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

describe('unassigned commits', () => {
  let repoDir: string;
  let sprintDir: string;

  beforeEach(async () => {
    repoDir = makeTempGitRepo();
    makeCommit(repoDir, 'initial commit');
    await runInit({}, repoDir);
    sprintDir = resolveTestSprintDir(repoDir);
  });

  afterEach(() => cleanup(repoDir));

  it('sync with no tracked branch puts commit into unassignedCommits', async () => {
    makeCommit(repoDir, 'orphan work');
    await runSync(repoDir);
    const state = readState(sprintDir);
    expect(state.unassignedCommits.length).toBeGreaterThan(0);
  });

  it('later track does not auto-claim historical unassigned commits', async () => {
    makeCommit(repoDir, 'orphan work');
    await runSync(repoDir);
    // Now track on the same branch
    await runTrack('AUTH-1', 'some work', repoDir);
    const state = readState(sprintDir);
    // unassigned commits are still unassigned — assignment is explicit
    expect(state.unassignedCommits.length).toBeGreaterThan(0);
    expect(state.tickets['AUTH-1'].commits).toHaveLength(0);
  });

  it('SPRINT.md shows Unassigned Commits section when populated', async () => {
    makeCommit(repoDir, 'orphan work');
    await runSync(repoDir);
    const md = readFileSync(join(sprintDir, 'SPRINT.md'), 'utf8');
    expect(md).toContain('## Unassigned Commits');
    expect(md).toContain('orphan work');
  });

  it('SPRINT.md shows _none_ in Unassigned Commits when empty', async () => {
    await runTrack('AUTH-1', 'tracked work', repoDir);
    makeCommit(repoDir, 'tracked commit');
    await runSync(repoDir);
    const state = readState(sprintDir);
    expect(state.unassignedCommits).toHaveLength(0);
    const md = readFileSync(join(sprintDir, 'SPRINT.md'), 'utf8');
    expect(md).toContain('## Unassigned Commits');
    expect(md).toContain('_none_');
  });

  it('sync is idempotent for unassigned commits', async () => {
    makeCommit(repoDir, 'orphan work');
    await runSync(repoDir);
    await runSync(repoDir);
    const state = readState(sprintDir);
    const uniq = new Set(state.unassignedCommits.map((c) => c.sha));
    expect(state.unassignedCommits.length).toBe(uniq.size);
  });
});
