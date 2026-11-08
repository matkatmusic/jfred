# engineV3: step by step

## Start state

The typesafe-playground folder is empty. No commit exists yet.
The first commit is `6510b84` "Initial commit" (2026-10-26 14:54:57 -0700).

## Rules

- `state` is the path to a folder that lives only inside a docker container.
  The engine reads and writes the files in that folder to track the repo's contents.
- The engine runs inside the docker container. Its reads and writes are plain file calls, not docker commands.
- During the replay, the docker container has no network and sees no folders on the Mac.
- Inside the container, the `state` folder is at `/Users/matkatmusicllc/Programming/typesafe-playground`, the same path as on the Mac. So a JSONL `cwd` is a container path with no change.

## Setup (before the main loop)

1. Make a docker image that has node, git, and the engine code.
   Code today: `jfred/engineV3/Dockerfile` (line 1 to 6). It uses `node:26-slim`, adds git, and installs `tsx` 4.23.1. The image has no engine code. The script in part 2 copies the engine code into the container.
2. Start a docker container from that image. It has no network and no Mac folders. It stays alive for the whole replay.
   Code today: `jfred/engineV3/run_engineV3_in_docker.sh`. Line 11 builds the image `engine-v3:1`. Line 15 starts the container with `--network none` and `sleep infinity`. Line 16 removes the container when the script ends.
3. Copy the typesafe-playground git history and the chat logs into the container one time, with `docker cp`, before the replay starts. Put them outside the `state` folder.
   Code today: `jfred/engineV3/run_engineV3_in_docker.sh`. Line 23 copies `.git` to `/input/repo.git`. Line 25 copies each JSONL folder to the same Mac path. Lines 28 to 31 copy `src`, `webapp`, `engineV3`, and `package.json` to `/input/jfred/`. Line 37 runs `tsx /input/jfred/engineV3/engineV3_replay.ts`.
4. Inside the container, make the empty folder `/Users/matkatmusicllc/Programming/typesafe-playground`. That folder is `state`.
   The typesafe-playground git history copy from part 3 must be outside this folder, so `state` starts empty.
   Code today: the `mkdir -p` on line 18 of `jfred/engineV3/run_engineV3_in_docker.sh` makes the state folder. The function `assertSafeToReplay` (`jfred/engineV3/engineV3_replay.ts:77`) stops the CLI unless `/.dockerenv` exists and the state folder is empty.

## Main loop

This is the whole high-level algorithm. It replays every JSONL line and every commit, one event at a time.
`state = {}` means `state` starts as the empty folder from Setup part 4.

```ts
//this is the whole high-level algorithm for the whole engine to replay every JSONL line.
lastEvent = null;
state = {};
while( true ) {
    let event = getNextEvent(repoPath, jsonlsPaths, lastEvent);
    if( event == TERMINAL_EVENT )
        break;
    state = doSomethingWithEvent(state, event, repoPath, jsonlsPath, fileSnapshots, /* other params*/ );
    lastEvent = event;
}
```

Code today: the loop is `executeReplay` (`jfred/engineV3/engineV3_replay.ts:36`).
Before each event, it prints `next event: source:<repo.git path> commit:<hash>` or `next event: source:<JSONL file> line:<n>`. The function `formatEventText` (`jfred/engineV3/engineV3_replay.ts:25`) makes that text.

### `getNextEvent(repoPath, jsonlsPaths, lastEvent)`

It reads the JSONL files and the repo. It returns the next event: a JSONL line or a git commit.
It is made of these small parts:

1. Find the next commit after `lastEvent`.
   Code today: `createCommitEvents` (`jfred/engineV3/engineV3_replay_timeline.ts:53`). It calls `listCommitsFromStartToEnd` (in `jfred/engineV3/engineV3test.ts`) from the root commit to HEAD.
2. Find the next JSONL line after `lastEvent`.
   Code today: `createLineEvents` (`jfred/engineV3/engineV3_replay_timeline.ts:65`). It calls `loadMergedJSONLLines` (`jfred/engineV3/engineV3_jsonl_lines.ts:97`), which reads all lines from all JSONL files, sorted by time.
   Ruling: a JSONL line with no time takes the time of the next line that has a time. So it stays next to its neighbors in file order.
