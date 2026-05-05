import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Config } from '../src/config.js';
import type { State } from '../src/state.js';

vi.mock('node:child_process', () => ({
  execFileSync: vi.fn(),
}));

import { summarizeStandup, summarizeReview } from '../src/ai.js';
import { execFileSync } from 'node:child_process';

const mockExec = vi.mocked(execFileSync);

function makeConfig(overrides: Partial<Config['ai']> = {}): Config {
  return {
    version: 1,
    name: 'test',
    createdAt: '2026-01-01T00:00:00.000Z',
    privacy: { allowDiffSummarization: false, allowCommandOutput: false },
    ai: {
      enabled: true,
      provider: 'claude-code',
      ...overrides,
    },
  };
}

function makeEmptyState(): State {
  return {
    version: 2,
    lastSyncAt: null,
    lastSyncSource: null,
    tickets: {},
    unassignedCommits: [],
  };
}

function makeTicketState(): State {
  return {
    ...makeEmptyState(),
    tickets: {
      'AUTH-1': {
        id: 'AUTH-1',
        title: 'Fix login bug',
        status: 'in_progress',
        commits: [],
        evidence: [
          {
            id: 'e1',
            timestamp: '2026-01-01T00:00:00.000Z',
            command: 'npm test',
            status: 'passed',
          },
        ],
        sessions: [],
        notes: {
          blocker: [],
          followup: [],
          decision: [],
          discovery: [],
          risk: [],
          context: [],
        },
        lastUpdatedAt: '2026-01-01T00:00:00.000Z',
      },
    },
  };
}

describe('summarizeStandup', () => {
  beforeEach(() => {
    mockExec.mockReset();
  });

  it('returns skipped when ai.enabled is false', async () => {
    const config = makeConfig({ enabled: false });
    const result = await summarizeStandup(config, {
      format: 'markdown',
      templateOutput: '## Done\n_none_\n',
      state: makeEmptyState(),
      privacy: config.privacy,
    });
    expect(result.kind).toBe('skipped');
    expect(mockExec).not.toHaveBeenCalled();
  });

  it('returns skipped when provider is none', async () => {
    const config = makeConfig({ provider: 'none' });
    const result = await summarizeStandup(config, {
      format: 'markdown',
      templateOutput: '## Done\n_none_\n',
      state: makeEmptyState(),
      privacy: config.privacy,
    });
    expect(result.kind).toBe('skipped');
    expect(mockExec).not.toHaveBeenCalled();
  });

  it('returns summary when claude CLI succeeds', async () => {
    mockExec.mockReturnValueOnce('Worked on AUTH-1 login fix. No blockers.');
    const config = makeConfig();
    const result = await summarizeStandup(config, {
      format: 'markdown',
      templateOutput: '## Done\n_none_\n',
      state: makeEmptyState(),
      privacy: config.privacy,
    });
    expect(result.kind).toBe('summary');
    expect((result as { kind: 'summary'; text: string }).text).toBe(
      'Worked on AUTH-1 login fix. No blockers.',
    );
  });

  it('calls claude with -p flag and pipes prompt via stdin', async () => {
    mockExec.mockReturnValueOnce('standup text');
    const config = makeConfig();
    await summarizeStandup(config, {
      format: 'markdown',
      templateOutput: '',
      state: makeEmptyState(),
      privacy: config.privacy,
    });
    expect(mockExec).toHaveBeenCalledWith(
      'claude',
      ['-p'],
      expect.objectContaining({ input: expect.any(String) }),
    );
  });

  it('returns skipped (does not throw) when claude CLI fails', async () => {
    mockExec.mockImplementationOnce(() => {
      throw new Error('command not found: claude');
    });
    const config = makeConfig();
    const result = await summarizeStandup(config, {
      format: 'markdown',
      templateOutput: '',
      state: makeEmptyState(),
      privacy: config.privacy,
    });
    expect(result.kind).toBe('skipped');
    expect((result as { kind: 'skipped'; reason: string }).reason).toContain('claude CLI error');
  });

  it('omits command text from prompt when allowCommandOutput is false', async () => {
    mockExec.mockReturnValueOnce('standup');
    const config = makeConfig();
    await summarizeStandup(config, {
      format: 'markdown',
      templateOutput: '',
      state: makeTicketState(),
      privacy: { allowDiffSummarization: false, allowCommandOutput: false },
    });
    const prompt = (mockExec.mock.calls[0][2] as { input: string }).input;
    expect(prompt).not.toContain('npm test');
  });

  it('includes command text in prompt when allowCommandOutput is true', async () => {
    mockExec.mockReturnValueOnce('standup');
    const config = makeConfig();
    await summarizeStandup(config, {
      format: 'markdown',
      templateOutput: '',
      state: makeTicketState(),
      privacy: { allowDiffSummarization: false, allowCommandOutput: true },
    });
    const prompt = (mockExec.mock.calls[0][2] as { input: string }).input;
    expect(prompt).toContain('npm test');
  });
});

