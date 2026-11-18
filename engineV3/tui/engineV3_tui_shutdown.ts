import type { Path } from "../../src/structures/domain.ts";
import { releaseTuiLock } from "./engineV3_tui_settings.ts";
// import { endAllLiveChildren } from "./engineV3_tui_step_process.ts";
import type { StepPool } from "./engineV3_tui_walk_types.ts";

export async function shutdownTui(pool: StepPool, storeFolder: Path): Promise<void> {
    pool.stopStarting();
    // await endAllLiveChildren();
    await pool.cancelAll();
    releaseTuiLock(storeFolder);
}

const SHUTDOWN_SIGNALS: NodeJS.Signals[] = ["SIGTERM", "SIGHUP"];

export function registerShutdownSignalHandlers(pool: StepPool, storeFolder: Path): void {
    for (const signal of SHUTDOWN_SIGNALS) {
        process.once(signal, () => {
            shutdownTui(pool, storeFolder).then(() => process.exit(0));
        });
    }
}
