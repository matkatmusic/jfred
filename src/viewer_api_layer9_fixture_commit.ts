// Canned answer of the commit route in fixture mode, so the page runs its real Commit client code.

import { type IncomingMessage, type ServerResponse } from "node:http";
import { JfredCommitOutcome, type WireJfredCommitReply, type WireJfredCommitRequest } from "../webapp/layer1-components/commits-column/layer1-wire-jfred.ts";
import { sendNdjsonBuild } from "./viewer_api_layer1_route.ts";
import { readFixtureRequestBody } from "./viewer_api_layer6_fixture_needs.ts";
import { FIXTURE_NEXT_CHANGE_AT, FIXTURE_UNCHANGED_MARK_AT } from "./viewer_api_layer9_fixture_data.ts";

const CANNED_HASH_PREFIX = "c0ffee";

function computeNextCannedShortHash(parentShortHash: string): string {
  let parentCounter = 0;
  const isCannedParent = parentShortHash.startsWith(CANNED_HASH_PREFIX);
  if (isCannedParent) {
    parentCounter = Number(parentShortHash.slice(CANNED_HASH_PREFIX.length));
  }
  return `${CANNED_HASH_PREFIX}${String(parentCounter + 1).padStart(2, "0")}`;
}

function buildCannedCommitReply(request: WireJfredCommitRequest): WireJfredCommitReply {
  const isUnchangedMark = Date.parse(request.markInstant) === FIXTURE_UNCHANGED_MARK_AT.getTime();
  if (isUnchangedMark) {
    return { outcome: JfredCommitOutcome.unchanged, nextInstant: FIXTURE_NEXT_CHANGE_AT.toISOString() };
  }
  const parentShortHash = request.parentShortHash ?? request.baseShortHash;
  const commit = {
    instant: request.markInstant,
    shortHash: computeNextCannedShortHash(parentShortHash),
    parentShortHash,
    message: request.message,
  };
  return { outcome: JfredCommitOutcome.committed, commit };
}

export function receiveFixtureJfredCommit(request: IncomingMessage, response: ServerResponse): void {
  function sendCannedReply(body: string): void {
    const commitRequest = JSON.parse(body) as WireJfredCommitRequest;
    function buildCommitReply(writeNdjsonLine: (value: unknown) => void): WireJfredCommitReply {
      writeNdjsonLine({ kind: "progress", label: "building the commit" });
      return buildCannedCommitReply(commitRequest);
    }
    sendNdjsonBuild(response, buildCommitReply);
  }
  readFixtureRequestBody(request, sendCannedReply);
}
