# Research Log Companion

An [Obsidian](https://obsidian.md) plugin for researchers: a lab notebook whose entries cost
nothing to write and are easy to query later. Each entry is **append-only**, **typed** (experiment,
result, decision, idea) and carries **provenance filled in automatically**: the git branch and commit
of your code (and whether the tree was dirty), the parameters from the config or job file you just
changed, the data files that changed since your last entry with size and sha256, and the figures
you just saved. Timelines, run comparisons and parameter searches are deterministic and work
offline; an optional weekly report uses a local model through [Ollama](https://ollama.com), and every
bullet it writes cites the entry it came from.

- **Two fields, everything else automatic.** You type what you ran (or what happened) and optional
  notes. The plugin appends the commit, changed parameters, changed data files and new figures.
- **Append-only.** The log note is never rewritten; the plugin only adds a block under a
  `## <date time> · <type>` heading. Edit the prose if you like: queries read the `key: value` lines.
- **Query without a model.** A timeline by week, a side-by-side diff of two runs, and a search by
  parameter value, written to a queries note you can keep and link to.
- **Reproducibility card.** One page per result with commit, repository URL, command line,
  parameters, data hashes, figures and the entry text, ready for an advisor or a paper appendix.
- **Weekly report with citations.** Summary / Results / Decisions / Open questions from the last
  seven days (or since the last report); every bullet links to its entry, and uncited or invented
  citations are flagged rather than hidden.
- Free and open source, MIT licensed. No accounts, no API keys, no telemetry.

## Requirements

1. Obsidian desktop, 1.7.2 or later. The plugin runs `git` and hashes files, so it is desktop only.
2. `git` on your PATH if you want commit information (everything else works without it).
3. For the weekly report only: [Ollama](https://ollama.com) running locally (or on a machine on
   your network; set the URL in settings) and a chat model, e.g. `ollama pull qwen3.5:9b` (default;
   fits a 12 GB GPU). Everything else works without Ollama.

## Usage

1. In **Settings → Research Log Companion**, add a project: a name, the log note path (default
   `Research/<name> log.md`), and optionally the absolute path of your code repository, one or more
   absolute paths of data/results folders to watch, and a figures folder inside the vault.
2. After a run, use **Log an experiment** (ribbon flask icon or command palette). Type what you ran
   and any notes; press Ctrl/Cmd+Enter. The entry is appended to the log:

   ```markdown
   ## 2026-11-07 21:14 · run
   what: baseline on the cleaned split
   repo: main @ 3f2a9c1 (dirty: 3 files)
   params: lr=3e-4, batch=64, model=resnet-18 (from configs/base.yaml)
   command: python train.py --config configs/base.yaml
   data: results/run12.csv 1.2 MB sha256:9f3cab12e4f0
   data: results/run12.ckpt 1.9 GB sha256:5be0c1a7d2e8 (first 64 MB)
   figures: ![[Research/figures/loss_run12.png]]
   notes: loss plateaued at epoch 12; try a cosine schedule next
   ```

3. Later, **Log a result**, **Log a decision** or **Log an idea** the same way. Entry ids are the
   heading text, so `[[Research/Thesis log#2026-11-07 21:14 · run]]` links to that entry from anywhere.
4. **Show project timeline**, **Compare two runs** and **Find runs by parameter** write their
   output as sections of `Research/<name> queries.md`, replacing the section when the same query
   runs again.
5. On Friday, **Write this week's report** produces `Research/<name> report 2026-W45.md`.
6. For a result you want to hand over, **Export reproducibility card**.

### Commands

| Command | What it does |
|---|---|
| Log an entry | Modal with a type picker, the two fields and (with several projects) a project picker |
| Log an experiment / Log a result / Log a decision / Log an idea | The same modal with the type preset |
| Show project timeline | Entries grouped by ISO week, newest first, with type counts; each a link to its heading |
| Compare two runs | Pick two run/result entries; a table of what differs in commit, parameters, data and figures |
| Find runs by parameter | Type `lr=3e-4 batch=64` (or a bare `lr`); lists matching entries, numbers compared by value |
| Write this week's report | Sends the period's entries to the local model; writes a report whose bullets cite entry ids |
| Export reproducibility card | One-page note for a run or result with everything needed to redo it |

### How it works

**Entries.** An entry is a `## YYYY-MM-DD HH:MM · type` heading followed by `key: value` lines
(`what`, `repo`, `params`, `command`, `data`, `figures`, `notes`); multi-line values continue on
lines indented by two spaces. Two entries in the same minute get ` · 2`, ` · 3` appended. The parser
ignores anything else in the note, so you can write freely between entries.

**Provenance sources.**

- *repo:* `git rev-parse` for the branch and short commit, `git status --porcelain` for the dirty
  count, `git remote get-url origin` for the card's repository link. Git is run with
  `child_process` in the repository folder. If git is missing or the folder is not a repository,
  the line says so and the entry is still written.
- *params:* the plugin looks at files changed since the previous entry (uncommitted changes from
  `git status`, plus `git diff --name-only <previous entry's commit>..HEAD`; when git names none,
  files in the repository newer than the previous entry) with extensions `.yaml .yml .json .toml
  .ini .cfg .env .sh .slurm`, picks the newest, and extracts up to 12 `key=value` / `key: value`
  pairs from its first 60 lines. JSON is parsed and flattened one level; TOML/INI keys are prefixed
  with their section; shell and SLURM scripts contribute `VAR=value` assignments and `--flag value`
  options, and the first `python …`/`srun …`-style line becomes `command:`.
- *data:* files in the watched folders whose modification time is later than the previous entry
  (the last 24 hours for the very first entry), newest first, capped at 25. Each gets its size and
  the first 12 hex characters of its sha256. Only the first 64 MB of a file are hashed, and the line
  says `(first 64 MB)` when that happened.
- *figures:* images (png, jpg, gif, svg, webp, pdf) in the figures folder newer than the previous
  entry, embedded with `![[...]]`.

**Queries.** Timeline, compare and find are plain functions over the parsed entries: no model, same
output for the same log. Compare marks a row `≠` when values differ; parameters compare numerically
(`3e-4` equals `0.0003`), data files by hash.

**Report.** The system prompt asks for exactly four `##` sections of bullets, each ending in a
`[[<log>#<entry id>]]` citation, and forbids inventing anything. The user message carries the
period's entries verbatim (oldest first, trimmed to the context window). The reply is checked:
citations to known ids are normalised to full links, bullets without one are marked
_(no citation)_, ids that do not exist are marked `(?)`, and the counts are shown in a callout at
the top of the report. Temperature 0.2, thinking off by default.

**Reproducibility card.** Rendered from the entry alone plus the repository remote; a dirty working
tree is called out in bold because the commit alone will not reproduce it.

## Privacy and network use

The plugin contacts only the Ollama URL you set (localhost by default), and only when you run
*Write this week's report*. It runs `git` in the repository folder you configure and reads the
data folders you list; it writes only under the project's log folder. No telemetry, no accounts.

## Development

```bash
npm install
npm run dev     # watch build → main.js
npm test        # unit tests (vitest), no Ollama or git needed
npm run build   # type-check + Obsidian review lint + production bundle
```

To release: bump `version` in `manifest.json` and `package.json`, add the version to
`versions.json`, write `release-notes/<version>.md`, commit, then push a tag named exactly
`<version>`. The release workflow builds, tests, attests and publishes the GitHub release.

`src/core/` (entries, params, git, files, provenance, timeline, compare, report, repro, notes,
Ollama client) has no Obsidian dependency; git is injected as a `runGit(args) => string` function
and the file system as an interface, so the tests run against fakes. `src/node-fs.ts` is the Node
implementation (hashing, listing, `execFileSync("git", …)`); `src/main.ts`, the modals and the
settings tab are the thin Obsidian layer.

## The Companion suite

Research Log Companion is part of the Companion suite of local-first Obsidian plugins by Tony Peonio
for students and researchers: your machine does the work, every change is a diff you approve, and
the numbers are published. The others are Local Vault Agent (local Ollama agent that searches,
compiles, edits notes), Lecture Companion (live local lecture transcription, Canvas slides, Ollama
summaries), Canvas Companion (Canvas LMS assignments, grades and announcements as notes), Exam
Companion (day-by-day study plan, daily quizzes and flashcards), Paper Companion (Zotero search by
meaning, page-cited reading notes), Job Hunt Companion (job applications as notes, resume tailoring,
interview questions), Fellowship Companion (grants and fellowships: deadlines, materials, letters,
eligibility), Code Companion (commits in the daily note, weekly report, TODOs), Teaching Companion
(local-model rubric grading with verbatim evidence) and Branching Table of Contents (parent/child
properties as a rooted family tree). All at [github.com/TonyPeonio](https://github.com/TonyPeonio).

## License

MIT
