import { describe, it, expect, beforeAll, beforeEach, afterAll, afterEach } from 'vitest';
import { rmSync } from 'node:fs';
import { runConfigure } from '../src/commands/configure.js';
import { readConfig } from '../src/config.js';
import { CyaError } from '../src/errors.js';
import {
  setupTestAppData,
  makeTestRepo,
  cleanup,
  resolveTestSprintDir,
} from './helpers.js';
import { runInit } from '../src/commands/init.js';

let teardown: () => void;
beforeAll(() => {
  ({ teardown } = setupTestAppData());
});
afterAll(() => teardown());

describe('runConfigure', () => {
  let repoDir: string;

  beforeEach(async () => {
    ({ repoDir } = await makeTestRepo());
  });

  afterEach(() => cleanup(repoDir));

  it('enables AI with enableAi option', async () => {
    await runConfigure({ enableAi: true }, repoDir);
    const config = readConfig(resolveTestSprintDir(repoDir));
    expect(config.ai.enabled).toBe(true);
    expect(config.ai.provider).toBe('claude-code');
  });

  it('disables AI with disableAi option', async () => {
    await runConfigure({ enableAi: true }, repoDir);
    await runConfigure({ disableAi: true }, repoDir);
    const config = readConfig(resolveTestSprintDir(repoDir));
    expect(config.ai.enabled).toBe(false);
    expect(config.ai.provider).toBe('none');
  });

  it('enables allowCommandOutput', async () => {
    await runConfigure({ allowCommandOutput: true }, repoDir);
    const config = readConfig(resolveTestSprintDir(repoDir));
    expect(config.privacy.allowCommandOutput).toBe(true);
  });

  it('enables allowDiffSummarization', async () => {
    await runConfigure({ allowDiffSummarization: true }, repoDir);
    const config = readConfig(resolveTestSprintDir(repoDir));
    expect(config.privacy.allowDiffSummarization).toBe(true);
  });

  it('throws configure-conflict when enableAi and disableAi are both set', async () => {
    let caught: unknown;
    try {
      await runConfigure({ enableAi: true, disableAi: true }, repoDir);
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(CyaError);
    expect((caught as CyaError).code).toBe('configure-conflict');
  });

  it('does not modify config when no options are passed', async () => {
    const before = readConfig(resolveTestSprintDir(repoDir));
    await runConfigure({}, repoDir);
    const after = readConfig(resolveTestSprintDir(repoDir));
    expect(after).toEqual(before);
  });
});
