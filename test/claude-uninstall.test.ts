import { describe, it, expect, beforeAll, beforeEach, afterAll, afterEach } from 'vitest';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { runInit } from '../src/commands/init.js';
import { runClaudeInstall, runClaudeUninstall } from '../src/commands/claude.js';
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

describe('runClaudeUninstall', () => {
  let repoDir: string;

  beforeEach(async () => {
    repoDir = makeTempGitRepo();
    await runInit({}, repoDir);
    await runClaudeInstall({}, repoDir);
  });

  afterEach(() => cleanup(repoDir));

  it('removes cya Stop entry from local settings and preserves other matchers', async () => {
    const settingsPath = join(repoDir, '.claude', 'settings.local.json');
    const existing = JSON.parse(readFileSync(settingsPath, 'utf8'));
    existing.hooks.Stop.push({ matcher: 'other', hooks: [{ type: 'command', command: 'echo other' }] });
    writeFileSync(settingsPath, JSON.stringify(existing), 'utf8');

    await runClaudeUninstall({}, repoDir);

    const updated = JSON.parse(readFileSync(settingsPath, 'utf8'));
    const commands = (updated.hooks?.Stop ?? []).flatMap(
      (m: { hooks: Array<{ command: string }> }) => m.hooks.map((h) => h.command),
    );
    expect(commands.some((c: string) => c.includes('cya sync'))).toBe(false);
    expect(commands).toContain('echo other');
  });

  it('if local hooks.Stop becomes empty, removes the key', async () => {
    await runClaudeUninstall({}, repoDir);
    const updated = JSON.parse(readFileSync(join(repoDir, '.claude', 'settings.local.json'), 'utf8'));
    expect(updated.hooks).toBeUndefined();
  });

  it('uninstall on never-installed repo is a no-op', async () => {
    const freshDir = makeTempGitRepo();
    await runInit({}, freshDir);
    await expect(runClaudeUninstall({}, freshDir)).resolves.not.toThrow();
    cleanup(freshDir);
  });

  it('emits agent_hooks_uninstalled event', async () => {
    await runClaudeUninstall({}, repoDir);
    const events = readFileSync(join(resolveTestSprintDir(repoDir), 'events.jsonl'), 'utf8')
      .split('\n')
      .filter(Boolean)
      .map((l) => JSON.parse(l));
    const ev = events.find((e: { type: string }) => e.type === 'agent_hooks_uninstalled');
    expect(ev).toBeDefined();
    expect(ev.payload.hooks).toContain('claude-stop');
  });

  it('uninstall on missing local settings file is a no-op', async () => {
    const freshDir = makeTempGitRepo();
    await runInit({}, freshDir);
    const settingsPath = join(freshDir, '.claude', 'settings.local.json');
    expect(existsSync(settingsPath)).toBe(false);
    await expect(runClaudeUninstall({}, freshDir)).resolves.not.toThrow();
    cleanup(freshDir);
  });

  it('--scope local uninstalls from settings.local.json', async () => {
    const localDir = makeTempGitRepo();
    await runInit({}, localDir);
    await runClaudeInstall({ scope: 'local' }, localDir);
    const localPath = join(localDir, '.claude', 'settings.local.json');
    expect(existsSync(localPath)).toBe(true);
    await runClaudeUninstall({ scope: 'local' }, localDir);
    const updated = JSON.parse(readFileSync(localPath, 'utf8'));
    expect(updated.hooks).toBeUndefined();
    cleanup(localDir);
  });

  it('preserves other top-level keys when local hooks becomes empty', async () => {
    const settingsPath = join(repoDir, '.claude', 'settings.local.json');
    const existing = JSON.parse(readFileSync(settingsPath, 'utf8'));
    existing.permissions = { allow: ['Bash'] };
    writeFileSync(settingsPath, JSON.stringify(existing), 'utf8');

    await runClaudeUninstall({}, repoDir);

    const updated = JSON.parse(readFileSync(settingsPath, 'utf8'));
    expect(updated.permissions?.allow).toContain('Bash');
    expect(updated.hooks).toBeUndefined();
  });

  it('--scope project can clean up a legacy shared settings.json hook', async () => {
    const legacyDir = makeTempGitRepo();
    await runInit({}, legacyDir);
    const settingsDir = join(legacyDir, '.claude');
    mkdirSync(settingsDir, { recursive: true });
    const settingsPath = join(settingsDir, 'settings.json');
    writeFileSync(
      settingsPath,
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

    await runClaudeUninstall({ scope: 'project' }, legacyDir);

    const updated = JSON.parse(readFileSync(settingsPath, 'utf8'));
    expect(updated.hooks).toBeUndefined();
    cleanup(legacyDir);
  });
});
