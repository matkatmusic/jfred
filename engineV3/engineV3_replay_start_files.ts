// Files that sat untracked on the user's disk at the real start, so no commit holds them.

import { Path } from "../src/structures/domain.ts";
import { writeFileIntoState } from "./engineV3_replay_submodule.ts";

// source = c6df4977-982a-4d00-8032-b6542fe225f3.jsonl:348
export const PLAYGROUND_HISTORY_CONTENT = "[\n  {\n    \"id\": 1,\n    \"time\": \"2026-10-26T22:58:43.395Z\",\n    \"state\": {},\n    \"questions\": {},\n    \"calls\": 0,\n    \"outputs\": []\n  }\n]\n";
export const PLAYGROUND_HISTORY_PATH = "playground/results/playground-history.json";

export function writeUntrackedStartFiles(state: Path): void {
  writeFileIntoState(state, new Path(PLAYGROUND_HISTORY_PATH), Buffer.from(PLAYGROUND_HISTORY_CONTENT, "utf8"));
}
