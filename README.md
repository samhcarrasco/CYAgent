# CYA

Local-first sprint memory for software engineers.

CYA is an append-only work memory for git-backed development. It tracks tickets,
captures decisions, attaches commits, records session notes, and turns the whole
thing into standup or performance review notes.

## Quick start

Requirements: Node.js 20+ and Git.

Install the CLI from npm:

```sh
npm install -g cyagent
```

For local development from this checkout:

```sh
cd path/to/cya
npm install
npm run build
npm link
```

`cyagent` is the package name. Both install paths put the `cya` command on your
PATH.

Initialize CYA in the git repo you want to track:

```sh
cd path/to/work-repo
cya init
cya hooks install
```

Optional: enable Claude Code AI if you want `cya standup` and `cya review` to
ask your local `claude` CLI to rewrite the template output. Install the Claude
Code hook if you want CYA to run a quiet sync when a Claude Code session ends.
Commit tracking works without either option.

```sh
cya configure --enable-ai
cya claude install
```

Optional: allow `cya review` to read your local git diffs so the AI narrative
can reference specific files and changes instead of just ticket names.

```sh
cya configure --enable-diff-summarization
```

Create a feature branch and start working:

```sh
git checkout -b AUTH-123-session-expiry
```

CYA automatically starts tracking the new branch as ticket `AUTH-123` with title
`session expiry`. Only commits made after tracking starts are attached; old repo
history is excluded.

Add context as you go:

```sh
cya note AUTH-123 "Refresh fails after Redis evicts the token" --type discovery
cya note AUTH-123 "Keep refresh tokens server-side only" --type decision
```

When you delete the branch, CYA automatically marks the ticket done:

```sh
git branch -d AUTH-123-session-expiry
# -> AUTH-123 marked done (source: git-hook)
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

## Reviews and dates

Use `cya review` for the period you want to talk about. If you do not pass
dates, CYA reviews the last 90 days.

```sh
cya review
cya review --since 2026-05-01 --until 2026-05-31
```

Pick dates from your reporting window: the current sprint, the previous month,
or the promotion/performance review period. The output is printed and also saved
as `review-<range>.md` in CYA storage.

CYA stores both an event timestamp and the Git commit timestamp. Review ranges
currently use the CYA event timestamp, which is when the activity was recorded
by CYA. With git hooks installed, commit events are recorded immediately after
`git commit`, so that usually matches the commit date. If you run `cya sync`
later, the commit still keeps its original Git `committedAt` value, but the
review range uses the later sync event time.

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
the name does not match what you want:

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

On Windows, default storage is:

```text
%LOCALAPPDATA%\cya\repos\<repo-id>\
```

Find the repo ID in:

```text
%LOCALAPPDATA%\cya\repos\index.json
```

## Integrations

Install git hooks to enable auto-tracking, auto-close on deletion, and commit
sync after local git activity:

```sh
cya hooks install
```

CYA manages `post-commit`, `post-merge`, `post-checkout`, and
`reference-transaction`, chaining any existing hooks before its own automation.

Enable Claude Code AI for standup/review prose, and optionally install a local
Claude Code Stop hook that runs a quiet sync after Claude sessions:

```sh
cya configure --enable-ai
cya claude install
```

The hook writes `.claude/settings.local.json` and stays local to your checkout.
AI is optional: template output always works without it (`--no-ai`).

Session notes can be added manually:

```sh
cya session-note AUTH-123 "Finished the auth refresh flow and left follow-up tests."
```

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
