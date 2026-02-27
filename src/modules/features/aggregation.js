import { project } from '../core/state.js';
import { normalizeDate } from '../utils/helpers.js';

let resourceViewMode = 'week'; // 'day', 'week'
let visiblePhaseIds = []; // IDs of phases to show in Phase S-Curve

let currentAggPage = 'progress';

export function renderAggregation() {
    const container = document.getElementById('aggregation-view');
    if (!container || !project) return;
    container.innerHTML = '';
    container.style.display = 'flex';
    container.style.height = '100%';
    container.style.gap = '1rem';

    // Sidebar
    const sidebar = document.createElement('div');
    sidebar.style.cssText = 'width:250px; background:var(--card-bg); border-right:1px solid var(--border-color); padding:1rem; display:flex; flex-direction:column; gap:0.5rem; flex-shrink:0;';

    const menuItems = [
        { id: 'progress', label: 'Progress (S-Curve)' },
        { id: 'resource', label: 'Resource Load' }
    ];

    menuItems.forEach(item => {
        const btn = document.createElement('div');
        btn.className = `settings-menu-item ${currentAggPage === item.id ? 'active' : ''}`;
        btn.textContent = item.label;
        btn.onclick = () => {
            currentAggPage = item.id;
            renderAggregation();
        };
        sidebar.appendChild(btn);
    });

    // Content Area
    const contentArea = document.createElement('div');
    contentArea.style.cssText = 'flex:1; padding:1rem; overflow-y:auto; background:var(--bg-color); display:flex; flex-direction:column; gap:2rem;';

    if (currentAggPage === 'progress') {
        renderOverallCurve(contentArea);
        renderPhaseCurve(contentArea);
    } else if (currentAggPage === 'resource') {
        // Render both chart and table in the same view
        renderResourceChartSection(contentArea);
        renderResourceTableSection(contentArea);
    }

    container.appendChild(sidebar);
    container.appendChild(contentArea);
}

function renderOverallCurve(container) {
    const overallData = calculateSCurveData(project.phases.flatMap(p => p.tasks));
    container.appendChild(createSCurve('Overall Progress (Cumulative Tasks)', [overallData], ['Overall'], ['#3b82f6']));
}

function renderPhaseCurve(container) {
    if (visiblePhaseIds.length === 0 && project.phases.length > 0) {
        visiblePhaseIds = project.phases.map(p => p.id);
    }

    const phaseSection = document.createElement('div');
    phaseSection.className = 'chart-card';
    phaseSection.style.cssText = 'background:var(--card-bg); padding:1rem; border:1px solid var(--border-color); border-radius:8px; width:100%; max-width:1000px;';

    const phaseHeader = document.createElement('div');
    phaseHeader.innerHTML = '<h3 style="margin:0 0 1rem 0;">Progress by Phase</h3>';

    const toggleContainer = document.createElement('div');
    toggleContainer.style.cssText = 'display:flex; gap:1rem; flex-wrap:wrap; margin-bottom:1rem;';
    project.phases.forEach((p, i) => {
        const color = getPhaseColor(i);
        const lbl = document.createElement('label');
        lbl.style.cssText = 'display:flex; align-items:center; gap:4px; font-size:0.9rem; cursor:pointer;';
        lbl.innerHTML = `
            <input type="checkbox" value="${p.id}" ${visiblePhaseIds.includes(p.id) ? 'checked' : ''}>
            <span style="width:10px; height:10px; background:${color}; display:inline-block; border-radius:2px;"></span>
            ${p.name}
        `;
        lbl.querySelector('input').onchange = (e) => {
            if (e.target.checked) visiblePhaseIds.push(p.id);
            else visiblePhaseIds = visiblePhaseIds.filter(id => id !== p.id);
            renderAggregation(); // Re-render whole tab (fast enough usually)
        };
        toggleContainer.appendChild(lbl);
    });
    phaseHeader.appendChild(toggleContainer);
    phaseSection.appendChild(phaseHeader);

    const phaseDatasets = [];
    const phaseLabels = [];
    const phaseColors = [];

    project.phases.forEach((p, i) => {
        if (visiblePhaseIds.includes(p.id)) {
            const d = calculateSCurveData(p.tasks);
            if (d) {
                phaseDatasets.push(d);
                phaseLabels.push(p.name);
                phaseColors.push(getPhaseColor(i));
            }
        }
    });

    if (phaseDatasets.length > 0) {
        phaseSection.appendChild(createMultiSCurve(phaseDatasets, phaseLabels, phaseColors));
    } else {
        phaseSection.innerHTML += '<p style="color:var(--text-secondary);">No phases selected or no data</p>';
    }
    container.appendChild(phaseSection);
}

