// The recorded debt report runs eslint twice per tracked file, which takes minutes in the container; the replay runs the fix script instead.

import { join } from "node:path";

const DEBT_REPORT_CALL_PATTERN = /\bnode\s+\S*debt-ratchet-report\.ts/g;
const FIX_SCRIPT = join(import.meta.dirname, "engineV3_debt_report_fix.ts");

export function replaceDebtReportCall(command: string): string {
  return command.replace(DEBT_REPORT_CALL_PATTERN, `node '${FIX_SCRIPT}'`);
}
