// One small class that turns "rows or columns, grow, min size" into plain CSS flexbox.

export enum FlexLayoutMode {
    rows = "rows",
    columns = "columns",
}

export interface FlexChildOptions {
    grow?: number;
    minSize?: number;
}

export class FlexBox {
    static readonly layoutModes = FlexLayoutMode;
    readonly element: HTMLElement;
    private readonly layoutMode: FlexLayoutMode;

    constructor(layoutMode: FlexLayoutMode, element: HTMLElement = document.createElement("div")) {
        this.layoutMode = layoutMode;
        this.element = element;
        this.element.style.display = "flex";
        this.element.style.flexDirection = layoutMode === FlexLayoutMode.rows ? "column" : "row";
    }

    add(child: HTMLElement | FlexBox, options: FlexChildOptions = {}): void {
        const childElement = child instanceof FlexBox ? child.element : child;
        this.element.append(childElement);
        if (options.grow !== undefined) {
            this.setGrow(childElement, options.grow);
        }
        if (options.minSize !== undefined) {
            this.setMinSize(childElement, options.minSize);
        }
    }

    setGrow(child: HTMLElement, grow: number): void {
        child.style.flexGrow = String(grow);
    }

    private setMinSize(child: HTMLElement, minSizePx: number): void {
        const property = this.layoutMode === FlexLayoutMode.rows ? "minHeight" : "minWidth";
        child.style[property] = `${minSizePx}px`;
    }
}
