// The Mac had a linked worktree that no recorded command made; the replay makes it before the first command that names it.

import { existsSync, mkdirSync } from "node:fs";
import { basename, join } from "node:path";
import { Path } from "../src/structures/domain.ts";
import { executeGit } from "./engineV3.ts";

export type LinkedWorktree = { path: Path; commit: string; ignoredFolder: string };

// source = 7d31cfda-fb91-4f61-ba61-7031cb5484e2.jsonl:924 (`git worktree list` shows this folder at 85c2c39, detached); no recorded command has a `git worktree add` for it.
export const PLAYGROUND_TEST_WORKTREE: LinkedWorktree = { path: new Path("/Users/matkatmusicllc/Programming/typesafe-playground-test"), commit: "85c2c39", ignoredFolder: "playground/results" };

// The ignored folder holds what the user's own playground run wrote there on the Mac; a recorded `ls` of it must find the folder.
export function createLinkedWorktreeWhenCommandNamesIt(state: Path, command: string, worktree: LinkedWorktree): void {
  const worktreeName = basename(worktree.path.toString());
  if (command.includes(worktreeName)) {
    if (!existsSync(worktree.path.toString())) {
      executeGit(state, ["worktree", "add", "-q", "--detach", worktree.path.toString(), worktree.commit]);
      mkdirSync(join(worktree.path.toString(), worktree.ignoredFolder), { recursive: true });
    }
  }
}
