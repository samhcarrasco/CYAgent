import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';
import { atomicWrite } from './io.js';
import { CyaError } from './errors.js';

export const ConfigSchema = z.object({
  version: z.literal(1),
  name: z.string(),
  createdAt: z.string(),
  privacy: z.object({
    allowDiffSummarization: z.boolean(),
    allowCommandOutput: z.boolean(),
  }),
  ai: z.object({
    enabled: z.boolean(),
    provider: z.enum(['none', 'claude-code']),
  }),
  storage: z
    .object({
      mode: z.enum(['app-data', 'repo']),
      repoRoot: z.string(),
      repoId: z.string(),
      originUrl: z.string().optional(),
    })
    .optional(),
});

export type Config = z.infer<typeof ConfigSchema>;

export function readConfig(sprintDir: string): Config {
  const configPath = join(sprintDir, 'config.json');
  let raw: string;
  try {
    raw = readFileSync(configPath, 'utf8');
  } catch {
    throw new CyaError('config-not-found', 'config.json not found. Run cya init first.');
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new CyaError('config-malformed', 'config.json is not valid JSON.');
  }
  const result = ConfigSchema.safeParse(parsed);
  if (!result.success) {
    const first = result.error.issues[0];
    const detail = first
      ? `${first.path.join('.') || 'root'}: ${first.message}`
      : result.error.message;
    throw new CyaError('config-invalid', `config.json is invalid — ${detail}`);
  }
  return result.data;
}

export async function writeConfig(sprintDir: string, config: Config): Promise<void> {
  await atomicWrite(join(sprintDir, 'config.json'), JSON.stringify(config, null, 2) + '\n');
}

export function defaultConfig(name: string): Omit<Config, 'storage'> {
  return {
    version: 1,
    name,
    createdAt: new Date().toISOString(),
    privacy: {
      allowDiffSummarization: false,
      allowCommandOutput: false,
    },
    ai: {
      enabled: false,
      provider: 'none',
    },
  };
}
