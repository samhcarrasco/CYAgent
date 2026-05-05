import { requireSprintDir, getBranchName } from '../paths.js';
import { createEvent, appendEvent } from '../events.js';
import { HOOK_NAMES, installHook, uninstallHook } from '../hooks.js';

export async function runHooksInstall(cwd = process.cwd()): Promise<void> {
  const { repoRoot, sprintDir } = requireSprintDir(cwd);

  const installed: string[] = [];
  for (const name of HOOK_NAMES) {
    const result = await installHook(repoRoot, name);
    const suffix = result === 'chained' ? ' (chained existing → backup)' : result === 'updated' ? ' (updated)' : '';
    console.log(`hooks: ${name} ${result}${suffix}`);
    installed.push(name);
  }

  const branch = getBranchName(repoRoot);
  const event = createEvent({
    type: 'agent_hooks_installed',
    repoPath: repoRoot,
    branch,
    source: 'user',
    payload: { hooks: installed },
  });
  await appendEvent(sprintDir, event);
}

export async function runHooksUninstall(cwd = process.cwd()): Promise<void> {
  const { repoRoot, sprintDir } = requireSprintDir(cwd);

  const removed: string[] = [];
  for (const name of HOOK_NAMES) {
    const result = await uninstallHook(repoRoot, name);
    if (result === 'skipped') {
      console.log(`hooks: ${name} not managed by cya, skipping`);
    } else {
      console.log(`hooks: ${name} ${result}`);
      removed.push(name);
    }
  }

  if (removed.length > 0) {
    const branch = getBranchName(repoRoot);
    const event = createEvent({
      type: 'agent_hooks_uninstalled',
      repoPath: repoRoot,
      branch,
      source: 'user',
      payload: { hooks: removed },
    });
    await appendEvent(sprintDir, event);
  }
}
