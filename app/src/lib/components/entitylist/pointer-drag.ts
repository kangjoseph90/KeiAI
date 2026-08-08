import type { Action } from 'svelte/action';

const HOLD_DELAY_MS = 280;
const MOVE_TOLERANCE_PX = 8;
const MOUSE_START_DISTANCE_PX = 4;
const EDGE_SIZE_PX = 56;
const MAX_SCROLL_PX = 14;

export interface PointerDragOptions {
    disabled?: boolean;
    allowInteractiveTarget?: boolean;
    showGhost?: boolean;
    onStart: (clientX: number, clientY: number) => void;
    onMove: (clientX: number, clientY: number) => void;
    onDrop: (clientX: number, clientY: number) => void | Promise<void>;
    onCancel: () => void;
}

interface Point {
    x: number;
    y: number;
}

export function isInteractiveDragTarget(target: EventTarget | null): boolean {
    if (!(target instanceof Element)) return false;
    return Boolean(
        target.closest(
            'input, textarea, select, button, a, [contenteditable="true"], [data-no-reorder-drag]'
        )
    );
}

function getScrollableElement(point: Point): HTMLElement | null {
    let element = document.elementFromPoint(point.x, point.y)?.parentElement ?? null;
    while (element && element !== document.body) {
        const style = getComputedStyle(element);
        if (/(auto|scroll)/.test(style.overflowY) && element.scrollHeight > element.clientHeight) {
            return element;
        }
        element = element.parentElement;
    }
    return null;
}

function scrollAtEdge(point: Point): void {
    const scrollable = getScrollableElement(point);
    const rect = scrollable?.getBoundingClientRect() ?? {
        top: 0,
        bottom: window.innerHeight
    };
    let delta = 0;
    if (point.y < rect.top + EDGE_SIZE_PX) {
        delta = -MAX_SCROLL_PX * (1 - (point.y - rect.top) / EDGE_SIZE_PX);
    } else if (point.y > rect.bottom - EDGE_SIZE_PX) {
        delta = MAX_SCROLL_PX * (1 - (rect.bottom - point.y) / EDGE_SIZE_PX);
    }
    if (delta === 0) return;
    if (scrollable) {
        scrollable.scrollBy({ top: delta });
    } else {
        window.scrollBy({ top: delta });
    }
}

