// The Layer 1 View server surface (task 235, spec S18): what is on disk right now against what the
// repository says. A NEW path beside /api/layered-graph, not a change to it — it reads NO JSONL at
// all, which is what makes the task-238 acceptance test meaningful (it cannot accidentally pass on
// JSONL data). HTTP wiring stays in viewer_server.ts; this file parses the query, composes the five
// layer1_* modules, and serializes (precedent: viewer_api_layered.ts).

import { type ServerResponse } from "node:http";
import { existsSync, statSync } from "node:fs";
import { listPairCommitHistory } from "./layer1_commit_history.ts";
import { walkCurrentFileState, type DiskFileState } from "./layer1_disk_walk.ts";
import { pairDiskFilesAgainstRepoPaths } from "./layer1_pairing.ts";
import { ACTIVE_BRANCH_REF, listRepoTreeAtRef } from "./layer1_repo_tree.ts";
import { resolveInstantOffsets } from "./layer1_ruler_axis.ts";
import type { Instant } from "./layered_types.ts";
import { Path } from "./structures/domain.ts";
import { requireParam, sendJson } from "./viewer_server_routes.ts";

// One placed moment on the wire: the instant, plus the finished pixel offset the page emits as
// --axis-px. The S18 ruler ACCUMULATES, so an offset cannot be derived from its own instant — the
// page must be handed the number (the same contract as task 239's axisOffsetsPx).
export interface Layer1WireInstant {
    instant: Instant;
    axisPx: number;
}

// One commit node of a pair's ladder.
export interface Layer1WireCommit extends Layer1WireInstant {
    hash: string;
}

// One pair: its path relative to BOTH roots, the commits that touched it (oldest first), and its
// current on-disk state — S18's final node.
export interface Layer1WirePair {
    path: Path;
    commits: Layer1WireCommit[];
    onDisk: Layer1WireInstant;
}

// One bucket row: a path and the single instant that places it.
export interface Layer1WireOrphan extends Layer1WireInstant {
    path: Path;
}

// The Layer 1 View. `pairs`/`gitOrphans`/`diskOrphans` are task 232's property names, passed
// through UNCHANGED — the two orphan sets are mirror images, so a swap is invisible to the
// task-238 acceptance test and must never happen here (S18 "Output contract").
export interface Layer1WireView {
    pairs: Layer1WirePair[];
    gitOrphans: Layer1WireOrphan[];
    diskOrphans: Layer1WireOrphan[];
    // Every distinct instant the view draws, ascending — the page's ruler ticks.
    ruler: Layer1WireInstant[];
}

// One git-orphan path with the instant that places it, before the axis is resolved.
interface GitOrphanPlacement {
    path: Path;
    instant: Instant;
}

// One pair with its ladder, before the axis is resolved.
interface PairHistory {
    file: DiskFileState;
    commits: { hash: string; instant: Instant }[];
}

// Resolve the whole view's instants ONCE so widgets, nodes and buckets share one ruler. Keyed by
// epoch ms — the same identity resolveInstantOffsets de-duplicates on, so two Date objects for the
// same moment resolve to one offset.
function mapInstantsToOffsetPixels(instants: Instant[]): Map<number, number> {
    return new Map(resolveInstantOffsets(instants).map((position) => [position.instant.getTime(), position.offsetPx]));
}

// Place one instant on the resolved ruler. Every instant handed out below was part of the resolve
// input, so a miss is a bug in this file rather than bad input — fail loudly instead of drawing a
// node at a silent zero.
function placeInstantOnAxis(offsets: Map<number, number>, instant: Instant): Layer1WireInstant {
    const axisPx = offsets.get(instant.getTime());
    if (axisPx === undefined) {
        throw new Error(`instant ${instant.toISOString()} is missing from the resolved ruler`);
    }
    return { instant, axisPx };
}

// Each git-orphan path's placing instant: its LAST touching commit, since a repo path with no
// on-disk counterpart has no mtime and its most recent commit is the moment it last existed in the
// repo (plans/layer1-mockup.html places a repo-only row the same way).
function listGitOrphanPlacements(repoDir: Path, gitOrphans: Path[], ref: string): GitOrphanPlacement[] {
    const placements: GitOrphanPlacement[] = [];
    for (const orphanPath of gitOrphans) {
        const lastTouch = listPairCommitHistory(repoDir, orphanPath, ref).at(-1);
        // ponytail: a path git lists at `ref` always has a commit reachable from that ref, so this
        // only holds for a shallow clone whose history was truncated; such a row is dropped rather
        // than invented at a fake instant. Revisit if shallow clones become a real input.
        if (lastTouch === undefined) {
            continue;
        }
        placements.push({ path: orphanPath, instant: lastTouch.instant });
    }
    return placements;
}

