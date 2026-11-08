# engineV3: step by step

## Start state

The typesafe-playground folder is empty. No commit exists yet.
The first commit is `6510b84` "Initial commit" (2026-10-26 14:54:57 -0700).

## Rules

- `state` is the path to a folder that lives only inside a docker container.
  The engine reads and writes the files in that folder to track the repo's contents.
- The engine runs inside the docker container. Its reads and writes are plain file calls, not docker commands.
- During the replay, the docker container has no network and sees no folders on the Mac.

## Setup (before the main loop)

1. Make a docker image that has node, git, and the engine code.
   Code today: none. `jfred/src/reconstruction_script_sandbox_docker.ts` uses the image `reveng-sandbox:1`, but that image only runs one script and has no engine code.
2. Start a docker container from that image. It has no network and no Mac folders. It stays alive for the whole replay.
   Code today: none. The docker code we have starts a new container for each script, then removes it.
3. Copy the typesafe-playground git history and the chat logs into the container one time, with `docker cp`, before the replay starts.
   Code today: none.
4. Inside the container, make an empty folder. That folder is `state`.
   Code today: none.

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

### `getNextEvent(repoPath, jsonlsPaths, lastEvent)`

It reads the JSONL files and the repo. It returns the next event: a JSONL line or a git commit.
It is made of these small parts:

1. Find the next commit after `lastEvent`.
   Code today: `getChildCommitTowards` (`jfred/engineV3/engineV3.ts:129`), but it needs an ending commit.
2. Find the next JSONL line after `lastEvent`.
   Code today: `loadMergedJSONLLines` (`jfred/engineV3/engineV3_jsonl_lines.ts:97`) reads all lines from all JSONL files, sorted by time. `getLineNumForCommit` (`jfred/engineV3/engineV3_jsonl_lines.ts:116`) finds the first line that is later than a commit's time.
3. Return the earlier of the two.
   Code today: none. Open question: which one comes first when a commit and a JSONL line have the same time.
4. Return `TERMINAL_EVENT` when there is no next commit and no next JSONL line.
   Code today: none.

The event type exists today: `TimelineEvent` (`jfred/engineV3/engineV3.ts:355`) is a git commit or a JSONL line, each with a time.

### `doSomethingWithEvent(state, event, ...)`

It changes `state` for one event. A git commit goes to `applyCommitToState`. A JSONL line goes to `applyJSONLLineToState`.
Code today: the loop body of `createGitCommitForRange` (`jfred/engineV3/engineV3.ts:373-385`) does this choice for each event in a list.
`applyCommitToState` (`jfred/engineV3/engineV3.ts:76`) and `applyJSONLLineToState` (`jfred/engineV3/engineV3.ts:335`) write into `RepoState` (`jfred/src/engine_v3_repo_state.ts:9`), a list in memory of file path to file bytes. They must change to write into the `state` folder.

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
