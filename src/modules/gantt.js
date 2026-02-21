import { project, selectedPhaseIds, setSelectedPhaseIds, saveState, viewMode, zoomRange, setViewMode, setZoomRange, ganttZoomMode } from './state.js';
import { normalizeDate, isBusinessDay, isHoliday, getDayOfWeek } from './helpers.js';
import { renderWBS, addMilestoneInfo } from './wbs.js';
import { showModal } from './ui.js';

let isTimelineCollapsed = false;

export function setTimelineCollapsed(val) { isTimelineCollapsed = val; }

export function renderTimeline() {
    const timelineView = document.getElementById('dashboard-view');
    if (!timelineView) return;

    timelineView.innerHTML = '';
    timelineView.className = `timeline-wrapper ${isTimelineCollapsed ? 'collapsed' : ''}`;

    const tBtn = document.getElementById('header-toggle-btn');
    if (tBtn) {
        tBtn.onclick = () => {
            isTimelineCollapsed = !isTimelineCollapsed;
            const dash = document.getElementById('mini-dashboard');
            if (dash) {
                if (isTimelineCollapsed) dash.classList.add('collapsed');
                else dash.classList.remove('collapsed');
            }
            renderTimeline();
        };
        tBtn.style.transform = isTimelineCollapsed ? 'rotate(-90deg)' : 'rotate(0deg)';
    }

    const titleEl = document.getElementById('current-project-title');
    const rangeEl = document.getElementById('project-date-range');
    if (titleEl && project) titleEl.textContent = project.name;
    if (rangeEl && project) rangeEl.textContent = `${project.start} ~ ${project.end}`;

    const { minDate, maxDate, totalTime } = getDateRange();
    if (totalTime <= 0) return;

    const headerContainer = document.createElement('div'); headerContainer.className = 'timeline-header-container';
    const contentContainer = document.createElement('div'); contentContainer.className = 'timeline-content-container';

    contentContainer.onscroll = () => {
        headerContainer.scrollLeft = contentContainer.scrollLeft;
    };

    const headerCanvas = document.createElement('div'); headerCanvas.className = 'timeline-canvas-full';
    const headerLayer = document.createElement('div');
    headerLayer.style.position = 'absolute'; headerLayer.style.width = '100%'; headerLayer.style.height = '100%';

    const totalDays = totalTime / (86400000);
    const containerWidth = timelineView.clientWidth || 1000;
    const pxPerDay = containerWidth / totalDays;
    let bottomUnit = (totalDays > 120 || pxPerDay < 24) ? 'week' : 'day';
    const jpDays = ['(日)', '(月)', '(火)', '(水)', '(木)', '(金)', '(土)'];

    let iter = new Date(minDate); iter.setHours(12, 0, 0, 0); const endT = maxDate.getTime();
    const hDayPct = 100 / totalDays;

    while (iter.getTime() <= endT) {
        const dStart = new Date(iter); dStart.setHours(0, 0, 0, 0);
        const pct = (dStart.getTime() - minDate.getTime()) / totalTime * 100;
        let show = false;

        if (bottomUnit === 'day') show = true;
        else if (dStart.getDay() === 0) show = true;

        if (show) {
            const cell = document.createElement('div'); cell.className = 'timeline-header-cell';
            cell.style.left = `${pct}%`;

            if (bottomUnit === 'day') {
                cell.style.width = `${hDayPct}%`;
                cell.style.display = 'flex';
                cell.style.flexDirection = 'column';
                cell.style.justifyContent = 'center';
                cell.style.alignItems = 'center';
                cell.style.lineHeight = '1.1';
                cell.style.fontSize = '0.7rem';

                const dateText = `${dStart.getMonth() + 1}/${dStart.getDate()}`;
                const dayText = jpDays[dStart.getDay()];

                cell.innerHTML = `<div>${dateText}</div><div style="font-size:0.65rem; opacity:0.8;">${dayText}</div>`;

                if (isHoliday(dStart, project.holidays)) cell.classList.add('holiday');
                else if (dStart.getDay() === 0) cell.classList.add('sunday');
                else if (dStart.getDay() === 6) cell.classList.add('saturday');
                else cell.classList.add('weekday');

            } else {
                cell.textContent = `${dStart.getMonth() + 1}/${dStart.getDate()}`;
            }

            const d = new Date(dStart); cell.onclick = () => zoomTo(d, bottomUnit);
            headerLayer.appendChild(cell);
        }
        iter.setDate(iter.getDate() + 1);
    }

    let mIter = new Date(minDate); mIter.setDate(1); mIter.setHours(0, 0, 0, 0);
    while (mIter <= maxDate) {
        const s = mIter < minDate ? minDate : mIter;
        const next = new Date(mIter); next.setMonth(next.getMonth() + 1);
        const e = next > maxDate ? maxDate : next;
        if (s < e) {
            const l = (s.getTime() - minDate.getTime()) / totalTime * 100;
            const w = (e.getTime() - s.getTime()) / totalTime * 100;
            const g = document.createElement('div'); g.className = 'timeline-header-group';
            g.style.left = `${l}%`; g.style.width = `${w}%`;
            g.textContent = `${mIter.getFullYear()}.${mIter.getMonth() + 1}`;
            headerLayer.appendChild(g);
        }
        mIter.setMonth(mIter.getMonth() + 1);
    }
    headerCanvas.appendChild(headerLayer); headerContainer.appendChild(headerCanvas);

    // Timeline Select Range
    let isSelecting = false;
    let startX = 0;
    let selectionOverlay = null;

    headerLayer.onmousedown = (e) => {
        isSelecting = true;
        startX = e.offsetX;
        const existing = headerLayer.querySelector('.timeline-selection-overlay');
        if (existing) existing.remove();
        selectionOverlay = document.createElement('div');
        selectionOverlay.className = 'timeline-selection-overlay';
        selectionOverlay.style.left = `${startX}px`;
        selectionOverlay.style.width = '0px';
        headerLayer.appendChild(selectionOverlay);
        e.preventDefault();
    };

    headerLayer.onmousemove = (e) => {
        if (!isSelecting || !selectionOverlay) return;
        const width = Math.abs(e.offsetX - startX);
        const left = Math.min(startX, e.offsetX);
        selectionOverlay.style.left = `${left}px`;
        selectionOverlay.style.width = `${width}px`;
    };

    headerLayer.onmouseup = (e) => {
        if (!isSelecting) return;
        isSelecting = false;
        if (Math.abs(e.offsetX - startX) < 5) {
            if (selectionOverlay) selectionOverlay.remove();
            return;
        }
    };
    headerLayer.onmouseleave = () => { if (isSelecting) isSelecting = false; };

    // Content
    const contentCanvas = document.createElement('div'); contentCanvas.className = 'timeline-canvas-full';

    // Grid Lines
    const gridEl = document.createElement('div');
    gridEl.className = 'timeline-canvas-full';
    gridEl.style.position = 'absolute'; gridEl.style.top = 0; gridEl.style.height = '100%'; gridEl.style.zIndex = 0;

    iter = new Date(minDate); iter.setHours(12, 0, 0, 0);
    const dayPct = 100 / (totalTime / 86400000);

    while (iter.getTime() <= endT) {
        const dStart = new Date(iter); dStart.setHours(0, 0, 0, 0);
        const pct = (dStart.getTime() - minDate.getTime()) / totalTime * 100;
        let show = (bottomUnit === 'day' || (bottomUnit === 'week' && dStart.getDay() === 0));

        if (show) {
            const l = document.createElement('div'); l.className = 'grid-line'; l.style.left = `${pct}%`;
            if (bottomUnit === 'day') {
                l.style.width = `${dayPct}%`;
                l.style.borderRight = '1px solid var(--border-color)';
                const holidays = project.holidays; // Pass to helper
                if (isHoliday(dStart, holidays)) l.classList.add('grid-col-holiday');
                else if (dStart.getDay() === 0) l.classList.add('grid-col-sun');
                else if (dStart.getDay() === 6) l.classList.add('grid-col-sat');
            }
            gridEl.appendChild(l);
        }
        iter.setDate(iter.getDate() + 1);
    }
    contentCanvas.appendChild(gridEl);

    // Milestones
    if (project.milestones.length > 0) {
        const mrow = document.createElement('div');
        mrow.className = 'timeline-track-row milestone-track';
        project.milestones.forEach(m => {
            const d = normalizeDate(m.date);
            if (d && d >= minDate && d <= maxDate) {
                const pct = (d.getTime() - minDate.getTime()) / totalTime * 100;
                const mk = document.createElement('div'); mk.className = 'milestone-marker';
                mk.style.left = `${pct}%`; mk.style.top = '10px';
                // Tooltip text
                mk.setAttribute('data-title', m.title);
                mk.onclick = () => addMilestoneInfo();

                // We use CSS for hover tooltip now, no separate label element needed.
                // Or if we want a fancy label that appears:
                const lbl = document.createElement('div'); lbl.className = 'milestone-tooltip';
                lbl.textContent = m.title;
                mk.appendChild(lbl);

                mrow.appendChild(mk);
            }
        });
        contentCanvas.appendChild(mrow);
    }

    // Phases
    const phasesContainer = document.createElement('div');
    phasesContainer.style.position = 'relative';
    phasesContainer.style.marginTop = '4px';

    const sortedPhases = [...project.phases].sort((a, b) => new Date(a.start) - new Date(b.start));
    const tracks = [];

    if (!isTimelineCollapsed) {
        sortedPhases.forEach((p, i) => {
            const s = normalizeDate(p.start); const e = normalizeDate(p.end);
            if (!s || !e) return;

            let trackIdx = i;
            tracks[trackIdx] = e;
            while (tracks.length <= trackIdx) tracks.push(e);

            if (e >= minDate && s <= maxDate) {
                const left = (Math.max(s.getTime(), minDate.getTime()) - minDate.getTime()) / totalTime * 100;
                const dur = Math.min(e.getTime(), maxDate.getTime()) - Math.max(s.getTime(), minDate.getTime());
                const width = (dur / totalTime) * 100;

                const bar = document.createElement('div');
                const isSelected = selectedPhaseIds.includes(p.id);
                bar.className = `phase-bar ${isSelected ? 'selected' : ''}`;
                bar.style.left = `${left}%`; bar.style.width = `${width}%`;
                bar.style.top = `${trackIdx * 34}px`;
                bar.textContent = p.name;
                bar.onclick = (ev) => {
                    ev.stopPropagation();
                    if (ev.ctrlKey || ev.metaKey) {
                        const newIds = isSelected ? selectedPhaseIds.filter(id => id !== p.id) : [...selectedPhaseIds, p.id];
                        setSelectedPhaseIds(newIds);
                    } else {
                        setSelectedPhaseIds([p.id]);
                    }
                    renderTimeline(); renderWBS();
                };

                // Resize Handles
                const lHandle = document.createElement('div'); lHandle.className = 'phase-resize-handle left';
                const rHandle = document.createElement('div'); rHandle.className = 'phase-resize-handle right';

                // Allow moving by dragging the bar body
                setupDrag(bar, 'move', p, contentCanvas, totalTime, minDate);
                // Resize
                setupDrag(lHandle, 'left', p, contentCanvas, totalTime, minDate);
                setupDrag(rHandle, 'right', p, contentCanvas, totalTime, minDate);

                // Edit on Double Click
                bar.ondblclick = (e) => {
                    e.stopPropagation();
                    // Call edit bucket
                    window.addPhaseInfo(p.id); // Reusing addPhaseInfo with ID to edit
                };

                bar.appendChild(lHandle); bar.appendChild(rHandle);
                phasesContainer.appendChild(bar);
            }
        });
    }
    phasesContainer.style.height = `${tracks.length * 34 + 10}px`;
    contentCanvas.appendChild(phasesContainer);

    contentContainer.appendChild(contentCanvas);
    timelineView.append(headerContainer, contentContainer);

    // Today Line
    const today = new Date(); today.setHours(0, 0, 0, 0);
    if (today >= minDate && today <= maxDate) {
        const tPct = (today.getTime() - minDate.getTime()) / totalTime * 100;
        const tLine = document.createElement('div'); tLine.className = 'today-line'; tLine.style.left = `${tPct}%`;
        contentCanvas.appendChild(tLine);
    }

    // Weekend/Holiday Backgrounds
    const iterDate = new Date(minDate);
    const dayMs = 86400000;
    while (iterDate < maxDate) {
        if (!isBusinessDay(iterDate, project.holidays)) {
            const rPct = (iterDate.getTime() - minDate.getTime()) / totalTime * 100;
            const wPct = dayMs / totalTime * 100;
            const bg = document.createElement('div');
            bg.className = 'gantt-weekend-col';
            bg.style.left = `${rPct}%`;
            bg.style.width = `${wPct}%`;
            contentCanvas.appendChild(bg);
        }
        iterDate.setDate(iterDate.getDate() + 1);
    }

    const headerHeight = 40;
    const milestoneHeight = project.milestones.length > 0 ? 32 : 0;
    const phasesHeight = isTimelineCollapsed ? 0 : (tracks.length * 34 + 10);
    const totalHeight = headerHeight + milestoneHeight + phasesHeight + (isTimelineCollapsed ? 15 : 20);
    timelineView.style.height = `${totalHeight}px`;
}

