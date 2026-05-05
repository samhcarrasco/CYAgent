import { spawnSync } from 'node:child_process';

export interface RawCommit {
  sha: string;
  shortSha: string;
  message: string;
  authorName: string | undefined;
  authorEmail: string | undefined;
  committedAt: string;
}

export function getHeadSha(repoRoot: string): string | undefined {
  const result = spawnSync('git', ['rev-parse', '--verify', 'HEAD'], {
    cwd: repoRoot,
    encoding: 'utf8',
  });
  if (result.status !== 0) return undefined;
  const sha = result.stdout.trim();
  return sha || undefined;
}

export function getGitLog(repoRoot: string, range?: string): RawCommit[] {
  const args = ['log', '--format=%H\x1f%h\x1f%s\x1f%an\x1f%ae\x1f%at'];
  if (range) args.push(range);

  const result = spawnSync('git', args, {
    cwd: repoRoot,
    encoding: 'utf8',
  });
  if (result.status !== 0 || !result.stdout) return [];

  const commits: RawCommit[] = [];
  for (const line of result.stdout.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const [sha, shortSha, message, authorName, authorEmail, unixTs] = trimmed.split('\x1f');
    if (!sha || !unixTs) continue;
    commits.push({
      sha,
      shortSha,
      message,
      authorName: authorName || undefined,
      authorEmail: authorEmail || undefined,
      committedAt: new Date(parseInt(unixTs, 10) * 1000).toISOString(),
    });
  }
  return commits;
}