3. Return the earlier of the two.
   Code today: `mergeEventsByTime` (`jfred/engineV3/engineV3_replay_timeline.ts:83`) merges the commits and the lines into one list. `getNextEvent` (`jfred/engineV3/engineV3_replay_timeline.ts:135`) returns the event after `lastEvent`.
   Ruling: a JSONL line in the same second as a commit goes first. The line goes first when line time < commit time + 1000 ms.
4. Return `TERMINAL_EVENT` when there is no next commit and no next JSONL line.
   Code today: `TERMINAL_EVENT` (`jfred/engineV3/engineV3_replay_timeline.ts:9`). `getNextEvent` returns it at line 147.

The event type exists today: `TimelineEvent` (`jfred/engineV3/engineV3.ts:355`) is a git commit or a JSONL line, each with a time.

### `doSomethingWithEvent(state, event, ...)`

It changes `state` for one event. A git commit goes to `applyCommitToState`. A JSONL line goes to `applyJSONLLineToState`.
Code today: `doSomethingWithEvent` (`jfred/engineV3/engineV3_replay.ts:18`) does this choice.
The copies `applyCommitToState` (`jfred/engineV3/engineV3_replay_apply.ts:53`) and `applyJSONLLineToState` (`jfred/engineV3/engineV3_replay_apply.ts:123`) write into the `state` folder.
The old versions in `jfred/engineV3/engineV3.ts` (lines 76 and 335) write into `RepoState` (`jfred/src/engine_v3_repo_state.ts:9`), a list in memory.

Ruling: a partial Edit can have a "\ No newline at end of file" row. The row is not a file line. It says the row above it has no newline at its end.
- After a "+" or " " row, the new file has no final newline.
- After a "-" row only, the new file has a final newline.
- Otherwise the old file's final newline is kept.
Code today: `stripNewlineMarkerRows` (`jfred/engineV3/engineV3_replay_newline.ts:11`) removes the marker rows before the hunks are applied. `decideFinalNewline` (`jfred/engineV3/engineV3_replay_newline.ts:27`) decides if the new file ends with a newline.

Ruling: a commit can add or move a submodule pointer (git mode 160000). The engine writes the other repo's files at the pointed commit into that folder.
- It reads the submodule's git folder at `<repo.git>/modules/<path>`.
- It sets `--work-tree` to that git folder, so the `core.worktree` setting of that folder is ignored.
- A removed pointer removes the folder.
Code today: `applyChangesToState` (`jfred/engineV3/engineV3_replay_submodule.ts:98`) loops over the changes of a commit. `applyChangeToState` (`jfred/engineV3/engineV3_replay_submodule.ts:72`) sends a mode 160000 change to `applySubmoduleChangeToState` (`jfred/engineV3/engineV3_replay_submodule.ts:63`) and removes the folder for a removed pointer. `readOldSubmoduleCommit` (`jfred/engineV3/engineV3_replay_submodule.ts:52`) gives the old commit: the empty tree for an added pointer, the old pointer for a moved one. `executeGitWithoutWorkTree` (`jfred/engineV3/engineV3_replay_submodule.ts:19`) sets `--work-tree`.
Real case: commit `4ed9daa` adds `playground/typesafe-checks` at `23fe850`.

## Steps

### Step 1: the first event is commit `6510b84`

1. `getNextEvent(repoPath, jsonlsPaths, null)` checks which came first: the repo's first commit, or the oldest line in the JSONL files.
2. For this walk-through, the first event is commit `6510b84`.
   Real data agrees: `6510b84` is at 2026-10-26 14:54:57 -0700. The oldest JSONL line is at 2026-10-26 16:57:39 -0700 (`2026-10-26T23:57:39.077Z`).
3. `doSomethingWithEvent` calls `applyCommitToState(6510b84e43da6059a657e75fe091c5d334fcb299, state, <path to the typesafe-playground copy>)`.
   This writes `LICENSE` into the `state` folder. `LICENSE` is the only file in `6510b84`.

### Step 2: check for JSONL lines after commit `6510b84`

1. `getNextEvent(repoPath, jsonlsPaths, 6510b84)` checks if any JSONL line happened after `6510b84` and before the next commit.
2. Real data: no JSONL line does. The next commit `cb136ca` (2026-10-26 16:54:53 -0700) is earlier than the oldest JSONL line (16:57:39 -0700). So the next event is commit `cb136ca`.
3. `getNextEvent` returns an event that says "apply commit `cb136ca` to state".
   Code today: the commit part of `TimelineEvent` (`jfred/engineV3/engineV3.ts:355-357`) is this event: `{ type: TimelineEventKind.GitCommit; commit; timestamp }`.

