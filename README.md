```text
┌──────────────────────────────────────────────────────────────────────────────┐
│ local-first sprint memory for software engineers                             │
└──────────────────────────────────────────────────────────────────────────────┘
```

CYA is an append-only work memory for git-backed development. It tracks tickets,
captures decisions, attaches commits, summarizes Claude Code sessions, and turns
the whole thing into standup or performance review notes.

This is sprint memory for the context that commits leave behind.

# Quick start

Install the CLI once, then initialize CYA inside the git repo you want to track:

```sh
npm install -g cyagent
cd path/to/work-repo
cya init
cya hooks install
```

Create a feature branch and start working:

```sh
git checkout -b AUTH-123-session-expiry
```

With hooks installed, CYA automatically starts tracking newly created
non-protected branches. For `AUTH-123-session-expiry`, it creates ticket
`AUTH-123` with the title `session expiry`.

CYA starts counting commits from the point the branch begins being tracked. That
means old repo history is not pulled into the new ticket, and only commits made
after tracking starts are attached.

Optional Claude Code summaries can keep session notes and generated updates
fresh while you work:

```sh
cya claude install
cya configure --enable-ai
```

By default, CYA keeps sprint data in app-data storage outside the repo. Use
`cya init --storage repo` if you want a repo-local `.sprint/` directory.

## Auto-tracking branches

CYA auto-tracks only branches that are newly created and checked out by the same
git operation, such as `git checkout -b AUTH-123-session-expiry` or
`git switch -c AUTH-123-session-expiry`.

Simply switching to an existing branch does not create a tracked ticket.

`main` and `master` are never auto-tracked. CYA also skips `develop`, `dev`,
`trunk`, `release/*`, and `hotfix/*` by default because those branches are
usually shared or release-management branches.

Manual tracking is still useful when:

- the branch existed before hooks were installed
- you intentionally want to track work on a protected branch
- the branch name does not contain the ticket or title you want

```sh
cya track AUTH-123 "Fix session expiry"
```

If a new branch contains a Jira-style ticket ID, CYA uses it. For example,
`AUTH-123-session-expiry` becomes ticket `AUTH-123` and title `session expiry`.
If there is no ticket ID, CYA creates a deterministic branch-derived ID like
`BRANCH-A1B2C3D4` and a title from the branch name.

## How it works

Capture context while you work:

```sh
cya note AUTH-123 "Refresh fails after Redis evicts the token" --type discovery
cya note AUTH-123 "Waiting on staging credentials" --type blocker
cya unblock AUTH-123 --note "Credentials arrived"
cya note AUTH-123 "Keep refresh tokens server-side only" --type decision
```

Record evidence:

```sh
npm test
cya record-command "npm test" --status passed --ticket AUTH-123
```

Sync git commits manually when needed:

```sh
cya sync
```

Generate updates:

```sh
cya status
cya standup --format markdown
cya standup --format slack
cya review --since 2026-05-01 --until 2026-05-31
```

Close out work:

```sh
cya done AUTH-123 --note "Merged behind the session-refresh flag"
```

## Storage

CYA stores an append-only event log and renders derived files from it.

| File | Role |
| --- | --- |
| `events.jsonl` | Source-of-truth event stream |
| `state.json` | Current reduced sprint state |
| `SPRINT.md` | Sprint-level markdown summary |
| `tickets/<ticket>.md` | Ticket summary with commits, evidence, sessions, notes |
| `review-*.md` | Saved review output for a date range |

By default, sprint data is stored outside the repo:

