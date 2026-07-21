# demo-baseline — pre-baseline reconstruction question (task 56)

A clone-ready bundle that demos the pre-baseline question UI: when a project's
`reveng-paths.json` supplies a git repo + base commit (item 46), the viewer asks —
before building the timeline — whether file states preceding the baseline commit
should be reconstructed at all.

## Run it

```sh
npm run demo:baseline
```

Open the printed URL and click into the `baseline-demo` project. The dialog appears
before the timeline:

- **Reconstruct pre-baseline states** — the full history builds, exactly as if no
  baseline were configured (the baseline commit appears as a `git baseline` node in
  the middle of the timeline).
- **Start at the baseline commit** — the engine drops every `inventory.py` revision
  the baseline supersedes; the timeline's first shown step is the baseline commit
  node, followed only by the post-commit edits.

## What's inside

- `projects/baseline-demo/ee3482f5-9efa-4827-ae72-85bc9975a9a4.jsonl` — one session
  copied from `demo/projects/s87-demo-composite/` (chosen because it records NO
  script executions — so the script-consent dialog never stacks in front of this
  demo — and edits `inventory.py` across 5 revisions).
- `file-history/ee3482f5-9efa-4827-ae72-85bc9975a9a4/` — the session's sidecar
  backups, copied from `demo/file-history/`.
- `repo.git.tar` — a one-commit git repo holding `inventory.py` at the session's
  mid-point state. `npm run demo:baseline` extracts it to
  `projects/baseline-demo/repo/` (git-ignored; the tar is the committed artifact —
  never `git add` the extracted repo).
- `projects/reveng-paths.json` — points the `baseline-demo` project at that repo +
  commit. The `repo` path is relative to the jfred root because the npm script runs
  from there.

## How the repo was recreated (reproducible recipe)

The session's revision ladder for `inventory.py` (times UTC):

| rev | changeId | timestamp |
|-----|----------|-----------|
| 0 | `971e94bac3cb2811@v2` (backup-seeded base) | 23:42:57.985 |
| 1 | `toolu_0136…` (Claude edit) | 23:42:57.986 |
| 2 | `09868d7a…` (user edit) | 23:44:01.904 |
| 3 | `toolu_01HB…` (Claude edit) | 23:44:09.283 |
| 4 | `c24c09b5…` (user edit) | 23:45:21.281 |

The baseline is the disk state after rev 2, which equals the sidecar backup blob
`971e94bac3cb2811@v4` byte-for-byte (verified: rev 2's `edited_text_file` snapshot,
line-number prefixes stripped, plus trailing newline, has the same md5). The commit
is back-dated STRICTLY between rev 2 and rev 3 — the committer date is what places
the baseline beacon in the timeline.

```sh
mkdir -p scratch/repo
cp demo/file-history/ee3482f5-9efa-4827-ae72-85bc9975a9a4/971e94bac3cb2811@v4 scratch/repo/inventory.py
cd scratch/repo && git init
git add inventory.py
GIT_AUTHOR_DATE='2026-07-17T23:44:05Z' GIT_COMMITTER_DATE='2026-07-17T23:44:05Z' \
  git -c user.name='baseline-demo' -c user.email='baseline-demo@example.com' \
  commit -m 'baseline: inventory.py as committed before the final edits'
cd ../.. && tar -cf demo-baseline/repo.git.tar -C scratch repo
```

Baseline commit: `3802acbd0a0e4aca111ab27cf503471de8cd5633`
(committer date `2026-07-17T23:44:05Z`).

The file lands at `repo/inventory.py` because the session's recorded cwd is the
repo root — `seedBaseCommitBeacon` only uses the recorded cwd for relative-path
math, so the recorded temp directory does not need to exist.
