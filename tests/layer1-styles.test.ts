// Layer 1 stylesheet checks: branch lane lines show in dark mode, and a lit node's brackets fit its dot.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const css = readFileSync(new URL("../webapp/layer1-styles.css", import.meta.url), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
const LIGHT_BLOCK = ".viz-root {";
const DARK_BLOCK = ':root[data-theme="dark"] .viz-root {';
const LIGHT_THEME_MIN_DIFFERENCE = 28;
const DARK_THEME_MIN_DIFFERENCE = 40;

function readDeclarationsOf(selector: string): Map<string, string> {
  const declarations = new Map<string, string>();
  for (const [, selectorList, body] of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const selectors = selectorList!.split(",").map((entry) => entry.trim());
    if (!selectors.includes(selector)) continue;
    for (const [, name, value] of body!.matchAll(/([\w-]+)\s*:\s*([^;]+);?/g)) {
      declarations.set(name!, value!.trim());
    }
  }
  return declarations;
}

function readThemeColour(block: string, name: string): number {
  const hex = css.slice(css.indexOf(block)).match(new RegExp(`--${name}:\\s*#([0-9a-f]{2})`, "i"));
  return parseInt(hex![1]!, 16);
}

function measureDifferenceFromSurface(selector: string, block: string, borderProperty: string): number {
  const declarations = readDeclarationsOf(selector);
  const colourName = declarations.get(borderProperty)!.match(/var\(--([\w-]+)\)/)![1]!;
  const opacity = parseFloat(declarations.get("opacity")!);
  return Math.abs(readThemeColour(block, "surface") - readThemeColour(block, colourName)) * opacity;
}

test("bug 477: the dashed branch rail and elbows are brighter than the baseline lines of both old versions in dark mode", () => {
  // Old dark differences: baseline .3/.35 gave 9 and 10.5; baseline .5/.6 gave 15 and 18.
  const lines = [[".brail", "border-left"], [".split-elbow", "border-right"], [".merge-elbow", "border-right"]] as const;
  for (const [selector, borderProperty] of lines) {
    const difference = measureDifferenceFromSurface(selector, DARK_BLOCK, borderProperty);
    assert.ok(difference >= DARK_THEME_MIN_DIFFERENCE, `${selector} in dark mode differs by only ${difference}`);
  }
});

test("bug 477: in light mode the branch lines keep the pre-611db1e contrast", () => {
  // Old light differences: baseline .5 gave 28.5 on the rail, .6 gave 34.2 on the elbows.
  for (const [selector, borderProperty] of [[".brail", "border-left"], [".split-elbow", "border-right"]] as const) {
    const difference = measureDifferenceFromSurface(selector, LIGHT_BLOCK, borderProperty);
    assert.ok(difference >= LIGHT_THEME_MIN_DIFFERENCE, `${selector} in light mode differs by only ${difference}`);
  }
});

function readThemeRgb(block: string, name: string): number[] {
  const hex = css.slice(css.indexOf(block)).match(new RegExp(`--${name}:\\s*#([0-9a-f]{6})`, "i"))![1]!;
  return [0, 2, 4].map((start) => parseInt(hex.slice(start, start + 2), 16));
}

function measureBranchNodeDifference(block: string, colourName: string): number {
  const opacity = parseFloat(readDeclarationsOf(".bnode").get("opacity")!);
  const surface = readThemeRgb(block, "surface");
  return readThemeRgb(block, colourName).reduce((sum, channel, index) => sum + Math.abs(channel - surface[index]!) * opacity, 0);
}

test("the main line uses the branch line colour", () => {
  assert.equal(readDeclarationsOf(".lane .lrail").get("border-left"), "1.5px solid var(--branch-line)");
});

test("branch lane dots are brighter than the old user colour against the dark surface", () => {
  const colourName = readDeclarationsOf(".bnode").get("background")!.match(/var\(--([\w-]+)\)/)![1]!;
  assert.ok(measureBranchNodeDifference(DARK_BLOCK, colourName) > measureBranchNodeDifference(DARK_BLOCK, "c-user"));
});

test("bug 495: a lit or aimed node's brackets are no taller than the dot", () => {
  const brackets = [".node.found::before", ".node.found::after", ".node.aimed::before", ".node.aimed::after", ".bnode.found::before", ".bnode.found::after"];
  for (const selector of brackets) {
    const dotSelector = selector.startsWith(".bnode") ? ".bnode" : ".node";
    const dotHeight = parseFloat(readDeclarationsOf(dotSelector).get("height")!);
    const declarations = readDeclarationsOf(selector);
    const bracketHeight = dotHeight - parseFloat(declarations.get("top")!) - parseFloat(declarations.get("bottom")!);
    assert.ok(bracketHeight <= dotHeight, `${selector} is ${bracketHeight}px tall, the dot is ${dotHeight}px`);
  }
});
