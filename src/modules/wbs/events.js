import { undo, redo, saveState, project, selectedPhaseIds, triggerRender } from '../core/state.js';
import { wbsState } from './state.js';
import { handlePaste, handleInsertAbove, copySelection } from './clipboard.js';
import { handleDeleteKey, addPhaseInfo, addMilestoneInfo } from './actions.js';
import { findTask } from '../utils/helpers.js';

export function selectCell(r, c, extend = false) {
    if (r < 0) r = 0;

    if (!extend) {
        wbsState.selectedCell.r = r;
        wbsState.selectedCell.c = c;
        wbsState.selectionAnchor = { r, c };
        wbsState.selectedRange = { r1: r, c1: c, r2: r, c2: c };
    } else {
        if (!wbsState.selectionAnchor) wbsState.selectionAnchor = { r: wbsState.selectedCell.r, c: wbsState.selectedCell.c };
        wbsState.selectedCell.r = r;
        wbsState.selectedCell.c = c;

        wbsState.selectedRange = {
            r1: Math.min(wbsState.selectionAnchor.r, r),
            c1: Math.min(wbsState.selectionAnchor.c, c),
            r2: Math.max(wbsState.selectionAnchor.r, r),
            c2: Math.max(wbsState.selectionAnchor.c, c)
        };
    }

    updateSelectionVisuals();

    if (!extend) {
        scrollGanttToTask(r);
    }
}

function scrollGanttToTask(r) {
    const td = document.querySelector(`.wbs-table tbody td[data-row="${r}"]`);
    const row = td ? td.closest('tr') : null;
    if (row && row.dataset.tid) {
        // Find the bar
        const bar = document.getElementById(`bar-${row.dataset.tid}`);
        const scrollContainer = document.querySelector('.wbs-gantt-container');

        if (bar && scrollContainer) {
            // bar.style.left contains the absolute left position in pixels within the canvas
            const leftStr = bar.style.left || '0px';
            const absoluteLeft = parseFloat(leftStr.replace('px', ''));

            const viewLeft = scrollContainer.scrollLeft;
            const viewRight = viewLeft + scrollContainer.clientWidth;

            // Offset 50 pixels to the left for padding
            const targetLeft = Math.max(0, absoluteLeft - 50);

            // If the bar is not fully visible, scroll there
            if (absoluteLeft < viewLeft || absoluteLeft > viewRight - 100) {
                // Ensure a smooth scroll experience if the browser supports it natively
                // Or fallback to direct property setting
                try {
                    scrollContainer.scrollTo({ left: targetLeft, behavior: 'smooth' });
                } catch (e) {
                    scrollContainer.scrollLeft = targetLeft;
                }
            }
        }
    }
}

export function selectRow(r, extend = false) {
    if (r < 0) r = 0;

    if (!extend) {
        wbsState.selectionAnchor = { r, c: 9 };
        wbsState.selectedCell.r = r;
        wbsState.selectedCell.c = 0;
        wbsState.selectedRange = { r1: r, c1: 0, r2: r, c2: 9 };
    } else {
        if (!wbsState.selectionAnchor) wbsState.selectionAnchor = { r: wbsState.selectedCell.r, c: 9 };
        wbsState.selectedCell.r = r;
        wbsState.selectedCell.c = 0;
        wbsState.selectedRange = {
            r1: Math.min(wbsState.selectionAnchor.r, r),
            c1: 0,
            r2: Math.max(wbsState.selectionAnchor.r, r),
            c2: 9
        };
    }
    updateSelectionVisuals();

    if (!extend) {
        scrollGanttToTask(r);
    }
}

export function updateSelectionVisuals() {
    document.querySelectorAll('.selected-range').forEach(el => el.classList.remove('selected-range'));
    document.querySelectorAll('.selected-cell').forEach(el => el.classList.remove('selected-cell'));
    document.querySelectorAll('td[style*="outline"]').forEach(el => {
        el.style.outline = '';
        el.style.zIndex = '';
    });

    if (!wbsState.selectedRange) return;

    for (let r = wbsState.selectedRange.r1; r <= wbsState.selectedRange.r2; r++) {
        for (let c = wbsState.selectedRange.c1; c <= wbsState.selectedRange.c2; c++) {
            const el = document.querySelector(`td[data-row="${r}"][data-col="${c}"]`);
            if (el) el.classList.add('selected-range');
        }
    }

    const cursor = document.querySelector(`td[data-row="${wbsState.selectedCell.r}"][data-col="${wbsState.selectedCell.c}"]`);
    if (cursor) {
        cursor.classList.add('selected-cell');
        cursor.style.outline = '2px solid #3b82f6';
        cursor.style.zIndex = '10';
        cursor.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    }
}