// Updated setupDrag to handle 'move', 'left', 'right'
function setupDrag(handle, type, p, contentCanvas, totalTime, minDate) {
    handle.onmousedown = (e) => {
        e.stopPropagation(); e.preventDefault();

        const startX = e.clientX;
        const originalStart = new Date(p.start).getTime();
        const originalEnd = new Date(p.end).getTime();
        const pxPerMs = contentCanvas.clientWidth / totalTime;
        let hasMoved = false;

        const moveHandler = (me) => {
            const dxPx = me.clientX - startX;
            if (Math.abs(dxPx) < 5) return; // Threshold

            if (!hasMoved) {
                hasMoved = true;
                saveState(); // Save state only when move starts
            }

            const dxMs = dxPx / pxPerMs;
            const fmt = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

            if (type === 'left') {
                let newS = originalStart + dxMs;
                if (newS < originalEnd - 86400000) {
                    p.start = fmt(new Date(newS));
                    renderTimeline();
                }
            } else if (type === 'right') {
                let newE = originalEnd + dxMs;
                if (newE > originalStart + 86400000) {
                    p.end = fmt(new Date(newE));
                    renderTimeline();
                }
            } else if (type === 'move') {
                let newS = originalStart + dxMs;
                let newE = originalEnd + dxMs;
                p.start = fmt(new Date(newS));
                p.end = fmt(new Date(newE));
                renderTimeline();
            }
        };
        const upHandler = () => {
            document.removeEventListener('mousemove', moveHandler);
            document.removeEventListener('mouseup', upHandler);
            if (hasMoved) {
                renderTimeline(); renderWBS();
            } else {
                // It was a click!
                // We prevented default, so we might need to manually trigger click logic if it was suppressed.
                // Or just do nothing and let the element's onclick handler fire?
                // e.preventDefault() on mousedown might NOT prevent click, but let's see.
                // If we don't re-render, the DOM element stays.

                // If it was a 'move' handle (the bar itself), we want selection logic.
                // If it was a 'resize' handle, we probably don't want selection?
                // But resize handles are children of bar, so click bubbles to bar.
                // Since we stopped propagation in mousedown, we might have stopped global handling, but bar.onclick?

                // Let's explicitly call the click logic if needed, or just let 'click' happen.
                // To be safe and ensure "click" selection works, we can simulate it here if we know what to do.
                // But bar.onclick is defined.
                // If we don't re-render, bar.onclick SHOULD fire.
            }
        };
        document.addEventListener('mousemove', moveHandler);
        document.addEventListener('mouseup', upHandler);
    };
}

