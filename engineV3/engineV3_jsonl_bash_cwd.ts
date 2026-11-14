// Gives each Bash call line the folder its own session's shell was in: the cwd field of a line is shared with parallel sessions, so it can name a folder another session cd'd to.

import { getContentBlocks } from "../src/structures/content-blocks.ts";
import type { Path } from "../src/structures/domain.ts";
import { BlockType, ToolName } from "../src/structures/vocabulary.ts";
import type { JSONLLine } from "./engineV3.ts";

const SUBAGENT_HANDBACK_TOOL_NAME = "SubagentHandback";

function collectResultCwds(records: JSONLLine[]): Map<string, Path | undefined> {
  const resultCwds = new Map<string, Path | undefined>();
  for (const record of records) {
    if (record.timestamp instanceof Date) {
      for (const block of getContentBlocks(record)) {
        if (block.type === BlockType.tool_result) {
          resultCwds.set(block.tool_use_id.toString(), record.cwd);
        }
      }
    }
  }
  return resultCwds;
}

// A session's shell moves only by its own Bash calls, so a call starts in the folder the session's previous Bash call left (the cwd of that call's result line). The first call, and the first call after a subagent handback (a resume starts a new shell), keep the cwd of their own line.
export function setBashCallCwdsToShellCwds(records: JSONLLine[]): void {
  const resultCwds = collectResultCwds(records);
  let previousCallId: string | undefined;
  for (const record of records) {
    if (record.timestamp instanceof Date) {
      for (const block of getContentBlocks(record)) {
        if (block.type === BlockType.tool_use) {
          if (block.name === SUBAGENT_HANDBACK_TOOL_NAME) {
            previousCallId = undefined;
          }
          if (block.name === ToolName.Bash) {
            if (previousCallId !== undefined) {
              const previousResultCwd = resultCwds.get(previousCallId);
              if (previousResultCwd === undefined) {
                throw new Error(`setBashCallCwdsToShellCwds: the previous Bash call ${previousCallId} has no result cwd`);
              }
              record.cwd = previousResultCwd;
            }
            previousCallId = block.id.toString();
          }
        }
      }
    }
  }
}