export function moveSelection(dr, dc, extend = false) {
    const rows = document.querySelectorAll('.wbs-table tbody tr');
    if (!rows.length) return;
    const maxR = rows.length;

    let nr = wbsState.selectedCell.r + dr;
    let nc = wbsState.selectedCell.c + dc;

    if (nr < 0) nr = 0;
    if (nr >= maxR) nr = maxR - 1;
    if (nc < 0) nc = 0;
    if (nc > 9) nc = 9;

    const isRowMode = wbsState.selectedRange && wbsState.selectedRange.c1 === 0 && wbsState.selectedRange.c2 === 9;

    if (extend && isRowMode && dc === 0) {
        selectRow(nr, true);
        const row = rows[nr];
        if (row && row.children[wbsState.selectedCell.c]) {
            row.children[wbsState.selectedCell.c].scrollIntoView({ block: 'nearest', inline: 'nearest' });
        }
        return;
    }

    selectCell(nr, nc, extend);

    const row = rows[nr];
    if (row && row.children[nc]) {
        row.children[nc].scrollIntoView({ block: 'nearest', inline: 'nearest' });
    }
}

export function enterEditMode(initialChar = null) {
    if (wbsState.isEditing) return;

    const el = document.querySelector(`td[data-row="${wbsState.selectedCell.r}"][data-col="${wbsState.selectedCell.c}"]`);
    if (el) {
        wbsState.isEditing = true;
        el.classList.add('editing');
        const input = el.querySelector('input, select, textarea');

        if (input) {
            input.focus();
            if (initialChar !== null) {
                input.value = initialChar;
                input.dispatchEvent(new Event('input', { bubbles: true }));
            } else if (input.select && typeof input.select === 'function') {
                input.select();
            }
            input.addEventListener('blur', () => {
                setTimeout(() => {
                    wbsState.isEditing = false;
                    el.classList.remove('editing');
                }, 100);
            }, { once: true });
        } else {
            const dateDiv = el.querySelector('.wbs-date-cell');
            if (dateDiv) {
                dateDiv.click();
            }
            el.classList.remove('editing');
            wbsState.isEditing = false;
        }
    }
}

export function handleArrowAccordion(key) {
    if (!wbsState.selectedCell) return false;
    let visibleTasks = [];
    const pushIfVisible = (t, isPhase, pid) => {
        visibleTasks.push({ ...t, pid, isPhase });
    };

    project.phases.forEach(p => {
        if (selectedPhaseIds.length === 0 || selectedPhaseIds.includes(p.id)) {
            pushIfVisible(p, true, p.id);
            const traverse = (list) => {
                list.forEach(t => {
                    pushIfVisible(t, false, p.id);
                    if (t.expanded !== false && t.subtasks) traverse(t.subtasks);
                });
            };
            if (p.expanded !== false && p.tasks) traverse(p.tasks);
        }
    });

    const item = visibleTasks[wbsState.selectedCell.r];
    if (!item) return false;

    const p = project.phases.find(ph => ph.id === (item.isPhase ? item.id : item.pid));
    const obj = item.isPhase ? p : findTask(p, item.id);

    if (obj && (item.isPhase || (obj.subtasks && obj.subtasks.length > 0))) {
        if (key === 'ArrowRight' && obj.expanded === false) {
            obj.expanded = true; triggerRender(); return true;
        } else if (key === 'ArrowLeft' && obj.expanded !== false) {
            obj.expanded = false; triggerRender(); return true;
        }
    }
    return false;
}

function setupSelectionEvents() {
    const table = document.getElementById('wbs-table-view');
    if (!table) return;

    let isDragging = false;

    table.addEventListener('mousedown', (e) => {
        const td = e.target.closest('td');
        if (!td) return;
        if (e.target.closest('input') || e.target.closest('select') || e.target.closest('button')) return;

        const r = parseInt(td.dataset.row);
        const c = parseInt(td.dataset.col);

        if (!isNaN(r) && !isNaN(c)) {
            isDragging = true;
            selectCell(r, c, e.shiftKey);
        }
    });

    table.addEventListener('dblclick', (e) => {
        const td = e.target.closest('td');
        if (!td) return;
        if (e.target.closest('input') || e.target.closest('select') || e.target.closest('button')) return;

        const r = parseInt(td.dataset.row);
        const c = parseInt(td.dataset.col);
        if (!isNaN(r) && !isNaN(c)) {
            enterEditMode();
        }
    });

    table.addEventListener('mouseover', (e) => {
        if (!isDragging) return;
        const td = e.target.closest('td');
        if (!td) return;

        const r = parseInt(td.dataset.row);
        const c = parseInt(td.dataset.col);

        if (!isNaN(r) && !isNaN(c)) {
            selectCell(r, c, true);
        }
    });

    document.addEventListener('mouseup', () => {
        isDragging = false;
    });

    const container = document.querySelector('.wbs-table-container');
    if (container) {
        container.addEventListener('dblclick', (e) => {
            if (e.target.id === 'wbs-table-view' || e.target.classList.contains('wbs-table-container')) {
                addPhaseInfo();
            }
        });
    }
}

