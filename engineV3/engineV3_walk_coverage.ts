// How far the walk of one file has gone: a sidecar file inside the inverse repo folder of the file.

import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Path } from "../src/structures/domain.ts";
import { listInverseCommits } from "./engineV3_inverse_repo.ts";

// tipInstant is the instant of the oldest stored commit; null when that commit has no instant.
export type WalkCoverage = { tipInstant: Date | null; isFinished: boolean };
type WalkCoverageOnDisk = { tipInstant: string | null; isFinished: boolean };

export const WALK_COVERAGE_FILE_NAME = "jfred-walk-coverage.json";
const TEMPORARY_FILE_SUFFIX = ".tmp";

export function readWalkCoverage(repoFolder: Path): WalkCoverage | undefined {
    const coveragePath = join(repoFolder.toString(), WALK_COVERAGE_FILE_NAME);
    if (!existsSync(coveragePath)) {
        return undefined;
    }
    const coverageOnDisk = JSON.parse(readFileSync(coveragePath, "utf8")) as WalkCoverageOnDisk;
    let tipInstant: Date | null = null;
    if (coverageOnDisk.tipInstant !== null) {
        tipInstant = new Date(coverageOnDisk.tipInstant);
    }
    return { tipInstant, isFinished: coverageOnDisk.isFinished };
}

// A finished walk stays finished. The file is renamed into place, so a killed child never leaves a half file.
export function writeWalkCoverage(repoFolder: Path, fileName: string, isFinishedNow: boolean): WalkCoverage {
    const storedCommits = listInverseCommits(repoFolder, fileName, false);
    const tipCommit = storedCommits[storedCommits.length - 1]!;
    const tipInstant = tipCommit.instant ?? null;
    let isFinished = isFinishedNow;
    const previousCoverage = readWalkCoverage(repoFolder);
    if (previousCoverage !== undefined) {
        if (previousCoverage.isFinished) {
            isFinished = true;
        }
    }
    const coverageOnDisk: WalkCoverageOnDisk = { tipInstant: tipInstant === null ? null : tipInstant.toISOString(), isFinished };
    const coveragePath = join(repoFolder.toString(), WALK_COVERAGE_FILE_NAME);
    const temporaryPath = coveragePath + TEMPORARY_FILE_SUFFIX;
    writeFileSync(temporaryPath, JSON.stringify(coverageOnDisk));
    renameSync(temporaryPath, coveragePath);
    return { tipInstant, isFinished };
}

// All text changes newer than the tip are stored, so any instant at or after the tip instant is answered by the stored commits.
export function isInstantSpannedByWalkCoverage(coverage: WalkCoverage, instant: Date): boolean {
    if (coverage.isFinished) {
        return true;
    }
    if (coverage.tipInstant === null) {
        return false;
    }
    return coverage.tipInstant.getTime() <= instant.getTime();
}
