// Real-mouse checks: a pressed plain button moves 2px right and 2px down, and moves back on release.
import type { MouseHeadlessPage } from "./cdp.ts";
import { reportCheck } from "./mockup-checks.ts";

const PRESS_NUDGE_PX = 2;
const READ_BUTTON_BOX = `(() => {
    const box = document.getElementById('zoom-reset').getBoundingClientRect();
    return { x: box.x, y: box.y, width: box.width, height: box.height };
})()`;

interface ButtonBox { x: number; y: number; width: number; height: number }

export async function validateButtonPressNudge(page: MouseHeadlessPage): Promise<void> {
  const resting = await page.evaluate<ButtonBox>(READ_BUTTON_BOX);
  const centreX = resting.x + resting.width / 2;
  const centreY = resting.y + resting.height / 2;
  await page.dispatchMouse("mouseMoved", centreX, centreY);
  await page.dispatchMouse("mousePressed", centreX, centreY);
  const pressed = await page.evaluate<ButtonBox>(READ_BUTTON_BOX);
  const pressedDx = pressed.x - resting.x;
  const pressedDy = pressed.y - resting.y;
  reportCheck("mousedown on a button moves its x/y position 2 pixels", pressedDx === PRESS_NUDGE_PX && pressedDy === PRESS_NUDGE_PX, { pressedDx, pressedDy });
  await page.dispatchMouse("mouseReleased", centreX, centreY);
  const released = await page.evaluate<ButtonBox>(READ_BUTTON_BOX);
  const releasedDx = released.x - pressed.x;
  const releasedDy = released.y - pressed.y;
  const isBackAtStart = released.x === resting.x && released.y === resting.y;
  reportCheck("mouseup on a mousedown'd button moves its x/y position -2 pixels", releasedDx === -PRESS_NUDGE_PX && releasedDy === -PRESS_NUDGE_PX && isBackAtStart, { releasedDx, releasedDy });
}
