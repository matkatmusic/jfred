// engineV3 mockup fixture: the fixture commits plus six fake Session steps, one list sorted by time.

import { Uuid } from "./structures/domain.ts";
import { COMMITS, parseMs, type FixtureCommit } from "./viewer_api_layer1_fixture_data.ts";
import { buildFixtureLayer1View } from "./viewer_api_layer1_fixture_view.ts";
import { ANNOTATION_BLOCK_IDS, listFillerIds } from "./viewer_api_layer7_fixture_data.ts";
import { EngineV3StepKind, type WireEngineV3StepOf } from "../webapp/layer1-components/engine-v3/layer1-wire-engine-v3.ts";

type EngineV3Step = WireEngineV3StepOf<Date, Uuid>;
type Annotation = NonNullable<ReturnType<typeof buildFixtureLayer1View>["annotations"]>[number];
type StepDraft = Omit<EngineV3Step, "nodeTime">;

// Only src/index.ts and src/util.ts: both are born (DISK) before the first Session column node used here.
const STEP_DRAFTS: StepDraft[] = [
  { nodeId: ANNOTATION_BLOCK_IDS[1]!, kind: EngineV3StepKind.noFileChange, filesChanged: [], sentence: "You ask to fix the trim bug. No file changes." },
  { nodeId: ANNOTATION_BLOCK_IDS[2]!, kind: EngineV3StepKind.edit, filesChanged: ["src/util.ts"], sentence: "Claude edits src/util.ts to trim the input." },
  { nodeId: ANNOTATION_BLOCK_IDS[5]!, kind: EngineV3StepKind.script, filesChanged: ["src/index.ts"], sentence: "A script runs and writes src/index.ts." },
  { nodeId: ANNOTATION_BLOCK_IDS[6]!, kind: EngineV3StepKind.snapshot, filesChanged: ["src/util.ts"], sentence: "A file-history snapshot sets src/util.ts to its saved text." },
  { nodeId: listFillerIds()[0]!, kind: EngineV3StepKind.rewindCode, filesChanged: ["src/util.ts"], sentence: "A rewind puts src/util.ts back to its earlier text." },
  { nodeId: listFillerIds()[1]!, kind: EngineV3StepKind.rewindChatOnly, filesChanged: [], sentence: "A rewind of the chat only. No file changes." },
];

function findAnnotationById(annotations: readonly Annotation[], nodeId: Uuid): Annotation | undefined {
  for (const annotation of annotations) {
    const isNode = annotation.id.equals(nodeId);
    if (isNode) {
      return annotation;
    }
  }
  return undefined;
}

function buildCommitSentence(commit: FixtureCommit, isFirstCommit: boolean): string {
  const overwrites = `Commit ${commit.hash} overwrites the files named in it with the commit's files: ${commit.files.join(", ")}.`;
  if (isFirstCommit) {
    return `This is the first commit in the repo. ${overwrites}`;
  }
  return overwrites;
}

function buildCommitSteps(): EngineV3Step[] {
  const steps: EngineV3Step[] = [];
  for (const [index, commit] of COMMITS.entries()) {
    const sentence = buildCommitSentence(commit, index === 0);
    steps.push({ nodeId: new Uuid(commit.hash), nodeTime: new Date(parseMs(commit.at)), kind: EngineV3StepKind.commit, filesChanged: commit.files, sentence });
  }
  return steps;
}

function buildSessionSteps(): EngineV3Step[] {
  const annotations = buildFixtureLayer1View().annotations!;
  const steps: EngineV3Step[] = [];
  for (const draft of STEP_DRAFTS) {
    const node = findAnnotationById(annotations, draft.nodeId);
    if (node === undefined) {
      throw new Error(`the fixture has no Session column node ${draft.nodeId}`);
    }
    steps.push({ ...draft, nodeTime: node.instant });
  }
  return steps;
}

function compareStepTimes(left: EngineV3Step, right: EngineV3Step): number {
  return left.nodeTime.getTime() - right.nodeTime.getTime();
}

// Array.sort is stable: commits come first in the concatenation, so a commit wins a tie with a Session step.
export function buildFixtureEngineV3Steps(): EngineV3Step[] {
  return [...buildCommitSteps(), ...buildSessionSteps()].sort(compareStepTimes);
}
