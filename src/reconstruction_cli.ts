// Runnable entry point: reconstructs a transcript's files and prints history or diffs.

import { fileURLToPath } from "node:url";
import { loadTranscript, type ProgressSink } from "./parse/loadTranscript.ts";
import {
  buildStderrProgressSink,
  reportReconstructionProgress,
  setReconstructionProgressSink,
} from "./reconstruction_progress.ts";
import { applyRevisionBound } from "./reconstruction_bound.ts";
import { parseArgs, type CliOptions } from "./reconstruction_cli_args.ts";
import { applyCliPathOverrides } from "./reconstruction_cli_path_overrides.ts";
import type { TranscriptRecord } from "./structures/envelope.ts";
import { reconstructBranches } from "./reconstruction_engine.ts";
import { clearReconstructionFailures } from "./reconstruction_health.ts";
import {
  formatReconstructionCountersLine,
  resetReconstructionCounters,
} from "./reconstruction_counters.ts";
import { renderBranchSummary } from "./reconstruction_render_branch_summary.ts";
import { renderChosen } from "./reconstruction_render_chosen.ts";
import { renderGraphs } from "./reconstruction_graph_render.ts";
import { countStepsInTranscript } from "./reconstruction_steps.ts";
import { buildSidecarReader } from "./reconstruction_sidecar_reader.ts";
import { parseTraceArgs, runTrace } from "./reconstruction_cli_trace.ts";
import {
  isTargetedSurvivingRequest,
  listTargetedSurvivingHistories,
} from "./reconstruction_target.ts";
import { getPathOverrides } from "./reconstruction_overrides.ts";
import { mergeMultiSourceRecords } from "./reconstruction_multi_source.ts";
import { renderJson } from "./reconstruction_cli_json.ts";
import { renderOneBranch, renderStep } from "./reconstruction_cli_text.ts";

// Load transcript and render the chosen view.
export function executeCli(argv: string[]): string {
  const traced = parseTraceArgs(argv);
  if (traced !== undefined)
    return runTrace(traced);
  const options = parseArgs(argv);
  applyCliPathOverrides(options);
  // task 119: aborted leftovers must not leak into this run's failure notes.
  clearReconstructionFailures();
  resetReconstructionCounters();
  const sink = options.progress ? buildStderrProgressSink(options.progressAll) : undefined;
  setReconstructionProgressSink(sink);
  try {
    const rendered = renderTranscriptView(options, sink);
    // task 192: the work-counter report rides stderr like the progress stream.
    if (sink !== undefined)
      process.stderr.write(`${formatReconstructionCountersLine()}\n`);
    return rendered;
  }
  finally {
    // task 191: the sink must not outlive its run.
    setReconstructionProgressSink(undefined);
  }
}

// Post-parse body: load, merge, build sidecar reader, and dispatch.
function renderTranscriptView(options: CliOptions, sink: ProgressSink | undefined): string {
  // Strict mode: a parse error in any transcript aborts the run (spec S4b).
  const recordLists: TranscriptRecord[][] = [];
  for (const jsonlPath of options.jsonlPaths) {
    recordLists.push(loadTranscript(jsonlPath, sink).records);
  }
  const sources = getPathOverrides().sources;
  if (sources !== undefined) {
    reportReconstructionProgress(`merging ${recordLists.length} transcripts across ${sources.length} sources`);
  }
  // Declared sources go through multi-source stages; otherwise the legacy single-transcript path.
  const merged = sources === undefined ? recordLists.flat() : mergeMultiSourceRecords(recordLists, sources);
  // task 193: --until-revision truncates the stream before the sidecar reader and engine.
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
  const isGraphRequested = options.graphConvo || options.graphFile;
  if (isGraphRequested) {
    return renderGraphs(records, { convo: options.graphConvo, file: options.graphFile }, reader);
  }
  // task 192: same fast path as renderJson.
  const isTargetedSurviving = isTargetedSurvivingRequest(options);
  if (isTargetedSurviving) {
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

const thisFilePath = fileURLToPath(import.meta.url);
const isEntryPoint = process.argv[1] === thisFilePath;
if (isEntryPoint)
  console.log(executeCli(process.argv.slice(2)));
