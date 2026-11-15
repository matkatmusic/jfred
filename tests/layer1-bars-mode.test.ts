import assert from "node:assert/strict";
import { test } from "node:test";
import {
    BARS_VIEW_ON_CLASS,
    BarsViewMode,
    getBarsViewMode,
    installBarsViewSlider,
    isBarsViewOn,
    registerBarsViewModeChange,
    setBarsViewMode,
} from "../webapp/layer1-components/bars-view/layer1-bars-mode.ts";
import { initBarsDom } from "./layer1-bars-test-helpers.ts";

function buildPageWithSliderInstalled(): { appWindow: HTMLElement; slider: HTMLInputElement } {
    initBarsDom();
    const appWindow = document.createElement("div");
    appWindow.id = "appWindow";
    document.body.appendChild(appWindow);
    installBarsViewSlider();
    const slider = document.getElementById("barsViewSliderInput") as HTMLInputElement;
    return { appWindow, slider };
}

function moveSliderTo(slider: HTMLInputElement, value: string): void {
    slider.value = value;
    slider.dispatchEvent(new window.Event("input"));
}

// This test must stay first in the file: it reads the module state before any install.
test("test_the_mode_is_bubbles_before_the_slider_is_installed", () => {
    // Step: nothing has been installed in this file yet.
    // Step: the mode reads bubbles.
    assert.equal(getBarsViewMode(), BarsViewMode.bubbles);
    // Step: the Bars view reports off.
    assert.equal(isBarsViewOn(), false);
});

test("test_the_mode_is_bars_after_the_slider_is_installed", () => {
    // Step: build the page and install the slider.
    buildPageWithSliderInstalled();
    // Step: the mode reads bars and the Bars view reports on.
    assert.equal(getBarsViewMode(), BarsViewMode.bars);
    assert.equal(isBarsViewOn(), true);
});

test("test_the_app_window_has_the_bars_class_in_bars_mode", () => {
    // Step: build the page and install the slider.
    const { appWindow } = buildPageWithSliderInstalled();
    // Step: the app window carries the Bars class.
    assert.equal(appWindow.classList.contains(BARS_VIEW_ON_CLASS), true);
});

test("test_moving_the_slider_to_one_leaves_bars_mode_and_removes_the_class", () => {
    // Step: build the page and install the slider.
    const { appWindow, slider } = buildPageWithSliderInstalled();
    // Step: move the slider to "1".
    moveSliderTo(slider, "1");
    // Step: the mode is bubbles and the class is gone.
    assert.equal(getBarsViewMode(), BarsViewMode.bubbles);
    assert.equal(appWindow.classList.contains(BARS_VIEW_ON_CLASS), false);
});

test("test_moving_the_slider_back_to_zero_returns_to_bars_mode", () => {
    // Step: build the page, install the slider, and move it to "1".
    const { appWindow, slider } = buildPageWithSliderInstalled();
    moveSliderTo(slider, "1");
    // Step: move the slider back to "0".
    moveSliderTo(slider, "0");
    // Step: the mode is bars and the class is back.
    assert.equal(getBarsViewMode(), BarsViewMode.bars);
    assert.equal(appWindow.classList.contains(BARS_VIEW_ON_CLASS), true);
});

test("test_the_registered_callback_runs_on_each_change", () => {
    // Step: build the page and register a callback that counts its calls.
    const { slider } = buildPageWithSliderInstalled();
    let callCount = 0;
    registerBarsViewModeChange(() => {
        callCount += 1;
    });
    // Step: moving the slider twice runs the callback twice.
    moveSliderTo(slider, "1");
    moveSliderTo(slider, "0");
    assert.equal(callCount, 2);
    // Step: setBarsViewMode runs the callback too.
    setBarsViewMode(BarsViewMode.bubbles);
    assert.equal(callCount, 3);
    // Step: a second register replaces the first callback.
    let secondCallCount = 0;
    registerBarsViewModeChange(() => {
        secondCallCount += 1;
    });
    setBarsViewMode(BarsViewMode.bars);
    assert.equal(callCount, 3);
    assert.equal(secondCallCount, 1);
});

test("test_installing_the_slider_does_not_run_the_callback", () => {
    // Step: register a callback that counts its calls.
    let callCount = 0;
    registerBarsViewModeChange(() => {
        callCount += 1;
    });
    // Step: build the page and install the slider.
    buildPageWithSliderInstalled();
    // Step: the callback has not run.
    assert.equal(callCount, 0);
});

test("test_setting_the_mode_moves_the_slider_value", () => {
    // Step: build the page and install the slider.
    const { slider } = buildPageWithSliderInstalled();
    // Step: set bubbles mode: the slider reads "1".
    setBarsViewMode(BarsViewMode.bubbles);
    assert.equal(slider.value, "1");
    // Step: set bars mode: the slider reads "0".
    setBarsViewMode(BarsViewMode.bars);
    assert.equal(slider.value, "0");
});
