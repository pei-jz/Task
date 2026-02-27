// DOM Elements
export const dom = {
    modalOverlay: () => document.getElementById('modal-overlay'),
    modalTitle: () => document.getElementById('modal-title'),
    modalBody: () => document.getElementById('modal-body'),
    modalConfirmBtn: () => document.getElementById('modal-confirm-btn'),
    modalCancelBtn: () => document.getElementById('modal-cancel-btn')
};

export function showModal(title, html, confirmCallback) {
    const titleEl = dom.modalTitle();
    const bodyEl = dom.modalBody();
    const overlay = dom.modalOverlay();
    const confirmBtn = dom.modalConfirmBtn();
    const cancelBtn = dom.modalCancelBtn();

    if (!titleEl || !bodyEl || !overlay) return;

    titleEl.textContent = title;
    bodyEl.innerHTML = html;

    // Remove hidden class
    overlay.classList.remove('hidden');

    // Handlers
    const close = () => {
        overlay.classList.add('hidden');
        if (confirmBtn) confirmBtn.onclick = null; // Cleanup
        if (cancelBtn) cancelBtn.onclick = null;
    };

    if (cancelBtn) cancelBtn.onclick = close;

    if (confirmBtn) {
        confirmBtn.onclick = () => {
            if (confirmCallback) confirmCallback();
            close();
        };
    }

    // Default Date Inputs to Today
    bodyEl.querySelectorAll('input[type="date"]').forEach(i => {
        if (!i.value) i.value = new Date().toISOString().split('T')[0];
    });

    // Auto-focus first input
    const firstInput = bodyEl.querySelector('input');
    if (firstInput) firstInput.focus();
}

/**
 * Show a custom date picker modal.
 * @param {string} currentDate - yyyy-mm-dd
 * @param {function} onSelect - callback(newDateStr)
 * @param {Array} holidays - list of holiday strings 'yyyy-mm-dd'
 */
export function showDatePicker(currentDate, onSelect, holidays = []) {
    const overlay = dom.modalOverlay();
    if (!overlay) return;

    let d = currentDate ? new Date(currentDate) : new Date();
    if (isNaN(d.getTime())) d.setTime(Date.now());

    // Track localized "focus" date (different from original currentDate until confirmed)
    let focusDate = new Date(d);

    const renderCalendar = (y, m, activeDateStr) => {
        const firstDay = new Date(y, m, 1);
        const lastDay = new Date(y, m + 1, 0);
        const startDay = firstDay.getDay(); // 0=Sun
        const daysInMonth = lastDay.getDate();

        // Header
        let html = `
            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:1rem;">
                <button id="dp-prev" class="secondary-btn">&lt;</button>
                <div style="font-weight:bold;">${y}.${String(m + 1).padStart(2, '0')}</div>
                <button id="dp-next" class="secondary-btn">&gt;</button>
            </div>
            <div style="display:grid; grid-template-columns:repeat(7, 1fr); gap:2px; text-align:center; font-size:0.8rem; font-weight:bold; margin-bottom:4px;">
                <div style="color:#ef4444;">Sun</div><div>Mon</div><div>Tue</div><div>Wed</div><div>Thu</div><div>Fri</div><div style="color:#3b82f6;">Sat</div>
            </div>
            <div style="display:grid; grid-template-columns:repeat(7, 1fr); gap:2px;">
        `;

        // Empty slots
        for (let i = 0; i < startDay; i++) {
            html += `<div></div>`;
        }

        // Days
        for (let i = 1; i <= daysInMonth; i++) {
            const dateStr = `${y}-${String(m + 1).padStart(2, '0')}-${String(i).padStart(2, '0')}`;
            const isHol = holidays.includes(dateStr);
            const dObj = new Date(y, m, i);
            const isSun = dObj.getDay() === 0;
            const isSat = dObj.getDay() === 6;

            let color = 'var(--text-primary)';
            let bg = 'transparent';
            let border = '1px solid transparent';

            if (isHol || isSun) color = '#ef4444';
            else if (isSat) color = '#3b82f6';

            if (dateStr === activeDateStr) {
                bg = 'var(--accent-color)';
                color = 'white';
                border = '1px solid var(--accent-light, #60a5fa)';
            } else if (dateStr === currentDate) {
                border = '1px solid var(--accent-color)';
            }

            html += `
                <div class="dp-day" data-date="${dateStr}" style="padding:6px; cursor:pointer; border-radius:4px; color:${color}; background:${bg}; border:${border};">
                    ${i}
                </div>
            `;
        }
        html += `</div>
            <div style="margin-top:1rem; font-size:0.8rem; color:var(--text-secondary); text-align:center;">
                Direction Keys: Move | Enter: Select | Esc: Close
            </div>`;
        return html;
    };

    const mount = () => {
        const y = focusDate.getFullYear();
        const m = focusDate.getMonth();
        const activeDateStr = focusDate.toISOString().split('T')[0];

        showModal('Select Date', renderCalendar(y, m, activeDateStr), null);

        const bodyEl = dom.modalBody();
        const confirmBtn = dom.modalConfirmBtn();
        if (confirmBtn) confirmBtn.style.display = 'none';

        // Bind Nav
        document.getElementById('dp-prev').onclick = (e) => { e.stopPropagation(); focusDate.setMonth(focusDate.getMonth() - 1); mount(); };
        document.getElementById('dp-next').onclick = (e) => { e.stopPropagation(); focusDate.setMonth(focusDate.getMonth() + 1); mount(); };

        // Bind Days
        bodyEl.querySelectorAll('.dp-day').forEach(el => {
            el.onclick = (e) => {
                e.stopPropagation();
                selectAndClose(el.dataset.date);
            };
            el.onmouseenter = () => { if (el.dataset.date !== activeDateStr) el.style.backgroundColor = 'var(--border-color)'; };
            el.onmouseleave = () => { if (el.dataset.date !== activeDateStr) el.style.backgroundColor = 'transparent'; };
        });

        // Setup global actions for events.js
        window.DATE_PICKER_ACTION = {
            isOpen: true,
            moveFocus: (days) => {
                focusDate.setDate(focusDate.getDate() + days);
                mount();
            },
            confirm: () => {
                selectAndClose(focusDate.toISOString().split('T')[0]);
            },
            close: () => {
                closeModal();
            }
        };
    };

    const selectAndClose = (dateStr) => {
        if (onSelect) onSelect(dateStr);
        closeModal();
    };

    const closeModal = () => {
        window.DATE_PICKER_ACTION = { isOpen: false };
        const confirmBtn = dom.modalConfirmBtn();
        if (confirmBtn) confirmBtn.style.display = '';
        dom.modalOverlay().classList.add('hidden');
    };

    mount();
}
