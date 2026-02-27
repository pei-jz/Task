import { wbsState } from './state.js';
import { save } from '@tauri-apps/plugin-dialog';
import { invoke } from '../utils/helpers.js';

export async function exportWBSToHTML() {

    // Capture the current content
    const wbsContainer = document.querySelector('.wbs-split-view');
    if (!wbsContainer) return;

    // Clone the node to avoid mutating the original DOM
    const clone = wbsContainer.cloneNode(true);

    // Remove things we don't want to print: the resizer, buttons, inputs, edit modes.
    const resizer = clone.querySelector('.wbs-resizer');
    if (resizer) resizer.remove();

    // Replace inputs/selects with text spans for cleaner printing
    clone.querySelectorAll('input, select').forEach(el => {
        let val = el.value || '';
        if (el.tagName === 'SELECT' && el.selectedIndex >= 0) {
            val = el.options[el.selectedIndex].text;
        }
        const span = document.createElement('span');
        span.textContent = val;
        span.style.cssText = 'display:inline-block; width:100%; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; font-size:12px;';
        el.parentNode.replaceChild(span, el);
    });

    // Clean up classes related to editing or selection
    clone.querySelectorAll('.editing, .selected-cell, .selected-range').forEach(el => {
        el.classList.remove('editing', 'selected-cell', 'selected-range');
        el.style.outline = '';
    });

    // Layout the split view as side-by-side with full native sizes
    clone.style.display = 'flex';
    clone.style.flexDirection = 'row';
    clone.style.width = 'max-content';
    clone.style.height = 'max-content';

    const tableCont = clone.querySelector('.wbs-table-container');
    const ganttCont = clone.querySelector('.wbs-gantt-container');

    if (tableCont) {
        tableCont.style.width = 'max-content';
        tableCont.style.height = 'max-content';
        tableCont.style.overflow = 'visible';
        // Make the table take full width natively 
        const table = tableCont.querySelector('table');
        if (table) {
            table.style.width = 'max-content';
            table.style.pageBreakInside = 'auto'; // Help browser not break rows
            table.querySelectorAll('tr').forEach(tr => {
                tr.style.pageBreakInside = 'avoid';
                tr.style.pageBreakAfter = 'auto';
            });
        }
    }

    if (ganttCont) {
        ganttCont.style.width = 'max-content';
        ganttCont.style.height = 'max-content';
        ganttCont.style.overflow = 'visible';
        ganttCont.style.marginTop = '0'; // Removing the previous 2rem margin
        ganttCont.style.marginLeft = '1rem';
        const svg = ganttCont.querySelector('svg');
        if (svg) {
            // Unbound SVG
            svg.style.maxWidth = 'none';
        }
    }

    // Get the styles from the main page
    const styles = Array.from(document.styleSheets)
        .map(styleSheet => {
            try {
                return Array.from(styleSheet.cssRules)
                    .map(rule => rule.cssText)
                    .join('');
            } catch (e) {
                // Cross-origin stylesheet access might be blocked, ignore
                console.warn('Cannot read styles from', styleSheet.href);
                return '';
            }
        })
        .join('\n');

    // Build the HTML document
    const html = `
        <!DOCTYPE html>
        <html>
        <head>
            <title>Project WBS Export</title>
            <style>
                ${styles}
                body {
                    background: white !important;
                    color: black !important;
                    padding: 20px;
                    font-family: sans-serif;
                }
                .wbs-table th, .wbs-table td {
                    color: black !important;
                    border-color: #ccc !important;
                }
                .wbs-table th {
                    background: #f0f0f0 !important;
                }
                @media print {
                    @page { size: landscape; margin: 1cm; }
                    body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
                }
                /* Hide things that shouldn't print */
                .resizer, .toolbar, button { display: none !important; }
            </style>
        </head>
        <body>
            <div style="width: 100%; overflow-x: auto; padding-bottom: 2rem;">
                ${clone.outerHTML}
            </div>
            <script>
                // Hide scrollbars in saved HTML for better viewing
                document.body.style.overflow = 'auto';
            </script>
        </body>
        </html>
    `;

    try {
        const filePath = await save({
            filters: [{ name: 'HTML Document', extensions: ['html'] }],
            defaultPath: 'Project_WBS_Export.html'
        });

        if (filePath) {
            const encoder = new TextEncoder();
            const content = encoder.encode(html);
            await invoke('save_file', { path: filePath, content: Array.from(content) });
            const { message } = await import('@tauri-apps/plugin-dialog');
            await message(`Successfully saved WBS export to:\n${filePath}`, { title: 'Export Complete', kind: 'info' });
        }
    } catch (err) {
        console.error('Failed to export HTML:', err);
        const { message } = await import('@tauri-apps/plugin-dialog');
        await message(`Error saving export: ${err}`, { title: 'Export Failed', kind: 'error' });
    }
}
