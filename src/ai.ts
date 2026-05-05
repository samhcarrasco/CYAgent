import { execFileSync } from 'node:child_process';
import type { Config } from './config.js';
import type { State } from './state.js';

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
  return `You are a software engineer writing a sprint performance review narrative. Below is a structured markdown sprint review for the period ${data.since} to ${data.until}. Rewrite it as a natural, first-person narrative (2–4 paragraphs). Lead with accomplishments, then discuss blockers and how they were resolved, then close with what remains in flight. Use concrete details (ticket IDs, specific outcomes). Do not use bullet points — write in prose.

Structured review:
${data.templateOutput}

Write only the narrative, nothing else.`;
}
