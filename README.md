```text
┌──────────────────────────────────────────────────────────────┐
│ local-first sprint memory for software engineers             │
└──────────────────────────────────────────────────────────────┘
```

CYA is an append-only work memory for git-backed development. It tracks tickets,
captures decisions, attaches commits, summarizes Claude Code sessions, and turns
the whole thing into standup or performance review notes.

# Quick start

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

CYA automatically starts tracking the new branch as ticket `AUTH-123` with title
`session expiry`. Only commits made after tracking starts are attached — old repo
history is excluded.

Add context as you go:

```sh
cya note AUTH-123 "Refresh fails after Redis evicts the token" --type discovery
cya note AUTH-123 "Keep refresh tokens server-side only" --type decision
```

When you delete the branch, CYA automatically marks the ticket done:

```sh
git branch -d AUTH-123-session-expiry
# → AUTH-123 marked done (source: git-hook)
```

Or close it manually with a note:

```sh
cya done AUTH-123 --note "Merged behind the session-refresh flag"
```

Generate updates at any time:

```sh
cya status
cya standup --format slack
cya review --since 2026-05-01 --until 2026-05-31
```

## Auto-tracking branches

CYA auto-tracks branches created and checked out in the same git operation
(`git checkout -b` or `git switch -c`). Switching to an existing branch does
nothing.

When the branch is later deleted locally, CYA finds any open ticket bound to
that branch and marks it done with a context note. Remote deletions and tags are
ignored.

`main`, `master`, `develop`, `dev`, `trunk`, `release/*`, and `hotfix/*` are
never auto-tracked.

Manual tracking is available when the branch predates hooks, is protected, or
the name doesn't match what you want:

```sh
cya track AUTH-123 "Fix session expiry"
```

Branches with a Jira-style ID (`AUTH-123-session-expiry`) use it directly.
Branches without one get a deterministic synthetic ID (`BRANCH-A1B2C3D4`).

## Storage

CYA stores an append-only event log and renders derived files from it.

| File | Role |
| --- | --- |
| `events.jsonl` | Source-of-truth event stream |
| `state.json` | Current reduced sprint state |
| `SPRINT.md` | Sprint-level markdown summary |
| `tickets/<ticket>.md` | Ticket summary with commits, evidence, sessions, notes |
| `review-*.md` | Saved review output for a date range |

Sprint data is stored in platform app-data outside the repo by default. Set
`CYA_DATA_HOME` to override. Use `cya init --storage repo` for a repo-local
`.sprint/` directory instead.

## Integrations

Install git hooks to enable auto-tracking, auto-close on deletion, and commit
sync after local git activity:

```sh
cya hooks install
```

CYA manages `post-commit`, `post-merge`, `post-checkout`, and
`reference-transaction`, chaining any existing hooks before its own automation.

Install a Claude Code Stop hook for automatic session summaries:

```sh
cya claude install
cya configure --enable-ai
```

The hook writes `.claude/settings.local.json` and stays local to your checkout.
AI is optional — template output always works without it (`--no-ai`).

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
