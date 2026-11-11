// Claude Code makes a scratchpad folder for each session when the session starts; recorded Bash calls write into it without making it.

import { mkdirSync } from "node:fs";
import { join, sep } from "node:path";
import { Path } from "../src/structures/domain.ts";
import { getRecordSource } from "../src/parse/loadTranscript.ts";
import { getSessionId } from "../src/reconstruction_multi_source_paths.ts";
import type { JSONLLine } from "./engineV3.ts";

// The Mac user's Claude Code temp folder: /private/tmp/claude-<user id>.
export const MAC_CLAUDE_TEMP_FOLDER = new Path("/private/tmp/claude-501");
const SCRATCHPAD_FOLDER_NAME = "scratchpad";
const JSONL_EXTENSION = ".jsonl";

// Every log of a session sits at <project folder>/<session id>.jsonl or under <project folder>/<session id>/.
function getProjectFolderName(logPath: string, sessionId: string): string {
  const pathParts = logPath.split(sep);
  for (let partIndex = 1; partIndex < pathParts.length; partIndex++) {
    const pathPart = pathParts[partIndex];
    if (pathPart === sessionId) {
      return pathParts[partIndex - 1]!;
    }
    if (pathPart === sessionId + JSONL_EXTENSION) {
      return pathParts[partIndex - 1]!;
    }
  }
  throw new Error(`getProjectFolderName: ${logPath} has no part named ${sessionId} or ${sessionId}${JSONL_EXTENSION}`);
}

// ponytail: made again at each line of the session (a no-op once it exists); a session that deletes its own scratchpad gets it back at its next line.
export function createSessionScratchpadFolder(claudeTempFolder: Path, line: JSONLLine): void {
  const sessionId = getSessionId(line);
  if (sessionId === undefined) {
    return;
  }
  const source = getRecordSource(line);
  if (source === undefined) {
    throw new Error(`createSessionScratchpadFolder: the line of session ${sessionId.toString()} has no source file`);
  }
  const projectFolderName = getProjectFolderName(source.filePath, sessionId.toString());
  mkdirSync(join(claudeTempFolder.toString(), projectFolderName, sessionId.toString(), SCRATCHPAD_FOLDER_NAME), { recursive: true });
}
