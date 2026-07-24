// Git-derived baseline host selection (task 121, split from timeline-nodes.ts, 250-line cap):
// gitBase-only steps land on ONE host node — the recorded base-commit row when the session
// captured that commit (the merged row wearing the baseline dress), else a dedicated standalone
// baseline turn (task 86 behavior, kept as the fallback for e.g. a back-dated base commit no
// session ever recorded).
import { computeGitBaselineText, extractGitBaseCommitHash } from "./timeline-changes.js";
import { AGENT_TURN_NODE_KIND, } from "./timeline-types.js";
// The recorded base-commit row: the commit node whose short resultHash prefixes the baseline
// beacon's full commit hash — the row the git-derived baseline merges into.
function findBaseCommitNode(commitNodes, snapshot) {
    const baselineCommitHash = extractGitBaseCommitHash(snapshot.changeIds[0]);
    return commitNodes.find((node) => {
        if (node.resultHash === undefined) {
            return false;
        }
        if (node.resultHash === "") {
            return false;
        }
        return baselineCommitHash.startsWith(node.resultHash);
    });
}
// The node hosting baseline snapshots: the recorded base-commit row (merged) or a fresh
// standalone baseline turn (fallback), pushed into turnNodes so it joins the sort.
function claimBaselineHost(turnNodes, commitNodes, snapshot) {
    const baseCommitNode = findBaseCommitNode(commitNodes, snapshot);
    if (baseCommitNode !== undefined) {
        baseCommitNode.isGitBaseline = true;
        baseCommitNode.text = computeGitBaselineText(snapshot);
        baseCommitNode.snapshots = [];
        return baseCommitNode;
    }
    const baselineTurn = {
        kind: AGENT_TURN_NODE_KIND,
        when: snapshot.when,
        sessionId: snapshot.sessionId,
        text: computeGitBaselineText(snapshot),
        isGitBaseline: true,
        snapshots: [],
        gitOperations: [],
    };
    turnNodes.push(baselineTurn);
    return baselineTurn;
}
// (task 86) attach a gitBase-only snapshot to the baseline host, claiming it on first use;
// returns the (possibly just-claimed) host.
export function recordGitBaselineSnapshot(turnNodes, commitNodes, snapshot, baselineHost) {
    if (baselineHost === undefined) {
        baselineHost = claimBaselineHost(turnNodes, commitNodes, snapshot);
    }
    baselineHost.snapshots.push(snapshot);
    return baselineHost;
}
