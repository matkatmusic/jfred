import { getInputById, getRequiredElementById } from "../../app-dom.ts";

export const BarsViewMode = { bars: "bars", bubbles: "bubbles" } as const;
export type BarsViewMode = (typeof BarsViewMode)[keyof typeof BarsViewMode];
export const BARS_VIEW_ON_CLASS = "barsViewOn";

const SLIDER_VALUE_BARS = "0";
const SLIDER_VALUE_BUBBLES = "1";

let currentMode: BarsViewMode = BarsViewMode.bubbles;
let modeChangeCallback: (() => void) | null = null;

export function getBarsViewMode(): BarsViewMode {
    return currentMode;
}

export function isBarsViewOn(): boolean {
    return currentMode === BarsViewMode.bars;
}

function applyBarsViewMode(mode: BarsViewMode): void {
    currentMode = mode;
    getRequiredElementById("appWindow").classList.toggle(BARS_VIEW_ON_CLASS, mode === BarsViewMode.bars);
    getInputById("barsViewSliderInput").value = mode === BarsViewMode.bars ? SLIDER_VALUE_BARS : SLIDER_VALUE_BUBBLES;
}

// Sets the mode, toggles BARS_VIEW_ON_CLASS on #appWindow, sets the slider value, then calls the registered callback.
export function setBarsViewMode(mode: BarsViewMode): void {
    applyBarsViewMode(mode);
    if (modeChangeCallback !== null) {
        modeChangeCallback();
    }
}

export function registerBarsViewModeChange(callback: () => void): void {
    modeChangeCallback = callback;
}

// Wires the input event of #barsViewSliderInput and applies the default mode Bars (without calling the callback).
export function installBarsViewSlider(): void {
    const slider = getInputById("barsViewSliderInput");
    slider.addEventListener("input", () => {
        setBarsViewMode(slider.value === SLIDER_VALUE_BARS ? BarsViewMode.bars : BarsViewMode.bubbles);
    });
    applyBarsViewMode(BarsViewMode.bars);
}