export const pointerDrag: Action<HTMLElement, PointerDragOptions> = (node, initialOptions) => {
    let options = initialOptions;
    let pointerId: number | null = null;
    let pointerType: string | null = null;
    let origin: Point | null = null;
    let latest: Point | null = null;
    let grabOffset: Point | null = null;
    let holdTimer: ReturnType<typeof setTimeout> | null = null;
    let active = false;
    let ghost: HTMLElement | null = null;
    let animationFrame: number | null = null;
    let suppressClickUntil = 0;
    let previousBodyUserSelect: string | null = null;
    let sessionListenersAttached = false;

    function addSessionListeners(): void {
        if (sessionListenersAttached) return;
        sessionListenersAttached = true;
        window.addEventListener('pointermove', handlePointerMove, { passive: false });
        window.addEventListener('pointerup', finish, { passive: false });
        window.addEventListener('pointercancel', cancel);
        window.addEventListener('blur', handleBlur);
    }

    function removeSessionListeners(): void {
        if (sessionListenersAttached) {
            sessionListenersAttached = false;
            window.removeEventListener('pointermove', handlePointerMove);
            window.removeEventListener('pointerup', finish);
            window.removeEventListener('pointercancel', cancel);
            window.removeEventListener('blur', handleBlur);
        }
    }

    function clearTimer(): void {
        if (holdTimer) clearTimeout(holdTimer);
        holdTimer = null;
    }

    function removeGhost(): void {
        ghost?.remove();
        ghost = null;
    }

    function suppressSelection(): void {
        previousBodyUserSelect = document.body.style.userSelect;
        document.body.style.userSelect = 'none';
    }

    function restoreSelection(): void {
        if (previousBodyUserSelect === null) return;
        document.body.style.userSelect = previousBodyUserSelect;
        previousBodyUserSelect = null;
    }

    function stopFrame(): void {
        if (animationFrame !== null) cancelAnimationFrame(animationFrame);
        animationFrame = null;
    }

    function releasePointerCapture(): void {
        if (pointerId === null || !node.hasPointerCapture?.(pointerId)) return;
        node.releasePointerCapture(pointerId);
    }

    function reset(): void {
        clearTimer();
        stopFrame();
        removeGhost();
        releasePointerCapture();
        removeSessionListeners();
        pointerId = null;
        pointerType = null;
        origin = null;
        latest = null;
        grabOffset = null;
        active = false;
        restoreSelection();
        node.classList.remove('pointer-drag-source');
    }

    function updateGhost(point: Point): void {
        if (!ghost) return;
        const offset = grabOffset ?? { x: 0, y: 0 };
        ghost.style.transform = `translate3d(${point.x - offset.x}px, ${point.y - offset.y}px, 0)`;
    }

    function runFrame(): void {
        animationFrame = null;
        if (!active || !latest) return;
        updateGhost(latest);
        scrollAtEdge(latest);
        options.onMove(latest.x, latest.y);
        animationFrame = requestAnimationFrame(runFrame);
    }

    function startDrag(): void {
        if (pointerId === null || !latest) return;
        active = true;
        clearTimer();
        node.setPointerCapture?.(pointerId);
        suppressSelection();
        if (options.showGhost !== false) {
            node.classList.add('pointer-drag-source');
            ghost = node.cloneNode(true) as HTMLElement;
            ghost.removeAttribute('id');
            Object.assign(ghost.style, {
                position: 'fixed',
                left: '0',
                top: '0',
                width: `${node.getBoundingClientRect().width}px`,
                zIndex: '9999',
                opacity: '0.85',
                pointerEvents: 'none',
                transition: 'none',
                animation: 'none',
                willChange: 'transform',
                transform: 'translate3d(0, 0, 0)'
            });
            updateGhost(latest);
            document.body.appendChild(ghost);
        }
        try {
            navigator.vibrate?.(20);
        } catch {
            // Haptics are optional and may be blocked by the browser or WebView.
        }
        options.onStart(latest.x, latest.y);
        animationFrame = requestAnimationFrame(runFrame);
    }

    function handlePointerDown(event: PointerEvent): void {
        if (
            options.disabled ||
            pointerId !== null ||
            event.button !== 0 ||
            (!options.allowInteractiveTarget && isInteractiveDragTarget(event.target))
        ) {
            return;
        }

        pointerId = event.pointerId;
        pointerType = event.pointerType;
        origin = { x: event.clientX, y: event.clientY };
        latest = origin;
        const rect = node.getBoundingClientRect();
        grabOffset = {
            x: event.clientX - rect.left,
            y: event.clientY - rect.top
        };
        addSessionListeners();
        if (event.pointerType !== 'mouse') {
            holdTimer = setTimeout(startDrag, HOLD_DELAY_MS);
        }
    }

    function handlePointerMove(event: PointerEvent): void {
        if (event.pointerId !== pointerId || !origin) return;
        latest = { x: event.clientX, y: event.clientY };

        if (!active) {
            const distance = Math.hypot(latest.x - origin.x, latest.y - origin.y);
            if (pointerType === 'mouse') {
                if (distance < MOUSE_START_DISTANCE_PX) return;
                startDrag();
            } else {
                if (distance > MOVE_TOLERANCE_PX) reset();
                return;
            }
        }

        event.preventDefault();
    }

    async function finish(event: PointerEvent): Promise<void> {
        if (event.pointerId !== pointerId) return;
        const point = { x: event.clientX, y: event.clientY };
        const wasActive = active;
        if (wasActive) {
            event.preventDefault();
            suppressClickUntil = performance.now() + 600;
            reset();
            await options.onDrop(point.x, point.y);
            return;
        }
        reset();
    }

    function cancel(event?: PointerEvent): void {
        if (event && event.pointerId !== pointerId) return;
        if (active) options.onCancel();
        reset();
    }

    function handleBlur(): void {
        cancel();
    }

    function handleClick(event: MouseEvent): void {
        if (performance.now() > suppressClickUntil) return;
        suppressClickUntil = 0;
        event.preventDefault();
        event.stopImmediatePropagation();
    }

    function handleContextMenu(event: MouseEvent): void {
        if (pointerId === null) return;
        if (pointerType === 'mouse') return;
        event.preventDefault();
    }

    function handleTouchMove(event: TouchEvent): void {
        if (!active) return;
        event.preventDefault();
    }

    node.addEventListener('pointerdown', handlePointerDown);
    // This must exist before a touch gesture starts. Some mobile browsers hand the
    // gesture to native scrolling when no blocking listener was present at touchstart,
    // then cancel the pointer stream as soon as the held finger moves.
    node.addEventListener('touchmove', handleTouchMove, { passive: false });
    node.addEventListener('click', handleClick, true);
    node.addEventListener('contextmenu', handleContextMenu);

    return {
        update(nextOptions) {
            options = nextOptions;
            if (options.disabled) cancel();
        },
        destroy() {
            cancel();
            node.removeEventListener('pointerdown', handlePointerDown);
            node.removeEventListener('touchmove', handleTouchMove);
            node.removeEventListener('click', handleClick, true);
            node.removeEventListener('contextmenu', handleContextMenu);
        }
    };
};
