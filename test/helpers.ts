import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execSync } from 'node:child_process';
import { requireSprintDir } from '../src/paths.js';
import { runInit, type InitOptions } from '../src/commands/init.js';

export function makeTempGitRepo(prefix = 'cya-test-'): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  execSync('git init', { cwd: dir, stdio: 'pipe' });
  return dir;
}

export function makeTempDir(prefix = 'cya-test-'): string {
  return mkdtempSync(join(tmpdir(), prefix));
}

export function cleanup(dir: string): void {
  rmSync(dir, { recursive: true, force: true });
}

/**
 * Sets process.env.CYA_DATA_HOME to an isolated temp dir for the duration of
 * a test file. Call in beforeAll, call the returned function in afterAll.
 *
 * Returns { dir, teardown }. teardown() restores the env var and deletes the dir.
 */
export function setupTestAppData(): { dir: string; teardown: () => void } {
  const dir = mkdtempSync(join(tmpdir(), 'cya-data-'));
  const prev = process.env['CYA_DATA_HOME'];
  process.env['CYA_DATA_HOME'] = dir;
  return {
    dir,
    teardown: () => {
      if (prev !== undefined) {
        process.env['CYA_DATA_HOME'] = prev;
      } else {
        delete process.env['CYA_DATA_HOME'];
      }
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

/** Resolve the sprint dir for a given repo dir (requires CYA_DATA_HOME to be set). */
export function resolveTestSprintDir(repoDir: string): string {
  return requireSprintDir(repoDir).sprintDir;
}

/**
 * Create a temp git repo, run cya init, and return { repoDir, sprintDir }.
 * Requires CYA_DATA_HOME to be set (call setupTestAppData in beforeAll first).
 */
export async function makeTestRepo(
  options?: Pick<InitOptions, 'name' | 'storage'>,
): Promise<{ repoDir: string; sprintDir: string }> {
  const repoDir = makeTempGitRepo();
  await runInit(options ?? {}, repoDir);
  const sprintDir = resolveTestSprintDir(repoDir);
  return { repoDir, sprintDir };
}
