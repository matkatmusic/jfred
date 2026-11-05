// Lists every difference between two computed-style captures, optionally only for a list of property names.

// Shared value, style (a change list on the style before) and path tables; each state maps paths to styles.
export interface StyleCapture {
  properties: string[];
  values: string[];
  styles: number[][];
  paths: string[];
  states: Record<string, Record<string, number>>;
}

export interface StyleDifference {
  state: string;
  path: string;
  property: string;
  before: string;
  after: string;
}

interface CompareContext {
  before: StyleCapture;
  after: StyleCapture;
  names: string[];
  beforeRows: Int32Array[];
  afterRows: Int32Array[];
  sameStylePairs: Map<number, boolean>;
}

export const ELEMENT_PROPERTY = "<element>";
const PRESENT = "present";
const ABSENT = "absent";
const NO_VALUE = -1;
const ABSENT_PROPERTY = -2;
const PAIR_KEY_FACTOR = 100_000_000;

function buildStyleIndexByPath(capture: StyleCapture, state: string): Map<string, number> {
  const styleIndexByPath = new Map<string, number>();
  for (const [pathIndex, styleIndex] of Object.entries(capture.states[state] ?? {})) {
    styleIndexByPath.set(capture.paths[Number(pathIndex)]!, styleIndex);
  }
  return styleIndexByPath;
}

function selectColumns(fullRow: Int32Array, positions: number[]): Int32Array {
  const row = new Int32Array(positions.length);
  for (const [column, position] of positions.entries()) {
    row[column] = position === -1 ? ABSENT_PROPERTY : fullRow[position]!;
  }
  return row;
}

// Styles are change lists on the style before; only the `names` columns are kept, to save memory.
export function buildStyleRows(capture: StyleCapture, names: string[] = capture.properties): Int32Array[] {
  const positions: number[] = [];
  for (const name of names) {
    positions.push(capture.properties.indexOf(name));
  }
  const rows: Int32Array[] = [];
  const fullRow = new Int32Array(capture.properties.length).fill(NO_VALUE);
  for (const changes of capture.styles) {
    for (let at = 0; at < changes.length; at += 2) {
      fullRow[changes[at]!] = changes[at + 1]!;
    }
    rows.push(selectColumns(fullRow, positions));
  }
  return rows;
}

// Unset in an older row reads as empty text; never listed by the capture reads as absent.
function readValueText(capture: StyleCapture, row: Int32Array, column: number): string {
  const valueIndex = row[column]!;
  if (valueIndex === ABSENT_PROPERTY) {
    return ABSENT;
  }
  return valueIndex === NO_VALUE ? "" : capture.values[valueIndex]!;
}

function isSameStyleText(context: CompareContext, beforeIndex: number, afterIndex: number): boolean {
  const beforeRow = context.beforeRows[beforeIndex]!;
  const afterRow = context.afterRows[afterIndex]!;
  for (const column of context.names.keys()) {
    const isDifferent = readValueText(context.before, beforeRow, column) !== readValueText(context.after, afterRow, column);
    if (isDifferent) {
      return false;
    }
  }
  return true;
}

function isSameStyleCached(context: CompareContext, beforeIndex: number, afterIndex: number): boolean {
  const pairKey = beforeIndex * PAIR_KEY_FACTOR + afterIndex;
  const knownAnswer = context.sameStylePairs.get(pairKey);
  if (knownAnswer !== undefined) {
    return knownAnswer;
  }
  const answer = isSameStyleText(context, beforeIndex, afterIndex);
  context.sameStylePairs.set(pairKey, answer);
  return answer;
}

function addStyleChange(differences: StyleDifference[], context: CompareContext, state: string, path: string, indexes: [number, number]): void {
  const [beforeIndex, afterIndex] = indexes;
  const isSameStyle = isSameStyleCached(context, beforeIndex, afterIndex);
  if (isSameStyle) {
    return;
  }
  for (const [column, property] of context.names.entries()) {
    const before = readValueText(context.before, context.beforeRows[beforeIndex]!, column);
    const after = readValueText(context.after, context.afterRows[afterIndex]!, column);
    const isChanged = before !== after;
    if (isChanged) {
      differences.push({ state, path, property, before, after });
    }
  }
}

function addPathDifference(differences: StyleDifference[], context: CompareContext, state: string, path: string, indexes: [number | undefined, number | undefined]): void {
  const [beforeIndex, afterIndex] = indexes;
  if (beforeIndex === undefined) {
    differences.push({ state, path, property: ELEMENT_PROPERTY, before: ABSENT, after: PRESENT });
    return;
  }
  if (afterIndex === undefined) {
    differences.push({ state, path, property: ELEMENT_PROPERTY, before: PRESENT, after: ABSENT });
    return;
  }
  addStyleChange(differences, context, state, path, [beforeIndex, afterIndex]);
}

function addStateDifferences(differences: StyleDifference[], context: CompareContext, state: string): void {
  const beforeStyles = buildStyleIndexByPath(context.before, state);
  const afterStyles = buildStyleIndexByPath(context.after, state);
  const paths = new Set([...beforeStyles.keys(), ...afterStyles.keys()]);
  for (const path of paths) {
    addPathDifference(differences, context, state, path, [beforeStyles.get(path), afterStyles.get(path)]);
  }
}

// With no list, every property either capture lists is compared.
export function listStyleDifferences(before: StyleCapture, after: StyleCapture, propertyNames?: string[]): StyleDifference[] {
  const names = propertyNames ?? [...new Set([...before.properties, ...after.properties])];
  const context: CompareContext = { before, after, names, beforeRows: buildStyleRows(before, names), afterRows: buildStyleRows(after, names), sameStylePairs: new Map() };
  const differences: StyleDifference[] = [];
  const stateNames = new Set([...Object.keys(before.states), ...Object.keys(after.states)]);
  for (const state of stateNames) {
    addStateDifferences(differences, context, state);
  }
  return differences;
}
