import { existsSync } from 'node:fs';
import { mkdir, writeFile, appendFile, readFile } from 'node:fs/promises';
import { join, basename } from 'node:path';
import {
  findGitRoot,
  getSprintDir,
  getAppDataRoot,
  getRepoIdentity,
  getRepoId,
  normalizeRepoRoot,
  registerInIndex,
} from '../paths.js';
import { defaultConfig } from '../config.js';
import { initialState } from '../state.js';
import { CyaError } from '../errors.js';
import { atomicWrite } from '../io.js';

export interface InitOptions {
  force?: boolean;
  name?: string;
  storage?: 'app-data' | 'repo';
}

async function updateGitignore(repoRoot: string): Promise<void> {
  const gitignorePath = join(repoRoot, '.gitignore');
  const linesToAdd = ['.sprint/state.json', '.sprint/SPRINT.md'];

  let existing = '';
  if (existsSync(gitignorePath)) {
    existing = await readFile(gitignorePath, 'utf8');
  }

  const existingLines = new Set(existing.split('\n').map((l) => l.trim()));
  const missing = linesToAdd.filter((line) => !existingLines.has(line));

  if (missing.length > 0) {
    const addition = `\n# cya\n${missing.join('\n')}\n`;
    await appendFile(gitignorePath, addition, 'utf8');
  }
}

export async function runInit(options: InitOptions = {}, cwd = process.cwd()): Promise<void> {
  const repoRoot = findGitRoot(cwd);
  if (!repoRoot) {
    throw new CyaError(
      'not-a-git-repo',
      'Not inside a git repository. Run git init first.',
    );
  }

  const storageMode = options.storage ?? 'app-data';
  const appDataRoot = getAppDataRoot();

  let sprintDir: string;
  let repoId: string;

  if (storageMode === 'app-data') {
    const identity = getRepoIdentity(repoRoot);
    repoId = getRepoId(identity);
    sprintDir = join(appDataRoot, 'repos', repoId);
  } else {
    sprintDir = getSprintDir(repoRoot);
    const identity = getRepoIdentity(repoRoot);
    repoId = getRepoId(identity);
  }

  if (existsSync(sprintDir) && !options.force) {
    throw new CyaError(
      'already-initialized',
      storageMode === 'app-data'
        ? 'Sprint storage already exists. Use --force to reinitialize.'
        : '.sprint/ already exists. Use --force to reinitialize.',
    );
  }

  // Register in index before creating files.
  await registerInIndex(repoRoot, storageMode, appDataRoot);

  await mkdir(sprintDir, { recursive: true });
  await mkdir(join(sprintDir, 'tickets'), { recursive: true });

  const name = options.name ?? basename(repoRoot);
  const config = {
    ...defaultConfig(name),
    storage: {
      mode: storageMode,
      repoRoot: normalizeRepoRoot(repoRoot),
      repoId,
    },
  };
  await atomicWrite(join(sprintDir, 'config.json'), JSON.stringify(config, null, 2) + '\n');

  // Preserve events.jsonl on --force: it is the source of truth.
  const eventsPath = join(sprintDir, 'events.jsonl');
  if (!existsSync(eventsPath)) {
    await writeFile(eventsPath, '', 'utf8');
  }

  await atomicWrite(join(sprintDir, 'state.json'), JSON.stringify(initialState(), null, 2) + '\n');

  const sprintMd = [
    `# Sprint`,
    `_No active tickets_`,
    ``,
    `## Done`,
    `_None_`,
    ``,
    `## In Progress`,
    `_None_`,
    ``,
    `## Blockers`,
    `_None_`,
    ``,
  ].join('\n');
  await atomicWrite(join(sprintDir, 'SPRINT.md'), sprintMd);

  if (storageMode === 'repo') {
    await updateGitignore(repoRoot);
    console.log(`initialized .sprint/ at ${repoRoot}`);
    console.log(`added .sprint/state.json and .sprint/SPRINT.md to .gitignore`);
  } else {
    console.log(`initialized sprint storage at ${sprintDir}`);
  }
}
