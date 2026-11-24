// Makes the inverse repo of a linear git repo: commit 0 is the source HEAD state; each next commit reverts one source commit, newest source commit first.

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { Path, Uuid } from "../src/structures/domain.ts";
import { runJfredGit } from "../src/viewer_api_layer1_jfred_git.ts";
import type { CommitHash } from "./engineV3.ts";

const INVERSE_IDENTITY_NAME = "make inverse repo";
const INVERSE_IDENTITY_EMAIL = "make-inverse-repo@jfred.invalid";
const FIELD_SEPARATOR = "\x1f";

type SourceCommit = { commitHash: CommitHash; parentHash: CommitHash | undefined; authorSeconds: number; subject: string };

// Newest first. Throws when a commit has 2 or more parents.
function listSourceCommitsNewestFirst(sourceRepo: Path): SourceCommit[] {
    const format = ["%H", "%P", "%at", "%s"].join("%x1f");
    const output = runJfredGit(sourceRepo, ["log", `--format=${format}`, "HEAD"]);
    const sourceCommits: SourceCommit[] = [];
    for (const line of output.split("\n")) {
        const [commitHash, parentsText, authorSeconds, subject] = line.split(FIELD_SEPARATOR);
        if (commitHash === undefined || parentsText === undefined || authorSeconds === undefined || subject === undefined) {
            throw new Error(`listSourceCommitsNewestFirst: cannot read the git log line: ${line}`);
        }
        const parentHashes = parentsText === "" ? [] : parentsText.split(" ");
        if (parentHashes.length > 1) {
            throw new Error(`listSourceCommitsNewestFirst: commit ${commitHash} has ${parentHashes.length} parents; only linear history is supported`);
        }
        const parentHash = parentHashes[0] === undefined ? undefined : new Uuid(parentHashes[0]);
        sourceCommits.push({ commitHash: new Uuid(commitHash), parentHash, authorSeconds: Number(authorSeconds), subject });
    }
    return sourceCommits;
}

function createEmptyBareRepo(): Path {
    const repoFolder = new Path(mkdtempSync(join(tmpdir(), "make-inverse-repo-")));
    runJfredGit(repoFolder, ["init", "-q", "--bare"]);
    return repoFolder;
}

// Copies every object of the source HEAD history, so the inverse commits can use the source trees.
function copySourceObjects(inverseRepo: Path, sourceRepo: Path): void {
    runJfredGit(inverseRepo, ["fetch", "-q", sourceRepo.toString(), "HEAD"]);
}

function getTreeHash(repo: Path, commitHash: CommitHash): Uuid {
    return new Uuid(runJfredGit(repo, ["rev-parse", `${commitHash.toString()}^{tree}`]));
}

function writeEmptyTree(repo: Path): Uuid {
    return new Uuid(runJfredGit(repo, ["mktree"], { input: "" }));
}

function writeInverseCommit(inverseRepo: Path, treeHash: Uuid, parentHash: CommitHash | undefined, message: string, authorSeconds: number): CommitHash {
    const dateText = `${authorSeconds} +0000`;
    const args = ["-c", "commit.gpgsign=false", "commit-tree", treeHash.toString()];
    if (parentHash !== undefined) {
        args.push("-p", parentHash.toString());
    }
    args.push("-m", message);
    const env = {
        GIT_AUTHOR_NAME: INVERSE_IDENTITY_NAME,
        GIT_AUTHOR_EMAIL: INVERSE_IDENTITY_EMAIL,
        GIT_AUTHOR_DATE: dateText,
        GIT_COMMITTER_NAME: INVERSE_IDENTITY_NAME,
        GIT_COMMITTER_EMAIL: INVERSE_IDENTITY_EMAIL,
        GIT_COMMITTER_DATE: dateText,
    };
    return new Uuid(runJfredGit(inverseRepo, args, { env }));
}

// The tree that holds only filePath, as it is in the source commit; the empty tree when the file is absent there.
function writeSingleFileTree(inverseRepo: Path, sourceRepo: Path, commitHash: CommitHash, filePath: Path): Uuid {
    const entryText = runJfredGit(sourceRepo, ["ls-tree", commitHash.toString(), "--", filePath.toString()]);
    if (entryText === "") {
        return writeEmptyTree(inverseRepo);
    }
    const [modeAndType, entryPath] = entryText.split("\t");
    const [mode, objectType, blobHash] = (modeAndType ?? "").split(" ");
    if (objectType !== "blob" || blobHash === undefined || entryPath !== filePath.toString()) {
        throw new Error(`writeSingleFileTree: ${filePath.toString()} is not a file in ${commitHash.toString()}: ${entryText}`);
    }
    const indexFile = join(inverseRepo.toString(), "single-file-index");
    rmSync(indexFile, { force: true });
    const env = { GIT_INDEX_FILE: indexFile };
    runJfredGit(inverseRepo, ["update-index", "--add", "--cacheinfo", `${mode},${blobHash},${filePath.toString()}`], { env });
    return new Uuid(runJfredGit(inverseRepo, ["write-tree"], { env }));
}

// The whole tree of the source commit, or only the tree of filePath when it is given.
function writeStateTree(inverseRepo: Path, sourceRepo: Path, commitHash: CommitHash, filePath: Path | undefined): Uuid {
    if (filePath === undefined) {
        return getTreeHash(sourceRepo, commitHash);
    }
    return writeSingleFileTree(inverseRepo, sourceRepo, commitHash, filePath);
}

function listHashesOfCommitsThatChangeFile(sourceRepo: Path, filePath: Path): string[] {
    return runJfredGit(sourceRepo, ["log", "--format=%H", "HEAD", "--", filePath.toString()]).split("\n");
}

// With filePath: only the source commits that change that file are reverted, and every tree holds only that file.
export function makeInverseRepo(sourceRepo: Path, filePath?: Path): Path {
    let sourceCommits = listSourceCommitsNewestFirst(sourceRepo);
    const sourceHead = sourceCommits[0];
    if (sourceHead === undefined) {
        throw new Error(`makeInverseRepo: ${sourceRepo.toString()} has no commits`);
    }
    if (filePath !== undefined) {
        const hashesThatChangeFile = listHashesOfCommitsThatChangeFile(sourceRepo, filePath);
        sourceCommits = sourceCommits.filter((sourceCommit) => hashesThatChangeFile.includes(sourceCommit.commitHash.toString()));
    }
    const inverseRepo = createEmptyBareRepo();
    copySourceObjects(inverseRepo, sourceRepo);
    const emptyTreeHash = writeEmptyTree(inverseRepo);
    let inverseHead = writeInverseCommit(inverseRepo, writeStateTree(inverseRepo, sourceRepo, sourceHead.commitHash, filePath), undefined, `inverse base: state of source HEAD ${sourceHead.commitHash.toString()} ${sourceHead.subject}`, sourceHead.authorSeconds);
    for (const sourceCommit of sourceCommits) {
        let treeBeforeSourceCommit = emptyTreeHash;
        if (sourceCommit.parentHash !== undefined) {
            treeBeforeSourceCommit = writeStateTree(inverseRepo, sourceRepo, sourceCommit.parentHash, filePath);
        }
        inverseHead = writeInverseCommit(inverseRepo, treeBeforeSourceCommit, inverseHead, `revert ${sourceCommit.commitHash.toString()} ${sourceCommit.subject}`, sourceCommit.authorSeconds);
    }
    runJfredGit(inverseRepo, ["update-ref", "HEAD", inverseHead.toString()]);
    return inverseRepo;
}
