
import {
    handlePaste, handleDeleteKey, moveSelection, enterEditMode, isEditing, selectedCell
} from './wbs.js';
import { undo, redo, saveState } from './state.js';

export function setupGlobalEvents() {
    // Helper to check if we should ignore global shortcuts
    const isInputActive = (e) => {
        const tag = e.target.tagName;
        return tag === 'INPUT' || tag === 'TEXTAREA' || e.target.isContentEditable;
    };

    // Keyboard Shortcuts
    document.addEventListener('keydown', (e) => {
        // --- Date Picker Navigation ---
        if (window.DATE_PICKER_ACTION && window.DATE_PICKER_ACTION.isOpen) {
            if (e.key === 'Escape') {
                e.preventDefault();
                window.DATE_PICKER_ACTION.close();
                return;
            }
            if (e.key === 'Enter') {
                e.preventDefault();
                window.DATE_PICKER_ACTION.confirm();
                return;
            }
            if (e.key.startsWith('Arrow')) {
                e.preventDefault();
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
                e.preventDefault();
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

        if (e.ctrlKey && e.key === 'c') {
            // Copy
            // If we have a selection range, copy it.
            // But we must allow default copy if user is selecting text in an input!
            // isInputActive check handles inputs.
            // But what if user selected text in a non-input?
            // The WBS table is not contenteditable, so standard selection doesn't apply easily unless customized.
            // We'll assume if not input, it's our WBS selection.
            e.preventDefault();
            import('./wbs.js').then(m => m.copySelection());
        }
        else if (e.ctrlKey && e.key === 'z') { e.preventDefault(); undo(); }
        else if (e.ctrlKey && e.key === 'y') { e.preventDefault(); redo(); }
        else if (e.key === 'Delete') { handleDeleteKey(); }
        else if (e.key === 'F2') {
            e.preventDefault();
            enterEditMode();
        }
        else if (e.key === 'Enter') {
            e.preventDefault();
            moveSelection(1, 0, false);
        }
        else if (e.key.startsWith('Arrow')) {
            e.preventDefault();
            let dr = 0, dc = 0;
            if (e.key === 'ArrowUp') dr = -1;
            if (e.key === 'ArrowDown') dr = 1;
            if (e.key === 'ArrowLeft') dc = -1;
            if (e.key === 'ArrowRight') dc = 1;
            moveSelection(dr, dc, e.shiftKey);
        }
    });

    // Paste
    document.addEventListener('paste', (e) => {
        if (isInputActive(e) || isEditing) return; // Let default paste work in input
        e.preventDefault();
        const text = (e.clipboardData || window.clipboardData).getData('text');
        handlePaste(text);
    });

    // Prevent default drag behaviors on body to allow custom drop
    document.addEventListener('dragover', (e) => e.preventDefault());
    document.addEventListener('drop', (e) => e.preventDefault());
}
