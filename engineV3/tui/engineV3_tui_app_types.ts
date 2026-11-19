// Contract of the Ink root component (plan Stage B8). Types only.

import type { Path } from "../../src/structures/domain.ts";
import type { GuessCategory } from "../../src/structures/vocabulary.ts";
import type { InverseRepoFileWire } from "../../webapp/layer1-components/bars-view/layer1-bars-wire.ts";
import type { ConsentAnswers, ConsentQuestion } from "./engineV3_tui_consent.ts";
import type { EngineLog } from "./engineV3_tui_engine_log.ts";
import type { KeyBox, KeyBoxSettings, Keymap } from "./engineV3_tui_keymap.ts";
import type { FileEventCounts, ProjectEventEntry } from "./engineV3_tui_project_cache.ts";
import type { WalkState } from "./engineV3_tui_walk_state.ts";
import type { HistoryWalker, StepPool } from "./engineV3_tui_walk_types.ts";

export type AppProps = {
    terminalRows: number;
    terminalColumns: number;
    projectFolder: Path;
    storeFolder: Path;
    files: Path[];
    events: ProjectEventEntry[];
    countsByFile: Map<string, FileEventCounts>;
    // only the files that need guesses are keys
    guessCategoryByFile: Map<string, GuessCategory>;
    keymap: Keymap;
    keyBoxes: Record<KeyBox, KeyBoxSettings>;
    engineLog: EngineLog;
    openLogFolder: () => void;
    walkState: WalkState;
    walker: HistoryWalker;
    pool: StepPool;
    scriptCounts: { mayWrite: number; readOnly: number };
    consentAnswers: ConsentAnswers;
    staleRepoCount: number;
    // text for the header barbershop while the project cache loads, undefined once loaded
    cacheStatusText: string | undefined;
    // the root re-renders whenever the walk state changes
    subscribeToStatusChanges: (listener: () => void) => () => void;
    // default in jfredTUI: (file) => listInverseRepoFileWire(storeFolder, projectFolder, file)
    loadFileWire: (file: Path) => InverseRepoFileWire;
    // default: readWalkCoverage + isInstantSpannedByWalkCoverage
    isTimeSpannedForFile: (file: Path, instant: Date) => boolean;
    onConsentAnswered: (answerKey: ConsentQuestion["answerKey"], answer: boolean) => void;
    onResetSelectedStores: (files: Path[]) => Promise<void>;
    onResetAllStores: () => Promise<void>;
    onPlayScript: (file: Path, startAt: Date) => Promise<void>;
};

export type SelectionState = { cursorIndex: number; selectedFiles: Path[]; lastToggledIndex: number | undefined };

// own time per file, keyed by path string
export type FileTimes = Map<string, Date>;