### Step 3: apply commit `cb136ca`

1. `doSomethingWithEvent` gets the event "apply commit `cb136ca` to state".
2. It calls `applyCommitToState(cb136ca199e7b68336c80ae929ecbc2d9dd6e6f4, state, <path to the typesafe-playground copy>)`.
   This writes `.gitignore` into the `state` folder. `.gitignore` is the only file in `cb136ca` ("added git ignore").
3. Now the `state` folder has `LICENSE` and `.gitignore`.

### Step 4: apply commit `2716f82`

1. `getNextEvent(repoPath, jsonlsPaths, cb136ca)` returns "apply commit `2716f82` to state".
   Real data: `2716f82` is at 2026-10-26 16:57:17 -0700. That is earlier than the oldest JSONL line (16:57:39 -0700).
2. `doSomethingWithEvent` calls `applyCommitToState(2716f820d4178b02e8143b35041240e76f8466d6, state, <path to the typesafe-playground copy>)`.
   This writes `.claude/settings.json` into the `state` folder. `.claude/settings.json` is the only file in `2716f82` ("added .claude/settings.json with session taskList ID").
3. Now the `state` folder has `LICENSE`, `.gitignore`, and `.claude/settings.json`.
4. The oldest JSONL line is line 7 of `/Users/matkatmusicllc/.claude/projects/-Users-matkatmusicllc-Programming-typesafe-playground/9789f2d0-5506-4633-9117-f64471817355.jsonl`, at `2026-10-26T23:57:39.077Z`.

### Step 5: apply JSONL line 7

1. After `2716f82`, `getNextEvent` returns line 1 of the first chat.
   Lines 1 to 6 (types last-prompt, custom-title, agent-name, mode, permission-mode, bridge-session) have no time. So they take line 7's time and run right before line 7. They change no file.
   Then line 7 comes: `getNextEvent` returns "apply JSONL line 7 to state".
2. Line 7 is an `attachment` line: a system-reminder. It changes no file. `doSomethingWithEvent` leaves the `state` folder as it is.
3. Line 7 has `cwd` `/Users/matkatmusicllc/Programming/typesafe-playground`. This is the first step with a `cwd`.
   The engine converts a `cwd` to a container path with no change, because the `state` folder is at the same path inside the container. Nothing uses the converted path yet.
   Real data: every `cwd` in the typesafe-playground chat logs is inside `/Users/matkatmusicllc/Programming/typesafe-playground`. Examples: `playground/`, `playground/client`, `playground/typesafe-checks`, `.idleState`, and 5 folders in `.claude/worktrees/agent-*`.
   Code today: `chooseSandboxMount` (`jfred/src/reconstruction_script_sandbox_docker.ts:47`) uses the recorded `cwd` with no change as the container path.

### Checks after the main loop

Both checks skip the `.git` folder and the `.idleState` folder at the root of the state folder (agreed 2026-11-08). The idle-state hook rewrites `.idleState` files.

1. Check vs HEAD: the state folder is compared with the repo files at its newest commit, plus the submodule files at the pointed commit. It prints `missing from state`, `extra in state`, `different content`, then the counts.
   Code today: `compareStateToHead` (`jfred/engineV3/engineV3_replay_check.ts:75`). It calls `readExpectedHeadState` (line 56) and `addSubmoduleFilesToState` (line 43).
2. Check vs disk: the engine records every file it writes or removes.
   Code today: `recordTouchedPath` and `recordTouchedFilesUnder` (`jfred/engineV3/engineV3_replay_touched.ts`) record the paths. `writeTouchedPathsFile` writes the list.
   After the run, `run_engineV3_in_docker.sh` copies the state folder and the list out to a Mac temp folder. Then `compareStateToDisk` (`jfred/engineV3/engineV3_compare_disk.ts:29`) compares each touched file with the real Mac folder. It only reads the Mac folder. It prints the same 3 kinds of lines, then the counts, plus how many are the same.

### Real run (2026-11-07)