describe('summarizeReview', () => {
  beforeEach(() => {
    mockExec.mockReset();
  });

  it('returns skipped when ai.enabled is false', async () => {
    const config = makeConfig({ enabled: false });
    const result = await summarizeReview(config, {
      since: '2026-01-01',
      until: '2026-01-31',
      templateOutput: '# Review\n',
      privacy: config.privacy,
    });
    expect(result.kind).toBe('skipped');
  });

  it('returns summary on success', async () => {
    mockExec.mockReturnValueOnce('Great sprint narrative.');
    const config = makeConfig();
    const result = await summarizeReview(config, {
      since: '2026-01-01',
      until: '2026-01-31',
      templateOutput: '# Review\n',
      privacy: config.privacy,
    });
    expect(result.kind).toBe('summary');
    expect((result as { kind: 'summary'; text: string }).text).toBe('Great sprint narrative.');
  });

  it('returns skipped when claude CLI throws', async () => {
    mockExec.mockImplementationOnce(() => {
      throw new Error('Timeout');
    });
    const config = makeConfig();
    const result = await summarizeReview(config, {
      since: '2026-01-01',
      until: '2026-01-31',
      templateOutput: '# Review\n',
      privacy: config.privacy,
    });
    expect(result.kind).toBe('skipped');
  });

  it('includes structured commit messages in prompt when tickets provided', async () => {
    mockExec.mockReturnValueOnce('narrative');
    const config = makeConfig();
    await summarizeReview(config, {
      since: '2026-01-01',
      until: '2026-01-31',
      templateOutput: '# Review\n',
      privacy: config.privacy,
      tickets: [
        {
          id: 'AUTH-1',
          title: 'Fix login bug',
          status: 'done',
          commits: [
            {
              sha: 'abc1234defabc1234def',
              shortSha: 'abc1234',
              message: 'Fix the login timeout',
              committedAt: '2026-01-15T10:00:00.000Z',
              observedAt: '2026-01-15T10:00:00.000Z',
              branch: 'main',
            },
          ],
          notes: {
            blocker: [], followup: [], decision: [], discovery: [], risk: [], context: [],
          },
          commandEvidence: [],
        },
      ],
    });
    const prompt = (mockExec.mock.calls[0]![2] as { input: string }).input;
    expect(prompt).toContain('AUTH-1');
    expect(prompt).toContain('Fix the login timeout');
    expect(prompt).toContain('abc1234');
  });

  it('includes implementation evidence in prompt when provided', async () => {
    mockExec.mockReturnValueOnce('narrative');
    const config = makeConfig();
    await summarizeReview(config, {
      since: '2026-01-01',
      until: '2026-01-31',
      templateOutput: '# Review\n',
      privacy: config.privacy,
      implementationEvidence: {
        enabled: true,
        caps: {
          maxCommitsPerTicket: 10,
          maxFilesPerCommit: 20,
          maxExcerptFilesPerCommit: 3,
          maxExcerptChars: 2000,
          maxExcerptChangedLines: 100,
          maxTotalEvidenceChars: 30000,
          diffContextLines: 3,
        },
        tickets: [
          {
            ticketId: 'AUTH-1',
            commits: [
              {
                sha: 'abc1234defabc1234defabc1234defabc1234def0',
                shortSha: 'abc1234',
                message: 'Fix login',
                shortstat: '2 files changed',
                files: [{ path: 'src/auth.ts', status: 'M', additions: 10, deletions: 2 }],
                excerpts: [{ path: 'src/auth.ts', excerpt: '+const x = 1;\n', truncated: false }],
                omitted: {},
              },
            ],
          },
        ],
      },
    });
    const prompt = (mockExec.mock.calls[0]![2] as { input: string }).input;
    expect(prompt).toContain('Implementation evidence');
    expect(prompt).toContain('src/auth.ts');
    expect(prompt).toContain('2 files changed');
  });

  it('omits implementation evidence section when not provided', async () => {
    mockExec.mockReturnValueOnce('narrative');
    const config = makeConfig();
    await summarizeReview(config, {
      since: '2026-01-01',
      until: '2026-01-31',
      templateOutput: '# Review\n',
      privacy: config.privacy,
    });
    const prompt = (mockExec.mock.calls[0]![2] as { input: string }).input;
    expect(prompt).not.toContain('Implementation evidence');
  });

  it('includes anti-hallucination instructions in review prompt', async () => {
    mockExec.mockReturnValueOnce('narrative');
    const config = makeConfig();
    await summarizeReview(config, {
      since: '2026-01-01',
      until: '2026-01-31',
      templateOutput: '# Review\n',
      privacy: config.privacy,
    });
    const prompt = (mockExec.mock.calls[0]![2] as { input: string }).input;
    expect(prompt).toMatch(/does not invent|NOT invent/i);
  });

  it('does not surface raw secret literals from excerpts in prompt', async () => {
    mockExec.mockReturnValueOnce('narrative');
    const config = makeConfig();
    // Evidence contains an already-redacted excerpt (redaction happens in collectReviewEvidence)
    await summarizeReview(config, {
      since: '2026-01-01',
      until: '2026-01-31',
      templateOutput: '# Review\n',
      privacy: config.privacy,
      implementationEvidence: {
        enabled: true,
        caps: {
          maxCommitsPerTicket: 10,
          maxFilesPerCommit: 20,
          maxExcerptFilesPerCommit: 3,
          maxExcerptChars: 2000,
          maxExcerptChangedLines: 100,
          maxTotalEvidenceChars: 30000,
          diffContextLines: 3,
        },
        tickets: [
          {
            ticketId: 'T-1',
            commits: [
              {
                sha: 'a'.repeat(40),
                shortSha: 'aaaaaaa',
                message: 'Config update',
                files: [],
                excerpts: [
                  { path: 'config.ts', excerpt: '+const KEY = [REDACTED];\n', truncated: false },
                ],
                omitted: {},
              },
            ],
          },
        ],
      },
    });
    const prompt = (mockExec.mock.calls[0]![2] as { input: string }).input;
    // The redacted form appears, not the original secret
    expect(prompt).toContain('[REDACTED]');
    expect(prompt).not.toContain('supersecret');
  });
});
