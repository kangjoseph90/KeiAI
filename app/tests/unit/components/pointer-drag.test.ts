import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
    pointerDrag,
    type PointerDragOptions
} from '../../../src/lib/components/entitylist/pointer-drag';

function pointerEvent(
    type: string,
    init: Partial<PointerEventInit> & { pointerType: string }
): PointerEvent {
    return new PointerEvent(type, {
        bubbles: true,
        cancelable: true,
        pointerId: 1,
        button: 0,
        clientX: 20,
        clientY: 20,
        ...init
    });
}

describe('pointerDrag', () => {
    let node: HTMLDivElement;
    let options: PointerDragOptions;

    beforeEach(() => {
        vi.useFakeTimers();
        node = document.createElement('div');
        document.body.appendChild(node);
        options = {
            onStart: vi.fn(),
            onMove: vi.fn(),
            onDrop: vi.fn(),
            onCancel: vi.fn()
        };
    });

    afterEach(() => {
        vi.restoreAllMocks();
        vi.useRealTimers();
        document.body.replaceChildren();
    });

    it('attaches window listeners only for an active pointer session', () => {
        const addEventListener = vi.spyOn(window, 'addEventListener');
        const removeEventListener = vi.spyOn(window, 'removeEventListener');
        const action = pointerDrag(node, options);

        expect(addEventListener).not.toHaveBeenCalledWith(
            'pointermove',
            expect.any(Function),
            expect.anything()
        );

        node.dispatchEvent(pointerEvent('pointerdown', { pointerType: 'mouse' }));

        expect(addEventListener).toHaveBeenCalledWith('pointermove', expect.any(Function), {
            passive: false
        });
        expect(addEventListener).toHaveBeenCalledWith('pointerup', expect.any(Function), {
            passive: false
        });
        expect(addEventListener).toHaveBeenCalledWith('pointercancel', expect.any(Function));
        expect(addEventListener).toHaveBeenCalledWith('blur', expect.any(Function));

        window.dispatchEvent(pointerEvent('pointerup', { pointerType: 'mouse' }));

        expect(removeEventListener).toHaveBeenCalledWith('pointermove', expect.any(Function));
        expect(removeEventListener).toHaveBeenCalledWith('pointerup', expect.any(Function));
        expect(removeEventListener).toHaveBeenCalledWith('pointercancel', expect.any(Function));
        expect(removeEventListener).toHaveBeenCalledWith('blur', expect.any(Function));
        action?.destroy?.();
    });

    it('prevents touch scrolling only after long-press activation', async () => {
        const addEventListener = vi.spyOn(window, 'addEventListener');
        const removeEventListener = vi.spyOn(window, 'removeEventListener');
        const action = pointerDrag(node, options);

        node.dispatchEvent(pointerEvent('pointerdown', { pointerType: 'touch' }));
        expect(addEventListener).not.toHaveBeenCalledWith(
            'touchmove',
            expect.any(Function),
            expect.anything()
        );

        await vi.advanceTimersByTimeAsync(280);
        expect(addEventListener).toHaveBeenCalledWith('touchmove', expect.any(Function), {
            passive: false
        });

        window.dispatchEvent(pointerEvent('pointerup', { pointerType: 'touch' }));
        expect(removeEventListener).toHaveBeenCalledWith('touchmove', expect.any(Function));
        action?.destroy?.();
    });

    it('starts a touch drag after a long press and drops at the pointer position', async () => {
        const action = pointerDrag(node, options);

        node.dispatchEvent(pointerEvent('pointerdown', { pointerType: 'touch' }));
        await vi.advanceTimersByTimeAsync(280);

        expect(options.onStart).toHaveBeenCalledOnce();
        window.dispatchEvent(
            pointerEvent('pointermove', {
                pointerType: 'touch',
                clientX: 28,
                clientY: 31
            })
        );
        const touchMove = new TouchEvent('touchmove', { bubbles: true, cancelable: true });
        window.dispatchEvent(touchMove);

        expect(touchMove.defaultPrevented).toBe(true);
        window.dispatchEvent(
            pointerEvent('pointerup', {
                pointerType: 'touch',
                clientX: 44,
                clientY: 55
            })
        );

        expect(options.onDrop).toHaveBeenCalledWith(44, 55);
        action?.destroy?.();
    });

    it('preserves scrolling by cancelling before activation when the pointer moves', async () => {
        const action = pointerDrag(node, options);

        node.dispatchEvent(pointerEvent('pointerdown', { pointerType: 'touch' }));
        window.dispatchEvent(
            pointerEvent('pointermove', {
                pointerType: 'touch',
                clientX: 40
            })
        );
        await vi.advanceTimersByTimeAsync(300);

        expect(options.onStart).not.toHaveBeenCalled();
        expect(options.onDrop).not.toHaveBeenCalled();
        action?.destroy?.();
    });

    it('starts mouse dragging after movement without a hold delay', () => {
        node.getBoundingClientRect = vi.fn(() =>
            DOMRect.fromRect({
                x: 10,
                y: 12,
                width: 100,
                height: 40
            })
        );
        const action = pointerDrag(node, options);

        node.dispatchEvent(pointerEvent('pointerdown', { pointerType: 'mouse' }));
        window.dispatchEvent(
            pointerEvent('pointermove', {
                pointerType: 'mouse',
                clientX: 30
            })
        );

        const ghost = document.body.lastElementChild as HTMLElement;
        expect(ghost).not.toBe(node);
        expect(ghost.style.transition).toBe('none');
        expect(ghost.style.animation).toBe('none');
        expect(ghost.style.transform).toBe('translate3d(20px, 12px, 0)');

        window.dispatchEvent(
            pointerEvent('pointerup', {
                pointerType: 'mouse',
                clientX: 44,
                clientY: 55
            })
        );

        expect(options.onStart).toHaveBeenCalledOnce();
        expect(options.onDrop).toHaveBeenCalledWith(44, 55);
        action?.destroy?.();
    });

    it('suppresses the click generated after a long mouse drag', async () => {
        const clickHandler = vi.fn();
        node.addEventListener('click', clickHandler);
        const action = pointerDrag(node, options);

        node.dispatchEvent(pointerEvent('pointerdown', { pointerType: 'mouse' }));
        window.dispatchEvent(
            pointerEvent('pointermove', {
                pointerType: 'mouse',
                clientX: 30
            })
        );
        await vi.advanceTimersByTimeAsync(1_000);
        window.dispatchEvent(pointerEvent('pointerup', { pointerType: 'mouse' }));
        node.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));

        expect(clickHandler).not.toHaveBeenCalled();
        action?.destroy?.();
    });

    it('removes the drag ghost before waiting for async drop work', () => {
        options.onDrop = vi.fn(() => new Promise<void>(() => undefined));
        const action = pointerDrag(node, options);

        node.dispatchEvent(pointerEvent('pointerdown', { pointerType: 'mouse' }));
        window.dispatchEvent(
            pointerEvent('pointermove', {
                pointerType: 'mouse',
                clientX: 30
            })
        );

        const ghost = document.body.lastElementChild;
        expect(ghost).not.toBe(node);

        window.dispatchEvent(
            pointerEvent('pointerup', {
                pointerType: 'mouse',
                clientX: 44,
                clientY: 55
            })
        );

        expect(options.onDrop).toHaveBeenCalledWith(44, 55);
        expect(document.body.contains(ghost)).toBe(false);
        action?.destroy?.();
    });

    it('ignores interactive controls', async () => {
        const button = document.createElement('button');
        node.appendChild(button);
        const action = pointerDrag(node, options);

        button.dispatchEvent(pointerEvent('pointerdown', { pointerType: 'touch' }));
        await vi.advanceTimersByTimeAsync(300);

        expect(options.onStart).not.toHaveBeenCalled();
        action?.destroy?.();
    });
});