function renderResourceChartSection(container) {
    const resourceSection = document.createElement('div');
    resourceSection.className = 'chart-card';
    resourceSection.style.cssText = 'background:var(--card-bg); padding:1rem; border:1px solid var(--border-color); border-radius:8px; width:100%; max-width:1000px;';

    const header = document.createElement('div');
    header.style.display = 'flex';
    header.style.justifyContent = 'space-between';
    header.style.marginBottom = '1rem';
    header.innerHTML = `<h3 style="margin:0;">Resource Loading (Stacked)</h3>`;

    const toggleGroup = document.createElement('div');
    toggleGroup.innerHTML = `
        <button id="res-day-btn" class="${resourceViewMode === 'day' ? 'primary-btn' : 'secondary-btn'}" style="padding:4px 8px; font-size:0.8rem;">Daily</button>
        <button id="res-week-btn" class="${resourceViewMode === 'week' ? 'primary-btn' : 'secondary-btn'}" style="padding:4px 8px; font-size:0.8rem;">Weekly</button>
    `;
    header.appendChild(toggleGroup);
    resourceSection.appendChild(header);

    const chartContainer = document.createElement('div');
    resourceSection.appendChild(chartContainer);
    container.appendChild(resourceSection);

    renderResourceAreaChart(chartContainer);

    setTimeout(() => {
        const dayBtn = document.getElementById('res-day-btn');
        const weekBtn = document.getElementById('res-week-btn');
        if (dayBtn) dayBtn.onclick = () => { resourceViewMode = 'day'; renderAggregation(); };
        if (weekBtn) weekBtn.onclick = () => { resourceViewMode = 'week'; renderAggregation(); };
    }, 0);
}

function renderResourceTableSection(container) {
    const tableSection = document.createElement('div');
    tableSection.className = 'chart-card';
    tableSection.style.cssText = 'background:var(--card-bg); padding:1rem; border:1px solid var(--border-color); border-radius:8px; overflow-x:auto; width:100%; max-width:1200px;';

    const header = document.createElement('div');
    header.style.display = 'flex';
    header.style.justifyContent = 'space-between';
    header.style.marginBottom = '1rem';
    header.innerHTML = `<h3 style="margin:0;">Resource Data Table</h3>`;

    const toggleGroup = document.createElement('div');
    toggleGroup.innerHTML = `
        <button id="res-day-btn-table" class="${resourceViewMode === 'day' ? 'primary-btn' : 'secondary-btn'}" style="padding:4px 8px; font-size:0.8rem;">Daily</button>
        <button id="res-week-btn-table" class="${resourceViewMode === 'week' ? 'primary-btn' : 'secondary-btn'}" style="padding:4px 8px; font-size:0.8rem;">Weekly</button>
    `;
    header.appendChild(toggleGroup);
    tableSection.appendChild(header);

    renderResourceTable(tableSection);
    container.appendChild(tableSection);

    setTimeout(() => {
        const dayBtn = document.getElementById('res-day-btn-table');
        const weekBtn = document.getElementById('res-week-btn-table');
        if (dayBtn) dayBtn.onclick = () => { resourceViewMode = 'day'; renderAggregation(); };
        if (weekBtn) weekBtn.onclick = () => { resourceViewMode = 'week'; renderAggregation(); };
    }, 0);
}

function getPhaseColor(i) {
    const colors = ['#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899', '#6366f1'];
    return colors[i % colors.length];
}

