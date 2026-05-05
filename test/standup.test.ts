import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execSync } from 'node:child_process';
import { generateStandup } from '../src/standup.js';
import { runStandup } from '../src/commands/standup.js';
import { CyaError } from '../src/errors.js';
import type { State, TicketState } from '../src/state.js';
import { setupTestAppData } from './helpers.js';

let teardown: () => void;
beforeAll(() => {
  ({ teardown } = setupTestAppData());
});
afterAll(() => teardown());

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeNote(text: string) {
  return { id: 'n1', timestamp: '2026-05-01T00:00:00.000Z', text };
}

function makeCommit(sha: string, message: string) {
  return { sha, shortSha: sha.slice(0, 7), message, committedAt: '2026-05-01T00:00:00.000Z', branch: 'main' };
}

function makeEvidence(command: string, status: 'passed' | 'failed') {
  return { id: 'e1', timestamp: '2026-05-01T00:00:00.000Z', command, status };
}

function makeTicket(id: string, title: string, overrides: Partial<TicketState> = {}): TicketState {
  return {
    id,
    title,
    branch: undefined,
    status: 'in_progress',
    commits: [],
    evidence: [],
    notes: { blocker: [], followup: [], decision: [], discovery: [], risk: [], context: [] },
    lastUpdatedAt: '2026-05-01T00:00:00.000Z',
    ...overrides,
  };
}

function makeState(tickets: TicketState[]): State {
  return {
    version: 2,
    lastSyncAt: null,
    lastSyncSource: null,
    tickets: Object.fromEntries(tickets.map((t) => [t.id, t])),
    unassignedCommits: [],
  };
}

function section(output: string, name: string): string {
  const after = output.split(name)[1] ?? '';
  // grab up to the next section heading (## or *Word*)
  return after.split(/(?:^|\n)(?:##|\*\w)/m)[0] ?? after;
}

function makeTempGitRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), 'cya-standup-test-'));
  execSync('git init', { cwd: dir, stdio: 'pipe' });
  return dir;
}

function makeTempDir(): string {
  return mkdtempSync(join(tmpdir(), 'cya-standup-test-'));
}

// ── empty standup ─────────────────────────────────────────────────────────────

describe('generateStandup — empty', () => {
  it('does not crash with no tickets', () => {
    expect(() => generateStandup(makeState([]))).not.toThrow();
  });

  it('includes all three section headers in markdown', () => {
    const out = generateStandup(makeState([]));
    expect(out).toContain('## Done');
    expect(out).toContain('## In Progress');
    expect(out).toContain('## Blockers');
  });

  it('all three sections show _none_', () => {
    const out = generateStandup(makeState([]));
    expect((out.match(/_none_/g) ?? []).length).toBe(3);
  });
});

// ── in progress ───────────────────────────────────────────────────────────────

describe('generateStandup — in progress', () => {
  it('in_progress ticket appears in In Progress section', () => {
    const out = generateStandup(makeState([makeTicket('AUTH-123', 'Fix session expiry')]));
    expect(section(out, '## In Progress')).toContain('AUTH-123');
    expect(section(out, '## In Progress')).toContain('Fix session expiry');
  });

  it('in_progress ticket does not appear in Blockers section', () => {
    const out = generateStandup(makeState([makeTicket('AUTH-123', 'Fix session expiry')]));
    expect(section(out, '## Blockers')).not.toContain('AUTH-123');
  });
});

// ── blockers ──────────────────────────────────────────────────────────────────

describe('generateStandup — blockers', () => {
  it('blocked ticket appears in Blockers section', () => {
    const out = generateStandup(
      makeState([makeTicket('AUTH-123', 'Fix session expiry', { status: 'blocked' })]),
    );
    expect(section(out, '## Blockers')).toContain('AUTH-123');
  });

  it('blocked ticket does not appear in In Progress section', () => {
    const out = generateStandup(
      makeState([makeTicket('AUTH-123', 'Fix session expiry', { status: 'blocked' })]),
    );
    expect(section(out, '## In Progress')).not.toContain('AUTH-123');
  });

  it('blocker note text appears in Blockers section', () => {
    const t = makeTicket('AUTH-123', 'Fix session expiry', {
      notes: {
        blocker: [makeNote('Need staging Redis credentials')],
        followup: [], decision: [], discovery: [], risk: [], context: [],
      },
    });
    const out = generateStandup(makeState([t]));
    expect(section(out, '## Blockers')).toContain('Need staging Redis credentials');
  });
});

// ── discovery note ────────────────────────────────────────────────────────────

describe('generateStandup — discovery note', () => {
  it('discovery note text appears as context in In Progress section', () => {
    const t = makeTicket('AUTH-123', 'Fix session expiry', {
      notes: {
        blocker: [], followup: [], decision: [],
        discovery: [makeNote('Root cause was stale cache')],
        risk: [], context: [],
      },
    });
    const out = generateStandup(makeState([t]));
    expect(section(out, '## In Progress')).toContain('Root cause was stale cache');
  });
});

