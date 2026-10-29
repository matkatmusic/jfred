// The one backup path both the sidecar reader and the missing-backup check use.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { Path, Uuid } from "./structures/domain.ts";
import type { BackupReader } from "./reconstruction_sidecar.ts";

// <root>/<sessionId>/<backupFileName>.
export function buildSidecarBackupPath(sessionId: Uuid, root: Path, backupFileName: Path): string {
  return join(root.toString(), sessionId.toString(), backupFileName.toString());
}

// The default on-disk reader.
export function createSidecarReader(sessionId: Uuid, root: Path): BackupReader {
  return (backupFileName) => readFileSync(buildSidecarBackupPath(sessionId, root, backupFileName), "utf8");
}
