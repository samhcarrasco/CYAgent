import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { CyaError } from './errors.js';

export type ClaudeScope = 'project' | 'local' | 'user';

const STOP_HOOK_COMMAND = 'cya sync --source claude-code --quiet';

export interface ClaudeHookEntry {
  type: 'command';
  command: string;
}

export interface ClaudeStopMatcher {
  matcher: string;
  hooks: ClaudeHookEntry[];
}

export interface ClaudeSettings {
  hooks?: {
    Stop?: ClaudeStopMatcher[];
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

export function claudeSettingsPath(repoRoot: string, scope: 'project' | 'local'): string {
  const filename = scope === 'local' ? 'settings.local.json' : 'settings.json';
  return join(repoRoot, '.claude', filename);
}

export function readSettings(filePath: string): ClaudeSettings {
  if (!existsSync(filePath)) return {};
  const raw = readFileSync(filePath, 'utf8').trim();
  if (!raw) return {};
  try {
    return JSON.parse(raw) as ClaudeSettings;
  } catch {
    throw new CyaError(
      'claude-settings-malformed',
      `Cannot parse ${filePath} as JSON. Fix or remove it before running claude install.`,
    );
  }
}

export function isStopHookInstalled(settings: ClaudeSettings): boolean {
  const matchers = settings.hooks?.Stop ?? [];
  return matchers.some((m) =>
    m.hooks?.some((h) => h.type === 'command' && h.command.startsWith('cya sync')),
  );
}

export function mergeStopHook(settings: ClaudeSettings): ClaudeSettings {
  if (isStopHookInstalled(settings)) return settings;
  const existing = settings.hooks?.Stop ?? [];
  const newMatcher: ClaudeStopMatcher = {
    matcher: '',
    hooks: [{ type: 'command', command: STOP_HOOK_COMMAND }],
  };
  return {
    ...settings,
    hooks: {
      ...settings.hooks,
      Stop: [...existing, newMatcher],
    },
  };
}

export function removeStopHook(settings: ClaudeSettings): ClaudeSettings {
  const matchers = settings.hooks?.Stop ?? [];
  const filtered = matchers
    .map((m) => ({
      ...m,
      hooks: m.hooks.filter(
        (h) => !(h.type === 'command' && h.command.startsWith('cya sync --source claude-code')),
      ),
    }))
    .filter((m) => m.hooks.length > 0);

  const newHooks = { ...settings.hooks };
  if (filtered.length === 0) {
    delete newHooks.Stop;
  } else {
    newHooks.Stop = filtered;
  }

  if (Object.keys(newHooks).length === 0) {
    const rest = { ...settings };
    delete rest.hooks;
    return rest;
  }

  return { ...settings, hooks: newHooks };
}

export function stopHookSnippet(): ClaudeSettings {
  return {
    hooks: {
      Stop: [
        {
          matcher: '',
          hooks: [{ type: 'command', command: STOP_HOOK_COMMAND }],
        },
      ],
    },
  };
}
