import { project, saveState, assigneeColors, triggerRender } from '../core/state.js';
import { generateId, normalizeDate, DISTINCT_COLORS } from '../utils/helpers.js';
import { renderWBS } from './view.js';
import { renderTimeline } from './gantt.js';
import { getNextBusinessDay, addBusinessDays, isBusinessDay } from '../utils/dateCalc.js';
import { showModal } from '../ui/modal.js';

let importFormat = ['title', 'estimate', 'assignee']; // Default
const availableFields = [
    { id: 'phase', label: 'Phase (Group)' },
    { id: 'title', label: 'Task Title' },
    { id: 'estimate', label: 'Estimate' },
    { id: 'assignee', label: 'Assignee' },
    { id: 'start', label: 'Start Date' },
    { id: 'end', label: 'End Date' },
    { id: 'status', label: 'Status' },
    { id: 'predecessors', label: 'Predecessors' },
    { id: 'phase_cols', label: 'Phase Columns (Auto)' },
    { id: 'ignore', label: '(Ignore Column)', title: 'Use this to skip a column in your text that you do not want to import.' }
];

export function importWBSFlat(text, unitStr, format) {
    saveState();
    const lines = text.trim().split('\n').map(l => l.trim()).filter(l => l);
    if (lines.length < 1) return;

    const multiplier = unitStr === 'days' ? 8 : 1;
    let separator = '\t';
    if (!lines[0].includes('\t')) separator = /\s{2,}/;

    const assigneeSchedule = {};
    const getAssignee = (name) => {
        if (!project.assignees) project.assignees = [];
        let a = project.assignees.find(x => x.name === name);
        if (!a) {
            const color = DISTINCT_COLORS.find(c => !project.assignees.some(ex => ex.color === c)) || '#' + Math.floor(Math.random() * 16777215).toString(16);
            a = { id: generateId(), name: name, color: color };
            project.assignees.push(a);
            assigneeColors[name] = color;
        }
        return a;
    };

    let currentPhase = null;
    if (project.phases.length > 0) currentPhase = project.phases[project.phases.length - 1];

    const phaseColChipIdx = format.indexOf('phase_cols');
    if (phaseColChipIdx >= 0) {
        // Matrix Import Mode
        const headerLine = lines[0];
        const dataLines = lines.slice(1);
        let headers = headerLine.split(separator).map(h => h.trim());
        while (headers.length > 0 && headers[headers.length - 1] === '') headers.pop();

        const chipsBefore = format.slice(0, phaseColChipIdx);
        const chipsAfter = format.slice(phaseColChipIdx + 1);

        const startDynIdx = chipsBefore.length;
        const endDynIdx = headers.length - chipsAfter.length;

        if (endDynIdx <= startDynIdx) {
            alert("Error: Not enough columns for Phase mapping.");
            return;
        }

        const phaseHeaders = headers.slice(startDynIdx, endDynIdx);
        const fmt = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

        const phaseMap = {};
        phaseHeaders.forEach((phName) => {
            let p = project.phases.find(x => x.name === phName);
            if (!p) {
                p = { id: generateId(), name: phName, start: project.start, end: project.start, tasks: [], expanded: true };
                project.phases.push(p);
            }
            phaseMap[phName] = p;
        });

        const rowLastEnd = {};

        dataLines.forEach(line => {
            const parts = line.split(separator).map(p => p.trim());
            const rowData = {};

            chipsBefore.forEach((fid, i) => rowData[fid] = parts[i]);
            chipsAfter.forEach((fid, i) => {
                const idx = parts.length - chipsAfter.length + i;
                if (idx >= 0 && idx < parts.length) rowData[fid] = parts[idx];
            });

            const featureTitle = rowData.title || 'Untitled Feature';
            let assigneeObj = null;
            if (rowData.assignee) assigneeObj = getAssignee(rowData.assignee);

            phaseHeaders.forEach((phHeader, i) => {
                const colIdx = startDynIdx + i;
                const valStr = parts[colIdx];
                const est = parseFloat(valStr);

                if (!isNaN(est) && est > 0) {
                    const phase = phaseMap[phHeader];
                    const cost = est * multiplier;
                    const durationDays = Math.ceil(cost / 8);

                    let refDate = rowLastEnd[featureTitle] ? new Date(rowLastEnd[featureTitle]) : normalizeDate(project.start);

                    if (rowData.assignee && assigneeSchedule[rowData.assignee]) {
                        const personDate = new Date(assigneeSchedule[rowData.assignee]);
                        if (personDate > refDate) refDate = personDate;
                    }

                    let sDate = getNextBusinessDay(refDate, project.holidays);
                    if (!rowLastEnd[featureTitle] && !assigneeSchedule[rowData.assignee]) {
                        sDate = new Date(refDate);
                        while (!isBusinessDay(sDate, project.holidays)) sDate.setDate(sDate.getDate() + 1);
                    }

                    const eDate = addBusinessDays(sDate, durationDays, project.holidays);

                    const newTask = {
                        id: generateId(), title: featureTitle, start: fmt(sDate), end: fmt(eDate),
                        progress: 0, estimate: cost, assignee: assigneeObj || rowData.assignee || null,
                        status: rowData.status || 'todo'
                    };

                    phase.tasks.push(newTask);

                    const lastDate = new Date(eDate);
                    rowLastEnd[featureTitle] = lastDate;
                    if (rowData.assignee) assigneeSchedule[rowData.assignee] = lastDate;
                }
            });
        });

        project.phases.forEach(p => {
            if (p.tasks.length > 0) {
                let minDate = new Date(p.tasks[0].start);
                let maxDate = new Date(p.tasks[0].end);
                p.tasks.forEach(t => {
                    const s = new Date(t.start);
                    const e = new Date(t.end);
                    if (s < minDate) minDate = s;
                    if (e > maxDate) maxDate = e;
                });
                p.start = fmt(minDate);
                p.end = fmt(maxDate);

                const mName = p.name + ' End';
                let m = project.milestones.find(x => x.title === mName);
                if (!m) {
                    project.milestones.push({ id: generateId(), title: mName, date: p.end });
                } else {
                    m.date = p.end;
                }
            }
        });

        saveState();
        triggerRender();
        return;
    }

    // Flat Import Mode
    lines.forEach(line => {
        const parts = line.split(separator).map(p => p.trim());
        const taskData = {};

        format.forEach((fid, idx) => {
            if (idx < parts.length) {
                taskData[fid] = parts[idx];
            }
        });

        if (taskData.phase) {
            let p = project.phases.find(x => x.name === taskData.phase);
            if (!p) {
                p = { id: generateId(), name: taskData.phase, start: project.start, end: project.start, tasks: [], expanded: true };
                project.phases.push(p);
            }
            currentPhase = p;
        }
        if (!currentPhase) {
            currentPhase = { id: generateId(), name: 'Imported Phase', start: project.start, end: project.start, tasks: [], expanded: true };
            project.phases.push(currentPhase);
        }

        const title = taskData.title || 'Untitled';
        const estVal = parseFloat(taskData.estimate);
        const estimate = isNaN(estVal) ? 0 : estVal * multiplier;
        let assigneeObj = null;
        if (taskData.assignee) assigneeObj = getAssignee(taskData.assignee);

        let sDateStr = taskData.start ? normalizeDate(taskData.start) : null;
        let eDateStr = taskData.end ? normalizeDate(taskData.end) : null;

        if (!sDateStr) {
            let refDate = normalizeDate(currentPhase.start);
            if (taskData.assignee && assigneeSchedule[taskData.assignee]) {
                const prevEnd = new Date(assigneeSchedule[taskData.assignee]);
                const nextStart = getNextBusinessDay(prevEnd, project.holidays);
                if (nextStart > refDate) refDate = nextStart;
            }
            sDateStr = refDate;
            while (!isBusinessDay(sDateStr, project.holidays)) sDateStr.setDate(sDateStr.getDate() + 1);
        }

        if (!eDateStr) {
            const durationDays = estimate > 0 ? Math.ceil(estimate / 8) : 0;
            if (durationDays <= 0) eDateStr = new Date(sDateStr);
            else eDateStr = addBusinessDays(sDateStr, durationDays, project.holidays);
        }

        if (taskData.assignee) assigneeSchedule[taskData.assignee] = new Date(eDateStr);

        const fmt = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

        const newTask = {
            id: generateId(), title: title, start: fmt(sDateStr), end: fmt(eDateStr),
            progress: 0, estimate: estimate, assignee: assigneeObj || taskData.assignee,
            status: taskData.status || 'todo',
            predecessors: taskData.predecessors ? taskData.predecessors.split(',') : []
        };
        currentPhase.tasks.push(newTask);
    });

    project.phases.forEach(p => {
        if (p.tasks.length > 0) {
            let minS = p.tasks[0].start;
            let maxE = p.tasks[0].end;
            p.tasks.forEach(t => {
                if (t.start < minS) minS = t.start;
                if (t.end > maxE) maxE = t.end;
            });
            p.start = minS;
            p.end = maxE;
        }
    });

    renderTimeline();
    renderWBS();
}

