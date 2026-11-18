// Row helpers of the terminal UI root component: row state text and files whose oldest event is newer than a time.

import type { Path } from "../../src/structures/domain.ts";
import { describeFinalState, describeFoldedState, isBarFileChangedSince, type BarFileModel } from "../../webapp/layer1-components/bars-view/layer1-bars-model.ts";
import type { ProjectEventEntry } from "./engineV3_tui_project_cache.ts";
import { listEventsOfFile } from "./engineV3_tui_time_marker.ts";

export function describeRowState(model: BarFileModel, time: Date, markerRowIndex: number): string {
    const storedInstants = model.commits.flatMap((commit) => (commit.instant === null ? [] : [Date.parse(commit.instant)]));
    let selectedRowIndex = markerRowIndex;
    if (storedInstants.length > 0) {
        if (Math.min(...storedInstants) > time.getTime()) {
            selectedRowIndex = Math.max(markerRowIndex, model.bornRowIndex + 1);
        }
    }
    if (isBarFileChangedSince(model, selectedRowIndex)) {
        return describeFinalState(model, selectedRowIndex);
    }
    return describeFoldedState(model, selectedRowIndex);
}

export function listFilesWithOldestEventNewerThan(files: Path[], events: ProjectEventEntry[], time: Date): Path[] {
    return files.filter((file) => {
        const fileEvents = listEventsOfFile(events, file);
        return fileEvents.length > 0 && fileEvents[fileEvents.length - 1]!.instant.getTime() > time.getTime();
    });
}