1. Command (from the `jfred` folder): `sh engineV3/run_engineV3_in_docker.sh /Users/matkatmusicllc/Programming/typesafe-playground /Users/matkatmusicllc/.claude/projects/-Users-matkatmusicllc-Programming-typesafe-playground /Users/matkatmusicllc/.claude/projects/-Users-matkatmusicllc-Programming-typesafe-playground-playground`
2. The first events are commits `6510b84`, `cb136ca`, `2716f82`, then lines 1 to 9 of `9789f2d0-5506-4633-9117-f64471817355.jsonl`.
3. It replays all 39,198 events (39,065 JSONL lines and 133 commits) with no error. The last event is line 1433 of `70acab65-8467-404e-8848-e7478d987dba.jsonl`.
4. Earlier stops, now fixed: an `atis-latch` line had no file and line number (event 30); a partial Edit with a "\ No newline at end of file" row (event 14,849); the submodule commit `4ed9daa` (event 36,310).
5. The script removes its docker container when the run ends (the `trap ... EXIT` line in `run_engineV3_in_docker.sh`).
6. Check vs HEAD `d927120`: 0 missing, 0 different, 70 extra. The 70 extra files are not tracked by git: the 67 worktree files and `playground/zz_tabprobe.test.ts` below, plus `.idleState/.gitignore` and `.idleState/2026-11-06-1354-70acab65.json`.
7. Check vs disk: 265 same, 0 missing, 68 extra, 1 different.
8. Failed files and causes:
   - 67 extra files in `.claude/worktrees/agent-*` (36 in `agent-a674f07f272bbee2f`, 11 in `agent-a7120163a3f6f7816`, 8 in `agent-ab7e48f2a358604dd`, 7 in `agent-a592465854ed22f14`, 5 in `agent-a73744cc80a40c30f`). Cause: a script. A Bash `git worktree remove --force` loop removed them, and Bash is not replayed yet.
   - 1 extra file: `playground/zz_tabprobe.test.ts`. Cause: a script. Bash `cp` made it and Bash `rm zz_tabprobe.test.ts` removed it.
   - 1 different file: `.idleState/2026-11-06-1354-70acab65.json`. The data is the same, but the disk copy is pretty-printed and the replay copy is the compact text from the chat's Write. No Bash command in the logs changes it. A hook probably rewrote it, outside the logs. This is not proven.
9. No failure comes from a missing `originalFile`. Scripts explain 68 of the 69 failures.

### Real .git in the state folder (built 2026-11-08)

The state folder gets a real `.git`. Later, real git commands can run in it.

1. At the start, the replay clones the copied repo into the empty state folder with no checkout. Code: `copyRepoIntoState` (`jfred/engineV3/engineV3_replay_git.ts:109`). It is called in the CLI block (`jfred/engineV3/engineV3_replay.ts:104`).
2. After each commit event, the branches and HEAD move to where the copied repo's own branch logs had them at that moment. If no log line matches the commit, the replay throws an error that names the commit. Code: `moveBranchesToCommitTime` (`jfred/engineV3/engineV3_replay_git.ts:114`).
3. After each commit event, the index (the staging list) is set to that commit with `git read-tree`. So `git status` is clean for the files of that commit. Code: the last line of `moveBranchesToCommitTime`.

`doSomethingWithEvent` calls `applyCommitToState` and then `moveBranchesToCommitTime` (`jfred/engineV3/engineV3_replay.ts:23`).

### Helper worktrees (built 2026-11-08)

The replay makes the real helper worktrees that Claude Code made.

1. A JSONL line has `type` "user". Its `tool_result` text has a line `agentId: <id>`.
2. Find the Agent `tool_use` with the same `tool_use_id`. It is earlier in the same source file.
3. If that call's input has `isolation: "worktree"`, run this in the state folder: `git worktree add -b worktree-agent-<id> .claude/worktrees/agent-<id> HEAD`.
4. Any other line stays a Skip. A line of type `api-request-blob` never makes a worktree. A blocked call has no `agentId:` text, so it makes none.

Real example: the file `7d31cfda-fb91-4f61-ba61-7031cb5484e2.jsonl` in the project `typesafe-playground`. Line 954 is the Agent call with `isolation: "worktree"`. Line 967 is the result with `agentId: a7120163a3f6f7816`. The replay runs `git worktree add -b worktree-agent-a7120163a3f6f7816 .claude/worktrees/agent-a7120163a3f6f7816 HEAD`. The base commit is `c26df65`.

