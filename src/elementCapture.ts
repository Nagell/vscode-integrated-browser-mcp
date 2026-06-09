export interface CapturedElement {
    pageId: string;
    tagName: string;
    id?: string;
    className?: string;
    innerText: string;
    outerHTML: string;
    rect: { x: number; y: number; width: number; height: number };
    capturedAt: string;
}

let _captured: CapturedElement | null = null;

export function setCaptured(el: CapturedElement | null): void {
    _captured = el;
}

export function getCaptured(): CapturedElement | null {
    return _captured;
}
