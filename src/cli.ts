#!/usr/bin/env node
import { Command } from 'commander';
import { runInit } from './commands/init.js';
import { runTrack } from './commands/track.js';
import { runNote } from './commands/note.js';
import { runSync, type SyncOptions } from './commands/sync.js';
import { runRecordCommand } from './commands/record-command.js';
import { runStandup } from './commands/standup.js';
import { runAssign } from './commands/assign.js';
import { runHooksInstall, runHooksUninstall } from './commands/hooks.js';
import { runAgentStatus } from './commands/agent.js';
import { runSessionNote } from './commands/session-note.js';
import { runClaudeInstall, runClaudeUninstall } from './commands/claude.js';
import { runReview } from './commands/review.js';
import { runDone } from './commands/done.js';
import { runUnblock } from './commands/unblock.js';
import { runStatus } from './commands/status.js';
import { runConfigure } from './commands/configure.js';
import { runHookPostCheckout, runHookReferenceTransaction } from './commands/hook.js';
import { CyaError } from './errors.js';

const program = new Command();

program
  .name('cya')
  .description('Local-first sprint memory agent for software engineers')
  .version('0.3.0');

program
  .command('init')
  .description('Initialize cya sprint storage for the current git repository')
  .option('--force', 'Reinitialize even if sprint storage already exists')
  .option('--name <name>', 'Sprint or project name (defaults to repo directory name)')
  .option('--storage <mode>', 'Storage location: app-data (default) or repo')
  .action(async (options: { force?: boolean; name?: string; storage?: string }) => {
    try {
      const storage = options.storage === 'repo' ? 'repo' : 'app-data';
      await runInit({ force: options.force, name: options.name, storage });
    } catch (err) {
      handleError(err);
    }
  });

program
  .command('track')
  .description('Start tracking a ticket')
  .argument('<ticket>', 'Ticket ID (e.g. AUTH-123)')
  .argument('<title>', 'Short description of the work')
  .action(async (ticket: string, title: string) => {
    try {
      await runTrack(ticket, title);
    } catch (err) {
      handleError(err);
    }
  });

program
  .command('note')
  .description('Add a note to a tracked ticket')
  .argument('<ticket>', 'Ticket ID (e.g. AUTH-123)')
  .argument('<note>', 'Note text')
  .option('--type <kind>', 'Note type: blocker|followup|decision|discovery|risk|context')
  .action(async (ticket: string, note: string, options: { type?: string }) => {
    try {
      await runNote(ticket, note, options.type);
    } catch (err) {
      handleError(err);
    }
  });

program
  .command('session-note')
  .description('Append a session summary to a tracked ticket')
  .argument('<ticket>', 'Ticket ID (e.g. AUTH-123)')
  .argument('<summary>', 'Short summary of the session (max 2000 chars)')
  .option('--source <source>', 'Event source: claude-code|user (default: claude-code)')
  .option('--session-id <id>', 'Optional Claude session ID')
  .option('--duration-ms <ms>', 'Optional session duration in milliseconds', parseInt)
  .action(
    async (
      ticket: string,
      summary: string,
      options: { source?: string; sessionId?: string; durationMs?: number },
    ) => {
      try {
        const validSources = ['claude-code', 'user'] as const;
        const source = validSources.includes(options.source as typeof validSources[number])
          ? (options.source as 'claude-code' | 'user')
          : options.source
          ? (() => { throw new CyaError('invalid-source', `Invalid source: "${options.source}". Must be claude-code or user.`); })()
          : 'claude-code';
        await runSessionNote(ticket, summary, { source, sessionId: options.sessionId, durationMs: options.durationMs });
      } catch (err) {
        handleError(err);
      }
    },
  );

program
  .command('sync')
  .description('Sync local git commits to the sprint log')
  .option('--source <source>', 'Event source: user|git-hook|watcher|claude-code (default: user)')
  .option('--quiet', 'Suppress success output')
  .action(async (options: { source?: string; quiet?: boolean }) => {
    try {
      const validSources = ['user', 'git-hook', 'watcher', 'claude-code'] as const;
      const source = validSources.includes(options.source as typeof validSources[number])
        ? (options.source as SyncOptions['source'])
        : 'user';
      await runSync(process.cwd(), { source, quiet: options.quiet });
    } catch (err) {
      handleError(err);
    }
  });

