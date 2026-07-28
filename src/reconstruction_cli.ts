// Runnable entry point: reconstructs a transcript's files and prints history or diffs, across all branches by default; see plans/reconstruction-engine-design.md.

import { fileURLToPath } from "node:url";
import { loadTranscript, type ProgressSink } from "./parse/loadTranscript.ts";
import {
    buildStderrProgressSink,
    reportReconstructionProgress,
    setReconstructionProgressSink,
} from "./reconstruction_progress.ts";
import { applyRevisionBound } from "./reconstruction_bound.ts";
import { Path } from "./structures/domain.ts";
import {
    USAGE,
    applyCliPathOverrides,
    parseArgs,
    type CliOptions,
} from "./reconstruction_cli_args.ts";
import type { TranscriptRecord } from "./structures/envelope.ts";
import {
    reconstructBranches,
    type BranchedReconstruction,
    type FileHistory,
    type FileRevision,
} from "./reconstruction_engine.ts";
import { findBranchById, shortUuid } from "./reconstruction_branch.ts";
import { clearReconstructionFailures } from "./reconstruction_health.ts";
import {
    formatReconstructionCountersLine,
    resetReconstructionCounters,
} from "./reconstruction_counters.ts";
import { isGenuineUserPrompt } from "./reconstruction_prompts.ts";
import { recordVerdict } from "./reconstruction_parse_lines.ts";
import {
    summarizeBranches,
    buildReconstructionDocument,
} from "./reconstruction_json.ts";
import { buildStepSnapshots } from "./reconstruction_json_steps.ts";
import {
    filterByTarget,
    renderBranchSummary,
    renderChosen,
} from "./reconstruction_render_list.ts";
import { renderGraphs } from "./reconstruction_graph_render.ts";
import {
    countStepsInTranscript,
    reconstructStepStates,
    resolveFilesAtStep,
    renderRepoSnapshot,
} from "./reconstruction_steps.ts";
import type { BackupReader } from "./reconstruction_sidecar.ts";
import { buildSidecarReader } from "./reconstruction_sidecar_reader.ts";
import { parseTraceArgs, runTrace } from "./reconstruction_cli_trace.ts";
import {
    isTargetedSurvivingRequest,
    listTargetedSurvivingHistories,
} from "./reconstruction_target.ts";
import { getPathOverrides } from "./reconstruction_overrides.ts";
import { mergeMultiSourceRecords } from "./reconstruction_multi_source.ts";

// renderHistories / filterByTarget / renderChosen moved to reconstruction_render_list.ts (task 192): this file hit the 250-line cap.

// The selectable branch ids for the `--branch` error message: "surviving" plus each rewound tip.
function listAvailableBranchIds(branched: BranchedReconstruction): string {
    const ids: string[] = [];
    if (branched.survivingTip !== undefined) {
        ids.push(`surviving (#${shortUuid(branched.survivingTip)})`);
    }
    for (const entry of branched.rewound) {
        ids.push(`#${shortUuid(entry.tip)}`);
    }
    return ids.join(", ");
}

// Render one branch by `--branch <id>` (a tip id or "surviving"); throws usage plus available ids when none match.
function renderOneBranch(
    branched: BranchedReconstruction,
    options: CliOptions,
): string {
    const histories = findBranchById(branched, options.branch!);
    if (histories === undefined) {
        throw new Error(`${USAGE}\navailable branches: ${listAvailableBranchIds(branched)}`);
    }
    return renderChosen(histories, options);
}

// Render one code-change step's full-repo snapshot by `--step <n>` (1-based); throws usage plus valid range if out of bounds.
function renderStep(
    records: TranscriptRecord[],
    reader: BackupReader | undefined,
    stepNumber: number,
): string {
    const steps = reconstructStepStates(records, reader);
    if (stepNumber < 1 || stepNumber > steps.length) {
        throw new Error(`${USAGE}\nstep must be in 1..${steps.length}`);
    }
    return renderRepoSnapshot(steps[stepNumber - 1]!);
}

