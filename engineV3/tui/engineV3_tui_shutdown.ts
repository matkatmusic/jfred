import type { Path } from "../../src/structures/domain.ts";
import { releaseTuiLock } from "./engineV3_tui_settings.ts";
import { endAllLiveChildren } from "./engineV3_tui_step_process.ts";
import type { StepPool } from "./engineV3_tui_walk_types.ts";

export async function shutdownTui(pool: StepPool, storeFolder: Path): Promise<void> {
    pool.stopStarting();
    await endAllLiveChildren();
    releaseTuiLock(storeFolder);
}