function calculateSCurveData(tasks) {
    if (!tasks || tasks.length === 0) return null;

    let minDateObj = null;
    let maxDateObj = null;

    const traverseForRange = (list) => {
        list.forEach(t => {
            if (t.end) {
                const e = new Date(t.end);
                if (!minDateObj || e < minDateObj) minDateObj = new Date(e);
                if (!maxDateObj || e > maxDateObj) maxDateObj = new Date(e);
            }
            if (t.actualEnd) {
                const ae = new Date(t.actualEnd);
                if (!minDateObj || ae < minDateObj) minDateObj = new Date(ae);
                if (!maxDateObj || ae > maxDateObj) maxDateObj = new Date(ae);
            }
            if (t.subtasks) traverseForRange(t.subtasks);
        });
    };
    traverseForRange(tasks);

    if (!minDateObj || !maxDateObj) return null;

    // Pad
    const minPadded = new Date(minDateObj);
    minPadded.setDate(minPadded.getDate() - 2);
    const maxPadded = new Date(maxDateObj);
    maxPadded.setDate(maxPadded.getDate() + 2);

    const fmt = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

    const dates = [];
    let curr = new Date(minPadded);
    while (curr <= maxPadded) {
        dates.push(new Date(curr));
        curr.setDate(curr.getDate() + 1);
    }

    const flatTasks = [];
    const getFlat = (list) => {
        list.forEach(t => {
            if (!t.subtasks || t.subtasks.length === 0) flatTasks.push(t);
            else getFlat(t.subtasks);
        });
    }
    getFlat(tasks);

    const total = flatTasks.length;
    const dayCounts = {};

    flatTasks.forEach(t => {
        if (t.end) {
            const dStr = t.end.split(' ')[0]; // Already YYYY-MM-DD
            if (!dayCounts[dStr]) dayCounts[dStr] = { p: 0, a: 0 };
            dayCounts[dStr].p++;
        }
        if (t.actualEnd && t.status === 'done') {
            const dStr = t.actualEnd.split(' ')[0];
            if (!dayCounts[dStr]) dayCounts[dStr] = { p: 0, a: 0 };
            dayCounts[dStr].a++;
        }
    });

    const plannedArr = [];
    const actualArr = [];
    let runningP = 0;
    let runningA = 0;

    dates.forEach(d => {
        const dStr = fmt(d);
        const cnt = dayCounts[dStr] || { p: 0, a: 0 };
        runningP += cnt.p;
        runningA += cnt.a;
        plannedArr.push(runningP);
        actualArr.push(runningA);
    });

    return { dates, planned: plannedArr, actual: actualArr, total };
}

// Single S-Curve Wrapper
function createSCurve(title, datasets, labels, colors) {
    if (!datasets || datasets.length === 0 || !datasets[0]) {
        const wrapper = document.createElement('div');
        wrapper.className = 'chart-card';
        wrapper.style.cssText = 'background:var(--card-bg); padding:1rem; border:1px solid var(--border-color); border-radius:8px; flex:1; min-width:400px;';
        wrapper.innerHTML = `<h4 style="margin-top:0;">${title}</h4><p>No data</p>`;
        return wrapper;
    }
    return createMultiSCurve(datasets, labels, colors, title);
}

