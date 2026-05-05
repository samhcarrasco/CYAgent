import { requireSprintDir } from '../paths.js';
import { readConfig, writeConfig } from '../config.js';
import { CyaError } from '../errors.js';

export interface ConfigureOptions {
  enableAi?: boolean;
  disableAi?: boolean;
  allowDiffSummarization?: boolean;
  allowCommandOutput?: boolean;
}

export async function runConfigure(
  options: ConfigureOptions = {},
  cwd = process.cwd(),
): Promise<void> {
  const { sprintDir } = requireSprintDir(cwd);
  const config = readConfig(sprintDir);

  if (options.enableAi && options.disableAi) {
    throw new CyaError(
      'configure-conflict',
      'Cannot use --enable-ai and --disable-ai together.',
    );
  }

  let changed = false;

  if (options.enableAi) {
    config.ai.enabled = true;
    config.ai.provider = 'claude-code';
    changed = true;
  }
  if (options.disableAi) {
    config.ai.enabled = false;
    config.ai.provider = 'none';
    changed = true;
  }
  if (options.allowDiffSummarization !== undefined) {
    config.privacy.allowDiffSummarization = options.allowDiffSummarization;
    changed = true;
  }
  if (options.allowCommandOutput !== undefined) {
    config.privacy.allowCommandOutput = options.allowCommandOutput;
    changed = true;
  }

  if (!changed) {
    console.log('Current AI configuration:');
    console.log(`  enabled:  ${config.ai.enabled}`);
    console.log(`  provider: ${config.ai.provider}`);
    console.log('');
    console.log('Privacy:');
    console.log(`  allowDiffSummarization: ${config.privacy.allowDiffSummarization}`);
    console.log(`  allowCommandOutput:     ${config.privacy.allowCommandOutput}`);
    return;
  }

  await writeConfig(sprintDir, config);
  console.log('Configuration updated.');
  if (config.ai.enabled) {
    console.log('AI enabled. Claude Code will be used to generate summaries.');
  }
}
