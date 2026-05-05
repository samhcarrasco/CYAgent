import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { readConfig, writeConfig, defaultConfig } from '../src/config.js';
import { CyaError } from '../src/errors.js';

function makeTempDir(): string {
  return mkdtempSync(join(tmpdir(), 'cya-config-test-'));
}

describe('readConfig', () => {
  let dir: string;
  beforeEach(() => {
    dir = makeTempDir();
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('reads and parses a valid config.json', () => {
    const config = defaultConfig('my-sprint');
    writeFileSync(join(dir, 'config.json'), JSON.stringify(config), 'utf8');
    const result = readConfig(dir);
    expect(result.name).toBe('my-sprint');
    expect(result.ai.enabled).toBe(false);
    expect(result.version).toBe(1);
  });

  it('throws config-not-found when file is missing', () => {
    let caught: unknown;
    try {
      readConfig(dir);
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(CyaError);
    expect((caught as CyaError).code).toBe('config-not-found');
  });

  it('throws config-malformed for invalid JSON', () => {
    writeFileSync(join(dir, 'config.json'), 'not valid json', 'utf8');
    let caught: unknown;
    try {
      readConfig(dir);
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(CyaError);
    expect((caught as CyaError).code).toBe('config-malformed');
  });

  it('throws config-invalid for wrong schema', () => {
    writeFileSync(join(dir, 'config.json'), JSON.stringify({ version: 99 }), 'utf8');
    let caught: unknown;
    try {
      readConfig(dir);
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(CyaError);
    expect((caught as CyaError).code).toBe('config-invalid');
  });

  it('older config missing allowDiffSummarization reads as false', () => {
    const config = defaultConfig('my-sprint');
    const { allowDiffSummarization: _removed, ...privacyWithout } = config.privacy;
    const oldConfig = { ...config, privacy: privacyWithout };
    writeFileSync(join(dir, 'config.json'), JSON.stringify(oldConfig), 'utf8');
    const result = readConfig(dir);
    expect(result.privacy.allowDiffSummarization).toBe(false);
  });
});

describe('writeConfig', () => {
  let dir: string;
  beforeEach(() => {
    dir = makeTempDir();
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('writes a valid config that can be read back', async () => {
    const config = defaultConfig('test-project');
    await writeConfig(dir, config);
    const back = readConfig(dir);
    expect(back).toEqual(config);
  });

  it('round-trips ai.enabled=true with claude-code provider', async () => {
    const config = defaultConfig('test');
    config.ai.enabled = true;
    config.ai.provider = 'claude-code';
    await writeConfig(dir, config);
    const back = readConfig(dir);
    expect(back.ai.enabled).toBe(true);
    expect(back.ai.provider).toBe('claude-code');
  });

  it('round-trips privacy flags', async () => {
    const config = defaultConfig('test');
    config.privacy.allowCommandOutput = true;
    config.privacy.allowDiffSummarization = true;
    await writeConfig(dir, config);
    const back = readConfig(dir);
    expect(back.privacy.allowCommandOutput).toBe(true);
    expect(back.privacy.allowDiffSummarization).toBe(true);
  });
});
