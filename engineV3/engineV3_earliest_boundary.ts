// The earliest boundary: a commit C of a repo R is the earliest known state of every file.

import { dirname, relative } from "node:path";
import { Path, Uuid } from "../src/structures/domain.ts";
import { executeGit } from "./engineV3.ts";
import { FileEventType, createEvent, type FileEvent } from "./engineV3_replay_reverse_events.ts";

export type EarliestBoundary = { repoFolder: Path; commit: Uuid; instant: Date };
export type FileAtBoundary = { isInsideRepo: boolean; text: string | undefined };

const GITLINK_MODE = "160000";
const FILE_OUTSIDE_THE_REPO: FileAtBoundary = { isInsideRepo: false, text: undefined };

// Same seconds precision as collectGitKnownStates; a bad commit makes executeGit throw.
export function readEarliestBoundary(repoFolder: Path, commit: Uuid): EarliestBoundary {
    const fullHash = executeGit(repoFolder, ["rev-parse", "--verify", `${commit.toString()}^{commit}`]).toString("utf8").trim();
    const committerSeconds = executeGit(repoFolder, ["show", "-s", "--format=%ct", fullHash]).toString("utf8").trim();
    return { repoFolder, commit: new Uuid(fullHash), instant: new Date(Number(committerSeconds) * 1000) };
}

// The folders of a relative path from the top: "a/b/c.txt" gives "a" and "a/b".
function listParentFolders(relativePath: string): string[] {
    const parentFolders: string[] = [];
    let parentFolder = dirname(relativePath);
    while (parentFolder !== ".") {
        parentFolders.unshift(parentFolder);
        parentFolder = dirname(parentFolder);
    }
    return parentFolders;
}

function isFolderGitlinkInCommit(boundary: EarliestBoundary, folder: string): boolean {
    const treeLine = executeGit(boundary.repoFolder, ["ls-tree", boundary.commit.toString(), "--", folder]).toString("utf8");
    return treeLine.startsWith(`${GITLINK_MODE} `);
}

export function readFileTextAtBoundary(boundary: EarliestBoundary, file: Path): FileAtBoundary {
    const relativePath = relative(boundary.repoFolder.toString(), file.toString());
    if (relativePath.startsWith("..")) {
        return FILE_OUTSIDE_THE_REPO;
    }
    for (const parentFolder of listParentFolders(relativePath)) {
        if (isFolderGitlinkInCommit(boundary, parentFolder)) {
            return FILE_OUTSIDE_THE_REPO;
        }
    }
    const treeLine = executeGit(boundary.repoFolder, ["ls-tree", boundary.commit.toString(), "--", relativePath]).toString("utf8");
    if (treeLine === "") {
        return { isInsideRepo: true, text: undefined };
    }
    const text = executeGit(boundary.repoFolder, ["show", `${boundary.commit.toString()}:./${relativePath}`]).toString("utf8");
    return { isInsideRepo: true, text };
}

// events are newest first; an event with no instant (DiskNow) stays.
export function applyEarliestBoundaryToEvents(events: FileEvent[], boundary: EarliestBoundary, fileAtBoundary: FileAtBoundary): FileEvent[] {
    if (!fileAtBoundary.isInsideRepo) {
        return events;
    }
    const keptEvents: FileEvent[] = [];
    for (const event of events) {
        if (event.instant === undefined) {
            keptEvents.push(event);
        } else {
            if (event.instant.getTime() > boundary.instant.getTime()) {
                keptEvents.push(event);
            }
        }
    }
    if (fileAtBoundary.text !== undefined) {
        keptEvents.push(createEvent(FileEventType.GitCommit, boundary.instant, undefined, { commitHash: boundary.commit, bytes: fileAtBoundary.text }));
    }
    return keptEvents;
}
