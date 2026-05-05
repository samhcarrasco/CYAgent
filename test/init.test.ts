import { describe, it, expect, beforeAll, beforeEach, afterAll, afterEach } from 'vitest';
import { mkdtempSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execSync } from 'node:child_process';
import { runInit } from '../src/commands/init.js';
import { ConfigSchema } from '../src/config.js';
import { StateSchema } from '../src/state.js';
import { CyaError } from '../src/errors.js';
import { requireSprintDir } from '../src/paths.js';
import { setupTestAppData, makeTempGitRepo, makeTempDir, cleanup } from './helpers.js';

let appData: { dir: string; teardown: () => void };
beforeAll(() => {
  appData = setupTestAppData();
});
afterAll(() => appData.teardown());

// ── app-data init (default) ───────────────────────────────────────────────────

describe('default app-data init', () => {
  let repoDir: string;
  let sprintDir: string;

  beforeEach(async () => {
    repoDir = makeTempGitRepo();
    await runInit({}, repoDir);
    sprintDir = requireSprintDir(repoDir).sprintDir;
  });

  afterEach(() => cleanup(repoDir));

  it('creates all required files and directories under app-data', () => {
    expect(existsSync(join(sprintDir, 'config.json'))).toBe(true);
    expect(existsSync(join(sprintDir, 'events.jsonl'))).toBe(true);
    expect(existsSync(join(sprintDir, 'state.json'))).toBe(true);
    expect(existsSync(join(sprintDir, 'SPRINT.md'))).toBe(true);
    expect(existsSync(join(sprintDir, 'tickets'))).toBe(true);
  });

  it('sprint dir is NOT inside the git repo', () => {
    expect(sprintDir.startsWith(repoDir)).toBe(false);
  });

  it('does not create .sprint/ inside the git repo', () => {
    expect(existsSync(join(repoDir, '.sprint'))).toBe(false);
  });

  it('does not create or modify .gitignore', () => {
    expect(existsSync(join(repoDir, '.gitignore'))).toBe(false);
  });

  it('writes valid config.json with correct defaults', () => {
    const raw = readFileSync(join(sprintDir, 'config.json'), 'utf8');
    const result = ConfigSchema.safeParse(JSON.parse(raw));
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.version).toBe(1);
    expect(result.data.ai.provider).toBe('none');
    expect(result.data.ai.enabled).toBe(false);
  });

  it('config.json includes storage metadata with mode app-data', () => {
    const raw = readFileSync(join(sprintDir, 'config.json'), 'utf8');
    const config = ConfigSchema.parse(JSON.parse(raw));
    expect(config.storage?.mode).toBe('app-data');
    expect(config.storage?.repoId).toBeDefined();
    expect(config.storage?.repoId.length).toBe(12);
  });

  it('uses repo directory name as default sprint name', async () => {
    const raw = readFileSync(join(sprintDir, 'config.json'), 'utf8');
    const config = ConfigSchema.parse(JSON.parse(raw));
    const { basename } = await import('node:path');
    expect(config.name).toBe(basename(repoDir));
  });

  it('uses --name option when provided', async () => {
    const repoDir2 = makeTempGitRepo();
    try {
      await runInit({ name: 'my-sprint' }, repoDir2);
      const sd = requireSprintDir(repoDir2).sprintDir;
      const raw = readFileSync(join(sd, 'config.json'), 'utf8');
      const config = ConfigSchema.parse(JSON.parse(raw));
      expect(config.name).toBe('my-sprint');
    } finally {
      cleanup(repoDir2);
    }
  });

  it('writes valid state.json', () => {
    const raw = readFileSync(join(sprintDir, 'state.json'), 'utf8');
    const result = StateSchema.safeParse(JSON.parse(raw));
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.version).toBe(2);
    expect(result.data.tickets).toEqual({});
    expect(result.data.lastSyncAt).toBeNull();
  });

  it('writes events.jsonl as an empty file', () => {
    const content = readFileSync(join(sprintDir, 'events.jsonl'), 'utf8');
    expect(content).toBe('');
  });

  it('writes SPRINT.md with all required sections', () => {
    const content = readFileSync(join(sprintDir, 'SPRINT.md'), 'utf8');
    expect(content).toContain('# Sprint');
    expect(content).toContain('## Done');
    expect(content).toContain('## In Progress');
    expect(content).toContain('## Blockers');
  });

  it('detects git root from a subdirectory', async () => {
    const { mkdirSync } = await import('node:fs');
    const repoDir2 = makeTempGitRepo();
    try {
      const subdir = join(repoDir2, 'src', 'deep');
      mkdirSync(subdir, { recursive: true });
      await expect(runInit({}, subdir)).resolves.not.toThrow();
      expect(() => requireSprintDir(subdir)).not.toThrow();
    } finally {
      cleanup(repoDir2);
    }
  });
});

