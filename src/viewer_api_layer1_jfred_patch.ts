// Task 603: the patch text of one jfred commit, for the Details drawer.

import { type ServerResponse } from "node:http";
import { Path } from "./structures/domain.ts";
import { COMMIT_HASH_PATTERN } from "./viewer_api_layer1_file.ts";
import { runJfredGit } from "./viewer_api_layer1_jfred_git.ts";
import { validateExistingFolderParam } from "./viewer_api_layer1_route.ts";
import { getRequiredParam, sendText } from "./viewer_server_routes.ts";

export function readJfredCommitPatch(repoDir: Path, shortHash: string): string {
  const isCommitHash = COMMIT_HASH_PATTERN.test(shortHash);
  if (!isCommitHash) {
    throw new Error(`not a commit hash: ${shortHash}`);
  }
  return runJfredGit(repoDir, ["show", "--no-color", "--no-ext-diff", "--src-prefix=a/", "--dst-prefix=b/", "--format=", "--patch", shortHash, "--"]);
}

// GET /api/layer1-jfred-patch?repo=<git folder>&hash=<short hash>: a failure throws, so the server answers 400.
export function sendLayer1JfredPatchResponse(response: ServerResponse, query: URLSearchParams): void {
  const repoDir = validateExistingFolderParam(query, "repo");
  const patchText = readJfredCommitPatch(repoDir, getRequiredParam(query, "hash"));
  sendText(response, 200, patchText);
}
