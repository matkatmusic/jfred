export const BarsViewMode = { bars: "bars", bubbles: "bubbles" } as const;
export type BarsViewMode = (typeof BarsViewMode)[keyof typeof BarsViewMode];
export const BARS_VIEW_ON_CLASS = "barsViewOn";
export function getBarsViewMode(): BarsViewMode {
    throw new Error("not built: getBarsViewMode");
}
export function isBarsViewOn(): boolean {
    throw new Error("not built: isBarsViewOn");
}
// Sets the mode, toggles BARS_VIEW_ON_CLASS on #appWindow, sets the slider value, then calls the registered callback.
export function setBarsViewMode(mode: BarsViewMode): void {
    throw new Error("not built: setBarsViewMode");
}
export function registerBarsViewModeChange(callback: () => void): void {
    throw new Error("not built: registerBarsViewModeChange");
}
// Wires the input event of #barsViewSliderInput and applies the default mode Bars (without calling the callback).
export function installBarsViewSlider(): void {
    throw new Error("not built: installBarsViewSlider");
}
