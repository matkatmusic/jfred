// The builder that merges per-state page snapshots into one StyleCapture with shared value, style and path tables.

import type { StyleCapture } from "./computed-style-diff.ts";
import type { PageStyleSnapshot } from "./computed-style-page-probe.ts";

export interface CaptureBuilder {
  capture: StyleCapture;
  valueIndexes: Map<string, number>;
  styleIndexes: Map<string, number>;
  pathIndexes: Map<string, number>;
  lastRow: number[];
}

export function createCaptureBuilder(): CaptureBuilder {
  return {
    capture: { properties: [], values: [], styles: [], paths: [], states: {} },
    valueIndexes: new Map(),
    styleIndexes: new Map(),
    pathIndexes: new Map(),
    lastRow: [],
  };
}

function addIndexedItem<T>(items: T[], indexes: Map<string, number>, key: string, item: T): number {
  const knownIndex = indexes.get(key);
  if (knownIndex !== undefined) {
    return knownIndex;
  }
  indexes.set(key, items.length);
  items.push(item);
  return items.length - 1;
}

// Custom properties set inline appear only in later states: new names are appended, in first-seen order.
function addProperties(capture: StyleCapture, snapshotProperties: string[]): number[] {
  const columns: number[] = [];
  for (const property of snapshotProperties) {
    const knownColumn = capture.properties.indexOf(property);
    const isNew = knownColumn === -1;
    if (isNew) {
      capture.properties.push(property);
    }
    columns.push(isNew ? capture.properties.length - 1 : knownColumn);
  }
  return columns;
}

function addValues(builder: CaptureBuilder, values: string[]): number[] {
  const valueIndexes: number[] = [];
  for (const value of values) {
    valueIndexes.push(addIndexedItem(builder.capture.values, builder.valueIndexes, value, value));
  }
  return valueIndexes;
}

// Flat position, value-index pairs that turn the previous row into this one.
function listRowChanges(previousRow: number[], row: number[]): number[] {
  const changes: number[] = [];
  for (const [position, valueIndex] of row.entries()) {
    const isChanged = previousRow[position] !== valueIndex;
    if (isChanged) {
      changes.push(position, valueIndex);
    }
  }
  return changes;
}

function buildGlobalRow(builder: CaptureBuilder, row: number[], valueIndexes: number[], columns: number[]): number[] {
  const emptyIndex = addIndexedItem(builder.capture.values, builder.valueIndexes, "", "");
  const globalRow = new Array<number>(builder.capture.properties.length).fill(emptyIndex);
  for (const [position, valueIndex] of row.entries()) {
    globalRow[columns[position]!] = valueIndexes[valueIndex]!;
  }
  return globalRow;
}

function addRow(builder: CaptureBuilder, globalRow: number[]): number {
  const rowKey = globalRow.join(",");
  const isKnownRow = builder.styleIndexes.has(rowKey);
  const changes = isKnownRow ? [] : listRowChanges(builder.lastRow, globalRow);
  if (!isKnownRow) {
    builder.lastRow = globalRow;
  }
  return addIndexedItem(builder.capture.styles, builder.styleIndexes, rowKey, changes);
}

function addRows(builder: CaptureBuilder, snapshot: PageStyleSnapshot, valueIndexes: number[], columns: number[]): number[] {
  const styleIndexes: number[] = [];
  for (const row of snapshot.rows) {
    styleIndexes.push(addRow(builder, buildGlobalRow(builder, row, valueIndexes, columns)));
  }
  return styleIndexes;
}

function addElements(builder: CaptureBuilder, elements: [string, number][], styleIndexes: number[]): Record<string, number> {
  const entries: Record<string, number> = {};
  for (const [path, rowIndex] of elements) {
    const pathIndex = addIndexedItem(builder.capture.paths, builder.pathIndexes, path, path);
    entries[pathIndex] = styleIndexes[rowIndex]!;
  }
  return entries;
}

export function addSnapshotToBuilder(builder: CaptureBuilder, state: string, snapshot: PageStyleSnapshot): void {
  const columns = addProperties(builder.capture, snapshot.properties);
  const valueIndexes = addValues(builder, snapshot.values);
  const styleIndexes = addRows(builder, snapshot, valueIndexes, columns);
  builder.capture.states[state] = addElements(builder, snapshot.elements, styleIndexes);
}
