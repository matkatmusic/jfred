// The "reverse" toggle only holds on/off state and tells its listener; it remembers nothing across reloads.

import { getRequiredElementById } from "../../app-dom.ts";

let reverseOn = false;

// Registered by the code that reacts to the toggle, so this file needs no import of it.
let notifyReverseChange: () => void = () => {};

export function registerReverseChange(callback: () => void): void {
  notifyReverseChange = callback;
}

export function isReverseOn(): boolean {
  return reverseOn;
}

export function resetReverseToggle(): void {
  reverseOn = false;
  getRequiredElementById("reverse-toggle").classList.remove("current");
}

export function turnReverseOff(): void {
  reverseOn = false;
  getRequiredElementById("reverse-toggle").classList.remove("current");
  notifyReverseChange();
}

function flipReverseToggle(): void {
  reverseOn = !reverseOn;
  getRequiredElementById("reverse-toggle").classList.toggle("current", reverseOn);
  notifyReverseChange();
}

export function installReverseToggle(): void {
  getRequiredElementById("reverse-toggle").addEventListener("click", flipReverseToggle);
}