| Platform | Default location |
| --- | --- |
| Windows | `%LOCALAPPDATA%\cya\repos\<repo-id>\` |
| macOS | `~/Library/Application Support/cya/repos/<repo-id>/` |
| Linux | `${XDG_STATE_HOME:-~/.local/state}/cya/repos/<repo-id>/` |

Set `CYA_DATA_HOME` to override the root directory.

Repo-local storage is available when you want `.sprint/` in the checkout:

```sh
cya init --storage repo
```

In repo mode, CYA adds generated `.sprint/state.json` and `.sprint/SPRINT.md`
files to `.gitignore`. Review `.sprint/` before committing repo-local memory.

## Configuration

When AI is enabled, CYA calls the local `claude` CLI to summarize structured
sprint data for `standup` and `review`. Template output is always available:

```sh
cya standup --no-ai
cya review --no-ai
```

Configuration commands:

```sh
cya configure
cya configure --enable-ai
cya configure --disable-ai
cya configure --allow-command-output
cya configure --allow-diff-summarization
```

| Command | What it does |
| --- | --- |
| `cya configure` | Shows the current AI provider and privacy settings |
| `cya configure --enable-ai` | Enables Claude Code summaries |
| `cya configure --disable-ai` | Disables AI summaries and uses template output |
| `cya configure --allow-command-output` | Allows command output to be included in AI prompts |
| `cya configure --allow-diff-summarization` | Allows git diffs to be included in AI prompts |

## Integrations

Git hooks can auto-track newly created feature branches and sync commits after
local git activity:

```sh
cya hooks install
cya hooks uninstall
```

CYA manages `post-commit`, `post-merge`, `post-checkout`, and
`reference-transaction`. If an existing hook is present, CYA backs it up and
chains it before running its own automation.

Claude Code integration installs a local Stop hook:

```sh
cya claude install
cya claude install --with-slash-commands
cya claude install --print
cya claude uninstall
```

The default install writes `.claude/settings.local.json` and excludes it through
`.git/info/exclude`, so the hook stays local to your checkout.

Session summaries are explicit:

```sh
cya session-note AUTH-123 "Refactored token refresh and added expiry coverage"
```

## Key design decisions

- Local-first storage keeps sprint memory out of the repo unless you explicitly
  choose `--storage repo`.
- Event sourcing keeps `events.jsonl` as the source of truth; rendered files can
  be regenerated from it.
- Branch-bound tickets let sync attach commits without guessing from commit
  messages.
- Baselines prevent old repo history from being attached to newly tracked work.
- Unassigned commit safety preserves commits from unknown or ambiguous branches
  until you run `cya assign <sha> <ticket>`.
- Hook chaining preserves existing user hooks and runs them before CYA's
  automation.
- AI is optional presentation; structured local data is useful without AI.

## Commands

| Command | Responsibility |
| --- | --- |
| `cya init [--name <name>] [--storage app-data\|repo] [--force]` | Initialize sprint storage |
| `cya track <ticket> <title>` | Start tracking a ticket |
| `cya note <ticket> <note> --type <kind>` | Add typed context |
| `cya unblock <ticket> [--note <note>]` | Clear blocked status |
| `cya done <ticket> [--note <note>]` | Mark work complete |
| `cya sync [--source <source>] [--quiet]` | Record new git commits |
| `cya assign <sha> <ticket>` | Attach an unassigned commit |
| `cya record-command <command> --status passed\|failed --ticket <ticket>` | Record command evidence |
| `cya session-note <ticket> <summary>` | Add a session summary |
| `cya status` | Show sprint status |
| `cya standup [--format markdown\|slack] [--no-ai]` | Generate standup output |
| `cya review [--since YYYY-MM-DD] [--until YYYY-MM-DD] [--no-ai]` | Generate review output |
| `cya hooks install\|uninstall` | Manage git hooks |
| `cya claude install\|uninstall` | Manage Claude Code hook |
| `cya agent status` | Show hook/sync/branch status |
| `cya configure` | View or update configuration |

## Stack

| Tool | Role |
| --- | --- |
| Node.js 20+ | Runtime |
| TypeScript | Implementation language |
| Commander | CLI command parsing |
| Zod | Event/config validation |
| Vitest | Unit tests |
| Git | Commit and branch source |
| Claude Code | Optional local summarization and Stop hook integration |

## Development

```sh
npm install
npm test
npm run typecheck
npm run build
npm pack --dry-run
```

The published package includes `dist/` and this README. Run `npm run build`
before testing the packaged CLI locally.
