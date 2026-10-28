import { execFileSync, execSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { buildSidecarReader } from "../src/reconstruction_sidecar_reader.ts";
import { getSurvivingFileHistory } from "../src/reconstruction_target.ts";
import { getLinesText } from "../src/reconstruction_revisions.ts";
import type { SweepRow } from "../src/per_file_sweep_report.ts";
import { Path } from "../src/structures/domain.ts";
import type { FileRevision } from "../src/reconstruction_events.ts";
import type { TranscriptRecord } from "../src/structures/envelope.ts";
import type { SweepSettings } from "./per_file_sweep_settings.ts";

// A revision's bytes in the form that blob-matched in task 182: lines joined, trailing newline.
function renderRevisionText(revision: FileRevision): string {
  return getLinesText(revision).join("\n") + "\n";
}

function computeBlobHashOfText(text: string): string {
  const output = execFileSync("git", ["hash-object", "--stdin"], { input: text }).toString();
  return output.trim();
}

// The baseline blob sha for the candidate, or undefined when the baseline holds no such path.
function readBaselineBlobSha(settings: SweepSettings, relativePath: Path): string | undefined {
  try {
    const output = execSync(`git rev-parse ${settings.baseCommit}:${JSON.stringify(relativePath.toString())}`, {
      cwd: settings.repo.toString(),
    }).toString();
    return output.trim();
  }
  catch {
    return undefined;
  }
}

// Returns working-tree text, or undefined if the file was deleted (D-phase normal case).
function readWorkingTreeText(settings: SweepSettings, relativePath: Path): string | undefined {
  const onDisk = join(settings.repo.toString(), relativePath.toString());
  const isOnDisk = existsSync(onDisk);
  if (!isOnDisk) {
    return undefined;
  }
  return readFileSync(onDisk, "utf8");
}

function isBlobShaInRevisions(revisions: FileRevision[], blobSha: string): boolean {
  for (const revision of revisions) {
    const revisionSha = computeBlobHashOfText(renderRevisionText(revision));
    if (revisionSha === blobSha) {
      return true;
    }
  }
  return false;
}

function countUnrecoverableRevisions(revisions: FileRevision[]): number {
  let count = 0;
  for (const revision of revisions) {
    const isUnrecoverable = revision.unrecoverable !== undefined;
    if (isUnrecoverable) {
      count += 1;
    }
  }
  return count;
}

// Builds one SweepRow; catches throws so one bad candidate never kills the sweep.
export function buildSweepRow(
  settings: SweepSettings,
  records: TranscriptRecord[],
  reader: ReturnType<typeof buildSidecarReader>,
  recordedRoot: Path,
  relativePath: Path,
): SweepRow {
  const target = new Path(join(recordedRoot.toString(), relativePath.toString()));
  const startedAt = Date.now();
  let revisions: FileRevision[];
  try {
    revisions = getSurvivingFileHistory(records, target, reader)?.revisions ?? [];
  }
  catch (error) {
    return {
      file: relativePath,
      revisions: 0,
      baselineBlobMatched: false,
      diskMatched: false,
      unrecoverable: 0,
      seconds: Math.round((Date.now() - startedAt) / 1000),
      note: `threw: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
  const last = revisions[revisions.length - 1];
  const baselineSha = readBaselineBlobSha(settings, relativePath);
  const diskText = readWorkingTreeText(settings, relativePath);
  // Baseline blob may appear mid-ladder, not at revision 0, due to git-seed timing.
  const baselineBlobMatched = baselineSha !== undefined && isBlobShaInRevisions(revisions, baselineSha);
  return {
    file: relativePath,
    baselineBlobMatched,
    revisions: revisions.length,
    diskMatched: last !== undefined && diskText !== undefined && renderRevisionText(last) === diskText,
    unrecoverable: countUnrecoverableRevisions(revisions),
    seconds: Math.round((Date.now() - startedAt) / 1000),
    note: diskText === undefined ? "absent from the working tree" : "",
  };
}