program
  .command('record-command')
  .description('Record a test/build/lint command outcome for a ticket')
  .argument('<command>', 'Command that was run')
  .option('--status <status>', 'Outcome: passed|failed')
  .option('--ticket <ticket>', 'Ticket ID to attach the outcome to')
  .option('--exit-code <code>', 'Exit code (optional)', parseInt)
  .action(
    async (
      command: string,
      options: { status?: string; ticket?: string; exitCode?: number },
    ) => {
      try {
        await runRecordCommand(command, options.status, options.ticket, options.exitCode);
      } catch (err) {
        handleError(err);
      }
    },
  );

program
  .command('standup')
  .description('Generate a standup report from the sprint log')
  .option('--format <format>', 'Output format: markdown|slack (default: markdown)')
  .option('--no-ai', 'Force template output even when AI is enabled')
  .action(async (options: { format?: string; ai?: boolean }) => {
    try {
      await runStandup(options.format, process.cwd(), { noAi: options.ai === false });
    } catch (err) {
      handleError(err);
    }
  });

program
  .command('assign')
  .description('Attach an unassigned commit to a tracked ticket')
  .argument('<sha>', 'Commit SHA or unambiguous prefix (≥4 chars)')
  .argument('<ticket>', 'Ticket ID (e.g. AUTH-123)')
  .action(async (sha: string, ticket: string) => {
    try {
      await runAssign(sha, ticket);
    } catch (err) {
      handleError(err);
    }
  });

const hooksCmd = program
  .command('hooks')
  .description('Manage git hook integration');

hooksCmd
  .command('install')
  .description('Install cya git hooks into .git/hooks/')
  .action(async () => {
    try {
      await runHooksInstall();
    } catch (err) {
      handleError(err);
    }
  });

hooksCmd
  .command('uninstall')
  .description('Remove cya git hooks from .git/hooks/')
  .action(async () => {
    try {
      await runHooksUninstall();
    } catch (err) {
      handleError(err);
    }
  });

const internalHookCmd = program
  .command('hook')
  .description('Internal git hook entrypoints');

internalHookCmd
  .command('reference-transaction')
  .argument('<state>', 'Git reference transaction state')
  .argument('<gitProcessId>', 'Git process ID')
  .action(async (state: string, gitProcessId: string) => {
    try {
      await runHookReferenceTransaction(state, gitProcessId, await readStdin());
    } catch (err) {
      handleError(err);
    }
  });

internalHookCmd
  .command('post-checkout')
  .argument('<oldHead>', 'Previous HEAD')
  .argument('<newHead>', 'New HEAD')
  .argument('<flag>', 'Checkout flag')
  .argument('<gitProcessId>', 'Git process ID')
  .option('--quiet', 'Suppress success output')
  .action(
    async (
      oldHead: string,
      newHead: string,
      flag: string,
      gitProcessId: string,
      options: { quiet?: boolean },
    ) => {
      try {
        await runHookPostCheckout(oldHead, newHead, flag, gitProcessId, process.cwd(), {
          quiet: options.quiet,
        });
      } catch (err) {
        handleError(err);
      }
    },
  );

const agentCmd = program
  .command('agent')
  .description('Agent mode commands');

agentCmd
  .command('status')
  .description('Show agent status: hooks, last sync, branch, unassigned commits')
  .action(async () => {
    try {
      await runAgentStatus();
    } catch (err) {
      handleError(err);
    }
  });

const claudeCmd = program
  .command('claude')
  .description('Claude Code hook integration');