export function setupWBSEvents() {
    const addPhaseBtn = document.getElementById('add-phase-btn');
    const addMilestoneBtn = document.getElementById('add-milestone-btn');

    if (addPhaseBtn) addPhaseBtn.onclick = () => addPhaseInfo();
    if (addMilestoneBtn) addMilestoneBtn.onclick = () => addMilestoneInfo();

    const resizer = document.getElementById('wbs-resizer');
    const splitView = document.querySelector('.wbs-split-view');

    setupSelectionEvents();

    if (resizer && splitView) {
        let isResizing = false;

        resizer.addEventListener('mousedown', (e) => {
            isResizing = true;
            resizer.classList.add('active');
            document.body.style.cursor = 'col-resize';
            e.preventDefault();
        });

        document.addEventListener('mousemove', (e) => {
            if (!isResizing) return;
            const containerRect = splitView.getBoundingClientRect();
            const newWidth = e.clientX - containerRect.left;
            if (newWidth > 50 && newWidth < containerRect.width - 50) {
                splitView.style.gridTemplateColumns = `${newWidth}px 4px 1fr`;
            }
        });

        document.addEventListener('mouseup', () => {
            if (isResizing) {
                isResizing = false;
                resizer.classList.remove('active');
                document.body.style.cursor = '';
            }
        });
    }
}

export function setupGlobalEvents() {
    if (window.__globalEventsSetup) return;
    window.__globalEventsSetup = true;

    // Expose events for inline handlers generated by wbs/view.js
    window.WBS_EVENTS = {
        selectCell,
        selectRow,
        enterEditMode,
        updateSelectionVisuals,
        handleTaskDropProxy: (src, dest) => {
            import('./actions.js').then(m => m.handleTaskDrop(src, dest));
        }
    };

    const isInputActive = (e) => {
        const tag = e.target.tagName;
        return tag === 'INPUT' || tag === 'TEXTAREA' || e.target.isContentEditable;
    };

    document.addEventListener('keydown', (e) => {
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
            return;
        }

        if (wbsState.isEditing) {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault(); e.stopImmediatePropagation();
                const activeEl = document.activeElement;
                if (activeEl) activeEl.blur();
                moveSelection(1, 0, false);
            }
            return;
        }

        if (isInputActive(e)) return;

        if (e.shiftKey && e.code === 'Space' && !e.ctrlKey && !e.metaKey && !e.altKey) {
            e.preventDefault(); e.stopImmediatePropagation();
            selectRow(wbsState.selectedCell.r, false);
            return;
        }

        if (!wbsState.isEditing && e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey && !(e.shiftKey && e.code === 'Space')) {
            enterEditMode(e.key);
            e.preventDefault(); e.stopImmediatePropagation();
            return;
        }

        if (!wbsState.isEditing && e.altKey && e.key === 'ArrowDown') {
            const el = document.querySelector(`td[data-row="${wbsState.selectedCell.r}"][data-col="${wbsState.selectedCell.c}"]`);
            if (el && el.querySelector('select')) {
                e.preventDefault(); e.stopImmediatePropagation();
                enterEditMode();
                setTimeout(() => {
                    const sel = el.querySelector('select');
                    if (sel && sel.showPicker) { try { sel.showPicker(); } catch (err) { } }
                }, 50);
                return;
            }
        }

        if (e.ctrlKey && e.key === 'c') {
            e.preventDefault(); e.stopImmediatePropagation();
            copySelection();
        }
        else if (e.ctrlKey && e.key === 'z') { e.preventDefault(); e.stopImmediatePropagation(); undo(); }
        else if (e.ctrlKey && e.key === 'y') { e.preventDefault(); e.stopImmediatePropagation(); redo(); }
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
                let handled = false;
                if (wbsState.selectedCell && wbsState.selectedCell.c === 0) {
                    handled = handleArrowAccordion(e.key);
                }
                if (!handled) {
                    moveSelection(0, e.key === 'ArrowRight' ? 1 : -1, false);
                }
            } else {
                let dr = 0, dc = 0;
                if (e.key === 'ArrowUp') dr = -1;
                if (e.key === 'ArrowDown') dr = 1;
                if (e.shiftKey && e.key === 'ArrowLeft') dc = -1;
                if (e.shiftKey && e.key === 'ArrowRight') dc = 1;
                moveSelection(dr, dc, e.shiftKey);
            }
        } else if (e.ctrlKey && e.shiftKey && (e.key === '+' || e.key === '=' || e.key === ';')) {
            e.preventDefault(); e.stopImmediatePropagation();
            handleInsertAbove();
        }
    }, { capture: true });

    document.addEventListener('paste', (e) => {
        if (isInputActive(e) || wbsState.isEditing) return;
        e.preventDefault(); e.stopImmediatePropagation();
        const text = (e.clipboardData || window.clipboardData).getData('text');
        handlePaste(text);
    }, { capture: true });

    document.addEventListener('dragover', (e) => e.preventDefault());
    document.addEventListener('drop', (e) => e.preventDefault());
}