// ── repo-local init (--storage repo) ─────────────────────────────────────────

describe('repo-local init (--storage repo)', () => {
  let repoDir: string;

  beforeEach(() => {
    repoDir = makeTempGitRepo();
  });

  afterEach(() => cleanup(repoDir));

  it('creates .sprint/ inside the git repo', async () => {
    await runInit({ storage: 'repo' }, repoDir);
    expect(existsSync(join(repoDir, '.sprint'))).toBe(true);
  });

  it('creates all required files under .sprint/', async () => {
    await runInit({ storage: 'repo' }, repoDir);
    expect(existsSync(join(repoDir, '.sprint', 'config.json'))).toBe(true);
    expect(existsSync(join(repoDir, '.sprint', 'events.jsonl'))).toBe(true);
    expect(existsSync(join(repoDir, '.sprint', 'state.json'))).toBe(true);
    expect(existsSync(join(repoDir, '.sprint', 'SPRINT.md'))).toBe(true);
    expect(existsSync(join(repoDir, '.sprint', 'tickets'))).toBe(true);
  });

  it('creates .gitignore with required entries', async () => {
    await runInit({ storage: 'repo' }, repoDir);
    const content = readFileSync(join(repoDir, '.gitignore'), 'utf8');
    expect(content).toContain('.sprint/state.json');
    expect(content).toContain('.sprint/SPRINT.md');
  });

  it('appends to existing .gitignore without overwriting', async () => {
    const { writeFileSync } = await import('node:fs');
    writeFileSync(join(repoDir, '.gitignore'), 'node_modules/\ndist/\n', 'utf8');
    await runInit({ storage: 'repo' }, repoDir);
    const content = readFileSync(join(repoDir, '.gitignore'), 'utf8');
    expect(content).toContain('node_modules/');
    expect(content).toContain('dist/');
    expect(content).toContain('.sprint/state.json');
  });

  it('does not duplicate .gitignore entries on --force reinit', async () => {
    await runInit({ storage: 'repo' }, repoDir);
    await runInit({ force: true, storage: 'repo' }, repoDir);
    const content = readFileSync(join(repoDir, '.gitignore'), 'utf8');
    const lines = content.split('\n');
    const stateLines = lines.filter((l) => l.trim() === '.sprint/state.json');
    expect(stateLines.length).toBe(1);
  });

  it('config.json includes storage metadata with mode repo', async () => {
    await runInit({ storage: 'repo' }, repoDir);
    const raw = readFileSync(join(repoDir, '.sprint', 'config.json'), 'utf8');
    const config = ConfigSchema.parse(JSON.parse(raw));
    expect(config.storage?.mode).toBe('repo');
  });

  it('requireSprintDir resolves to .sprint/ for repo-local init', async () => {
    await runInit({ storage: 'repo' }, repoDir);
    const { sprintDir } = requireSprintDir(repoDir);
    expect(sprintDir).toBe(join(repoDir, '.sprint'));
  });
});

// ── idempotency and --force ───────────────────────────────────────────────────

