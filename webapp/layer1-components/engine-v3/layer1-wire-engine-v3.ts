// engineV3 mockup wire vocabulary: one step per Session column node (fixture mode only, fake data).

export const EngineV3StepKind = {
  commit: "commit",
  edit: "edit",
  script: "script",
  snapshot: "snapshot",
  rewindCode: "rewind-code",
  rewindChatOnly: "rewind-chat-only",
  noFileChange: "no-file-change",
} as const;
export type EngineV3StepKind = (typeof EngineV3StepKind)[keyof typeof EngineV3StepKind];

// nodeId is the Session column record id, or the commit hash for a commit step; filesChanged are repo-relative paths.
export interface WireEngineV3StepOf<I, U> {
  nodeId: U;
  nodeTime: I;
  kind: EngineV3StepKind;
  filesChanged: string[];
  sentence: string;
}

export type WireEngineV3Step = WireEngineV3StepOf<string, string>;

export interface WireEngineV3Steps {
  steps: WireEngineV3Step[];
}
