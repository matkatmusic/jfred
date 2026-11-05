// The page expression that reads every element's computed style, and the shape of its answer.

export interface PageStyleSnapshot {
  properties: string[];
  values: string[];
  rows: number[][];
  elements: [string, number][];
}

// The minimap box follows scrolling a moment late: true once it and the scroll position stop changing.
export const WAIT_FOR_STABLE_LAYOUT = `(async () => {
    const timelines = document.getElementById('timelines');
    const read = () => document.getElementById('mm-view')?.style.cssText + '|' + timelines?.scrollTop + ',' + timelines?.scrollLeft;
    let last = read();
    for (let attempt = 0; attempt < 20; attempt++) {
        await new Promise((resolve) => setTimeout(resolve, 250));
        const now = read();
        if (now === last) return true;
        last = now;
    }
    return false;
})()`;

// Every name any rule of any sheet sets, imported sheets and grouping rules included; rule.style lists longhands.
export const LIST_SHEET_PROPERTY_NAMES = `(sheets) => {
    const names = new Set();
    const walk = (rules) => {
        for (const rule of rules) {
            if (rule.styleSheet) walk(rule.styleSheet.cssRules);
            if (rule.style) { for (const name of rule.style) names.add(name); }
            if (rule.cssRules) walk(rule.cssRules);
        }
    };
    for (const sheet of sheets) walk(sheet.cssRules);
    return [...names].sort();
}`;

// Reads only the sheet-set properties; a path is tag, id, classes and sibling index.
export const STYLE_PROBE = `(() => {
    const everyElement = [...document.querySelectorAll('*')];
    const properties = (${LIST_SHEET_PROPERTY_NAMES})(document.styleSheets);
    const values = [];
    const valueIndexes = new Map();
    const rows = [];
    const rowIndexes = new Map();
    const elements = [];
    const pathOf = new Map();
    const describeSegment = (element) => {
        const parent = element.parentElement;
        const position = parent ? Array.prototype.indexOf.call(parent.children, element) : 0;
        const id = element.id ? '#' + element.id : '';
        const classes = [...element.classList].map((name) => '.' + name).join('');
        return element.localName + id + classes + '[' + position + ']';
    };
    const readPath = (element) => {
        if (pathOf.has(element)) return pathOf.get(element);
        const segment = describeSegment(element);
        const path = element.parentElement ? readPath(element.parentElement) + ' > ' + segment : segment;
        pathOf.set(element, path);
        return path;
    };
    const readRowIndex = (element, pseudo) => {
        const style = getComputedStyle(element, pseudo);
        const row = properties.map((property) => {
            const value = style.getPropertyValue(property);
            if (!valueIndexes.has(value)) { valueIndexes.set(value, values.length); values.push(value); }
            return valueIndexes.get(value);
        });
        const key = row.join(',');
        if (!rowIndexes.has(key)) { rowIndexes.set(key, rows.length); rows.push(row); }
        return rowIndexes.get(key);
    };
    for (const element of everyElement) {
        const path = readPath(element);
        elements.push([path, readRowIndex(element, null)]);
        elements.push([path + '::before', readRowIndex(element, '::before')]);
        elements.push([path + '::after', readRowIndex(element, '::after')]);
    }
    return { properties, values, rows, elements };
})()`;
