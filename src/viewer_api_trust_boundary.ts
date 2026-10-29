// Trust-boundary name resolution: project/jsonl/blob names never arrive as paths.

import { existsSync, readFileSync, realpathSync } from "node:fs";
import { join, resolve, sep } from "node:path";
import { Path, Uuid } from "./structures/domain.ts";
import { ROOT_PROJECT_NAME } from "./viewer_api_project_scan.ts";
import { getEffectiveFileHistoryDir } from "./viewer_api_projects.ts";

// Names resolve against the projects dir; the real path must stay under it, else loud error (400).
export function findProjectFile(projectsDir: Path, projectName: string, fileName: string): Path {
  const base = realpathSync(projectsDir.toString());
  const projectDir = projectName === ROOT_PROJECT_NAME ? base : resolve(base, projectName);
  const resolved = realpathSync(resolve(projectDir, fileName));
  const isInsideBase = resolved.startsWith(base + sep);
  if (!isInsideBase) {
    throw new Error(`refusing to resolve outside the projects dir: ${projectName}/${fileName}`);
  }
  return new Path(resolved);
}

// Trust boundary: patterns exclude `/`, `\`, `.` so traversal is impossible.
const BLOB_NAME_PATTERN = /^[0-9a-f]{16}@v\d+$/;
const SESSION_ID_PATTERN = /^[0-9a-fA-F-]+$/;

// Owner-session dir only; no cross-session fallback (avoids @vN collision wrong-content risk).
export function readBlobSnapshot(sessionId: Uuid, blobName: Path): { exists: boolean; content: string | undefined } {
  const isBlobName = BLOB_NAME_PATTERN.test(blobName.toString());
  if (!isBlobName) {
    throw new Error(`not a backup blob name: ${blobName.toString()}`);
  }
  const isSessionId = SESSION_ID_PATTERN.test(sessionId.toString());
  if (!isSessionId) {
    throw new Error(`not a session id: ${sessionId.toString()}`);
  }
  // item 46: const blobPath = join(getDefaultFileHistoryRoot().toString(), sessionId.toString(), blobName.toString());
  const blobPath = join(getEffectiveFileHistoryDir().toString(), sessionId.toString(), blobName.toString());
  const hasBlob = existsSync(blobPath);
  if (!hasBlob) {
    return { exists: false, content: undefined };
  }
  return { exists: true, content: readFileSync(blobPath, "utf8") };
}
