import { existsSync, readFileSync } from 'node:fs';
import { writeFile, rename, unlink, chmod } from 'node:fs/promises';
import { join } from 'node:path';
import { CyaError } from './errors.js';

export const HOOK_NAMES = ['post-commit', 'post-merge', 'post-checkout', 'reference-transaction'] as const;
export type HookName = typeof HOOK_NAMES[number];

export const SENTINEL = '>>> cya managed hook (v0.3) - DO NOT EDIT THIS LINE <<<';
const LEGACY_SENTINEL = 'cya managed hook (v0.2)';

function hookTemplate(name: HookName): string {
  if (name === 'post-checkout') return POST_CHECKOUT_HOOK_TEMPLATE;
  if (name === 'reference-transaction') return REFERENCE_TRANSACTION_HOOK_TEMPLATE;
  return SYNC_HOOK_TEMPLATE;
}

const SYNC_HOOK_TEMPLATE = `#!/bin/sh
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

const POST_CHECKOUT_HOOK_TEMPLATE = `#!/bin/sh
# ${SENTINEL}
# Chained existing hook (if any) runs first, then cya handles checkout automation.

PRE="$(dirname "$0")/$(basename "$0").cya-pre-existing"
if [ -x "$PRE" ]; then
  "$PRE" "$@" || exit $?
fi

GIT_PID="$PPID"
if [ -z "$GIT_PID" ]; then
  GIT_PID="unknown"
fi

# Auto-track newly created branches and sync sprint memory. Failures are non-fatal.
command -v cya >/dev/null 2>&1 && \\
  cya hook post-checkout "$1" "$2" "$3" "$GIT_PID" --quiet >/dev/null 2>&1 || true
# <<< cya managed hook (v0.3) <<<
`;

const REFERENCE_TRANSACTION_HOOK_TEMPLATE = `#!/bin/sh
# ${SENTINEL}
# Chained existing hook (if any) receives the original reference update stdin.

PRE="$(dirname "$0")/$(basename "$0").cya-pre-existing"
TMPDIR_VALUE="$TMPDIR"
if [ -z "$TMPDIR_VALUE" ]; then
  TMPDIR_VALUE="/tmp"
fi
INPUT_FILE="$(mktemp "$TMPDIR_VALUE/cya-reference-transaction.XXXXXX" 2>/dev/null)"
if [ -n "$INPUT_FILE" ]; then
  cat > "$INPUT_FILE"
else
  cat >/dev/null
fi

if [ -x "$PRE" ] && [ -n "$INPUT_FILE" ]; then
  "$PRE" "$@" < "$INPUT_FILE"
  PRE_STATUS=$?
  if [ "$PRE_STATUS" -ne 0 ]; then
    rm -f "$INPUT_FILE"
    exit "$PRE_STATUS"
  fi
fi

GIT_PID="$PPID"
if [ -z "$GIT_PID" ]; then
  GIT_PID="unknown"
fi

# Remember newly created branch refs. Failures are non-fatal so we never block git.
if [ -n "$INPUT_FILE" ]; then
  command -v cya >/dev/null 2>&1 && \\
    cya hook reference-transaction "$1" "$GIT_PID" < "$INPUT_FILE" >/dev/null 2>&1 || true
  rm -f "$INPUT_FILE"
fi
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
    await writeFile(target, hookTemplate(name), 'utf8');
    await chmod(target, 0o755);
    return 'installed';
  }

  if (isManagedHook(target)) {
    await writeFile(target, hookTemplate(name), 'utf8');
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
  await writeFile(target, hookTemplate(name), 'utf8');
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