describe('idempotency and --force (app-data)', () => {
  let repoDir: string;

  beforeEach(() => {
    repoDir = makeTempGitRepo();
  });

  afterEach(() => cleanup(repoDir));

  it('errors when storage already exists without --force', async () => {
    await runInit({}, repoDir);
    await expect(runInit({}, repoDir)).rejects.toBeInstanceOf(CyaError);
  });

  it('error has code already-initialized', async () => {
    await runInit({}, repoDir);
    try {
      await runInit({}, repoDir);
      expect.fail('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(CyaError);
      expect((err as CyaError).code).toBe('already-initialized');
    }
  });

  it('--force reinitializes without error', async () => {
    await runInit({}, repoDir);
    await expect(runInit({ force: true }, repoDir)).resolves.not.toThrow();
  });

  it('--force preserves existing events.jsonl', async () => {
    await runInit({}, repoDir);
    const { sprintDir } = requireSprintDir(repoDir);
    const { appendFileSync } = await import('node:fs');
    appendFileSync(join(sprintDir, 'events.jsonl'), '{"type":"test"}\n', 'utf8');
    await runInit({ force: true }, repoDir);
    const content = readFileSync(join(sprintDir, 'events.jsonl'), 'utf8');
    expect(content).toContain('{"type":"test"}');
  });

  it('--force rewrites config.json', async () => {
    await runInit({ name: 'original' }, repoDir);
    await runInit({ force: true, name: 'updated' }, repoDir);
    const { sprintDir } = requireSprintDir(repoDir);
    const raw = readFileSync(join(sprintDir, 'config.json'), 'utf8');
    const config = ConfigSchema.parse(JSON.parse(raw));
    expect(config.name).toBe('updated');
  });
});

describe('idempotency and --force (--storage repo)', () => {
  let repoDir: string;

  beforeEach(() => {
    repoDir = makeTempGitRepo();
  });

  afterEach(() => cleanup(repoDir));

  it('errors when .sprint/ already exists without --force', async () => {
    await runInit({ storage: 'repo' }, repoDir);
    await expect(runInit({ storage: 'repo' }, repoDir)).rejects.toBeInstanceOf(CyaError);
  });

  it('--force preserves existing events.jsonl in repo mode', async () => {
    await runInit({ storage: 'repo' }, repoDir);
    const { appendFileSync } = await import('node:fs');
    appendFileSync(join(repoDir, '.sprint', 'events.jsonl'), '{"type":"test"}\n', 'utf8');
    await runInit({ force: true, storage: 'repo' }, repoDir);
    const content = readFileSync(join(repoDir, '.sprint', 'events.jsonl'), 'utf8');
    expect(content).toContain('{"type":"test"}');
  });
});

// ── error handling ────────────────────────────────────────────────────────────

describe('error handling', () => {
  it('errors cleanly when not inside a git repository', async () => {
    const notARepo = makeTempDir();
    try {
      await expect(runInit({}, notARepo)).rejects.toBeInstanceOf(CyaError);
      await expect(runInit({}, notARepo)).rejects.toThrow('Not inside a git repository');
    } finally {
      cleanup(notARepo);
    }
  });

  it('error for non-git-repo has code not-a-git-repo', async () => {
    const notARepo = makeTempDir();
    try {
      try {
        await runInit({}, notARepo);
        expect.fail('should have thrown');
      } catch (err) {
        expect(err).toBeInstanceOf(CyaError);
        expect((err as CyaError).code).toBe('not-a-git-repo');
      }
    } finally {
      cleanup(notARepo);
    }
  });
});

// ── legacy fallback ───────────────────────────────────────────────────────────

describe('legacy repo-local fallback', () => {
  it('requireSprintDir finds legacy .sprint/ when no index entry exists', async () => {
    const repoDir = makeTempGitRepo();
    try {
      // Create a .sprint/ directly without going through runInit (simulates legacy)
      const { mkdirSync, writeFileSync } = await import('node:fs');
      const legacySprintDir = join(repoDir, '.sprint');
      mkdirSync(legacySprintDir, { recursive: true });
      writeFileSync(join(legacySprintDir, 'events.jsonl'), '', 'utf8');

      const { sprintDir } = requireSprintDir(repoDir);
      expect(sprintDir).toBe(legacySprintDir);
    } finally {
      cleanup(repoDir);
    }
  });
});
