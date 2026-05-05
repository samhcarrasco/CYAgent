import { requireSprintDir } from '../paths.js';
import { readEvents } from '../events.js';
import { reduceAll } from '../reduce.js';
import { generateStandup, type StandupFormat } from '../standup.js';
import { CyaError } from '../errors.js';
import { readConfig } from '../config.js';
import { summarizeStandup } from '../ai.js';

export async function runStandup(
  format: string | undefined,
  cwd = process.cwd(),
  options: { noAi?: boolean } = {},
): Promise<void> {
  const fmt = format ?? 'markdown';
  if (fmt !== 'markdown' && fmt !== 'slack') {
    throw new CyaError(
      'invalid-format',
      `Format must be "markdown" or "slack", got: "${fmt}".`,
    );
  }

  const { sprintDir } = requireSprintDir(cwd);
  const events = await readEvents(sprintDir);
  const state = reduceAll(events);

  const output = generateStandup(state, fmt as StandupFormat);

  if (!options.noAi) {
    try {
      const config = readConfig(sprintDir);
      if (config.ai.enabled) {
        const result = await summarizeStandup(config, {
          format: fmt as StandupFormat,
          templateOutput: output,
          state,
          privacy: config.privacy,
        });
        if (result.kind === 'summary') {
          console.log(result.text);
          return;
        }
      }
    } catch {
      // fall through to template output
    }
  }

  console.log(output);
}
