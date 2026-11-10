// Layer 1 run dot marks: one svg shape per run state and per file rating.

export const RunMarkKey = {
  notRun: "not-run",
  running: "running",
  replayed: "replayed",
  replayFailed: "replay-failed",
  notReplayed: "not-replayed",
  originalFailed: "original-failed",
  cancelled: "cancelled",
  verified: "verified",
  mismatch: "mismatch",
  injectedUnverified: "injected-unverified",
  deleted: "deleted",
  changedNotText: "changed-not-text",
} as const;
export type RunMarkKey = (typeof RunMarkKey)[keyof typeof RunMarkKey];

const MARK_STROKE = 'fill="none" stroke="currentColor"';
const DOT_VIEW_BOX = "0 0 13 13";
const STRIKE_VIEW_BOX = "0 0 16 16";

const MARK_SHAPES: Record<RunMarkKey, string> = {
  [RunMarkKey.notRun]: `<path d="M3.4 3.9C3.4 1.9 4.8 0.9 6.5 0.9C8.3 0.9 9.6 2 9.6 3.6C9.6 5.4 6.5 5.8 6.5 8.2" ${MARK_STROKE} stroke-width="1.8"/><circle cx="6.5" cy="11.9" r="1.1" fill="currentColor"/>`,
  [RunMarkKey.running]: `<circle cx="6.5" cy="6.5" r="4.75" ${MARK_STROKE} stroke-width="3.5" stroke-dasharray="7.5 22.4"/>`,
  [RunMarkKey.replayed]: `<path d="M2 0L13 6.5L2 13Z" fill="currentColor"/>`,
  [RunMarkKey.replayFailed]: `<path d="M1.5 0.6L11.5 12.4M11.5 0.6L1.5 12.4" ${MARK_STROKE} stroke-width="2"/>`,
  [RunMarkKey.notReplayed]: `<rect x="0" y="5.4" width="13" height="2.2" fill="currentColor"/>`,
  [RunMarkKey.originalFailed]: `<rect x="5.2" y="0" width="2.6" height="8.4" fill="currentColor"/><circle cx="6.5" cy="11.7" r="1.3" fill="currentColor"/>`,
  [RunMarkKey.cancelled]: `<path d="M0 0L16 16" ${MARK_STROKE} stroke-width="2.3"/>`,
  [RunMarkKey.verified]: `<path d="M1.2 7.4L4.6 12L11.4 1" ${MARK_STROKE} stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>`,
  [RunMarkKey.mismatch]: `<rect x="0.5" y="3.4" width="12" height="2.2" fill="currentColor"/><rect x="0.5" y="7.4" width="12" height="2.2" fill="currentColor"/><path d="M8.8 0.4L4.2 12.6" ${MARK_STROKE} stroke-width="1.8"/>`,
  [RunMarkKey.injectedUnverified]: `<path d="M6.5 0L13 13H0Z" fill="currentColor"/><rect x="5.7" y="4.6" width="1.6" height="4.2" fill="#0b0b0b"/><circle cx="6.5" cy="10.8" r="0.9" fill="#0b0b0b"/>`,
  [RunMarkKey.deleted]: `<path d="M0.8 2.9H12.2M4.5 2.9V0.9H8.5V2.9M2.3 2.9L3.1 12.1H9.9L10.7 2.9" ${MARK_STROKE} stroke-width="1.5" stroke-linejoin="round"/>`,
  [RunMarkKey.changedNotText]: `<rect x="1.3" y="1.3" width="10.4" height="10.4" ${MARK_STROKE} stroke-width="1.6"/><path d="M1.3 11.7L11.7 1.3" ${MARK_STROKE} stroke-width="1.6"/>`,
};

export function buildRunMarkMarkup(key: RunMarkKey): string {
  const viewBox = key === RunMarkKey.cancelled ? STRIKE_VIEW_BOX : DOT_VIEW_BOX;
  return `<svg class="run-mark mark-${key}" viewBox="${viewBox}" aria-hidden="true">${MARK_SHAPES[key]}</svg>`;
}
