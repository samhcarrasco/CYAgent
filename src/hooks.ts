import { existsSync, readFileSync } from 'node:fs';
import { writeFile, rename, unlink, chmod } from 'node:fs/promises';
import { join } from 'node:path';
import { CyaError } from './errors.js';

export const HOOK_NAMES = ['post-commit', 'post-merge', 'post-checkout'] as const;
export type HookName = typeof HOOK_NAMES[number];

export const SENTINEL = '>>> cya managed hook (v0.3) - DO NOT EDIT THIS LINE <<<';
const LEGACY_SENTINEL = 'cya managed hook (v0.2)';

const HOOK_TEMPLATE = `#!/bin/sh
# ${SENTINEL}
# Chained existing hook (if any) runs first, then cya sync.

PRE="$(dirname "$0")/$(basename "$0").cya-pre-existing"
if [ -x "$PRE" ]; then
  "$PRE" "$@" || exit $?
fi

# Sync sprint memory. Failures are non-fatal so we never block git.
command -v cya >/dev/null 2>&1 && \\
  cya sync --source git-hook --quiet >/dev/null 2>&1 || true
# <<< cya managed hook (v0.3) <<<
`;

export function hooksDir(repoRoot: string): string {
  return join(repoRoot, '.git', 'hooks');
}

export function hookPath(repoRoot: string, name: HookName): string {
  return join(hooksDir(repoRoot), name);
}

export function backupPath(repoRoot: string, name: HookName): string {
  return join(hooksDir(repoRoot), `${name}.cya-pre-existing`);
}

export function isManagedHook(filePath: string): boolean {
  if (!existsSync(filePath)) return false;
  try {
    const content = readFileSync(filePath, 'utf8');
    return content.includes(SENTINEL) || content.includes(LEGACY_SENTINEL);
  } catch {
    return false;
  }
}

export type HookInstallResult = 'installed' | 'updated' | 'chained';

export async function installHook(repoRoot: string, name: HookName): Promise<HookInstallResult> {
  const target = hookPath(repoRoot, name);
  const backup = backupPath(repoRoot, name);

  if (!existsSync(target)) {
    await writeFile(target, HOOK_TEMPLATE, 'utf8');
    await chmod(target, 0o755);
    return 'installed';
  }

  if (isManagedHook(target)) {
    await writeFile(target, HOOK_TEMPLATE, 'utf8');
    await chmod(target, 0o755);
    return 'updated';
  }

  // Pre-existing user hook: back it up and chain.
  if (existsSync(backup)) {
    throw new CyaError(
      'hooks-backup-conflict',
      `Backup already exists at ${backup}. Remove it manually before reinstalling.`,
    );
  }
  await rename(target, backup);
  await writeFile(target, HOOK_TEMPLATE, 'utf8');
  await chmod(target, 0o755);
  return 'chained';
}

export type HookUninstallResult = 'removed' | 'restored' | 'skipped';

export async function uninstallHook(repoRoot: string, name: HookName): Promise<HookUninstallResult> {
  const target = hookPath(repoRoot, name);
  const backup = backupPath(repoRoot, name);

  if (!existsSync(target) || !isManagedHook(target)) {
    if (existsSync(backup)) {
      // Managed hook was deleted externally but backup remains; restore it.
      await rename(backup, target);
      return 'restored';
    }
    return 'skipped';
  }

  await unlink(target);

  if (existsSync(backup)) {
    await rename(backup, target);
    return 'restored';
  }

  return 'removed';
}