function createMultiSCurve(datasets, labels, colors, title) {
    const wrapper = document.createElement('div');
    wrapper.style.cssText = 'background:var(--card-bg); padding:1rem; border:1px solid var(--border-color); border-radius:8px; flex:1; min-width:400px;';

    if (title) {
        wrapper.innerHTML = `<h4 style="margin-top:0;">${title}</h4>`;
    }

    // Align all datasets to a common date range
    let commonMin = new Date(8640000000000000);
    let commonMax = new Date(-8640000000000000);
    let validSets = 0;

    datasets.forEach(d => {
        if (d && d.dates.length > 0) {
            validSets++;
            if (d.dates[0] < commonMin) commonMin = d.dates[0];
            if (d.dates[d.dates.length - 1] > commonMax) commonMax = d.dates[d.dates.length - 1];
        }
    });

    if (validSets === 0) {
        wrapper.innerHTML += '<p>No data</p>';
        return wrapper;
    }

    const h = 300;
    const w = 800;
    const pad = 40;

    // Re-generate common dates
    const commonDates = [];
    let curr = new Date(commonMin);
    while (curr <= commonMax) {
        commonDates.push(new Date(curr));
        curr.setDate(curr.getDate() + 1);
    }

    // Find absolute Max Y
    let maxY = 0;
    datasets.forEach(d => {
        if (d) {
            maxY = Math.max(maxY, d.total);
        }
    });
    maxY = maxY || 10;
    // Round up maxY to nice number
    if (maxY > 10) maxY = Math.ceil(maxY / 5) * 5;

    const scaleY = (h - pad * 2) / maxY;

    // Time scale
    const totalDays = (commonMax - commonMin) / 86400000;
    const scaleX = (w - pad * 2) / (totalDays || 1);

    // Use viewBox for responsiveness
    let svgHtml = `<svg viewBox="0 0 ${w} ${h}" style="width:100%; height:auto; min-width:300px; background:var(--bg-color);">`;

    // Grid (Vertical - Time)
    // Draw vertical lines every week or month depending on range
    const timeSpan = totalDays;
    let tickInterval = 1; // days
    if (timeSpan > 60) tickInterval = 30; // ~Month
    else if (timeSpan > 14) tickInterval = 7; // Week
    else tickInterval = 1;

    let tCurr = new Date(commonMin);
    while (tCurr <= commonMax) {
        const diff = (tCurr - commonMin) / 86400000;
        const x = pad + diff * scaleX;

        // Draw Tick line
        svgHtml += `<line x1="${x}" y1="${pad}" x2="${x}" y2="${h - pad}" stroke="var(--border-color)" stroke-width="0.5" opacity="0.3" />`;

        // Label
        const dateStr = `${tCurr.getMonth() + 1}/${tCurr.getDate()}`;
        svgHtml += `<text x="${x}" y="${h - pad + 15}" text-anchor="middle" font-size="10" fill="var(--text-secondary)">${dateStr}</text>`;

        tCurr.setDate(tCurr.getDate() + tickInterval);
    }

    // Grid (Horizontal - Value)
    const yTicks = 5;
    for (let i = 0; i <= yTicks; i++) {
        const val = Math.round(maxY * (i / yTicks));
        const y = h - pad - val * scaleY;
        svgHtml += `<line x1="${pad}" y1="${y}" x2="${w - pad}" y2="${y}" stroke="var(--border-color)" stroke-width="0.5" opacity="0.5" />`;
        svgHtml += `<text x="${pad - 5}" y="${y + 3}" text-anchor="end" font-size="10" fill="var(--text-secondary)">${val}</text>`;
    }

    // Today Line
    const today = new Date(); today.setHours(0, 0, 0, 0);
    if (today >= commonMin && today <= commonMax) {
        const diff = (today - commonMin) / 86400000;
        const x = pad + diff * scaleX;
        svgHtml += `<line x1="${x}" y1="${pad}" x2="${x}" y2="${h - pad}" stroke="var(--accent-color)" stroke-width="1.5" stroke-dasharray="4" opacity="0.8" />`;
        svgHtml += `<text x="${x}" y="${pad - 5}" text-anchor="middle" font-size="10" fill="var(--accent-color)" font-weight="bold">Today</text>`;
    }

    // Axes lines
    svgHtml += `<line x1="${pad}" y1="${h - pad}" x2="${w - pad}" y2="${h - pad}" stroke="var(--text-secondary)" stroke-width="1" />`;
    svgHtml += `<line x1="${pad}" y1="${pad}" x2="${pad}" y2="${h - pad}" stroke="var(--text-secondary)" stroke-width="1" />`;

    // Helper to map values to grid
    const getValY = (val) => h - pad - val * scaleY;
    const getValX = (date) => {
        const diff = (date - commonMin) / 86400000;
        return pad + diff * scaleX;
    }

    // Draw Lines
    datasets.forEach((data, i) => {
        if (!data) return;

        // We need to map data.dates to commonDates
        const ptsP = data.planned.map((val, idx) => `${getValX(data.dates[idx])},${getValY(val)}`).join(' ');
        const ptsA = data.actual.map((val, idx) => `${getValX(data.dates[idx])},${getValY(val)}`).join(' ');

        // Planned (Dashed)
        svgHtml += `<polyline points="${ptsP}" fill="none" stroke="${colors[i] || '#ccc'}" stroke-width="2" stroke-dasharray="4" opacity="0.6" />`;
        // Actual (Solid)
        svgHtml += `<polyline points="${ptsA}" fill="none" stroke="${colors[i] || '#ccc'}" stroke-width="2" />`;
    });

    svgHtml += `</svg>`;
    wrapper.innerHTML += svgHtml;
    return wrapper;
}

