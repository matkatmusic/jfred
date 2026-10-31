// Command-line parsing for viewer_server.ts: applies the path flags and returns the launch options.

import { homedir } from "node:os";
import { join } from "node:path";
import { setFileStampCachePath } from "./file_stamp_cache.ts";
import { setProjectsDir, setFileHistoryDir } from "./viewer_api_projects.ts";
import { enableFixtureMode } from "./viewer_api_layer1_fixture.ts";
import { setLayer1SettingsPath } from "./viewer_api_layer1_settings.ts";
import { Path } from "./structures/domain.ts";

const DEFAULT_PORT = 7343;

const USAGE = "usage: tsx src/viewer_server.ts --projects-dir <path> [--port <n>] [--file-history-dir <path>] [--settings-file <path>] [--cache-file <path>] [--fixture] [--resetSandboxMemo] [--resetDocumentCache]";

function readFlagValue(argv: string[], flag: string): string | undefined {
  const index = argv.indexOf(flag);
  const hasFlag = index >= 0;
  return hasFlag ? argv[index + 1] : undefined;
}

// `--projects-dir` is MANDATORY: there is no default scan root.
export function parseServerArgs(argv: string[]): { port: number; resetSandboxMemo: boolean; resetDocumentCache: boolean } {
  const projectsDir = readFlagValue(argv, "--projects-dir");
  if (projectsDir === undefined) {
    throw new Error(USAGE);
  }
  setProjectsDir(projectsDir);
  // Item 46: after --projects-dir, so an explicit dir survives the folder switch's reset.
  const fileHistoryDir = readFlagValue(argv, "--file-history-dir");
  if (fileHistoryDir !== undefined) {
    setFileHistoryDir(fileHistoryDir);
  }
  const settingsFile = readFlagValue(argv, "--settings-file");
  if (settingsFile !== undefined) {
    setLayer1SettingsPath(new Path(settingsFile));
  }
  setFileStampCachePath(new Path(readFlagValue(argv, "--cache-file") ?? join(homedir(), ".jfred-layer1-cache.json")));
  // Task 330: --projects-dir stays mandatory even here; the fixture routes just ignore its contents.
  const isFixtureRequested = argv.includes("--fixture");
  if (isFixtureRequested) {
    enableFixtureMode();
  }
  const portIndex = argv.indexOf("--port");
  const port = portIndex >= 0 ? Number(argv[portIndex + 1]) : DEFAULT_PORT;
  const isPortValid = Number.isInteger(port);
  if (!isPortValid) {
    throw new Error(USAGE);
  }
  return {
    port,
    resetSandboxMemo: argv.includes("--resetSandboxMemo"),
    resetDocumentCache: argv.includes("--resetDocumentCache"),
  };
}
