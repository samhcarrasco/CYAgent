import { execFileSync } from 'node:child_process';
import type { Config } from './config.js';
import type { State } from './state.js';
import type { ReviewTicketSummary, ReviewImplementationEvidence } from './review-evidence.js';

export type AiSummaryResult =
  | { kind: 'summary'; text: string }
  | { kind: 'skipped'; reason: string };

export interface StandupPromptData {
  format: 'markdown' | 'slack';
  templateOutput: string;
  state: State;
  privacy: Config['privacy'];
}

export interface ReviewPromptData {
  since: string;
  until: string;
  templateOutput: string;
  privacy: Config['privacy'];
  tickets?: ReviewTicketSummary[];
  implementationEvidence?: ReviewImplementationEvidence;
}

export async function summarizeStandup(
  config: Config,
  data: StandupPromptData,
): Promise<AiSummaryResult> {
  const check = shouldSkip(config);
  if (check) return check;

  return callClaude(buildStandupPrompt(data));
}

export async function summarizeReview(
  config: Config,
  data: ReviewPromptData,
): Promise<AiSummaryResult> {
  const check = shouldSkip(config);
  if (check) return check;

  return callClaude(buildReviewPrompt(data));
}

function shouldSkip(config: Config): AiSummaryResult | null {
  if (!config.ai.enabled) return { kind: 'skipped', reason: 'AI disabled in config' };
  if (config.ai.provider !== 'claude-code')
    return { kind: 'skipped', reason: `unsupported provider: ${config.ai.provider}` };
  return null;
}

function callClaude(prompt: string): AiSummaryResult {
  try {
    const text = execFileSync('claude', ['-p'], {
      input: prompt,
      encoding: 'utf8',
      timeout: 60_000,
    }).trim();
    return text ? { kind: 'summary', text } : { kind: 'skipped', reason: 'empty response' };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { kind: 'skipped', reason: `claude CLI error: ${msg}` };
  }
}

function buildStandupPrompt(data: StandupPromptData): string {
  const tickets = Object.values(data.state.tickets);
  const format =
    data.format === 'slack' ? 'plain Slack message (no markdown headers)' : 'clean markdown';

  const snapshot = tickets.map((t) => ({
    id: t.id,
    title: t.title,
    status: t.status,
    commits: t.commits.map((c) => ({ message: c.message, committedAt: c.committedAt })),
    evidence: data.privacy.allowCommandOutput
      ? t.evidence.map((e) => ({ command: e.command, status: e.status }))
      : t.evidence.map((e) => ({ status: e.status })),
    notes: {
      blocker: t.notes.blocker.map((n) => n.text),
      discovery: t.notes.discovery.map((n) => n.text),
      decision: t.notes.decision.map((n) => n.text),
      followup: t.notes.followup.map((n) => n.text),
      risk: t.notes.risk.map((n) => n.text),
    },
  }));

  return `You are a software engineer writing your daily standup update. Below is structured sprint data from a local sprint log. Generate a concise, natural-language standup in ${format} format covering: what was done, what is in progress, and any blockers. Be specific — mention ticket IDs, commit messages, and blocker details. Do not add filler phrases. Omit sections that are empty.

Sprint data:
${JSON.stringify(snapshot, null, 2)}

Template output for reference (do not copy verbatim):
${data.templateOutput}

Write only the standup text, nothing else.`;
}

function buildReviewPrompt(data: ReviewPromptData): string {
  const parts: string[] = [];

  parts.push(
    `You are a software engineer writing a performance review narrative for the period ${data.since} to ${data.until}.`,
  );
  parts.push('');
  parts.push('Write an employer-facing first-person narrative (2–4 paragraphs) that:');
  parts.push('- Leads with what was accomplished (tickets completed, features or fixes shipped)');
  parts.push(
    '- Describes how the work was implemented — mention code, tests, infrastructure, config, or documentation when the evidence supports it',
  );
  parts.push(
    '- Notes blockers, how they were resolved, and what remains in progress',
  );
  parts.push(
    '- Uses "likely", "helps", or "reduces risk of" when inferring effects from code or file changes',
  );
  parts.push(
    '- Does NOT invent metrics, customer impact, revenue, performance numbers, deployment status, or business outcomes unless they appear explicitly in the notes or evidence',
  );
  parts.push('- Does NOT use bullet points — write in flowing prose');
  parts.push('- Does NOT quote raw diff text directly');
  parts.push('');
  parts.push(
    'Ground every claim in the data below. If the data is sparse, write a shorter narrative — do not pad with vague filler.',
  );

  if (data.tickets && data.tickets.length > 0) {
    parts.push('');
    parts.push('## Structured ticket data');
    parts.push(
      JSON.stringify(
        data.tickets.map((t) => ({
          id: t.id,
          title: t.title,
          status: t.status,
          commits: t.commits.map((c) => ({
            shortSha: c.shortSha,
            message: c.message,
            committedAt: c.committedAt,
          })),
          notes: {
            blocker: t.notes.blocker.map((n) => n.text),
            decision: t.notes.decision.map((n) => n.text),
            discovery: t.notes.discovery.map((n) => n.text),
            followup: t.notes.followup.map((n) => n.text),
            risk: t.notes.risk.map((n) => n.text),
          },
          commandEvidence: t.commandEvidence,
        })),
        null,
        2,
      ),
    );
  }

  if (data.implementationEvidence) {
    parts.push('');
    parts.push('## Implementation evidence (git-derived)');
    parts.push(
      'Use the file names, stats, and excerpts below to make concrete claims about implementation scope and approach.',
    );
    parts.push(JSON.stringify(data.implementationEvidence.tickets, null, 2));
  }

  parts.push('');
  parts.push('## Template review (reference)');
  parts.push(data.templateOutput);
  parts.push('');
  parts.push('Write only the narrative, nothing else.');

  return parts.join('\n');
}
