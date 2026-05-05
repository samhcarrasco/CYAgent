import { describe, it, expect, beforeAll, beforeEach, afterAll, afterEach, vi } from 'vitest';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { execSync } from 'node:child_process';
import { runInit } from '../src/commands/init.js';
import { runTrack } from '../src/commands/track.js';
import { runSync } from '../src/commands/sync.js';
import { runHooksInstall, runHooksUninstall } from '../src/commands/hooks.js';
import { runAgentStatus } from '../src/commands/agent.js';
import { runClaudeInstall, runClaudeUninstall } from '../src/commands/claude.js';
import { runSessionNote } from '../src/commands/session-note.js';
import { setupTestAppData, makeTempGitRepo, cleanup } from './helpers.js';

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

describe('agent status', () => {
  let repoDir: string;
  let output: string;

  beforeEach(async () => {
    repoDir = makeTempGitRepo();
    makeCommit(repoDir, 'initial commit');
    await runInit({}, repoDir);
    output = '';
    vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    vi.spyOn(console, 'log').mockImplementation((...args) => { output += args.join(' ') + '\n'; });
  });

  afterEach(() => {
    cleanup(repoDir);
    vi.restoreAllMocks();
  });

  it('shows hooks installed: no before install', async () => {
    await runAgentStatus(repoDir);
    expect(output).toContain('Hooks installed: no');
  });

  it('shows hooks installed: yes after install', async () => {
    await runHooksInstall(repoDir);
    output = '';
    await runAgentStatus(repoDir);
    expect(output).toContain('Hooks installed: yes');
  });

  it('shows hooks installed: no after uninstall', async () => {
    await runHooksInstall(repoDir);
    await runHooksUninstall(repoDir);
    output = '';
    await runAgentStatus(repoDir);
    expect(output).toContain('Hooks installed: no');
  });

  it('shows Last sync at: never before first sync', async () => {
    await runAgentStatus(repoDir);
    expect(output).toContain('Last sync at: never');
  });

  it('shows last sync source after sync with --source git-hook', async () => {
    await runTrack('AUTH-1', 'test', repoDir);
    makeCommit(repoDir, 'work');
    await runSync(repoDir, { source: 'git-hook' });
    output = '';
    await runAgentStatus(repoDir);
    expect(output).toContain('Last sync source: git-hook');
  });

  it('shows tracked ticket on current branch', async () => {
    await runTrack('AUTH-1', 'some work', repoDir);
    output = '';
    await runAgentStatus(repoDir);
    expect(output).toContain('Tracked ticket on this branch: AUTH-1');
  });

  it('shows none when no tracked ticket on branch', async () => {
    await runAgentStatus(repoDir);
    expect(output).toContain('Tracked ticket on this branch: none');
  });

  it('suggests explicit tracking when current branch is untracked', async () => {
    await runAgentStatus(repoDir);
    expect(output).toContain('Tracking hint: run `cya track <ticket> "<title>"`');
    expect(output).toContain('cya track <ticket> "<title>"');
  });

  it('shows unassigned count', async () => {
    makeCommit(repoDir, 'orphan work');
    await runSync(repoDir);
    output = '';
    await runAgentStatus(repoDir);
    // initial commit + orphan work both unassigned (no ticket tracked)
    const match = output.match(/Unassigned commits: (\d+)/);
    expect(match).not.toBeNull();
    expect(parseInt(match![1])).toBeGreaterThanOrEqual(1);
  });

  it('unassigned count is 0 when nothing unassigned', async () => {
    await runTrack('AUTH-1', 'tracked work', repoDir);
    makeCommit(repoDir, 'tracked commit');
    await runSync(repoDir);
    output = '';
    await runAgentStatus(repoDir);
    expect(output).toContain('Unassigned commits: 0');
  });

  it('shows Claude Code hook: not installed before claude install', async () => {
    await runAgentStatus(repoDir);
    expect(output).toContain('Claude Code hook: not installed');
  });

  it('shows Claude Code hook: installed (local) after claude install', async () => {
    await runClaudeInstall({}, repoDir);
    output = '';
    await runAgentStatus(repoDir);
    expect(output).toContain('Claude Code hook: installed (local)');
  });

  it('shows Claude Code hook: installed (project) for a legacy shared settings hook', async () => {
    const settingsDir = join(repoDir, '.claude');
    mkdirSync(settingsDir, { recursive: true });
    writeFileSync(
      join(settingsDir, 'settings.json'),
      JSON.stringify({
        hooks: {
          Stop: [
            {
              matcher: '',
              hooks: [{ type: 'command', command: 'cya sync --source claude-code --quiet' }],
            },
          ],
        },
      }),
      'utf8',
    );
    output = '';
    await runAgentStatus(repoDir);
    expect(output).toContain('Claude Code hook: installed (project)');
  });

  it('shows Claude Code hook: not installed after claude uninstall', async () => {
    await runClaudeInstall({}, repoDir);
    await runClaudeUninstall({}, repoDir);
    output = '';
    await runAgentStatus(repoDir);
    expect(output).toContain('Claude Code hook: not installed');
  });

  it('shows session summary count after session-note', async () => {
    await runTrack('AUTH-1', 'some work', repoDir);
    await runSessionNote('AUTH-1', 'Worked on auth today.', {}, repoDir);
    output = '';
    await runAgentStatus(repoDir);
    expect(output).toContain('Claude session summaries this sprint: 1');
  });
});
