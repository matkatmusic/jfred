// Types shared by the terminal UI walk, pool and step process modules.

import type { Path } from "../../src/structures/domain.ts";
import type { PlayOutcomeKind, ScriptAction, StepProcessOutcomeKind } from "../../src/structures/vocabulary.ts";
import type { EarliestBoundary } from "../engineV3_earliest_boundary.ts";
import type { FileEventType } from "../engineV3_replay_reverse_events.ts";
import type { StepResultLine } from "../engineV3_step_start_at.ts";
import type { EngineLog } from "./engineV3_tui_engine_log.ts";
import type { FileRunState, WalkState } from "./engineV3_tui_walk_state.ts";

// A --startAt walk of one file; isPassingStops adds --pass-stops.
export type StepRequest = { file: Path; startAt: Date; isPassingStops: boolean };
export type CrashedAtLine = { nextEventIndex: number; eventType: FileEventType | null; source: string | null };
export type StepProcessOutcome =
    | { kind: StepProcessOutcomeKind.Covered; lastLine: StepResultLine }
    | { kind: StepProcessOutcomeKind.Finished; lastLine: StepResultLine }
    | { kind: StepProcessOutcomeKind.Stopped; eventType: FileEventType; source: string | null; lastLine: StepResultLine }
    | { kind: StepProcessOutcomeKind.Crashed; exitCode: number | null; signal: NodeJS.Signals | null; crashedAt: CrashedAtLine | null; stderrTail: string };

export type PlayRequest = { file: Path };
export type PlayOutcome = { kind: PlayOutcomeKind; reasonText: string | undefined };

export type SpawnStepProcess = (request: StepRequest) => Promise<StepProcessOutcome>;
export type SpawnPlayProcess = (request: PlayRequest) => Promise<PlayOutcome>;

// What createSpawnStepProcess and createSpawnPlayProcess need to build a command line.
export type SpawnSettings = {
    projectFolder: Path;
    jsonlsFolders: Path[];
    fileHistoryFolders: Path[];
    storeFolder: Path;
    earliestBoundary: EarliestBoundary | undefined;
    jfredFolder: Path;
    engineLog?: EngineLog;   // every output line of the child goes to it
};

export type StepPoolOptions = {
    maxProcesses: number;
    spawnStepProcess: SpawnStepProcess;
    spawnPlayProcess: SpawnPlayProcess;
    onOutcome: (request: StepRequest, outcome: StepProcessOutcome) => void;
    onStatusChange: (file: Path, runState: FileRunState) => void;
    isFileWalkFinished: (file: Path) => boolean;
    isFileSteppable: (file: Path) => boolean;
    hasLogsGrown: () => boolean;
    isStoreStale?: () => boolean;   // while true the pool starts no child and refuses a play (the store holds stale repos)
    onLogsGrew: () => void;
    consentGate?: Promise<void>;   // while this promise is unresolved the pool starts no walk and no play; requests wait in the queue
    endChildOfFile: (file: Path) => Promise<void>;   // sends the end signal to the running step child of that file and resolves on its exit
    endAllChildren: () => Promise<void>;   // ends every live child and resolves when all have exited
};

export type StepPool = {
    requestWalk(request: StepRequest, isVisible: boolean): void;
    requestPlay(request: PlayRequest, walkToEndFiles: Path[]): Promise<PlayOutcome>;
    cancelFile(file: Path): Promise<void>;
    cancelAll(): Promise<void>;
    stopStarting(): void;
    waitUntilIdle(): Promise<void>;
    listRunningFiles(): Path[];
};

export type HistoryWalkerOptions = {
    storeFolder: Path;
    projectFolder: Path;
    walkState: WalkState;
    requestWalk: (request: StepRequest, isVisible: boolean) => void;
    requestPlay: (request: PlayRequest) => Promise<PlayOutcome>;
    decideScriptAction: (file: Path, eventType: FileEventType, source: string | null) => ScriptAction;
    onStatusChange: (file: Path, runState: FileRunState) => void;
    playKeyName: string;   // display name of the play key from the keymap, named in the stop text
    engineLog?: EngineLog;   // one summary line for each walk outcome and each play outcome
};

export type HistoryWalker = {
    // true = the repo already spans the time, no process requested
    walkHistoryTo(currentTime: Date, file: Path, isVisible: boolean): boolean;
    handleOutcome(request: StepRequest, outcome: StepProcessOutcome): Promise<void>;
    // the play key: asks the pool for a play of the file and writes the row state from the answer; startAt is the time to walk to again after a good replay
    playScript(file: Path, startAt: Date): Promise<void>;
};