claudeCmd
  .command('install')
  .description('Install cya Stop hook into local Claude Code settings')
  .option('--scope <scope>', 'Settings scope: local|user (default: local)')
  .option('--print', 'Print hook JSON to stdout without writing any file')
  .option('--with-slash-commands', 'Also write local .claude/commands/cya-note.md')
  .action(
    async (options: { scope?: string; print?: boolean; withSlashCommands?: boolean }) => {
      try {
        const validScopes = ['project', 'local', 'user'] as const;
        if (options.scope && !validScopes.includes(options.scope as typeof validScopes[number])) {
          throw new CyaError(
            'invalid-scope',
            `Invalid scope: "${options.scope}". Must be local or user.`,
          );
        }
        const scope = (options.scope as 'project' | 'local' | 'user' | undefined) ?? 'local';
        await runClaudeInstall({ scope, print: options.print, withSlashCommands: options.withSlashCommands });
      } catch (err) {
        handleError(err);
      }
    },
  );

claudeCmd
  .command('uninstall')
  .description('Remove cya Stop hook from Claude Code settings')
  .option('--scope <scope>', 'Settings scope: local|project (default: local; project only cleans up legacy shared hooks)')
  .action(async (options: { scope?: string }) => {
    try {
      const validScopes = ['project', 'local'] as const;
      if (options.scope && !validScopes.includes(options.scope as typeof validScopes[number])) {
        throw new CyaError(
          'invalid-scope',
          `Invalid scope: "${options.scope}". Must be local or project.`,
        );
      }
      const scope = (options.scope as 'project' | 'local' | undefined) ?? 'local';
      await runClaudeUninstall({ scope });
    } catch (err) {
      handleError(err);
    }
  });

program
  .command('done')
  .description('Mark a ticket as done')
  .argument('<ticket>', 'Ticket ID (e.g. AUTH-123)')
  .option('--note <note>', 'Optional completion note')
  .action(async (ticket: string, options: { note?: string }) => {
    try {
      await runDone(ticket, { note: options.note });
    } catch (err) {
      handleError(err);
    }
  });

program
  .command('unblock')
  .description('Clear the blocked status on a ticket')
  .argument('<ticket>', 'Ticket ID (e.g. AUTH-123)')
  .option('--note <note>', 'Optional context note')
  .action(async (ticket: string, options: { note?: string }) => {
    try {
      await runUnblock(ticket, { note: options.note });
    } catch (err) {
      handleError(err);
    }
  });

program
  .command('status')
  .description('Show a concise sprint status summary')
  .action(async () => {
    try {
      await runStatus();
    } catch (err) {
      handleError(err);
    }
  });

program
  .command('review')
  .description('Generate a performance review summary for a date range')
  .option('--since <date>', 'Start date (YYYY-MM-DD). Defaults to 90 days ago.')
  .option('--until <date>', 'End date (YYYY-MM-DD). Defaults to today.')
  .option('--no-ai', 'Force template output even when AI is enabled')
  .action(async (options: { since?: string; until?: string; ai?: boolean }) => {
    try {
      await runReview({ since: options.since, until: options.until, noAi: options.ai === false });
    } catch (err) {
      handleError(err);
    }
  });

program
  .command('configure')
  .description('View or update cya configuration')
  .option('--enable-ai', 'Enable AI-powered summaries via Claude Code')
  .option('--disable-ai', 'Disable AI-powered summaries')
  .option('--allow-diff-summarization', 'Allow AI to see git diffs')
  .option('--allow-command-output', 'Allow AI to see command output in prompts')
  .action(
    async (options: {
      enableAi?: boolean;
      disableAi?: boolean;
      allowDiffSummarization?: boolean;
      allowCommandOutput?: boolean;
    }) => {
      try {
        await runConfigure(options);
      } catch (err) {
        handleError(err);
      }
    },
  );

function handleError(err: unknown): never {
  if (err instanceof CyaError) {
    console.error(`error [${err.code}]: ${err.message}`);
    process.exit(2);
  }
  // Unexpected — rethrow so Node prints the stack.
  throw err;
}

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
  }
  return Buffer.concat(chunks).toString('utf8');
}

program.parseAsync(process.argv).catch((err: unknown) => {
  handleError(err);
});
