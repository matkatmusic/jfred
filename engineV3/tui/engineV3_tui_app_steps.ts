// Step and model-memo helpers of the terminal UI root component.

import type { Path } from "../../src/structures/domain.ts";
import { FileWalkStatus, JumpSpeed, MarkerDirection } from "../../src/structures/vocabulary.ts";
import type { BarFileModel } from "../../webapp/layer1-components/bars-view/layer1-bars-model.ts";
import type { RulerRow } from "../../webapp/layer1-components/ruler/layer1-ruler-rows.ts";
import type { AppProps, FileTimes } from "./engineV3_tui_app_types.ts";
import { listFilesWithOldestEventNewerThan } from "./engineV3_tui_app_rows.ts";
import { buildTuiBarModels } from "./engineV3_tui_bars.ts";
import { computeNextMarker, listEventsOfFile, type MarkerBounds, type TimeMarker } from "./engineV3_tui_time_marker.ts";
import type { VisibleRowRange } from "./engineV3_tui_viewport.ts";
import { getFileRunState } from "./engineV3_tui_walk_state.ts";

export type FileModelMemo = Map<string, { status: FileWalkStatus; model: BarFileModel }>;

export type StepContext = {
    props: AppProps;
    speed: JumpSpeed;
    marker: TimeMarker;
    bounds: MarkerBounds;
    range: VisibleRowRange;
    getTimeOfFile: (file: Path) => Date;
};

export function getMemoizedFileModel(memo: FileModelMemo, props: AppProps, rulerRows: RulerRow[], file: Path): BarFileModel {
    const status = getFileRunState(props.walkState, file).status;
    const memoEntry = memo.get(file.value);
    if (memoEntry !== undefined) {
        if (memoEntry.status === status) {
            return memoEntry.model;
        }
    }
    const model = buildTuiBarModels([props.loadFileWire(file)], rulerRows)[0]!;
    memo.set(file.value, { status, model });
    return model;
}

export function stepSelectedFiles(context: StepContext, files: Path[], fileTimes: FileTimes, direction: MarkerDirection): FileTimes {
    const nextFileTimes: FileTimes = new Map(fileTimes);
    for (const file of files) {
        const fileTime: TimeMarker = { instant: context.getTimeOfFile(file), eventIndex: undefined };
        const move = computeNextMarker(context.speed, listEventsOfFile(context.props.events, file), context.bounds, fileTime, direction);
        nextFileTimes.set(file.value, move.marker.instant);
        context.props.walker.walkHistoryTo(move.marker.instant, file, true);
    }
    return nextFileTimes;
}

export function stepProjectMarker(context: StepContext, direction: MarkerDirection): TimeMarker {
    const { props, range } = context;
    const move = computeNextMarker(context.speed, props.events, context.bounds, context.marker, direction);
    const newTime = move.marker.instant;
    if (context.speed !== JumpSpeed.Event) {
        for (const [index, file] of props.files.entries()) {
            props.walker.walkHistoryTo(newTime, file, index >= range.top && index < range.bottom);
        }
    }
    if (move.steppedFile !== undefined) {
        props.walker.walkHistoryTo(newTime, move.steppedFile, true);
        for (const file of listFilesWithOldestEventNewerThan(props.files, props.events, newTime)) {
            if (!props.isTimeSpannedForFile(file, newTime)) {
                props.walker.walkHistoryTo(newTime, file, true);
            }
        }
    }
    return move.marker;
}
