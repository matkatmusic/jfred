// Layer 1's script-replay wire contract: docker readiness, the needs route, and the run route request and reply.

import type { WireRunOutcome } from "./layer1-wire-script-results.ts";

export const WireScriptReplayProblem = { dockerNotInstalled: "docker-not-installed", dockerNotRunning: "docker-not-running", imageMissing: "image-missing" } as const;
export type WireScriptReplayProblem = (typeof WireScriptReplayProblem)[keyof typeof WireScriptReplayProblem];

export const WireScriptReplayReason = { namedByFile: "named-by-file", birthCandidate: "birth-candidate" } as const;
export type WireScriptReplayReason = (typeof WireScriptReplayReason)[keyof typeof WireScriptReplayReason];

export interface WireScriptReplayTask {
    taskId: string;
    instant: string;
    isInSpan: boolean;
    code: string;
    cwd: string;
    language: "python" | "bash";
    source?: { filePath: string; lineNumber: number };
    waitingFiles: { path: string; reason: WireScriptReplayReason }[];
}
export interface WireScriptReplayNeedsRequest { fromInstant: string | null; toInstant: string }
export interface WireScriptReplayNeeds { problem?: WireScriptReplayProblem; problemText?: string; tasks: WireScriptReplayTask[] }
export interface WireScriptReplayRunRequest { toInstant: string; allowScripts: boolean }
export interface WireScriptReplayFile { path: string; changeKind: "changed" | "created" | "deleted" | null; confidence: "proven" | "derived" | null; isGapFilled: boolean }
export interface WireScriptReplayTaskResult {
    taskId: string;
    outcome: WireRunOutcome;
    reason?: string;
    exitCode?: number;
    timedOut: boolean;
    stdout: string;
    stderr: string;
    missingExecutable?: string;
    files: WireScriptReplayFile[];
}
export interface WireScriptReplayRunReply { results: WireScriptReplayTaskResult[] }
export interface WireDockerReadiness { problem?: WireScriptReplayProblem; problemText?: string }
