import { findGitRoot, getBranchName, requireSprintDir } from '../paths.js';
import { readEvents } from '../events.js';
import { reduceAll } from '../reduce.js';
import { runTrack } from './track.js';
import { runSync } from './sync.js';
import {
  branchCreationMarkersFromReferenceTransaction,
  consumeBranchCreationMarker,
  deriveAutoTrackTicket,
  recordBranchCreationMarker,
} from '../auto-track.js';

export async function runHookReferenceTransaction(
  state: string,
  gitProcessId: string,
  stdin: string,
  cwd = process.cwd(),
): Promise<void> {
  const repoRoot = findGitRoot(cwd);
  if (!repoRoot) return;

  const markers = branchCreationMarkersFromReferenceTransaction(state, gitProcessId, stdin);
  for (const marker of markers) {
    await recordBranchCreationMarker(repoRoot, marker);
  }
}

export interface HookPostCheckoutOptions {
  quiet?: boolean;
}

export async function runHookPostCheckout(
  _oldHead: string,
  newHead: string,
  flag: string,
  gitProcessId: string,
  cwd = process.cwd(),
  options: HookPostCheckoutOptions = {},
): Promise<void> {
  const { repoRoot, sprintDir } = requireSprintDir(cwd);
  const branch = getBranchName(repoRoot);

  if (branch && flag === '1') {
    const marker = await consumeBranchCreationMarker(repoRoot, branch, newHead, gitProcessId);
    if (marker) {
      const events = await readEvents(sprintDir);
      const state = reduceAll(events);
      const derived = deriveAutoTrackTicket(branch, state);
      if (derived) {
        await runTrack(derived.ticket, derived.title, repoRoot, {
          source: 'git-hook',
          baselineSha: marker.sha,
          quiet: options.quiet,
        });
      }
    }
  }

  await runSync(repoRoot, { source: 'git-hook', quiet: options.quiet });
}
