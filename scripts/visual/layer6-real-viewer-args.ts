// Task 358: the command-line arguments of the viewer that the layer 6 real check starts.

import { join } from "node:path";

export interface ViewerTempFiles { settingsFile: string; cacheFile: string; memoFile: string; runResultsFile: string }

export function buildViewerArguments(recoveryDir: string, port: number, tempFiles: ViewerTempFiles): string[] {
  return [
    "--import", "tsx", "src/viewer_server.ts", "--projects-dir", join(recoveryDir, "projects"),
    "--file-history-dir", join(recoveryDir, "file-history"), "--port", String(port),
    "--settings-file", tempFiles.settingsFile, "--cache-file", tempFiles.cacheFile, "--sandbox-memo-file", tempFiles.memoFile,
    "--run-results-file", tempFiles.runResultsFile,
  ];
}