function renderResourceAreaChart(container) {
    const data = calculateResourceLoading();
    if (data.length === 0) {
        container.innerHTML = '<p>No resource data</p>';
        return;
    }

    const h = 350;
    const w = 800; // Fixed coordinate system
    const pad = 40;

    const assignees = [...new Set(data.flatMap(d => Object.keys(d.counts)))].sort();
    const colors = ['#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899'];
    const colorMap = {};
    assignees.forEach((a, i) => colorMap[a] = colors[i % colors.length]);

    // Find Max Y
    let maxY = 0;
    data.forEach(d => {
        const sum = Object.values(d.counts).reduce((a, b) => a + b, 0);
        if (sum > maxY) maxY = sum;
    });
    maxY = Math.max(maxY, 5);
    if (maxY > 5) maxY = Math.ceil(maxY / 5) * 5;

    const scaleY = (h - pad * 2) / maxY;
    const scaleX = (w - pad * 2) / (data.length - 1 || 1);

    let svgHtml = `<svg viewBox="0 0 ${w} ${h}" style="width:100%; height:auto; min-width:300px; background:var(--bg-color);">`;

    // Grid (Horizontal)
    const yTicks = 5;
    for (let i = 0; i <= yTicks; i++) {
        const val = Math.round(maxY * (i / yTicks));
        const y = h - pad - val * scaleY;
        svgHtml += `<line x1="${pad}" y1="${y}" x2="${w - pad}" y2="${y}" stroke="var(--border-color)" stroke-width="0.5" opacity="0.5" />`;
        svgHtml += `<text x="${pad - 5}" y="${y + 3}" text-anchor="end" font-size="10" fill="var(--text-secondary)">${val}</text>`;
    }

    // Grid (Vertical) - Every Nth item
    const step = Math.ceil(data.length / 10);
    data.forEach((d, i) => {
        const x = pad + i * scaleX;
        if (i % step === 0) {
            svgHtml += `<line x1="${x}" y1="${pad}" x2="${x}" y2="${h - pad}" stroke="var(--border-color)" stroke-width="0.5" opacity="0.3" />`;
            svgHtml += `<text x="${x}" y="${h - pad + 15}" text-anchor="middle" font-size="10" fill="var(--text-secondary)">${d.label}</text>`;
        }
    });

    // Today Line (Approximate since data is bucketted)
    // We can't easily draw exact Today line on bucketed chart without parsing labels back to dates.
    // But since resource chart is "future load", Today is implicitly the start if viewed from today.
    // Let's skip Today line for Resource Chart for now or estimate it?
    // User asked "Today line" generally. Let's add it if we can.
    // Resource chart buckets have labels, let's try to parse if possible.
    // Or just rely on visual buckets. 
    // If Daily mode, labels are M/D.
    const today = new Date();
    const todayLabel = `${today.getMonth() + 1}/${today.getDate()}`;
    const todayIdx = data.findIndex(d => d.label === todayLabel || (resourceViewMode === 'week' && d.label.startsWith(`${today.getFullYear()}/${today.getMonth() + 1}/${today.getDate()}`))); // Weak match

    if (todayIdx >= 0) {
        const x = pad + todayIdx * scaleX;
        svgHtml += `<line x1="${x}" y1="${pad}" x2="${x}" y2="${h - pad}" stroke="var(--accent-color)" stroke-width="1.5" stroke-dasharray="4" opacity="0.8" />`;
        svgHtml += `<text x="${x}" y="${pad - 5}" text-anchor="middle" font-size="10" fill="var(--accent-color)" font-weight="bold">Today</text>`;
    }

    // Axes lines
    svgHtml += `<line x1="${pad}" y1="${h - pad}" x2="${w - pad}" y2="${h - pad}" stroke="var(--text-secondary)" stroke-width="1" />`;
    svgHtml += `<line x1="${pad}" y1="${pad}" x2="${pad}" y2="${h - pad}" stroke="var(--text-secondary)" stroke-width="1" />`;

    // Build Paths (Stacked)
    const baseline = new Array(data.length).fill(0);

    assignees.forEach(user => {
        let areaPoints = [];
        let bottomPoints = [];

        data.forEach((d, i) => {
            const x = pad + i * scaleX;
            const val = d.counts[user] || 0;
            const y0 = baseline[i];
            const y1 = y0 + val;

            const sy0 = h - pad - y0 * scaleY;
            const sy1 = h - pad - y1 * scaleY;

            areaPoints.push(`${x},${sy1}`);
            bottomPoints.unshift(`${x},${sy0}`);

            baseline[i] = y1;
        });

        const d = `M ${areaPoints[0].split(',')[0]},${areaPoints[0].split(',')[1]} ` +
            `L ${areaPoints.map(p => p).join(' ')} ` +
            `L ${bottomPoints.map(p => p).join(' ')} Z`;

        svgHtml += `<path d="${d}" fill="${colorMap[user]}" stroke="white" stroke-width="0.5" opacity="0.8">
            <title>${user}</title>
        </path>`;
    });

    // Legend
    let lx = pad;
    const ly = 10;
    assignees.forEach(a => {
        svgHtml += `<rect x="${lx}" y="${ly}" width="10" height="10" fill="${colorMap[a]}" />`;
        svgHtml += `<text x="${lx + 15}" y="${ly + 9}" font-size="12" fill="var(--text-primary)">${a}</text>`;
        lx += a.length * 8 + 40;
    });

    svgHtml += `</svg>`;
    container.innerHTML = svgHtml;
}

