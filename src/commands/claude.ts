import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { requireSprintDir, getBranchName } from '../paths.js';
import { createEvent, appendEvent } from '../events.js';
import { atomicWrite } from '../io.js';
import { CyaError } from '../errors.js';
import {
  claudeSettingsPath,
  readSettings,
  isStopHookInstalled,
  mergeStopHook,
  removeStopHook,
  stopHookSnippet,
  type ClaudeScope,
} from '../claude-settings.js';

const SLASH_COMMAND_CONTENT = `---
description: Append a short session summary to the active cya ticket
allowed-tools: Bash(cya:*)
---

Run \`cya agent status\` to find the tracked ticket on the current branch, then run:

\`cya session-note <TICKET> "<one-paragraph summary of what was done this session>"\`

Keep the summary under 500 chars. Mention decisions, blockers, and what's next. Do not include diffs or transcripts.
`;

const LOCAL_GIT_EXCLUDES = ['.claude/settings.local.json'];
const SLASH_COMMAND_GIT_EXCLUDES = ['.claude/commands/cya-note.md'];

export interface ClaudeInstallOptions {
  scope?: ClaudeScope;
  print?: boolean;
  withSlashCommands?: boolean;
}

async function ensureLocalGitExcludes(repoRoot: string, patterns: string[]): Promise<void> {
  const gitDir = join(repoRoot, '.git');
  if (!existsSync(gitDir)) return;

  const infoDir = join(gitDir, 'info');
  if (!existsSync(infoDir)) mkdirSync(infoDir, { recursive: true });

  const excludePath = join(infoDir, 'exclude');
  const existing = existsSync(excludePath) ? readFileSync(excludePath, 'utf8') : '';
  const lines = new Set(existing.split(/\r?\n/).map((line) => line.trim()));
  const additions = patterns.filter((pattern) => !lines.has(pattern));
  if (additions.length === 0) return;

  const separator = existing.length > 0 && !existing.endsWith('\n') ? '\n' : '';
  await atomicWrite(excludePath, `${existing}${separator}${additions.join('\n')}\n`);
}

export async function runClaudeInstall(
  opts: ClaudeInstallOptions = {},
  cwd = process.cwd(),
): Promise<void> {
  const scope = opts.scope ?? 'local';

  if (scope === 'project') {
    throw new CyaError(
      'claude-project-scope-disabled',
      'Claude Code hook installs are local-only. Run `cya claude install` to write .claude/settings.local.json.',
    );
  }

  if (opts.print || scope === 'user') {
    console.log(JSON.stringify(stopHookSnippet(), null, 2));
    if (scope === 'user') {
      console.log('');
      console.log('Paste the above into ~/.claude/settings.json under "hooks".');
      console.log('Or run: cya claude install  (repo-local, gitignored via .git/info/exclude)');
    }
    return;
  }

  const { repoRoot, sprintDir } = requireSprintDir(cwd);
  const settingsFile = claudeSettingsPath(repoRoot, scope);
  const settingsDir = join(repoRoot, '.claude');

  const existing = readSettings(settingsFile);

  if (isStopHookInstalled(existing)) {
    await ensureLocalGitExcludes(repoRoot, LOCAL_GIT_EXCLUDES);
    console.log('claude: Stop hook already installed.');
    return;
  }

  const merged = mergeStopHook(existing);

  if (!existsSync(settingsDir)) mkdirSync(settingsDir, { recursive: true });
  await atomicWrite(settingsFile, JSON.stringify(merged, null, 2) + '\n');
  await ensureLocalGitExcludes(repoRoot, LOCAL_GIT_EXCLUDES);

  console.log(`claude: Stop hook installed → ${settingsFile} [local (gitignored)]`);
  console.log(`claude: Hook command: cya sync --source claude-code --quiet`);

  if (opts.withSlashCommands) {
    const commandsDir = join(settingsDir, 'commands');
    if (!existsSync(commandsDir)) mkdirSync(commandsDir, { recursive: true });
    const slashPath = join(commandsDir, 'cya-note.md');
    await atomicWrite(slashPath, SLASH_COMMAND_CONTENT);
    await ensureLocalGitExcludes(repoRoot, SLASH_COMMAND_GIT_EXCLUDES);
    console.log(`claude: Slash command written → ${slashPath}`);
  }

  const branch = getBranchName(repoRoot);
  const event = createEvent({
    type: 'agent_hooks_installed',
    repoPath: repoRoot,
    branch,
    source: 'user',
    payload: { hooks: ['claude-stop'] },
  });
  await appendEvent(sprintDir, event);
}

export interface ClaudeUninstallOptions {
  scope?: 'project' | 'local';
}

export async function runClaudeUninstall(
  opts: ClaudeUninstallOptions = {},
  cwd = process.cwd(),
): Promise<void> {
  const scope = opts.scope ?? 'local';
  const { repoRoot, sprintDir } = requireSprintDir(cwd);
  const settingsFile = claudeSettingsPath(repoRoot, scope);

  if (!existsSync(settingsFile)) {
    console.log('claude: no settings file found, nothing to uninstall.');
    return;
  }

  const existing = readSettings(settingsFile);

  if (!isStopHookInstalled(existing)) {
    console.log('claude: Stop hook not found, nothing to uninstall.');
    return;
  }

  const updated = removeStopHook(existing);
  await atomicWrite(settingsFile, JSON.stringify(updated, null, 2) + '\n');
  console.log(`claude: Stop hook removed from ${settingsFile}`);

  const branch = getBranchName(repoRoot);
  const event = createEvent({
    type: 'agent_hooks_uninstalled',
    repoPath: repoRoot,
    branch,
    source: 'user',
    payload: { hooks: ['claude-stop'] },
  });
  await appendEvent(sprintDir, event);
}
