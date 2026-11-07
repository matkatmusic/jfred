import { test } from "node:test";
import assert from "node:assert/strict";

import { runReplay, RepoState, CommitHash, Path, JSONLLine } from "./engineV3";

test("replay commits", () => {
    //use the typesafe-playground folder for 'repo'
    //use the initial commit of typesafe-playground for 'startingCommit'
    const repo: Path = "/Users/matkatmusicllc/Programming/typesafe-playground/";
    const startingCommit: CommitHash = "initial-commit";
    let repoState = checkOutRepoAt(repo, startingCommit);
    //use the 1st child commit of typesafe-playground for 'endingCommit'
    const endingCommit: CommitHash = "first-child-commit";
    const targetState = checkOutRepoAt(repo, endingCommit);
    const snapshotPaths: Path[] = []; // Add snapshot paths if needed
    const jsonlLines: JSONLLine[] = []; // Add JSONL lines if needed
    const currentState = runReplay(repoState, startingCommit, endingCommit, repo, snapshotPaths, jsonlLines);
    //only check git-tracked files for now.
    assert.equal( currentState, targetState );
});