function renderResourceTable(container) {
    const data = calculateResourceLoading();
    if (data.length === 0) return;

    const assignees = [...new Set(data.flatMap(d => Object.keys(d.counts)))].sort();

    let html = `<table style="width:100%; border-collapse:collapse; font-size:0.9rem;">`;
    html += `<thead><tr style="background:var(--bg-color); border-bottom:1px solid var(--border-color);">`;
    html += `<th style="padding:0.5rem; text-align:left;">Period</th>`;
    assignees.forEach(a => html += `<th style="padding:0.5rem; text-align:center;">${a}</th>`);
    html += `<th style="padding:0.5rem; text-align:center;">Total</th>`;
    html += `</tr></thead><tbody>`;

    data.forEach(d => {
        const sum = Object.values(d.counts).reduce((a, b) => a + b, 0);
        html += `<tr style="border-bottom:1px solid var(--border-color);">`;
        html += `<td style="padding:0.5rem;">${d.label}</td>`;
        assignees.forEach(a => {
            const val = d.counts[a] || 0;
            html += `<td style="padding:0.5rem; text-align:center; color:${val > 0 ? 'var(--text-primary)' : 'var(--text-secondary)'}">${val || '-'}</td>`;
        });
        html += `<td style="padding:0.5rem; text-align:center; font-weight:bold;">${sum}</td>`;
        html += `</tr>`;
    });

    html += `</tbody></table>`;
    container.innerHTML += html;
}

function calculateResourceLoading() {
    // Collect all tasks and range
    let minDate = new Date(8640000000000000);
    let maxDate = new Date(-8640000000000000);
    const tasks = [];

    const traverse = (list) => {
        list.forEach(t => {
            if (t.start && t.end && t.assignee) {
                const s = new Date(t.start);
                const e = new Date(t.end);
                if (s < minDate) minDate = s;
                if (e > maxDate) maxDate = e;
                tasks.push({ assignee: t.assignee.name || t.assignee, start: s, end: e });
            }
            if (t.subtasks) traverse(t.subtasks);
        });
    };
    project.phases.forEach(p => traverse(p.tasks));

    if (tasks.length === 0) return [];

    // Normalize Start/End based on View Mode
    if (resourceViewMode === 'week') {
        minDate.setDate(minDate.getDate() - minDate.getDay());
    } else {
        // Daily: Start from min
    }

    const buckets = [];
    let curr = new Date(minDate);

    while (curr <= maxDate) {
        let label = '';
        let next = new Date(curr);

        if (resourceViewMode === 'week') {
            label = `${curr.getFullYear()}/${curr.getMonth() + 1}/${curr.getDate()}`; // Start of week
            next.setDate(curr.getDate() + 7);
        } else {
            // Daily
            label = `${curr.getMonth() + 1}/${curr.getDate()}`;
            next.setDate(curr.getDate() + 1);
        }

        const bucket = { label, counts: {} };

        tasks.forEach(t => {
            // Overlap: t.start < next && t.end >= curr
            // Note: End date usually inclusive in UI but exclusive in logic? 
            // In our app end is inclusive. So t.start < next && t.end >= curr
            // Let's adjust strictness.
            // If t.end is 2026-02-15, it includes that day.
            // bucket [2026-02-15, 2026-02-16) (1 day)
            // t:[15, 15] overlaps.
            // Logic: Math.max(t.start, curr) < Math.min(t.end + 1_day, next)

            const tStart = t.start.getTime();
            const tEnd = t.end.getTime() + 86400000; // exclusive
            const bStart = curr.getTime();
            const bEnd = next.getTime();

            if (Math.max(tStart, bStart) < Math.min(tEnd, bEnd)) {
                const a = t.assignee;
                if (!bucket.counts[a]) bucket.counts[a] = 0;
                // Add "workload". Since we count tasks, we just add 1 if present?
                // Or we calculate overlap duration?
                // "Mountain accumulation" usually means "Headcount" or "Task Count".
                // Simple count: 1 task = 1 unit
                bucket.counts[a]++;
            }
        });

        buckets.push(bucket);
        curr = next;
    }
    return buckets;
}