export function getDateRange() {
    let minDate, maxDate;
    if (viewMode === 'zoom' && zoomRange) {
        minDate = new Date(zoomRange.start);
        maxDate = new Date(zoomRange.end);
    } else {
        minDate = normalizeDate(project.start);
        maxDate = normalizeDate(project.end);
        project.phases.forEach(p => {
            const s = normalizeDate(p.start), e = normalizeDate(p.end);
            if (s && (!minDate || s < minDate)) minDate = s;
            if (e && (!maxDate || e > maxDate)) maxDate = e;
        });
    }

    // Safety check: if no valid dates found (e.g. empty project or invalid dates)
    if (!minDate || isNaN(minDate.getTime())) minDate = new Date();
    if (!maxDate || isNaN(maxDate.getTime())) maxDate = new Date(minDate);

    // Padding
    const safeMin = new Date(minDate); safeMin.setDate(safeMin.getDate() - 2);
    const safeMax = new Date(maxDate); safeMax.setDate(safeMax.getDate() + 5);

    safeMin.setHours(0, 0, 0, 0); safeMax.setHours(0, 0, 0, 0);
    return { minDate: safeMin, maxDate: safeMax, totalTime: safeMax - safeMin };
}

export function zoomTo(d, unit) {
    const s = new Date(d); const e = new Date(d);
    if (unit === 'month') e.setMonth(e.getMonth() + 1);
    else if (unit === 'week') e.setDate(e.getDate() + 7);
    else { s.setDate(s.getDate() - 3); e.setDate(e.getDate() + 3); }
    setZoomRange({ start: s, end: e });
    setViewMode('zoom');
    renderTimeline();
    renderWBS();
}

export function changeGanttZoom(mode) {
    // Note: state.js defines setGanttZoomMode. renderWBS behaves differently based on it.
    // We should export set from state and call it.
    // Actually renderWBS reads ganttZoomMode from state.
    // This function acts as the public handler.
}
