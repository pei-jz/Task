
import {
    handlePaste, handleDeleteKey, moveSelection, enterEditMode, isEditing, selectedCell, handleInsertAbove
} from './wbs.js';
import { undo, redo, saveState } from './state.js';

export function setupGlobalEvents() {
    if (window.__globalEventsSetup) return;
    window.__globalEventsSetup = true;

    // Helper to check if we should ignore global shortcuts
    const isInputActive = (e) => {
        const tag = e.target.tagName;
        return tag === 'INPUT' || tag === 'TEXTAREA' || e.target.isContentEditable;
    };

    // Keyboard Shortcuts (Use Capture Phase to ensure we handle it first)
    document.addEventListener('keydown', (e) => {
        // --- Date Picker Navigation ---
        if (window.DATE_PICKER_ACTION && window.DATE_PICKER_ACTION.isOpen) {
            if (e.key === 'Escape') {
                e.preventDefault(); e.stopImmediatePropagation();
                window.DATE_PICKER_ACTION.close();
                return;
            }
            if (e.key === 'Enter') {
                e.preventDefault(); e.stopImmediatePropagation();
                window.DATE_PICKER_ACTION.confirm();
                return;
            }
            if (e.key.startsWith('Arrow')) {
                e.preventDefault(); e.stopImmediatePropagation();
                let days = 0;
                if (e.key === 'ArrowUp') days = -7;
                if (e.key === 'ArrowDown') days = 7;
                if (e.key === 'ArrowLeft') days = -1;
                if (e.key === 'ArrowRight') days = 1;
                window.DATE_PICKER_ACTION.moveFocus(days);
                return;
            }
            // Block other keys from propagating to WBS
            return;
        }

        // If editing, handle specific keys, else handle selection keys
        if (isEditing) {
            if (e.key === 'Enter' && !e.shiftKey) { // Simple Enter to commit and move down
                // The input will blur automatically if we move focus? 
                // We need to commit first. The `change` event handles commit.
                // We just need to exit edit mode and move selection down.
                e.preventDefault(); e.stopImmediatePropagation();
                // enterEditMode() toggles? No, enterEditMode is for entering.
                // We need to find the active input and blur it?
                const activeEl = document.activeElement;
                if (activeEl) activeEl.blur();
                // Then move down
                moveSelection(1, 0, false);
            }
            return; // Let other keys (arrows) work normally in input
        }

        if (isInputActive(e)) return; // Allow typing in other inputs (like modal)

        // Excel Row Selection: Shift + Space
        if (e.shiftKey && e.code === 'Space' && !e.ctrlKey && !e.metaKey && !e.altKey) {
            e.preventDefault(); e.stopImmediatePropagation();
            import('./wbs.js').then(m => m.selectRow(m.selectedCell.r, false));
            return;
        }

        // Type to edit (Printable single character, no control modifiers except shift, but NOT Shift+Space)
        if (!isEditing && e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey && !(e.shiftKey && e.code === 'Space')) {
            import('./wbs.js').then(m => m.enterEditMode(e.key));
            e.preventDefault(); e.stopImmediatePropagation();
            return;
        }

        if (e.ctrlKey && e.key === 'c') {
            e.preventDefault(); e.stopImmediatePropagation();
            import('./wbs.js').then(m => m.copySelection());
        }
        else if (e.ctrlKey && e.key === 'z') { e.preventDefault(); e.stopImmediatePropagation(); window.undo(); }
        else if (e.ctrlKey && e.key === 'y') { e.preventDefault(); e.stopImmediatePropagation(); window.redo(); }
        else if (e.key === 'Delete') {
            e.preventDefault(); e.stopImmediatePropagation();
            handleDeleteKey();
        }
        else if (e.key === 'F2') {
            e.preventDefault(); e.stopImmediatePropagation();
            enterEditMode();
        }
        else if (e.key === 'Enter') {
            e.preventDefault(); e.stopImmediatePropagation();
            moveSelection(1, 0, false);
        }
        else if (e.key.startsWith('Arrow')) {
            e.preventDefault(); e.stopImmediatePropagation();
            if (!e.shiftKey && (e.key === 'ArrowRight' || e.key === 'ArrowLeft')) {
                import('./wbs.js').then(m => {
                    let handled = false;
                    if (m.selectedCell && m.selectedCell.c === 0) {
                        handled = m.handleArrowAccordion(e.key);
                    }
                    if (!handled) {
                        m.moveSelection(0, e.key === 'ArrowRight' ? 1 : -1, false);
                    }
                });
            } else {
                let dr = 0, dc = 0;
                if (e.key === 'ArrowUp') dr = -1;
                if (e.key === 'ArrowDown') dr = 1;
                if (e.shiftKey && e.key === 'ArrowLeft') dc = -1;
                if (e.shiftKey && e.key === 'ArrowRight') dc = 1;
                import('./wbs.js').then(m => m.moveSelection(dr, dc, e.shiftKey));
            }
        } else if (e.ctrlKey && e.shiftKey && (e.key === '+' || e.key === '=' || e.key === ';')) {
            e.preventDefault(); e.stopImmediatePropagation();
            import('./wbs.js').then(m => m.handleInsertAbove());
        }
    }, { capture: true });

    // Paste
    document.addEventListener('paste', (e) => {
        if (isInputActive(e) || isEditing) return; // Let default paste work in input
        e.preventDefault(); e.stopImmediatePropagation();
        const text = (e.clipboardData || window.clipboardData).getData('text');
        handlePaste(text);
    }, { capture: true });

    // Prevent default drag behaviors on body to allow custom drop
    document.addEventListener('dragover', (e) => e.preventDefault());
    document.addEventListener('drop', (e) => e.preventDefault());
}