Code:
- `findWorktreeAgentId` (`jfred/engineV3/engineV3_replay_worktree.ts:100`) returns the `AgentId`, or undefined.
- `addWorktreeToState` (`jfred/engineV3/engineV3_replay_worktree.ts:111`) runs the git command.
- `getJSONLLineKind` returns `JSONLLineKind.WorktreeAdd` (`jfred/engineV3/engineV3.ts:282`).
- `applyJSONLLineToState` calls `addWorktreeToState` (`jfred/engineV3/engineV3_replay_apply.ts:92`).

### Script safety gate (built 2026-11-08)

Rule: a script in the docker container may change files only in the state folder and in `/tmp`. Everything else is read-only to it.

- The Dockerfile makes a plain user `replay`. Its home is `/tmp/replay-home`. `/var/tmp` and `/run/lock` lose their other-write bit. `/private/tmp` is a link to `/tmp`, like on the Mac.
- `run_engineV3_in_docker.sh` gives the state folder to `replay` and starts the engine with `docker exec -u replay`. Every script the engine starts keeps that user. The touched-paths file is in `/tmp`.
- Tests are in `jfred/engineV3/engineV3_replay_safety.test.ts`: `test_replay_user_can_write_in_the_state_folder`, `test_replay_user_can_write_in_tmp`, `test_replay_user_can_write_in_private_tmp_and_read_it_from_tmp`, `test_container_tmp_is_not_the_mac_tmp`, `test_replay_user_cannot_write_a_file_under_input`, `test_replay_user_cannot_delete_a_file_under_input`, `test_input_tree_is_unchanged_after_a_script_tries_to_wipe_it`, `test_no_folder_outside_state_and_tmp_is_writable_by_the_replay_user`.

## Start the replay at commit C (agreed 2026-11-07, not built yet)

Today the docker replay always starts at the first commit (`readRootCommit`, `jfred/engineV3/engineV3_replay_timeline.ts:31`).
These rules let it start at any commit C.

### Rules

1. Make an empty docker container. Clone the copied repo into it (no network needed). Check out C.
2. Move every branch back to where it was at C's time. Use git's branch logs (`.git/logs/refs/heads/<branch>` and `.git/logs/HEAD`). Later commits stay in `.git` as objects, but no branch points at them until the replay reaches them.
3. Split the JSONL lines. List A has the lines before C's time. List B has the lines after it. A line in the same second as C goes in list A (the same-second rule).
4. Replay list B and the commits after C onto the files of C, in time order.
5. At a file's first mention in list B, find its newest beacon (full copy) in list A. Apply the list A changes after that beacon, in order. If the result differs from C's copy, use the result.
6. If a list A Edit's `oldString` is not found in the rebuilt file, accept C's copy when it holds that Edit's `newString`. If it does not, stop with an error.
7. If list B must change a file in place, and neither C nor list A has a full copy of it, stop with an error.
8. After each commit event, move the branches and HEAD to where git's branch logs say they were at that time. If no log entry matches the commit, stop with an error that names it.

### Example: C = `4deaeea` (real data)

1. `4deaeeac26529d5b5636c7b2016ba3a239b26bd6`, 2026-10-28 09:21:04 -0700, on branch `develop` (`.git/logs/HEAD` line 131 is "checkout: moving from master to develop", line 133 is the commit). It is commit 81 of 133. 52 commits come after it.
2. Branches at C's time, from the branch logs: `develop` = `4deaeea`, `master` = `969c556`, `WIP` = `63e8fdb`, `saved-file-ops` = `bf10f67`.
3. List A has 15,417 timed lines. List B has 15,477. Only `c5a578ce-9057-4d32-89d5-a25125e332b3.jsonl` has lines in both lists.
4. List B uses 56 files that are in `4deaeea`. For 55 of them, the newest list A copy equals `4deaeea`'s copy. For `playground/page/playground.css`, the newest list A change is an Edit with no `originalFile` (`c5a578ce-9057-4d32-89d5-a25125e332b3/subagents/agent-a9774932563d48b31.jsonl:32`); rule 5 rebuilds it from the older beacon.
5. The 25 files that list B uses, that `4deaeea` does not have and that list A has no copy of, all come from somewhere else first: a later commit (8), hooks outside the logs and only read (13), the submodule commit `4ed9daa` (2), `bun install` (1, only read), or a full Write (1).
6. The worktrees and `zz_tabprobe.test.ts` were made and removed on 2026-10-27, before `4deaeea`. So this example has none of the 69 known failures.
