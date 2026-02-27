export const wbsState = {
    filters: {},
    activeFilterPopup: null,
    selectedCell: { r: 0, c: 0 },
    selectionAnchor: null,
    selectedRange: null,
    isEditing: false
};

export function setFilters(f) { wbsState.filters = f; }
export function setActiveFilterPopup(p) { wbsState.activeFilterPopup = p; }
export function setSelectedCell(r, c) { wbsState.selectedCell = { r, c }; }
export function setSelectionAnchor(r, c) { wbsState.selectionAnchor = { r, c }; }
export function setSelectedRange(r1, c1, r2, c2) { wbsState.selectedRange = { r1, c1, r2, c2 }; }
export function setIsEditing(val) { wbsState.isEditing = val; }