// Bucket rows ascending by instant, so the bucket's placement is simply its first row's axisPx and
// the page needs no Math.min. Re-ordering rows neither renames nor inverts a bucket, so S18's
// output contract is untouched.
function orderRowsByInstant(rows: Layer1WireOrphan[]): Layer1WireOrphan[] {
    return [...rows].sort((left, right) => left.instant.getTime() - right.instant.getTime());
}

// The S18 Layer 1 View of `projectFolder` against `repoDir` at `ref`.
export function buildLayer1View(projectFolder: Path, repoDir: Path, ref: string): Layer1WireView {
    const diskFiles = walkCurrentFileState(projectFolder);
    // Runs BEFORE any history read so a bad ref throws once, from the module whose message already
    // names it, rather than degrading into empty ladders.
    const repoPaths = listRepoTreeAtRef(repoDir, ref);
    const pairing = pairDiskFilesAgainstRepoPaths(diskFiles, repoPaths);
    const pairHistories: PairHistory[] = pairing.pairs.map((file) => ({
        file,
        commits: listPairCommitHistory(repoDir, file.relativePath, ref),
    }));
    const gitOrphanPlacements = listGitOrphanPlacements(repoDir, pairing.gitOrphans, ref);
    const offsets = mapInstantsToOffsetPixels([
        ...pairHistories.flatMap((pair) => [...pair.commits.map((commit) => commit.instant), pair.file.mtime]),
        ...gitOrphanPlacements.map((placement) => placement.instant),
        ...pairing.diskOrphans.map((file) => file.mtime),
    ]);
    return {
        // Pair order is the disk walk's path order — not re-sorted.
        pairs: pairHistories.map((pair) => ({
            path: pair.file.relativePath,
            commits: pair.commits.map((commit) => ({ hash: commit.hash, ...placeInstantOnAxis(offsets, commit.instant) })),
            onDisk: placeInstantOnAxis(offsets, pair.file.mtime),
        })),
        gitOrphans: orderRowsByInstant(gitOrphanPlacements.map((placement) => ({
            path: placement.path,
            ...placeInstantOnAxis(offsets, placement.instant),
        }))),
        diskOrphans: orderRowsByInstant(pairing.diskOrphans.map((file) => ({
            path: file.relativePath,
            ...placeInstantOnAxis(offsets, file.mtime),
        }))),
        ruler: [...offsets].map(([epochMs, axisPx]) => ({ instant: new Date(epochMs), axisPx })),
    };
}

// `dir` and `repo` are pasted or typed into the header's text boxes, so both are validated here
// rather than deep in a walker: a bad one must be a 400 the page can display, not an ENOENT from
// readdirSync. Existence + is-a-folder only — this is a localhost tool reading the user's own
// machine, so there is no allowlist to enforce (the same posture as POST /api/config).
function requireExistingFolderParam(query: URLSearchParams, name: string): Path {
    const value = requireParam(query, name);
    if (!existsSync(value)) {
        throw new Error(`${name} folder does not exist: ${value}`);
    }
    if (!statSync(value).isDirectory()) {
        throw new Error(`${name} is not a folder: ${value}`);
    }
    return new Path(value);
}

// An absent ref AND an empty one both mean "the repo's active branch" — the header's ref box is
// optional, and a blank box still submits `?ref=`. A non-repo repo path and an unresolvable ref
// need no check of their own: listRepoTreeAtRef throws naming the ref, and git ls-tree's stderr
// names the non-repo case. The ref never reaches a shell (both git calls use argument arrays), so
// no validation regex is required.
function resolveRequestedRef(query: URLSearchParams): string {
    const requested = query.get("ref");
    if (requested === null) {
        return ACTIVE_BRANCH_REF;
    }
    if (requested.trim() === "") {
        return ACTIVE_BRANCH_REF;
    }
    return requested.trim();
}

// GET /api/layer1-view?dir=&repo=&ref= — the S18 Layer 1 View as JSON (Path/Date serialize via
// toJSON / to ISO strings). Every failure below throws before any header is written, so
// viewer_server.ts's outer catch turns it into a 400 carrying the message and no stack, matching
// every other route.
export function handleLayer1ViewRequest(response: ServerResponse, query: URLSearchParams): void {
    const projectFolder = requireExistingFolderParam(query, "dir");
    const repoDir = requireExistingFolderParam(query, "repo");
    sendJson(response, 200, buildLayer1View(projectFolder, repoDir, resolveRequestedRef(query)));
}
