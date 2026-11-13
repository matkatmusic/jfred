// The in-memory session dot index: project-log and mention rules, per-file freshness, progress events.
import { readFileSync } from "node:fs";
import type { Path } from "./structures/domain.ts";
import { DocumentResponseKind } from "./structures/vocabulary_views.ts";
import { loadTranscript, type ProgressSink } from "./parse/loadTranscript.ts";
import { computeRecordProgressStride, computeTranscriptFileStamp, computeTranscriptSetStamp } from "./viewer_api_records.ts";
import { getProjectFolderKey, isProjectFolderMentioned, isProjectLogPath } from "./layer1_session_dots_filter.ts";
import { buildSessionDotIndex } from "./layer1_session_dots_query.ts";
import { buildFileSessionDots } from "./layer1_session_dots_build.ts";
import type { Layer1WireAnnotation, SessionDotIndex } from "./layer1_session_dots_types.ts";

export const LAYER1_PROGRESS_LABEL_INDEXING_SESSION_DOTS = "indexing session dots";

type FileDots = { stamp: string; dots: Layer1WireAnnotation[] };

// ponytail: one entry per (project folder, file) and one merged index per project folder; add eviction if projects pile up.
const dotsByFolderAndFile = new Map<string, FileDots>();
const indexByFolder = new Map<string, { setStamp: string; index: SessionDotIndex }>();

function keepMentioningDots(dots: Layer1WireAnnotation[], lines: string[], projectFolder: Path): Layer1WireAnnotation[] {
  const keptDots: Layer1WireAnnotation[] = [];
  for (const dot of dots) {
    const isMentioned = isProjectFolderMentioned(lines[dot.line - 1]!, projectFolder);
    if (isMentioned) {
      keptDots.push(dot);
    }
  }
  return keptDots;
}

function buildFileDots(file: Path, projectFolder: Path): Layer1WireAnnotation[] {
  const isProjectLog = isProjectLogPath(file, projectFolder);
  if (isProjectLog) {
    return buildFileSessionDots(loadTranscript(file.toString(), undefined, true).records, file);
  }
  const fileText = readFileSync(file.toString(), "utf8");
  const isMentioned = isProjectFolderMentioned(fileText, projectFolder);
  if (!isMentioned) {
    return [];
  }
  const dots = buildFileSessionDots(loadTranscript(file.toString(), undefined, true).records, file);
  return keepMentioningDots(dots, fileText.split("\n"), projectFolder);
}

function readFileDots(file: Path, projectFolder: Path): Layer1WireAnnotation[] {
  const cacheKey = `${getProjectFolderKey(projectFolder)}\n${file.toString()}`;
  const stamp = computeTranscriptFileStamp(file);
  const cached = dotsByFolderAndFile.get(cacheKey);
  if (cached !== undefined) {
    if (cached.stamp === stamp) {
      return cached.dots;
    }
  }
  const dots = buildFileDots(file, projectFolder);
  dotsByFolderAndFile.set(cacheKey, { stamp, dots });
  return dots;
}

function reportIndexProgress(reportProgress: ProgressSink, index: number, total: number): void {
  const current = index + 1;
  const stride = computeRecordProgressStride(total);
  const isOnStride = current % stride === 0;
  const isLastFile = current === total;
  const isDue = isOnStride || isLastFile;
  if (isDue) {
    reportProgress({ kind: DocumentResponseKind.progress, label: LAYER1_PROGRESS_LABEL_INDEXING_SESSION_DOTS, current, total });
  }
}

function collectFolderDots(projectFolder: Path, sortedFiles: Path[], reportProgress: ProgressSink): Layer1WireAnnotation[] {
  const dots: Layer1WireAnnotation[] = [];
  for (const [index, file] of sortedFiles.entries()) {
    reportIndexProgress(reportProgress, index, sortedFiles.length);
    dots.push(...readFileDots(file, projectFolder));
  }
  return dots;
}

function compareFilesByPath(left: Path, right: Path): number {
  return left.toString().localeCompare(right.toString());
}

function sortFilesByPath(files: readonly Path[]): Path[] {
  const sortedFiles = [...files];
  sortedFiles.sort(compareFilesByPath);
  return sortedFiles;
}

export function getSessionDotIndex(projectFolder: Path, files: readonly Path[], reportProgress: ProgressSink = () => {}): SessionDotIndex {
  const sortedFiles = sortFilesByPath(files);
  const setStamp = computeTranscriptSetStamp(sortedFiles);
  const folderKey = getProjectFolderKey(projectFolder);
  const cached = indexByFolder.get(folderKey);
  if (cached !== undefined) {
    if (cached.setStamp === setStamp) {
      return cached.index;
    }
  }
  const dots = collectFolderDots(projectFolder, sortedFiles, reportProgress);
  const index = buildSessionDotIndex(dots);
  indexByFolder.set(folderKey, { setStamp, index });
  return index;
}