export function openImportModal() {
    const renderBuilder = () => {
        const selectedHtml = importFormat.map((fid, idx) => {
            const f = availableFields.find(x => x.id === fid) || { id: fid, label: fid };
            return `<div class="format-chip" draggable="true" data-idx="${idx}" style="padding:4px 8px; background:var(--accent-color); color:white; border-radius:4px; cursor:grab; font-size:0.8rem; display:flex; align-items:center; gap:4px; position:relative; overflow:visible;">
                <span class="reorder-btn" onclick="moveFormatField(${idx}, -1)" style="cursor:pointer; font-size:0.7rem; background:rgba(0,0,0,0.2); padding:0 3px; border-radius:2px; user-select:none;">&larr;</span>
                <span style="flex:1;">${f.label}</span>
                <span class="reorder-btn" onclick="moveFormatField(${idx}, 1)" style="cursor:pointer; font-size:0.7rem; background:rgba(0,0,0,0.2); padding:0 3px; border-radius:2px; user-select:none;">&rarr;</span>
                <span onclick="removeFormatField(${idx})" style="cursor:pointer; opacity:0.8; font-weight:bold; margin-left:4px;">×</span>
            </div>`;
        }).join('<span style="color:var(--text-secondary);">&rarr;</span>');

        const availableHtml = availableFields
            .filter(f => f.id === 'ignore' || !importFormat.includes(f.id))
            .map(f => {
                return `<div class="field-chip" title="${f.title || ''}" onclick="addFormatField('${f.id}')" style="padding:4px 8px; border:1px solid var(--border-color); border-radius:4px; cursor:pointer; font-size:0.8rem; background:var(--bg-color); user-select:none;">${f.label}</div>`;
            }).join('');

        return `
            <div style="margin-bottom:1rem; border:1px solid var(--border-color); padding:0.5rem; border-radius:4px; background:var(--card-bg);">
                <label style="font-size:0.8rem; color:var(--text-secondary); display:block; margin-bottom:0.5rem;"><strong>1. Define Column Format</strong> (Click to add, Drag <b>or use &larr;&rarr;</b> to order)</label>
                <div id="format-drop-zone" style="min-height:30px; display:flex; flex-wrap:wrap; gap:0.5rem; align-items:center; padding:1rem; border:1px dashed var(--border-color); border-radius:4px; margin-bottom:0.5rem; background:var(--bg-color);">
                    ${selectedHtml}
                </div>
                <div style="display:flex; flex-wrap:wrap; gap:0.5rem;">
                    ${availableHtml}
                </div>
            </div>
            <div style="margin-bottom:0.5rem;">
                <label style="font-size:0.8rem; color:var(--text-secondary); display:block; margin-bottom:0.5rem;"><strong>2. Paste Text</strong> (Tab separated)</label>
                <textarea id="import-text" style="width:100%;height:100px;font-family:monospace; white-space:pre;" placeholder="Phase A    Task 1    10    User1"></textarea>
            </div>
            <div style="display:flex; align-items:center; gap:1rem;">
                <div style="flex:1;">
                     <label style="font-size:0.8rem;">Unit:</label>
                     <select id="import-unit" class="modal-input" style="width:auto; padding:0.2rem;">
                        <option value="days">Person Days (8h/day)</option>
                        <option value="hours">Hours</option>
                    </select>
                </div>
                <button class="primary-btn" id="run-import-btn">Import</button>
            </div>
            <style>
                .field-chip:hover { background: var(--active-phase-row-bg) !important; border-color:var(--accent-color) !important; }
                .format-chip:active { cursor:grabbing; }
            </style>
        `;
    };

    window.addFormatField = (fid) => { importFormat.push(fid); updateModal(); };
    window.removeFormatField = (idx) => { importFormat.splice(idx, 1); updateModal(); };
    window.moveFormatField = (idx, dir) => {
        const item = importFormat[idx];
        const newIdx = idx + dir;
        if (newIdx >= 0 && newIdx < importFormat.length) {
            importFormat.splice(idx, 1);
            importFormat.splice(newIdx, 0, item);
            updateModal();
        }
    };

    const getPlaceholder = () => {
        if (importFormat.length === 0) return "Paste your data here...";
        const row1 = [], row2 = [], row3 = [];
        importFormat.forEach(fid => {
            if (fid === 'phase_cols') {
                row1.push('Design', 'Dev'); row2.push('5', '10'); row3.push('3', '8');
            } else {
                switch (fid) {
                    case 'phase': row1.push('Phase A'); row2.push('Phase A'); row3.push('Phase A'); break;
                    case 'title': row1.push('Task Title'); row2.push('Feature A'); row3.push('Feature B'); break;
                    case 'estimate': row1.push('8'); row2.push('8'); row3.push('4'); break;
                    case 'assignee': row1.push('Assignee'); row2.push('User1'); row3.push('User2'); break;
                    case 'start': row1.push('Start Date'); row2.push('2023-01-01'); row3.push('2023-01-01'); break;
                    case 'end': row1.push('End Date'); row2.push('2023-01-10'); row3.push('2023-01-10'); break;
                    case 'status': row1.push('Status'); row2.push('todo'); row3.push('todo'); break;
                    case 'predecessors': row1.push('Pre'); row2.push(''); row3.push(''); break;
                    case 'ignore': row1.push('...'); row2.push('...'); row3.push('...'); break;
                    default: row1.push('...'); row2.push('...'); row3.push('...');
                }
            }
        });
        return [row1.join('    '), row2.join('    '), row3.join('    ')].join('\n');
    };

    const updateModal = () => {
        const body = document.getElementById('modal-body');
        if (body) {
            const txt = document.getElementById('import-text');
            const val = txt ? txt.value : '';
            body.innerHTML = renderBuilder();
            const newTxt = document.getElementById('import-text');
            if (newTxt) {
                newTxt.placeholder = getPlaceholder();
                newTxt.value = val;
            }
            bindEvents();
        }
    };

    const bindEvents = () => {
        const btn = document.getElementById('run-import-btn');
        if (btn) btn.onclick = () => {
            const text = document.getElementById('import-text').value;
            const unit = document.getElementById('import-unit').value;
            if (text.trim()) importWBSFlat(text, unit, importFormat);
        };
        const zone = document.getElementById('format-drop-zone');
        if (!zone) return;
        let dragSrcEl = null;
        const allowDrop = (e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; };
        zone.ondragover = allowDrop;
        zone.ondragenter = allowDrop;
        zone.ondrop = (e) => {
            e.preventDefault();
            const srcIdx = parseInt(e.dataTransfer.getData('text/plain'));
            if (!isNaN(srcIdx)) {
                const item = importFormat[srcIdx];
                importFormat.splice(srcIdx, 1);
                importFormat.push(item);
                updateModal();
            }
        };
        const chips = zone.querySelectorAll('.format-chip');
        chips.forEach(chip => {
            chip.ondragstart = (e) => {
                dragSrcEl = chip;
                e.dataTransfer.effectAllowed = 'move';
                e.dataTransfer.setData('text/plain', chip.dataset.idx);
                setTimeout(() => chip.style.opacity = '0.4', 0);
            };
            chip.ondragend = () => { chip.style.opacity = '1'; dragSrcEl = null; };
            chip.ondragover = allowDrop;
            chip.ondragenter = (e) => {
                allowDrop(e);
                if (chip !== dragSrcEl) {
                    chip.style.transform = 'scale(1.1)';
                    chip.style.outline = '2px solid white';
                }
            };
            chip.ondragleave = () => {
                chip.style.transform = 'scale(1)';
                chip.style.outline = 'none';
            };
            chip.ondrop = (e) => {
                e.preventDefault();
                e.stopPropagation();
                const srcIdx = parseInt(e.dataTransfer.getData('text/plain'));
                const targetIdx = parseInt(chip.dataset.idx);
                if (!isNaN(srcIdx) && !isNaN(targetIdx) && srcIdx !== targetIdx) {
                    const item = importFormat[srcIdx];
                    importFormat.splice(srcIdx, 1);
                    importFormat.splice(targetIdx, 0, item);
                    updateModal();
                }
            };
        });
    };

    showModal('Custom Import', renderBuilder(), () => { });
    const txt = document.getElementById('import-text');
    if (txt) txt.placeholder = getPlaceholder();
    bindEvents();
}

// Deprecated (Left for backward compat if needed)
export function importWBSFromText(text, unitStr) {
    importWBSFlat(text, unitStr, importFormat);
}