// Render the reconstruction as JSON, composing with the existing selectors: --allRecords, --step, --branch, --list-branches, or the full document.
function renderJson(
    records: TranscriptRecord[],
    reader: BackupReader | undefined,
    options: CliOptions,
): string {
    if (options.allRecords) {
        // Full body plus per-line classification (deep-dump twin of the document's compact lineVerdicts); length stays records.length, line-aligned by order.
        const enriched = records.map((record) => ({
            ...record,
            verdict: recordVerdict(record),
            isGenuinePrompt: isGenuineUserPrompt(record),
        }));
        return JSON.stringify(enriched, null, 2);
    }
    if (options.stepNumber !== undefined) {
        // The step's files resolve on demand from the compact histories (skeleton steps carry no file map anymore).
        const { steps, stepFileHistories } = buildStepSnapshots(records, reader);
        if (options.stepNumber < 1 || options.stepNumber > steps.length) {
            throw new Error(`${USAGE}\nstep must be in 1..${steps.length}`);
        }
        return JSON.stringify(resolveFilesAtStep(stepFileHistories, steps[options.stepNumber - 1]!.when), null, 2);
    }
    // task 192: (surviving, one target) skips the all-branch/all-file pass, routing through the target-scoped engine path instead.
    if (isTargetedSurvivingRequest(options)) {
        return JSON.stringify(listTargetedSurvivingHistories(records, reader, options.target!), null, 2);
    }
    const branched = reconstructBranches(records, reader);
    if (options.branch !== undefined) {
        const histories = findBranchById(branched, options.branch);
        if (histories === undefined) {
            throw new Error(`${USAGE}\navailable branches: ${listAvailableBranchIds(branched)}`);
        }
        return JSON.stringify(filterByTarget(histories, options.target), null, 2);
    }
    if (options.listBranches) {
        return JSON.stringify(summarizeBranches(records), null, 2);
    }
    return JSON.stringify(buildReconstructionDocument(records, branched, reader, options.target).document, null, 2);
}

// Load transcript and render the chosen view.
export function runCli(argv: string[]): string {
    const traced = parseTraceArgs(argv);
    if (traced !== undefined) return runTrace(traced);
    const options = parseArgs(argv);
    applyCliPathOverrides(options);
    // task 119: a previous run's aborted leftovers must not leak into this run's failure notes (tests drive runCli repeatedly).
    clearReconstructionFailures();
    resetReconstructionCounters();
    const sink = options.progress ? buildStderrProgressSink(options.progressAll) : undefined;
    setReconstructionProgressSink(sink);
    try {
        const rendered = renderTranscriptView(options, sink);
        // task 192: the work-counter report rides stderr like the progress stream, not the sink (contract test pins its sequences).
        if (sink !== undefined) process.stderr.write(`${formatReconstructionCountersLine()}\n`);
        return rendered;
    } finally {
        // task 191, same in-process concern as task 119 above: the sink must not outlive its run.
        setReconstructionProgressSink(undefined);
    }
}

// Post-parse body: load, merge, build sidecar reader, and dispatch.
function renderTranscriptView(options: CliOptions, sink: ProgressSink | undefined): string {
    // Strict mode: a parse error in any transcript aborts the run (spec S4b).
    const recordLists = options.jsonlPaths.map((jsonlPath) => loadTranscript(jsonlPath, sink).records);
    const sources = getPathOverrides().sources;
    if (sources !== undefined) {
        reportReconstructionProgress(`merging ${recordLists.length} transcripts across ${sources.length} sources`);
    }
    // With declared (or multi-root derived) sources the stream goes through multi-source stages; sources-less is the legacy single-transcript path.
    const merged = sources === undefined ? recordLists.flat() : mergeMultiSourceRecords(recordLists, sources);
    // task 193: --until-revision truncates the stream before the sidecar reader and engine see it, bounding every view uniformly.
    const records = applyRevisionBound(merged, options);
    reportReconstructionProgress("building sidecar backup reader");
    const reader = buildSidecarReader(records, sources);
    if (options.json) {
        return renderJson(records, reader, options);
    }
    if (options.countSteps) {
        return String(countStepsInTranscript(records, reader));
    }
    if (options.stepNumber !== undefined) {
        return renderStep(records, reader, options.stepNumber);
    }
    if (options.graphConvo || options.graphFile) {
        return renderGraphs(records, { convo: options.graphConvo, file: options.graphFile }, reader);
    }
    // task 192: same fast path as renderJson — the text views compose through renderChosen.
    if (isTargetedSurvivingRequest(options)) {
        return renderChosen(listTargetedSurvivingHistories(records, reader, options.target!), options);
    }
    const branched = reconstructBranches(records, reader);
    if (options.listBranches) {
        return renderBranchSummary(branched);
    }
    if (options.branch !== undefined) {
        return renderOneBranch(branched, options);
    }
    return renderChosen(branched.surviving, options);
}
if (process.argv[1] === fileURLToPath(import.meta.url)) console.log(runCli(process.argv.slice(2)));

