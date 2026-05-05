import { existsSync } from 'node:fs';
import { requireSprintDir, getBranchName } from '../paths.js';
import { readEvents } from '../events.js';
import { reduceAll } from '../reduce.js';
import { HOOK_NAMES, isManagedHook, hookPath, backupPath } from '../hooks.js';
import { claudeSettingsPath, readSettings, isStopHookInstalled } from '../claude-settings.js';

export async function runAgentStatus(cwd = process.cwd()): Promise<void> {
  const { repoRoot, sprintDir } = requireSprintDir(cwd);

  // Git hook status
  let allInstalled = true;
  for (const name of HOOK_NAMES) {
    const target = hookPath(repoRoot, name);
    const managed = isManagedHook(target);
    const chained = managed && existsSync(backupPath(repoRoot, name));
    const statusLabel = managed
      ? chained
        ? 'installed (chained)'
        : 'installed (cya v0.3)'
      : 'not installed';
    console.log(`  ${name}: ${statusLabel}`);
    if (!managed) allInstalled = false;
  }
  console.log(`Hooks installed: ${allInstalled ? 'yes' : 'no'}`);

  // Claude Code hook status
  const projectSettings = readSettings(claudeSettingsPath(repoRoot, 'project'));
  const localSettings = readSettings(claudeSettingsPath(repoRoot, 'local'));
  let claudeHookStatus = 'not installed';
  if (isStopHookInstalled(projectSettings)) {
    claudeHookStatus = 'installed (project)';
  } else if (isStopHookInstalled(localSettings)) {
    claudeHookStatus = 'installed (local)';
  }
  console.log(`Claude Code hook: ${claudeHookStatus}`);

  // Last sync info from state
  const events = await readEvents(sprintDir);
  const state = reduceAll(events);

  console.log(`Last sync at: ${state.lastSyncAt ?? 'never'}`);
  console.log(`Last sync source: ${state.lastSyncSource ?? 'n/a'}`);

  // Session summary count across all tickets
  const allSessions = Object.values(state.tickets).flatMap((t) => t.sessions);
  console.log(`Claude session summaries this sprint: ${allSessions.length}`);
  if (allSessions.length > 0) {
    const latest = allSessions.reduce((a, b) => (a.timestamp > b.timestamp ? a : b));
    const ticketId = Object.entries(state.tickets).find(([, t]) =>
      t.sessions.some((s) => s.id === latest.id),
    )?.[0];
    console.log(`Last session summary: ${ticketId ?? '?'} @ ${latest.timestamp}`);
  }

  // Current branch + tracked ticket
  const branch = getBranchName(repoRoot);
  console.log(`Current branch: ${branch ?? '(detached HEAD)'}`);

  const matching = branch
    ? Object.values(state.tickets).filter((t) => t.branch === branch)
    : [];
  if (matching.length === 1) {
    console.log(`Tracked ticket on this branch: ${matching[0].id}`);
  } else if (matching.length === 0) {
    console.log(`Tracked ticket on this branch: none`);
  } else {
    console.log(`Tracked ticket on this branch: ambiguous (${matching.length} tickets)`);
  }

  // Unassigned commits
  const unassigned = state.unassignedCommits;
  console.log(`Unassigned commits: ${unassigned.length}`);
  const preview = unassigned.slice(-5).reverse();
  for (const c of preview) {
    console.log(`  ${c.shortSha} ${c.message}`);
  }
}
