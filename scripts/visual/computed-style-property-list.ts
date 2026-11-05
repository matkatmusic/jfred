// Builds the compared property list from style sheet text, for captures that recorded more properties than the sheets set.

const COMMENT = /\/\*[\s\S]*?\*\//g;
const INNERMOST_BLOCK = /\{([^{}]*)\}/g;
const NESTED_BLOCK_MARK = "\u0001";
const DECLARATION_NAME = /^-?-?[a-z][a-z0-9-]*$/i;
const CUSTOM_PREFIX = "--";

// Shorthands whose longhands do not start with the shorthand's own name.
const NON_PREFIX_LONGHANDS: Record<string, string[]> = {
  "inset": ["top", "right", "bottom", "left"],
  "gap": ["row-gap", "column-gap"],
  "place-items": ["align-items", "justify-items"],
  "place-content": ["align-content", "justify-content"],
  "place-self": ["align-self", "justify-self"],
  "border-radius": ["border-top-left-radius", "border-top-right-radius", "border-bottom-right-radius", "border-bottom-left-radius"],
  "border-color": ["border-top-color", "border-right-color", "border-bottom-color", "border-left-color"],
  "border-style": ["border-top-style", "border-right-style", "border-bottom-style", "border-left-style"],
  "border-width": ["border-top-width", "border-right-width", "border-bottom-width", "border-left-width"],
  "font": ["line-height"],
};

function addDeclarationNames(names: Set<string>, body: string): void {
  for (const segment of body.split(";")) {
    const colonIndex = segment.indexOf(":");
    const isNestedSelector = segment.includes(NESTED_BLOCK_MARK);
    if (isNestedSelector) {
      continue;
    }
    const name = segment.slice(0, colonIndex).trim();
    const isDeclaration = colonIndex > 0 && DECLARATION_NAME.test(name);
    if (isDeclaration) {
      names.add(name);
    }
  }
}

// Innermost blocks hold declarations; each round marks them as done, so selectors of nested blocks are skipped.
export function listCssTextPropertyNames(cssText: string): string[] {
  let text = cssText.replace(COMMENT, "");
  const names = new Set<string>();
  let bodies = [...text.matchAll(INNERMOST_BLOCK)];
  while (bodies.length > 0) {
    for (const body of bodies) {
      addDeclarationNames(names, body[1]!);
    }
    text = text.replace(INNERMOST_BLOCK, NESTED_BLOCK_MARK);
    bodies = [...text.matchAll(INNERMOST_BLOCK)];
  }
  return [...names].sort();
}

// ponytail: prefix match can add a few extra longhands (border-top adds border-top-left-radius); extra compares never hide a change.
function addLonghands(longhands: Set<string>, name: string, captured: string[]): void {
  const isCaptured = captured.includes(name);
  if (isCaptured) {
    longhands.add(name);
    return;
  }
  for (const property of captured) {
    const isPrefixLonghand = property.startsWith(`${name}-`);
    if (isPrefixLonghand) {
      longhands.add(property);
    }
  }
  for (const property of NON_PREFIX_LONGHANDS[name] ?? []) {
    const isCapturedLonghand = captured.includes(property);
    if (isCapturedLonghand) {
      longhands.add(property);
    }
  }
}

export function listLonghandNames(names: string[], captured: string[]): string[] {
  const longhands = new Set<string>();
  for (const name of names) {
    addLonghands(longhands, name, captured);
  }
  return [...longhands].sort();
}

// Skips and reports custom names that only one capture lists; no other name is skipped.
export function selectComparedProperties(names: string[], beforeProperties: string[], afterProperties: string[]): { names: string[]; skippedCustomNames: string[] } {
  const compared: string[] = [];
  const skippedCustomNames: string[] = [];
  for (const name of names) {
    const isCustom = name.startsWith(CUSTOM_PREFIX);
    const isInBoth = beforeProperties.includes(name) && afterProperties.includes(name);
    if (isCustom && !isInBoth) {
      skippedCustomNames.push(name);
      continue;
    }
    compared.push(name);
  }
  return { names: compared, skippedCustomNames };
}
