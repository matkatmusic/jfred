# engineV3: step by step

## Start state

The typesafe-playground folder is empty. No commit exists yet.
The first commit is `6510b84` "Initial commit" (2026-10-26 14:54:57 -0700).

## Rules

- `state` is the path to a folder that lives only inside a docker container.
  The engine reads and writes the files in that folder to track the repo's contents.
- The engine runs inside the docker container. Its reads and writes are plain file calls, not docker commands.
- During the replay, the docker container has no network and sees no folders on the Mac.

## Steps

### Step 1: write the first commit into an empty `state` folder

1. Make a docker image that has node, git, and the engine code.
   Code today: none. `jfred/src/reconstruction_script_sandbox_docker.ts` uses the image `reveng-sandbox:1`, but that image only runs one script and has no engine code.
2. Start a docker container from that image. It has no network and no Mac folders. It stays alive for the whole replay.
   Code today: none. The docker code we have starts a new container for each script, then removes it.
3. Copy the typesafe-playground git history and the chat logs into the container one time, with `docker cp`, before the replay starts.
   Code today: none.
4. Inside the container, make an empty folder. That folder is `state`.
   Code today: none.
5. Inside the container, call `applyCommitToState(6510b84e43da6059a657e75fe091c5d334fcb299, state, <path to the typesafe-playground copy>)`.
   This writes `LICENSE` into the `state` folder. `LICENSE` is the only file in `6510b84`.
   Code today: `applyCommitToState` exists in `jfred/engineV3/engineV3.ts:76`, but it writes into `RepoState` (`jfred/src/engine_v3_repo_state.ts:9`), a list in memory of file path to file bytes. It must change to write into the `state` folder.
