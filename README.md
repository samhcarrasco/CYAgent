┌──────────────────────────────────────────────────────────────────────────────┐
│  local first sprint memory for software engineers                            │
└──────────────────────────────────────────────────────────────────────────────┘

An append-only work memory for git-backed development: track tickets, capture
decisions, attach commits, summarize Claude Code sessions,
and turn the whole thing into standup or  preformance review notes
    This is my sprint memory. It catches the context that commits leave behind.

# Quick start

Install the CLI once, then initialize CYA inside the git repo you want to track:

```sh
npm install -g cyagent
cd path/to/work-repo
cya init
```

Start tracking the branch you are working on:

```sh
git checkout -b AUTH-123-session-expiry
cya track AUTH-123 "Fix session expiry"
```

Turn on the automation. This is the main benefit of this agent: git hooks and
Claude Code hooks keep the sprint memory updated while you work, instead of
making you manually reconstruct context later.

```sh
cya hooks install
cya claude install
cya configure --enable-ai
```

By default, CYA keeps sprint data in app-data storage outside the repo. Use
`cya init --storage repo` if you want a repo-local `.sprint/` directory.

    Local-first by default — sprint data lives in app data unless you opt into
    repo-local `.sprint/` storage

    Append-only event log — `events.jsonl` is the source of truth; markdown and
    JSON summaries are rendered from it

    Git-aware tracking — tickets remember branches, and commits are attached
    automatically when the branch maps cleanly to one ticket

    Evidence-driven updates — test/build/lint outcomes, blockers, decisions,
    discoveries, and session summaries become material for standup and review

    Optional agent hooks — git and Claude Code integrations keep sync automatic
    while staying local to your checkout

Why this exists

Most sprint memory is lost in the spaces between commits: the blocker you hit,
the decision you made, the test that proved the fix, the branch that drifted
from its ticket, the AI session that got useful work done but left no artifact.

This repo is an exercise in practical engineering memory specifically in
building a small local tool that makes daily updates, performance reviews, and
handoffs easier.


How it works

Initialize CYA inside a git repository:

```sh
cya init
```

Start a ticket from the branch you are working on:

```sh
git checkout -b AUTH-123-session-expiry
cya track AUTH-123 "Fix session expiry"
```

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

Sync git commits into the sprint log:

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

Storage

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


When AI is enabled, CYA calls the local `claude` CLI to summarize structured
sprint data for `standup` and `review`. Template output is always available:

```sh
cya standup --no-ai
cya review --no-ai
```

Configuration:

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

Integrations

Git hooks can sync commits after local git activity:

```sh
cya hooks install
cya hooks uninstall
```

CYA manages `post-commit`, `post-merge`, and `post-checkout`. If an existing
hook is present, CYA backs it up and chains it before running its own sync.

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

Key design decisions

    Local-first storage: default app-data storage keeps sprint memory out of the
    repo unless you explicitly choose `--storage repo`

    Event sourcing: every meaningful action is appended to `events.jsonl`, and
    rendered files can be regenerated from the log

    Branch-bound tickets: `cya track` records the current branch so later syncs
    can attach commits without guessing from commit messages

    Unassigned commit safety: commits from unknown or ambiguous branches are
    preserved as unassigned until you run `cya assign <sha> <ticket>`

    Notes as typed evidence: blockers, follow-ups, decisions, discoveries,
    risks, and context are captured separately so summaries can stay specific

    Hook chaining: existing user hooks are preserved and run before CYA's sync

    AI as optional presentation: structured local data is useful without AI;
    Claude summaries only rewrite the output when you enable them

Commands

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

Stack

| Tool | Role |
| --- | --- |
| Node.js 20+ | Runtime |
| TypeScript | Implementation language |
| Commander | CLI command parsing |
| Zod | Event/config validation |
| Vitest | Unit tests |
| Git | Commit and branch source |
| Claude Code | Optional local summarization and Stop hook integration |

Development

```sh
npm install
npm test
npm run typecheck
npm run build
npm pack --dry-run
```

The published package includes `dist/` and this README. Run `npm run build`
before testing the packaged CLI locally.
