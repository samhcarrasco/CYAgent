import { describe, it, expect, beforeAll, beforeEach, afterAll, afterEach } from 'vitest';
import { rmSync, existsSync, writeFileSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { execSync } from 'node:child_process';
import { runInit } from '../src/commands/init.js';
import { runHooksInstall, runHooksUninstall } from '../src/commands/hooks.js';
import { CyaError } from '../src/errors.js';
import { SENTINEL, hookPath, backupPath, HOOK_NAMES } from '../src/hooks.js';
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

describe('hooks install', () => {
  let repoDir: string;

  beforeEach(async () => {
    repoDir = makeTempGitRepo();
    execSync('git -c user.email=t@t.t -c user.name=T commit --allow-empty -m init', {
      cwd: repoDir,
      stdio: 'pipe',
    });
    await runInit({}, repoDir);
  });

  afterEach(() => cleanup(repoDir));

  it('creates all four hook files', async () => {
    await runHooksInstall(repoDir);
    for (const name of HOOK_NAMES) {
      expect(existsSync(hookPath(repoDir, name))).toBe(true);
    }
  });

  it('hook files contain the sentinel', async () => {
    await runHooksInstall(repoDir);
    for (const name of HOOK_NAMES) {
      const content = readFileSync(hookPath(repoDir, name), 'utf8');
      expect(content).toContain(SENTINEL);
    }
  });

  it('post-checkout hook calls the internal checkout entrypoint', async () => {
    await runHooksInstall(repoDir);
    const content = readFileSync(hookPath(repoDir, 'post-checkout'), 'utf8');
    expect(content).toContain('cya hook post-checkout "$1" "$2" "$3" "$GIT_PID" --quiet');
  });

  it('reference-transaction hook calls the internal entrypoint with replayed stdin', async () => {
    await runHooksInstall(repoDir);
    const content = readFileSync(hookPath(repoDir, 'reference-transaction'), 'utf8');
    expect(content).toContain('"$PRE" "$@" < "$INPUT_FILE"');
    expect(content).toContain('cya hook reference-transaction "$1" "$GIT_PID" < "$INPUT_FILE"');
  });

  it('hook files are executable on non-Windows', async () => {
    if (process.platform === 'win32') return;
    await runHooksInstall(repoDir);
    for (const name of HOOK_NAMES) {
      const mode = statSync(hookPath(repoDir, name)).mode;
      expect(mode & 0o111).toBeGreaterThan(0);
    }
  });

  it('install over cya hook is idempotent (updated)', async () => {
    await runHooksInstall(repoDir);
    await runHooksInstall(repoDir); // second install should overwrite
    for (const name of HOOK_NAMES) {
      const content = readFileSync(hookPath(repoDir, name), 'utf8');
      expect(content).toContain(SENTINEL);
    }
  });

  it('updates legacy v0.2 managed hooks in place', async () => {
    const target = hookPath(repoDir, 'post-commit');
    writeFileSync(target, '#!/bin/sh\n# >>> cya managed hook (v0.2) <<<\necho old-cya-hook\n', 'utf8');
    await runHooksInstall(repoDir);
    const content = readFileSync(target, 'utf8');
    expect(content).toContain(SENTINEL);
    expect(content).not.toContain('old-cya-hook');
    expect(existsSync(backupPath(repoDir, 'post-commit'))).toBe(false);
  });

  it('install over existing user hook backs it up', async () => {
    const target = hookPath(repoDir, 'post-commit');
    writeFileSync(target, '#!/bin/sh\necho user-hook\n', 'utf8');
    await runHooksInstall(repoDir);
    expect(existsSync(backupPath(repoDir, 'post-commit'))).toBe(true);
    const backup = readFileSync(backupPath(repoDir, 'post-commit'), 'utf8');
    expect(backup).toContain('user-hook');
  });

  it('install over existing user hook chains it in the new script', async () => {
    const target = hookPath(repoDir, 'post-commit');
    writeFileSync(target, '#!/bin/sh\necho user-hook\n', 'utf8');
    await runHooksInstall(repoDir);
    const installed = readFileSync(target, 'utf8');
    expect(installed).toContain('cya-pre-existing');
  });

  it('install emits agent_hooks_installed event', async () => {
    await runHooksInstall(repoDir);
    const events = readFileSync(join(resolveTestSprintDir(repoDir), 'events.jsonl'), 'utf8')
      .split('\n').filter(Boolean).map((l) => JSON.parse(l));
    const hookEvent = events.find((e: { type: string }) => e.type === 'agent_hooks_installed');
    expect(hookEvent).toBeDefined();
    expect(hookEvent.payload.hooks).toContain('post-commit');
  });

  it('throws hooks-backup-conflict if backup already exists', async () => {
    const target = hookPath(repoDir, 'post-commit');
    const backup = backupPath(repoDir, 'post-commit');
    writeFileSync(target, '#!/bin/sh\necho user-hook\n', 'utf8');
    writeFileSync(backup, '#!/bin/sh\necho old-backup\n', 'utf8');
    const err = await runHooksInstall(repoDir).catch((e) => e);
    expect(err).toBeInstanceOf(CyaError);
    expect((err as CyaError).code).toBe('hooks-backup-conflict');
  });
});

describe('hooks uninstall', () => {
  let repoDir: string;

  beforeEach(async () => {
    repoDir = makeTempGitRepo();
    execSync('git -c user.email=t@t.t -c user.name=T commit --allow-empty -m init', {
      cwd: repoDir,
      stdio: 'pipe',
    });
    await runInit({}, repoDir);
    await runHooksInstall(repoDir);
  });

  afterEach(() => cleanup(repoDir));

  it('removes cya-managed hooks', async () => {
    await runHooksUninstall(repoDir);
    for (const name of HOOK_NAMES) {
      expect(existsSync(hookPath(repoDir, name))).toBe(false);
    }
  });

  it('removes legacy v0.2 managed hooks', async () => {
    for (const name of HOOK_NAMES) {
      writeFileSync(hookPath(repoDir, name), '#!/bin/sh\n# >>> cya managed hook (v0.2) <<<\n', 'utf8');
    }
    await runHooksUninstall(repoDir);
    for (const name of HOOK_NAMES) {
      expect(existsSync(hookPath(repoDir, name))).toBe(false);
    }
  });

  it('restores backed-up user hook', async () => {
    // Re-init with a user hook for post-commit
    rmSync(repoDir, { recursive: true, force: true });
    repoDir = makeTempGitRepo();
    execSync('git -c user.email=t@t.t -c user.name=T commit --allow-empty -m init', {
      cwd: repoDir,
      stdio: 'pipe',
    });
    await runInit({}, repoDir);
    writeFileSync(hookPath(repoDir, 'post-commit'), '#!/bin/sh\necho user-hook\n', 'utf8');
    await runHooksInstall(repoDir);
    await runHooksUninstall(repoDir);
    const restored = readFileSync(hookPath(repoDir, 'post-commit'), 'utf8');
    expect(restored).toContain('user-hook');
    expect(restored).not.toContain(SENTINEL);
  });

  it('uninstall on already-uninstalled repo is a no-op', async () => {
    await runHooksUninstall(repoDir);
    await expect(runHooksUninstall(repoDir)).resolves.not.toThrow();
  });

  it('emits agent_hooks_uninstalled event', async () => {
    await runHooksUninstall(repoDir);
    const events = readFileSync(join(resolveTestSprintDir(repoDir), 'events.jsonl'), 'utf8')
      .split('\n').filter(Boolean).map((l) => JSON.parse(l));
    const hookEvent = events.find((e: { type: string }) => e.type === 'agent_hooks_uninstalled');
    expect(hookEvent).toBeDefined();
  });
});
