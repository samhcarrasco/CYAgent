import { describe, it, expect, beforeAll, beforeEach, afterAll, afterEach } from 'vitest';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { runInit } from '../src/commands/init.js';
import { runClaudeInstall } from '../src/commands/claude.js';
import { CyaError } from '../src/errors.js';
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

function readSettingsFile(repoDir: string, scope: 'project' | 'local' = 'local') {
  const filename = scope === 'local' ? 'settings.local.json' : 'settings.json';
  const p = join(repoDir, '.claude', filename);
  return JSON.parse(readFileSync(p, 'utf8'));
}

function readGitExclude(repoDir: string) {
  return readFileSync(join(repoDir, '.git', 'info', 'exclude'), 'utf8');
}

describe('runClaudeInstall - local-only scope', () => {
  let repoDir: string;

  beforeEach(async () => {
    repoDir = makeTempGitRepo();
    await runInit({}, repoDir);
  });

  afterEach(() => cleanup(repoDir));

  it('defaults to .claude/settings.local.json and never creates shared settings.json', async () => {
    await runClaudeInstall({}, repoDir);
    expect(existsSync(join(repoDir, '.claude', 'settings.local.json'))).toBe(true);
    expect(existsSync(join(repoDir, '.claude', 'settings.json'))).toBe(false);

    const settings = readSettingsFile(repoDir);
    expect(settings.hooks?.Stop).toBeDefined();
    const commands = settings.hooks.Stop.flatMap((m: { hooks: Array<{ command: string }> }) =>
      m.hooks.map((h) => h.command),
    );
    expect(commands.some((c: string) => c.includes('cya sync'))).toBe(true);
    expect(readGitExclude(repoDir)).toContain('.claude/settings.local.json');
  });

  it('merges into existing local settings preserving other keys', async () => {
    const settingsDir = join(repoDir, '.claude');
    mkdirSync(settingsDir, { recursive: true });
    writeFileSync(
      join(settingsDir, 'settings.local.json'),
      JSON.stringify({ permissions: { allow: ['Bash'] } }),
      'utf8',
    );
    await runClaudeInstall({}, repoDir);
    const settings = readSettingsFile(repoDir);
    expect(settings.permissions?.allow).toContain('Bash');
    expect(settings.hooks?.Stop).toBeDefined();
  });

  it('merges into existing local hooks.Stop preserving other matchers', async () => {
    const settingsDir = join(repoDir, '.claude');
    mkdirSync(settingsDir, { recursive: true });
    writeFileSync(
      join(settingsDir, 'settings.local.json'),
      JSON.stringify({
        hooks: {
          Stop: [{ matcher: 'other', hooks: [{ type: 'command', command: 'echo done' }] }],
        },
      }),
      'utf8',
    );
    await runClaudeInstall({}, repoDir);
    const settings = readSettingsFile(repoDir);
    expect(settings.hooks.Stop).toHaveLength(2);
    const commands = settings.hooks.Stop.flatMap((m: { hooks: Array<{ command: string }> }) =>
      m.hooks.map((h) => h.command),
    );
    expect(commands).toContain('echo done');
    expect(commands.some((c: string) => c.includes('cya sync'))).toBe(true);
  });

  it('second install is idempotent - no duplicate Stop entry', async () => {
    await runClaudeInstall({}, repoDir);
    await runClaudeInstall({}, repoDir);
    const settings = readSettingsFile(repoDir);
    const cyaEntries = settings.hooks.Stop.filter((m: { hooks: Array<{ command: string }> }) =>
      m.hooks.some((h) => h.command.includes('cya sync')),
    );
    expect(cyaEntries).toHaveLength(1);
  });

  it('--scope local writes to settings.local.json not settings.json', async () => {
    await runClaudeInstall({ scope: 'local' }, repoDir);
    expect(existsSync(join(repoDir, '.claude', 'settings.local.json'))).toBe(true);
    expect(existsSync(join(repoDir, '.claude', 'settings.json'))).toBe(false);
    const settings = readSettingsFile(repoDir, 'local');
    expect(settings.hooks?.Stop).toBeDefined();
  });

  it('--scope project is rejected and writes no Claude settings', async () => {
    const err = await runClaudeInstall({ scope: 'project' }, repoDir).catch((e) => e);
    expect(err).toBeInstanceOf(CyaError);
    expect((err as CyaError).code).toBe('claude-project-scope-disabled');
    expect(existsSync(join(repoDir, '.claude', 'settings.local.json'))).toBe(false);
    expect(existsSync(join(repoDir, '.claude', 'settings.json'))).toBe(false);
  });

  it('--print writes nothing to disk and prints JSON to stdout', async () => {
    const logs: string[] = [];
    const orig = console.log;
    console.log = (...args) => { logs.push(args.join(' ')); };
    try {
      await runClaudeInstall({ print: true }, repoDir);
    } finally {
      console.log = orig;
    }
    expect(existsSync(join(repoDir, '.claude', 'settings.local.json'))).toBe(false);
    expect(existsSync(join(repoDir, '.claude', 'settings.json'))).toBe(false);
    const output = logs.join('\n');
    expect(output).toContain('cya sync');
    expect(output).toContain('"Stop"');
  });

  it('malformed local JSON throws claude-settings-malformed and leaves file untouched', async () => {
    const settingsDir = join(repoDir, '.claude');
    mkdirSync(settingsDir, { recursive: true });
    const settingsPath = join(settingsDir, 'settings.local.json');
    writeFileSync(settingsPath, 'not { valid json', 'utf8');
    const err = await runClaudeInstall({}, repoDir).catch((e) => e);
    expect(err).toBeInstanceOf(CyaError);
    expect((err as CyaError).code).toBe('claude-settings-malformed');
    expect(readFileSync(settingsPath, 'utf8')).toBe('not { valid json');
  });

  it('emits agent_hooks_installed event with hook label claude-stop', async () => {
    await runClaudeInstall({}, repoDir);
    const events = readFileSync(join(resolveTestSprintDir(repoDir), 'events.jsonl'), 'utf8')
      .split('\n')
      .filter(Boolean)
      .map((l) => JSON.parse(l));
    const ev = events.find((e: { type: string }) => e.type === 'agent_hooks_installed');
    expect(ev).toBeDefined();
    expect(ev.payload.hooks).toContain('claude-stop');
  });

  it('--with-slash-commands writes cya-note.md and excludes it locally', async () => {
    await runClaudeInstall({ withSlashCommands: true }, repoDir);
    const slashPath = join(repoDir, '.claude', 'commands', 'cya-note.md');
    expect(existsSync(slashPath)).toBe(true);
    const content = readFileSync(slashPath, 'utf8');
    expect(content).toContain('session-note');
    expect(readGitExclude(repoDir)).toContain('.claude/commands/cya-note.md');
  });
});
