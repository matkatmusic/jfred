// The per-line model's genesis sentinel. A LineEntry.oldLineNum of DOES_NOT_EXIST_YET marks a line with no predecessor in the previous revision — it was born (inserted/genesis) at this revision, so it "did not exist yet" one revision earlier. A leaf module (it imports nothing from the engine) so engine/replay/render may all import it as a value without a runtime cycle. Design: plans/reconstruction-engine-design.md ("The per-line model").
export const DOES_NOT_EXIST_YET = -1;

