// A git repo with a work tree, whose commits are checked out by index (0 = oldest) so the files on disk can be compared.

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { Path, Uuid } from "../src/structures/domain.ts";
import { runJfredGit } from "../src/viewer_api_layer1_jfred_git.ts";
import type { CommitHash } from "./engineV3.ts";

export type FileState = { filePath: Path; text: string };

export class CheckedOutRepo {
    private readonly commitHashes: CommitHash[];

    constructor(readonly repoFolder: Path) {
        const hashesText = runJfredGit(repoFolder, ["rev-list", "--reverse", "HEAD"]);
        this.commitHashes = hashesText.split("\n").map((hashText) => new Uuid(hashText));
    }

    getNumCommits(): number {
        return this.commitHashes.length;
    }

    // Index 0 is the oldest commit.
    checkout(commitIndex: number): void {
        const commitHash = this.commitHashes[commitIndex];
        if (commitHash === undefined) {
            throw new Error(`CheckedOutRepo.checkout: no commit at index ${commitIndex}; the repo has ${this.commitHashes.length} commits`);
        }
        runJfredGit(this.repoFolder, ["checkout", "-q", "--detach", commitHash.toString()]);
    }

    // The files on disk now, sorted by path.
    getTreeState(): FileState[] {
        const fileNamesText = runJfredGit(this.repoFolder, ["-c", "core.quotepath=off", "ls-files"]);
        const fileNames = fileNamesText.split("\n").filter((fileName) => fileName !== "");
        return fileNames.map((fileName) => ({ filePath: new Path(fileName), text: readFileSync(join(this.repoFolder.toString(), fileName), "utf8") }));
    }
}

// The commits of makeInverseRepo: commit 0 is the project HEAD state, the last commit is the state before the first project commit.
export class InverseRepo extends CheckedOutRepo {
    // Shows the files of project commit projectCommitIndex (0 = oldest); -1 shows the state before the first project commit.
    rewindTo(projectCommitIndex: number): void {
        this.checkout(this.getNumCommits() - 2 - projectCommitIndex);
    }
}
