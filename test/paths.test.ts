import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { join } from 'node:path';
import {
  getAppDataRoot,
  getRepoId,
  getRepoIdentity,
  normalizeRepoRoot,
  getAppDataSprintDir,
} from '../src/paths.js';
import { setupTestAppData, makeTempGitRepo, cleanup } from './helpers.js';

let teardown: () => void;
beforeAll(() => {
  ({ teardown } = setupTestAppData());
});
afterAll(() => teardown());

// ── getAppDataRoot ─────────────────────────────────────────────────────────────

describe('getAppDataRoot', () => {
  it('CYA_DATA_HOME overrides all platforms', () => {
    const result = getAppDataRoot('linux', { CYA_DATA_HOME: '/custom/path' }, '/home/user');
    expect(result).toBe('/custom/path');
  });

  it('windows: uses LOCALAPPDATA env', () => {
    const result = getAppDataRoot('win32', { LOCALAPPDATA: 'C:\\Users\\foo\\AppData\\Local' }, 'C:\\Users\\foo');
    expect(result).toBe(join('C:\\Users\\foo\\AppData\\Local', 'cya'));
  });

  it('windows: falls back to AppData/Local under homeDir when LOCALAPPDATA missing', () => {
    const result = getAppDataRoot('win32', {}, 'C:\\Users\\foo');
    expect(result).toBe(join('C:\\Users\\foo', 'AppData', 'Local', 'cya'));
  });

  it('darwin: uses Library/Application Support', () => {
    const result = getAppDataRoot('darwin', {}, '/Users/foo');
    expect(result.replace(/\\/g, '/')).toBe('/Users/foo/Library/Application Support/cya');
  });

  it('linux: uses XDG_STATE_HOME when set', () => {
    const result = getAppDataRoot('linux', { XDG_STATE_HOME: '/custom/state' }, '/home/foo');
    expect(result.replace(/\\/g, '/')).toBe('/custom/state/cya');
  });

  it('linux: falls back to ~/.local/state when XDG_STATE_HOME missing', () => {
    const result = getAppDataRoot('linux', {}, '/home/foo');
    expect(result.replace(/\\/g, '/')).toBe('/home/foo/.local/state/cya');
  });
});

// ── getRepoId ─────────────────────────────────────────────────────────────────

describe('getRepoId', () => {
  it('same identity produces same ID', () => {
    const id1 = getRepoId('/some/path');
    const id2 = getRepoId('/some/path');
    expect(id1).toBe(id2);
  });

  it('different identities produce different IDs', () => {
    const id1 = getRepoId('/path/a');
    const id2 = getRepoId('/path/b');
    expect(id1).not.toBe(id2);
  });

  it('IDs are 12 hex characters', () => {
    const id = getRepoId('/some/path');
    expect(id).toMatch(/^[0-9a-f]{12}$/);
  });
});

// ── getRepoIdentity ───────────────────────────────────────────────────────────

describe('getRepoIdentity', () => {
  it('two calls on same repo return same identity', () => {
    const repoDir = makeTempGitRepo();
    try {
      const id1 = getRepoIdentity(repoDir);
      const id2 = getRepoIdentity(repoDir);
      expect(id1).toBe(id2);
    } finally {
      cleanup(repoDir);
    }
  });

  it('different repo paths produce different identities', () => {
    const repo1 = makeTempGitRepo();
    const repo2 = makeTempGitRepo();
    try {
      const id1 = getRepoIdentity(repo1);
      const id2 = getRepoIdentity(repo2);
      expect(id1).not.toBe(id2);
    } finally {
      cleanup(repo1);
      cleanup(repo2);
    }
  });

  it('identity contains the normalized repo root', () => {
    const repoDir = makeTempGitRepo();
    try {
      const identity = getRepoIdentity(repoDir);
      const normalized = normalizeRepoRoot(repoDir);
      expect(identity).toContain(normalized);
    } finally {
      cleanup(repoDir);
    }
  });
});

// ── getAppDataSprintDir ───────────────────────────────────────────────────────

describe('getAppDataSprintDir', () => {
  it('returns a path under <appDataRoot>/repos/', () => {
    const repoDir = makeTempGitRepo();
    try {
      const sprintDir = getAppDataSprintDir(repoDir, '/fake/appdata');
      expect(sprintDir.startsWith(join('/fake/appdata', 'repos'))).toBe(true);
    } finally {
      cleanup(repoDir);
    }
  });

  it('same repo root always produces the same sprint dir', () => {
    const repoDir = makeTempGitRepo();
    try {
      const sd1 = getAppDataSprintDir(repoDir, '/fake/appdata');
      const sd2 = getAppDataSprintDir(repoDir, '/fake/appdata');
      expect(sd1).toBe(sd2);
    } finally {
      cleanup(repoDir);
    }
  });

  it('different repo roots produce different sprint dirs', () => {
    const repo1 = makeTempGitRepo();
    const repo2 = makeTempGitRepo();
    try {
      const sd1 = getAppDataSprintDir(repo1, '/fake/appdata');
      const sd2 = getAppDataSprintDir(repo2, '/fake/appdata');
      expect(sd1).not.toBe(sd2);
    } finally {
      cleanup(repo1);
      cleanup(repo2);
    }
  });
});