// ── commit evidence ───────────────────────────────────────────────────────────

describe('generateStandup — commit evidence', () => {
  it('commit shortSha and message appear in Done section', () => {
    const t = makeTicket('AUTH-123', 'Fix session expiry', {
      commits: [makeCommit('abc1234567890', 'add regression test')],
    });
    const out = generateStandup(makeState([t]));
    const done = section(out, '## Done');
    expect(done).toContain('add regression test');
    expect(done).toContain('AUTH-123');
  });
});

// ── command evidence ──────────────────────────────────────────────────────────

describe('generateStandup — command evidence', () => {
  it('passed command appears in Done section with ✓', () => {
    const t = makeTicket('AUTH-123', 'Fix session expiry', {
      evidence: [makeEvidence('pnpm test auth', 'passed')],
    });
    const out = generateStandup(makeState([t]));
    const done = section(out, '## Done');
    expect(done).toContain('pnpm test auth');
    expect(done).toContain('✓');
  });

  it('failed command appears as context in In Progress section with ✗', () => {
    const t = makeTicket('AUTH-123', 'Fix session expiry', {
      evidence: [makeEvidence('pnpm build', 'failed')],
    });
    const out = generateStandup(makeState([t]));
    expect(section(out, '## In Progress')).toContain('pnpm build');
    expect(section(out, '## In Progress')).toContain('✗');
  });

  it('failed command does NOT appear in Blockers section', () => {
    const t = makeTicket('AUTH-123', 'Fix session expiry', {
      evidence: [makeEvidence('pnpm build', 'failed')],
    });
    const out = generateStandup(makeState([t]));
    expect(section(out, '## Blockers')).not.toContain('pnpm build');
  });
});

// ── formats ───────────────────────────────────────────────────────────────────

describe('generateStandup — formats', () => {
  const state = makeState([makeTicket('AUTH-123', 'Fix session expiry')]);

  it('markdown format uses ## headers', () => {
    const out = generateStandup(state, 'markdown');
    expect(out).toContain('## Done');
    expect(out).toContain('## In Progress');
    expect(out).toContain('## Blockers');
  });

  it('markdown format uses - bullets for items', () => {
    const out = generateStandup(state, 'markdown');
    expect(out).toContain('- AUTH-123');
  });

  it('slack format uses *Bold* headers', () => {
    const out = generateStandup(state, 'slack');
    expect(out).toContain('*Done*');
    expect(out).toContain('*In Progress*');
    expect(out).toContain('*Blockers*');
  });

  it('slack format uses • bullets for items', () => {
    const out = generateStandup(state, 'slack');
    expect(out).toContain('• AUTH-123');
  });

  it('slack format does not use ## headers', () => {
    const out = generateStandup(state, 'slack');
    expect(out).not.toContain('## ');
  });
});

// ── error handling ────────────────────────────────────────────────────────────

describe('runStandup — error handling', () => {
  let tmpDirs: string[] = [];
  afterEach(() => {
    for (const d of tmpDirs) rmSync(d, { recursive: true, force: true });
    tmpDirs = [];
  });

  it('throws invalid-format for an unrecognized format', async () => {
    const err = await runStandup('html', tmpdir()).catch((e) => e);
    expect(err).toBeInstanceOf(CyaError);
    expect((err as CyaError).code).toBe('invalid-format');
  });

  it('throws not-initialized when .sprint is missing', async () => {
    const dir = makeTempGitRepo();
    tmpDirs.push(dir);
    const err = await runStandup(undefined, dir).catch((e) => e);
    expect(err).toBeInstanceOf(CyaError);
    expect((err as CyaError).code).toBe('not-initialized');
  });

  it('throws not-a-git-repo when not in a git repository', async () => {
    const dir = makeTempDir();
    tmpDirs.push(dir);
    const err = await runStandup(undefined, dir).catch((e) => e);
    expect(err).toBeInstanceOf(CyaError);
    expect((err as CyaError).code).toBe('not-a-git-repo');
  });
});

// ── CLI stubs ─────────────────────────────────────────────────────────────────

describe('CLI stubs', () => {
  it('review and standup are real commands (not stubs)', () => {
    const src = readFileSync(
      new URL('../src/cli.ts', import.meta.url).pathname.replace(/^\/([A-Z]:)/, '$1'),
      'utf8',
    );
    const notYetMatch = src.match(/const notYet\s*=\s*\[([^\]]*)\]/);
    const notYet = notYetMatch?.[1] ?? '';
    expect(notYet).not.toContain("'review'");
    expect(notYet).not.toContain("'standup'");
  });
});
