// Custom dropdown widget. Each native <select> on the page is wrapped at
// startup (and any time we re-render) by enhanceSelect(): the native control
// stays in the DOM (hidden) so chrome.storage / form state / change events
// continue to work, while a fully CSS-controlled trigger + listbox handles
// all rendering. This is the only way to truly escape the OS-rendered option
// popup (which paints a system-blue selection highlight that no CSS can
// reliably override across Chromium builds).
function enhanceSelect(nativeSelect) {
    if (nativeSelect.dataset.enhanced === 'true') return;
    nativeSelect.dataset.enhanced = 'true';

    const wrapper = document.createElement('div');
    wrapper.className = 'custom-select';

    const trigger = document.createElement('button');
    trigger.type = 'button';
    trigger.className = 'custom-select-trigger';
    trigger.innerHTML =
        '<span class="custom-select-label"></span>' +
        '<svg class="custom-select-chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"></polyline></svg>';

    const labelEl = trigger.querySelector('.custom-select-label');

    // The listbox lives on <body> so position: fixed escapes any ancestor
    // overflow:auto (right-panel scrolls; we don't want the popup clipped).
    const listbox = document.createElement('ul');
    listbox.className = 'custom-select-listbox';
    listbox.setAttribute('role', 'listbox');

    function rebuildOptions() {
        listbox.innerHTML = '';
        Array.from(nativeSelect.options).forEach((opt) => {
            const li = document.createElement('li');
            li.className = 'custom-select-option';
            li.setAttribute('role', 'option');
            li.dataset.value = opt.value;
            li.textContent = opt.textContent;
            if (opt.value === nativeSelect.value) li.setAttribute('aria-selected', 'true');
            li.addEventListener('click', (e) => {
                e.stopPropagation();
                nativeSelect.value = opt.value;
                // Bubble a synthetic change so the existing options.js listeners
                // (updatePreview, syncPlaceholderVisibility, etc.) all fire as
                // if the user had interacted with the native control directly.
                nativeSelect.dispatchEvent(new Event('change', { bubbles: true }));
                syncLabel();
                close();
            });
            listbox.appendChild(li);
        });
    }

    function syncLabel() {
        const opt = nativeSelect.options[nativeSelect.selectedIndex];
        labelEl.textContent = opt ? opt.textContent : '';
        Array.from(listbox.children).forEach(li => {
            if (li.dataset.value === nativeSelect.value) li.setAttribute('aria-selected', 'true');
            else li.removeAttribute('aria-selected');
        });
    }

    function position() {
        const rect = trigger.getBoundingClientRect();
        const margin = 12;

        // Always anchor the listbox below the trigger. A dropdown that opens
        // upward feels off — users expect the popup to grow downward as the
        // word "drop" implies. If the available space below isn't enough for
        // the natural list height, we cap max-height so the listbox fits
        // exactly the available space and scrolls internally instead.
        const spaceBelow = Math.max(120, window.innerHeight - rect.bottom - margin - 6);
        listbox.style.maxHeight = Math.min(280, spaceBelow) + 'px';

        listbox.style.minWidth = rect.width + 'px';
        listbox.style.maxWidth = Math.min(360, window.innerWidth - 16) + 'px';
        listbox.style.left = rect.left + 'px';
        listbox.style.top = (rect.bottom + 6) + 'px';

        // Horizontal edge detection only — vertical clipping is handled by
        // max-height above. The rightmost dropdown in a 3-column grid (Unique
        // ID) can otherwise extend past the page on narrow windows.
        const lb = listbox.getBoundingClientRect();
        if (lb.right > window.innerWidth - margin) {
            const shift = lb.right - (window.innerWidth - margin);
            listbox.style.left = Math.max(margin, rect.left - shift) + 'px';
        }
    }

    let isOpen = false;

    function open() {
        if (isOpen) return;
        rebuildOptions();
        syncLabel();
        if (listbox.parentNode !== document.body) document.body.appendChild(listbox);
        position();
        // Two-frame defer so the transition runs from the closed state.
        requestAnimationFrame(() => listbox.classList.add('is-open'));
        wrapper.classList.add('is-open');
        document.addEventListener('click', onDocClick, true);
        document.addEventListener('keydown', onKeyDown, true);
        // Close on any scroll inside the right panel — repositioning a popup
        // mid-scroll is jittery, and the user can just reopen.
        window.addEventListener('scroll', closeOnScroll, true);
        window.addEventListener('resize', closeOnScroll);
        isOpen = true;
    }

    function close() {
        if (!isOpen) return;
        listbox.classList.remove('is-open');
        wrapper.classList.remove('is-open');
        document.removeEventListener('click', onDocClick, true);
        document.removeEventListener('keydown', onKeyDown, true);
        window.removeEventListener('scroll', closeOnScroll, true);
        window.removeEventListener('resize', closeOnScroll);
        isOpen = false;
    }

    function closeOnScroll(e) {
        // Don't close on scroll inside the listbox itself. Bound to resize too,
        // whose target is `window` — not a Node, and Node.contains() throws on
        // a non-Node rather than returning false, so this needs an instanceof
        // guard. Resize then falls through to close(), which is correct: the
        // listbox is absolutely positioned and its placement is stale.
        if (e && e.target instanceof Node && listbox.contains(e.target)) return;
        close();
    }

    function onDocClick(e) {
        if (wrapper.contains(e.target) || listbox.contains(e.target)) return;
        close();
    }

    function onKeyDown(e) {
        if (e.key === 'Escape') { close(); trigger.focus(); return; }
        if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
            e.preventDefault();
            const opts = Array.from(nativeSelect.options);
            let idx = nativeSelect.selectedIndex;
            idx = e.key === 'ArrowDown'
                ? Math.min(opts.length - 1, idx + 1)
                : Math.max(0, idx - 1);
            nativeSelect.value = opts[idx].value;
            nativeSelect.dispatchEvent(new Event('change', { bubbles: true }));
            syncLabel();
        } else if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            close();
        }
    }

    trigger.addEventListener('click', (e) => {
        e.stopPropagation();
        if (isOpen) close(); else open();
    });

    // Programmatic value changes (applySettings does `select.value = ...`) don't
    // fire native change events — but every loader path in this file already
    // dispatches one explicitly, so listening here is enough to keep the
    // visible label in sync with the underlying native select.
    nativeSelect.addEventListener('change', syncLabel);

    nativeSelect.parentNode.insertBefore(wrapper, nativeSelect);
    wrapper.appendChild(nativeSelect);
    wrapper.appendChild(trigger);
    syncLabel();
}

// ---- Per-mode Format Options ---------------------------------------------
//
// Each download mode (Folder/ZIP/Individual) keeps its own Format Tweaks —
// separators, date format, ID style, etc. — so a user can have, say, dashes
// for ZIP filenames and underscores for Folder Mode without one bleeding
// into the other. The 9 controls are generated programmatically here and
// injected at the bottom of each panel; this keeps options.html lean and
// guarantees all three modes stay in sync if we add or rename a setting.
//
// Folder Pill Separator is omitted in Individual Mode because that mode
// has no folder-or-archive name to assemble.

const FORMAT_KEYS_ALL = [
    'folderSeparatorFormat', 'fileSeparatorFormat', 'indexFormat',
    'titleCaseFormat', 'titleSpaceFormat', 'idFormat',
    'dateFormat', 'dateSeparatorFormat', 'timeFormat'
];
const FORMAT_KEYS_NO_FOLDER_SEP = FORMAT_KEYS_ALL.filter(k => k !== 'folderSeparatorFormat');

const FORMAT_DEFAULTS = {
    folderSeparatorFormat: 'space',
    fileSeparatorFormat: 'space',
    titleSpaceFormat: 'default',
    titleCaseFormat: 'original',
    indexFormat: 'standard',
    dateFormat: 'yyyy-mm-dd',
    dateSeparatorFormat: 'dash',
    timeFormat: '24h',
    idFormat: 'hex'
};

function formatKeysForMode(mode) {
    return mode === 'individual' ? FORMAT_KEYS_NO_FOLDER_SEP : FORMAT_KEYS_ALL;
}

// Build the entire Format Tweaks block for one mode. Each <select> carries
// data-format-key + data-mode so it can be located cheaply later, and uses
// mode-suffixed IDs to avoid clashing across the three panels.
function buildFormatOptionsHTML(mode) {
    const id = (k) => `format-${k}-${mode}`;
    const includesFolderSep = mode !== 'individual';

    const folderSepGroup = includesFolderSep ? `
        <div class="setting-group">
            <label>Folder Pill Separation Character<span class="info-icon" data-tooltip="Used inside folder and ZIP archive names to join pills like Subreddit, Author, etc.">?</span></label>
            <select id="${id('folderSeparatorFormat')}" data-format-key="folderSeparatorFormat" data-mode="${mode}">
                <option value="space">Space (   )</option>
                <option value="underscore">Underscore ( _ )</option>
                <option value="dash">Dash ( - )</option>
                <option value="none">None (Merged)</option>
            </select>
        </div>` : '';

    return `
        <hr class="section-divider">
        <div class="format-options-inner">
            <h2>Format tweaks 🎨</h2>
            <p class="section-helper">These format choices apply to <strong>${mode === 'individual' ? 'Individual' : mode === 'zip' ? 'ZIP' : 'Folder'} Mode</strong> only. Switch tabs to set them differently for the other modes.</p>
            <div class="format-settings">
                ${folderSepGroup}
                <div class="setting-group">
                    <label>Title Pill Separation Character<span class="info-icon" data-tooltip="Joins the pills inside an image filename — e.g., between Title and Index. Static text pills are placed without extra separators on either side.">?</span></label>
                    <select id="${id('fileSeparatorFormat')}" data-format-key="fileSeparatorFormat" data-mode="${mode}">
                        <option value="space">Space (   )</option>
                        <option value="underscore">Underscore ( _ )</option>
                        <option value="dash">Dash ( - )</option>
                        <option value="none">None (Merged)</option>
                    </select>
                </div>
                <div class="setting-group">
                    <label>Index Format</label>
                    <select id="${id('indexFormat')}" data-format-key="indexFormat" data-mode="${mode}">
                        <option value="standard">01 (Standard)</option>
                        <option value="parentheses">(01) (Parentheses)</option>
                        <option value="brackets">[01] (Brackets)</option>
                    </select>
                </div>
                <div class="setting-group">
                    <label>Title Case<span class="info-icon" data-tooltip="Transforms the post title's letter case before it lands in the filename. Applies only to the Title pill — other pills like Subreddit and Author are untouched.">?</span></label>
                    <select id="${id('titleCaseFormat')}" data-format-key="titleCaseFormat" data-mode="${mode}">
                        <option value="original">Keep Original</option>
                        <option value="lower">lowercase</option>
                        <option value="upper">UPPERCASE</option>
                        <option value="title">Title Case</option>
                        <option value="sentence">Sentence case</option>
                    </select>
                </div>
                <div class="setting-group">
                    <label>Title Space Options<span class="info-icon" data-tooltip="Controls how spaces inside the post title are replaced — applies only to the title pill in image filenames. The title pill in folder and ZIP archive names always follows the Folder Pill Separation Character, regardless of this setting.">?</span></label>
                    <select id="${id('titleSpaceFormat')}" data-format-key="titleSpaceFormat" data-mode="${mode}">
                        <option value="default">Match Title Pill Separator</option>
                        <option value="keep">Keep spaces in title</option>
                        <option value="underscore">Underscore ( _ )</option>
                        <option value="dash">Dash ( - )</option>
                        <option value="none">None (Merged)</option>
                    </select>
                </div>
                <div class="setting-group">
                    <label>Unique ID Format<span class="info-icon" data-tooltip="Format of the random ID generated when you drop the Unique ID pill into a formula. Useful for guaranteeing every download has a different name.">?</span></label>
                    <select id="${id('idFormat')}" data-format-key="idFormat" data-mode="${mode}">
                        <option value="hex">Hex 6 (a1b2c3)</option>
                        <option value="hex8">Hex 8 (a1b2c3d4)</option>
                        <option value="numeric">Numeric 6 (987654)</option>
                        <option value="numeric8">Numeric 8 (12345678)</option>
                        <option value="alpha6">Alphanumeric (k7p2m9)</option>
                        <option value="letters">Letters (xKjPqM)</option>
                        <option value="timestamp">Timestamp (1733123456)</option>
                    </select>
                </div>
                <div class="setting-group">
                    <label>Date Format<span class="info-icon" data-tooltip="Order of year, month, and day. The character between them is set by the Date Separator dropdown next to it.">?</span></label>
                    <select id="${id('dateFormat')}" data-format-key="dateFormat" data-mode="${mode}">
                        <option value="yyyy-mm-dd">Year, Month, Day</option>
                        <option value="dd-mm-yyyy">Day, Month, Year</option>
                        <option value="dd-mm-yy">Day, Month, Year (2-digit year)</option>
                        <option value="mm-dd-yyyy">Month, Day, Year</option>
                        <option value="mm-dd-yy">Month, Day, Year (2-digit year)</option>
                    </select>
                </div>
                <div class="setting-group">
                    <label>Date Separator</label>
                    <select id="${id('dateSeparatorFormat')}" data-format-key="dateSeparatorFormat" data-mode="${mode}">
                        <option value="dash">Dash ( - )</option>
                        <option value="underscore">Underscore ( _ )</option>
                        <option value="dot">Dot ( . )</option>
                        <option value="space">Space (   )</option>
                        <option value="none">None (Merged)</option>
                    </select>
                </div>
                <div class="setting-group">
                    <label>Time Format<span class="info-icon" data-tooltip="The character between hour, minute, and second comes from the Title Pill Separation Character. AM/PM is appended for 12-hour mode.">?</span></label>
                    <select id="${id('timeFormat')}" data-format-key="timeFormat" data-mode="${mode}">
                        <option value="24h">24-hour clock</option>
                        <option value="12h">12-hour clock with AM/PM</option>
                    </select>
                </div>
            </div>
        </div>`;
}

document.addEventListener('DOMContentLoaded', () => {
    // Inject the per-mode Format Tweaks blocks BEFORE we enhance selects, so
    // every select on the page (including the 26 generated ones) gets the
    // custom dropdown widget in one pass.
    ['folder', 'zip', 'individual'].forEach(mode => {
        const panel = document.getElementById(`panel-${mode}`);
        if (panel) panel.insertAdjacentHTML('beforeend', buildFormatOptionsHTML(mode));
    });

    // Wrap every native <select> with our custom dropdown widget. Done before
    // applySettings() runs so the labels paint correctly on first render.
    document.querySelectorAll('select').forEach(enhanceSelect);

    // Look up a format select by mode + key. Returns null if the key isn't
    // present for this mode (e.g., folderSeparatorFormat in Individual Mode).
    function getFormatSelect(mode, key) {
        return document.querySelector(`select[data-mode="${mode}"][data-format-key="${key}"]`);
    }

    // Read a single format value from a mode's controls, falling back to the
    // documented default if the select isn't present (Individual + folderSep).
    function readFormatValue(mode, key) {
        const sel = getFormatSelect(mode, key);
        return sel ? sel.value : FORMAT_DEFAULTS[key];
    }

    const toolbox = document.getElementById('toolbox');
    const dropzones = {
        folder: { folder: document.getElementById('dropzone-folder-folder'), image: document.getElementById('dropzone-folder-image') },
        zip: { archive: document.getElementById('dropzone-zip-archive'), image: document.getElementById('dropzone-zip-image') },
        individual: document.getElementById('dropzone-individual')
    };

    const saveBtn = document.getElementById('save-configuration-btn');
    const addStaticTextBtn = document.getElementById('add-static-text-btn');
    const toast = document.getElementById('toast');

    const tabLinks = document.querySelectorAll('.tab-link');
    const panels = document.querySelectorAll('.panel');

    // Mode-specific explainer that sits above the Filename Elements toolbar.
    // Each string describes what background.js's matching download function
    // actually does, including the on-disk path. If you change a download
    // function, update the description here too.
    const MODE_DESCRIPTIONS = {
        folder: 'Wraps every gallery in its own sub-folder under your base downloads folder. The sub-folder is named using the <strong>Folder Naming Formula</strong>; each image inside follows the <strong>Image Filename Formula</strong>. Files land at <code>downloads/[base]/[your folder name]/[your image name].jpg</code>. Best when you want one folder per gallery — easy to find, easy to delete as a unit.',
        zip: 'Packs every image in the gallery into a single <code>.zip</code> archive that lands in your base downloads folder. The archive is named using the <strong>ZIP Archive Naming Formula</strong>; image filenames inside the ZIP follow the <strong>Image Filename Formula</strong>. Files land at <code>downloads/[base]/[your archive name].zip</code>. Best when you want to share a whole gallery as one file — Discord, email, cloud drives.',
        individual: 'Drops every image straight into your base downloads folder — no sub-folder, no archive. Each image is named using the <strong>Image Filename Formula</strong>. Files land at <code>downloads/[base]/[your image name].jpg</code>. Best when you have your own folder organization in mind and just want the bytes.'
    };
    const modeDescriptionEl = document.getElementById('mode-description');
    function setModeDescription(mode) {
        modeDescriptionEl.innerHTML = MODE_DESCRIPTIONS[mode] || '';
    }

    // Format selects are now per-mode and looked up via getFormatSelect(mode, key)
    // — see buildFormatOptionsHTML above. The toggles below stay global.
    const promptTitleToggle = document.getElementById('prompt-title-toggle');
    const keyboardShortcutToggle = document.getElementById('keyboard-shortcut-toggle');

    const fallbacks = {
        folder: {
            truncate: document.getElementById('truncate-rule-folder'),
            missingTitle: document.getElementById('missing-title-rule-folder'),
            placeholderText: document.getElementById('placeholder-text-folder'),
            singleFileIndex: document.getElementById('single-file-index-folder')
        },
        zip: {
            truncate: document.getElementById('truncate-rule-zip'),
            missingTitle: document.getElementById('missing-title-rule-zip'),
            placeholderText: document.getElementById('placeholder-text-zip'),
            singleFileIndex: document.getElementById('single-file-index-zip')
        },
        individual: {
            truncate: document.getElementById('truncate-rule-individual'),
            missingTitle: document.getElementById('missing-title-rule-individual'),
            placeholderText: document.getElementById('placeholder-text-individual'),
            singleFileIndex: document.getElementById('single-file-index-individual')
        }
    };

    function syncPlaceholderVisibility(group) {
        const hide = group.missingTitle.value !== 'placeholder';
        group.placeholderText.closest('.rule-group').classList.toggle('placeholder-hidden', hide);
    }
    Object.values(fallbacks).forEach(group => {
        group.missingTitle.addEventListener('change', () => syncPlaceholderVisibility(group));
    });

    let uniqueStaticTextId = 0;
    let toastTimeout;
    let currentBaseFolder = 'reddit_downloads';

    const emptyFallbackHash = Math.random().toString(36).substring(2, 10);

    // Mirror background.js's final-name handling so the preview never promises a
    // name the saved file won't keep: strip filesystem-forbidden characters and
    // cap at the same length. MAX_NAME_LENGTH matches background.js's constant.
    const MAX_NAME_LENGTH = 110;
    const cleanPreviewName = (s) => s.replace(/[<>:"/\\|?*]/g, '-').trim();

    function showToast(message, variant) {
        const textEl = toast.querySelector('.toast-text') || toast;
        textEl.textContent = message;
        toast.classList.remove('success');
        if (variant === 'success') toast.classList.add('success');
        toast.classList.add('show');
        clearTimeout(toastTimeout);
        const dur = variant === 'success' ? 2400 : 4000;
        toastTimeout = setTimeout(() => { toast.classList.remove('show'); }, dur);
    }

    new Sortable(toolbox, { group: { name: 'shared', pull: 'clone', put: false }, animation: 150, sort: false });

    const makeSortable = (el) => {
        new Sortable(el, { group: 'shared', animation: 150, onAdd: updatePreview, onUpdate: updatePreview, onRemove: updatePreview });
    };

    makeSortable(dropzones.folder.folder);
    makeSortable(dropzones.folder.image);
    makeSortable(dropzones.zip.archive);
    makeSortable(dropzones.zip.image);
    makeSortable(dropzones.individual);

    addStaticTextBtn.addEventListener('click', () => {
        addStaticTextBtn.style.display = 'none';

        const inputWrapper = document.createElement('div');
        inputWrapper.className = 'pill user-typed-text';

        const input = document.createElement('input');
        input.type = 'text';
        input.className = 'pill-input';
        input.placeholder = 'Type...';
        input.style.width = '8ch';

        inputWrapper.appendChild(input);
        toolbox.insertBefore(inputWrapper, addStaticTextBtn);

        input.focus();

        const updateWidth = () => { input.style.width = Math.max(input.value.length + 1, 8) + 'ch'; };
        input.addEventListener('input', updateWidth);

        let saved = false;
        const finalizePill = () => {
            if (saved) return;
            saved = true;

            let rawText = input.value;
            if (rawText === "") {
                inputWrapper.remove();
                addStaticTextBtn.style.display = 'block';
                return;
            }

            let sanitizedText = rawText.replace(/[<>:"/\\|?*]/g, '-');
            if (rawText !== sanitizedText) showToast("Special characters were replaced with '-'");

            inputWrapper.innerHTML = `<span style="white-space: pre;">${sanitizedText.replace(/ /g, '&nbsp;')}</span>`;
            inputWrapper.setAttribute('data-type', 'user_text');
            inputWrapper.setAttribute('data-generated-text', sanitizedText);
            inputWrapper.setAttribute('data-static-text-id', `static-text-${uniqueStaticTextId++}`);

            makePillDeletable(inputWrapper);

            addStaticTextBtn.style.display = 'block';
            updatePreview();
        };

        input.addEventListener('keydown', (e) => { if (e.key === 'Enter') finalizePill(); });
        input.addEventListener('blur', finalizePill);
    });

    const makePillDeletable = (pillEl) => {
        pillEl.title = "Double-click to delete";
        pillEl.addEventListener('dblclick', (e) => {
            if (pillEl.parentElement === toolbox) {
                pillEl.remove();
                updatePreview();
            }
        });
    };

    const activeZoneList = [dropzones.folder.folder, dropzones.folder.image, dropzones.zip.archive, dropzones.zip.image, dropzones.individual];
    activeZoneList.forEach(zone => {
        zone.addEventListener('dblclick', (e) => {
            // user_text pills wrap their label in a <span>, so e.target on a
            // double-click is the inner span — which has no `pill` class. Use
            // closest('.pill') so every pill type is actually deletable.
            const pill = e.target.closest && e.target.closest('.pill');
            if (pill && pill.parentElement === zone) {
                pill.remove();
                updatePreview();
            }
        });
    });

    tabLinks.forEach(link => {
        link.addEventListener('click', (e) => {
            const mode = e.target.getAttribute('data-mode');
            tabLinks.forEach(l => l.classList.remove('active'));
            panels.forEach(p => p.classList.remove('active'));
            e.target.classList.add('active');
            document.getElementById(`panel-${mode}`).classList.add('active');
            setModeDescription(mode);
            updatePreview();
        });
    });

    // Wire change listeners on every per-mode format select. updatePreview
    // reads from whichever mode's selects are currently active, so listening
    // on all 26 generated controls keeps the preview accurate when the user
    // tweaks a setting on any tab.
    document.querySelectorAll('select[data-format-key]').forEach(select => {
        select.addEventListener('change', updatePreview);
    });

    // Mock-post carousel — slides between the peacock images. Pure CSS transform
    // on the track for the transition. Linear (no wrap-around): the prev arrow
    // hides at the first slide, the next arrow hides at the last.
    (function setupGalleryCarousel() {
        const track = document.getElementById('gallery-track');
        const counter = document.getElementById('gallery-counter');
        const prev = document.querySelector('.gallery-prev');
        const next = document.querySelector('.gallery-next');
        if (!track || !prev || !next) return;

        // Slides 2 and 3 reference peacock2.jpg / peacock3.jpg, which the user
        // may not have saved yet. Inline onerror="" attributes get blocked by
        // the extension's CSP, so we wire the fallback up here. Each slide
        // tries its data-fallback once, then gives up to avoid a loop. The
        // surrounding .gallery-slide also has its --bg CSS var swapped so the
        // blurred backdrop matches the visible foreground.
        track.querySelectorAll('.gallery-img').forEach(img => {
            img.addEventListener('error', function once() {
                img.removeEventListener('error', once);
                const fallback = img.getAttribute('data-fallback');
                if (!fallback) return;
                img.src = fallback;
                const slide = img.closest('.gallery-slide');
                if (slide) slide.style.setProperty('--bg', `url('${fallback}')`);
            });
        });

        const total = track.querySelectorAll('.gallery-img').length;
        let idx = 0;
        const apply = () => {
            track.style.transform = `translateX(-${idx * 100}%)`;
            if (counter) counter.textContent = `${idx + 1} / ${total}`;
            prev.classList.toggle('is-hidden', idx === 0);
            next.classList.toggle('is-hidden', idx === total - 1);
        };
        prev.addEventListener('click', () => { if (idx > 0) { idx--; apply(); } });
        next.addEventListener('click', () => { if (idx < total - 1) { idx++; apply(); } });
        apply(); // Initial state: prev hidden because we start at slide 0.
    })();

    const applyTitleCase = (str, format) => {
        if (!str) return str;
        if (format === 'lower')    return str.toLowerCase();
        if (format === 'upper')    return str.toUpperCase();
        // Keep this in lock-step with applyTitleCase in background.js — the
        // live preview must show the same string the saved file will get.
        if (format === 'title')    return str.split(/(\s+)/).map(t => {
            if (/\s/.test(t)) return t;
            if (t.length >= 2 && t === t.toUpperCase() && /[A-Z]/.test(t)) return t;
            return t.charAt(0).toUpperCase() + t.slice(1).toLowerCase();
        }).join('');
        if (format === 'sentence') return str.charAt(0).toUpperCase() + str.slice(1).toLowerCase();
        return str;
    };

    function getActiveMode() {
        const activeTab = document.querySelector('.tab-link.active');
        return activeTab ? activeTab.getAttribute('data-mode') : 'folder';
    }

    const getSeparatorChar = (val) => {
        if (val === 'dash') return '-';
        if (val === 'space') return ' ';
        if (val === 'none') return '';
        return '_';
    };

    const getDateSeparatorChar = (val) => {
        if (val === 'underscore') return '_';
        if (val === 'space') return ' ';
        if (val === 'dot') return '.';
        if (val === 'none') return '';
        return '-';
    };

    const resolveTitleSep = (titleVal, fallbackChar) => {
        if (!titleVal || titleVal === 'default') return fallbackChar;
        if (titleVal === 'keep') return ' ';
        return getSeparatorChar(titleVal);
    };

    // Stable, hand-picked example for each Unique ID format so the preview
    // is deterministic instead of jumping every time the user touches a knob.
    const ID_FORMAT_PREVIEWS = {
        hex: 'a1b2c3',
        hex8: 'a1b2c3d4',
        numeric: '987654',
        numeric8: '12345678',
        alpha6: 'k7p2m9',
        letters: 'xKjPqM',
        timestamp: '1733123456'
    };

    function formatIndexValue(n, format) {
        const padded = String(n).padStart(2, '0');
        if (format === 'parentheses') return `(${padded})`;
        if (format === 'brackets') return `[${padded}]`;
        return padded;
    }

    // Format an arbitrary date the same way background.js's formatDateFromDate
    // does, so the Upload Date and Download Date pills preview as the distinct
    // values they actually carry (post-time vs. now) instead of one shared
    // string. Keep in lock-step with background.js:formatDateFromDate.
    const formatPreviewDate = (d, dateFormat, dateSepChar) => {
        const mm = String(d.getMonth() + 1).padStart(2, '0');
        const dd = String(d.getDate()).padStart(2, '0');
        const yyyy = d.getFullYear();
        const yy = yyyy.toString().slice(-2);
        if (dateFormat === 'dd-mm-yyyy' || dateFormat === 'uk') return `${dd}${dateSepChar}${mm}${dateSepChar}${yyyy}`;
        if (dateFormat === 'dd-mm-yy') return `${dd}${dateSepChar}${mm}${dateSepChar}${yy}`;
        if (dateFormat === 'mm-dd-yyyy' || dateFormat === 'us') return `${mm}${dateSepChar}${dd}${dateSepChar}${yyyy}`;
        if (dateFormat === 'mm-dd-yy') return `${mm}${dateSepChar}${dd}${dateSepChar}${yy}`;
        return `${yyyy}${dateSepChar}${mm}${dateSepChar}${dd}`;
    };

    const getDataValues = (separator, indexFormat, dateFormat, dateSeparator, timeFormat, idFormat, titleSpace, titleCase) => {
        const sepChar = getSeparatorChar(separator);
        const dateSepChar = getDateSeparatorChar(dateSeparator);
        const titleSepChar = resolveTitleSep(titleSpace, sepChar);
        const rawTitle = applyTitleCase("A peacock", titleCase || 'original');

        // Upload date = a representative "posted" date; download date = today —
        // the two genuinely differ in the saved file, so the preview shows them
        // as different strings too.
        const sampleUploadDate = new Date(2026, 4, 3);
        const todayDate = new Date();

        return {
            subreddit: 'BeAmazed',
            author: 'FeatherFanatic',
            title: rawTitle.split(' ').join(titleSepChar),
            index: formatIndexValue(1, indexFormat),
            unique_id: ID_FORMAT_PREVIEWS[idFormat] || ID_FORMAT_PREVIEWS.hex,
            uploadDate: formatPreviewDate(sampleUploadDate, dateFormat, dateSepChar),
            dlDate: formatPreviewDate(todayDate, dateFormat, dateSepChar),
            time: (timeFormat === '24h') ? `14${sepChar}30${sepChar}00` : `02${sepChar}30${sepChar}PM`
        };
    };

    const getFormulaString = (dropzone, data, sepChar) => {
        const pills = dropzone.querySelectorAll('.pill');
        if (pills.length === 0) return emptyFallbackHash;

        let formulaString = '';
        let prevWasUserText = false;
        let isFirstEmitted = true;

        pills.forEach((pill) => {
            const type = pill.getAttribute('data-type');
            const isUserText = (type === 'user_text');

            let value = '';
            if (isUserText) {
                value = pill.getAttribute('data-generated-text') || '';
            } else if (type === 'unique_id') {
                value = data.unique_id;
            } else if (type === 'upload_date') {
                value = data.uploadDate;
            } else if (type === 'dl_date') {
                value = data.dlDate;
            } else if (type === 'time') {
                value = data.time;
            } else {
                value = data[type] || '';
            }

            if (value === '' || value === undefined || value === null) return;

            if (!isFirstEmitted && !isUserText && !prevWasUserText) {
                formulaString += sepChar;
            }
            formulaString += value;
            prevWasUserText = isUserText;
            isFirstEmitted = false;
        });
        // Sanitize + cap exactly like background.js buildNameString, falling back
        // to the same empty-formula hash, so the preview line matches disk.
        const cleaned = cleanPreviewName(formulaString) || emptyFallbackHash;
        return cleaned.substring(0, MAX_NAME_LENGTH).trim();
    };

    // Monochrome filled-shape icons — every glyph is drawn with currentColor,
    // so each row's text colour drives the icon and the page stays on its
    // two-tone palette. The shapes themselves are deliberately chunky and
    // affordance-loaded (folder gets a tab, image gets an obvious mountain
    // + sun composition, archive has a visible zipper pull) so each kind
    // is identifiable at a glance even at 18px.
    const PREVIEW_ICONS = {
        // Open folder — for the "downloads/[base]/" root line. Body + a
        // slightly tilted lid silhouette read as "this folder is open".
        download: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M3 6.5A1.5 1.5 0 0 1 4.5 5h5.25a1.5 1.5 0 0 1 1.06.44L12.5 7h6.5a2 2 0 0 1 2 2v1.5H3z" opacity="0.5"/><path d="M2.5 11.2a1 1 0 0 1 1-1.2h17.5a1 1 0 0 1 .98 1.2l-1.55 7.4A1.8 1.8 0 0 1 18.66 20H5.34a1.8 1.8 0 0 1-1.77-1.4z"/></svg>',
        // Closed folder — gallery sub-folders. Tab on top + slightly lighter
        // back panel + bold front panel = unambiguously "manila folder".
        folder:   '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M3 6.5A1.5 1.5 0 0 1 4.5 5h5.25a1.5 1.5 0 0 1 1.06.44L12.5 7h6.5a2 2 0 0 1 2 2v1.5H3z" opacity="0.5"/><path d="M3 10.5h18a1.5 1.5 0 0 1 1.5 1.5v6.5A1.5 1.5 0 0 1 21 20H4.5A1.5 1.5 0 0 1 3 18.5z"/></svg>',
        // Photo file — picture frame with a sun and two mountain peaks, all
        // baked into one filled shape. Reads as "image" at any size because
        // the silhouette is the universal photo-frame composition.
        image:    '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M5 3.5h14a2.5 2.5 0 0 1 2.5 2.5v12A2.5 2.5 0 0 1 19 20.5H5A2.5 2.5 0 0 1 2.5 18V6A2.5 2.5 0 0 1 5 3.5zm15 14.6V14.6l-3.4-3.1a1 1 0 0 0-1.34 0L11.4 15.4l-2.06-1.9a1 1 0 0 0-1.34 0L4 17.2v0.9a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1z" opacity="0.45"/><circle cx="9" cy="9" r="2"/><path d="M20 18.1V14.6l-3.4-3.1a1 1 0 0 0-1.34 0L11.4 15.4l-2.06-1.9a1 1 0 0 0-1.34 0L4 17.2v0.9a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1z"/></svg>',
        // ZIP archive — folder body + a pronounced vertical zipper with a
        // pull-tab dangling at the top. The zipper teeth are deliberately
        // chunky so the "this is a zip" affordance survives at small sizes.
        archive:  '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M3 6.5A1.5 1.5 0 0 1 4.5 5h5.25a1.5 1.5 0 0 1 1.06.44L12.5 7h6.5a2 2 0 0 1 2 2v1.5H3z" opacity="0.5"/><path d="M3 10.5h18a1.5 1.5 0 0 1 1.5 1.5v6.5A1.5 1.5 0 0 1 21 20H4.5A1.5 1.5 0 0 1 3 18.5z"/><rect x="11.1" y="11" width="1.8" height="9" fill="var(--bg-card,#fff)"/><rect x="11.1" y="12.4" width="1.8" height="0.8" fill="currentColor"/><rect x="11.1" y="14" width="1.8" height="0.8" fill="currentColor"/><rect x="11.1" y="15.6" width="1.8" height="0.8" fill="currentColor"/><rect x="11.1" y="17.2" width="1.8" height="0.8" fill="currentColor"/><rect x="11.1" y="18.8" width="1.8" height="0.8" fill="currentColor"/><circle cx="12" cy="11.6" r="1.2" fill="var(--bg-card,#fff)" stroke="currentColor" stroke-width="0.6"/></svg>'
    };

    const NUM_PREVIEW_IMAGES = 3;

    function escapeHtml(s) {
        return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#039;');
    }

    // Build one image filename for the preview, mirroring background.js's
    // shouldAddTrailingIndex behaviour: if the formula has no Index pill and
    // we're showing >1 images, append the trailing index. Demo always shows 3,
    // so trailing index always applies when the formula doesn't already include one.
    function buildPreviewImageName(dropzone, fileData, sepChar, indexFormat, imageNum) {
        const dataI = { ...fileData, index: formatIndexValue(imageNum, indexFormat) };
        let name = getFormulaString(dropzone, dataI, sepChar);
        const hasIndexPill = dropzone.querySelectorAll('.pill[data-type="index"]').length > 0;
        if (!hasIndexPill) name += `${sepChar}${dataI.index}`;
        return name;
    }

    function previewRow(iconKey, name, kindClass, indentLevel) {
        const indent = indentLevel ? ` preview-indent-${indentLevel}` : '';
        const safe = escapeHtml(name);

        // Split off the trailing extension (or "/" for folders) so the
        // ellipsis can chew the body of the filename while keeping the
        // identifier suffix visible. Without this, long names truncate to
        // "A peacock showing off its f…" and you can't tell .jpg from .png.
        let body = safe, suffix = '';
        const slashAt = safe.lastIndexOf('/');
        const dotAt = safe.lastIndexOf('.');
        if (slashAt === safe.length - 1 && slashAt > 0) {
            body = safe.slice(0, -1);
            suffix = '/';
        } else if (dotAt > 0 && dotAt > slashAt && safe.length - dotAt <= 6) {
            body = safe.slice(0, dotAt);
            suffix = safe.slice(dotAt);
        }

        return `<div class="preview-row ${kindClass}${indent}" title="${safe}"><span class="preview-icon">${PREVIEW_ICONS[iconKey]}</span><span class="preview-name"><span class="preview-name-body">${body}</span><span class="preview-name-suffix">${suffix}</span></span></div>`;
    }

    function updatePreview() {
        const activeMode = getActiveMode();

        // Read every format value from the ACTIVE mode's controls. Each mode
        // has its own set of selects, so the preview always reflects the
        // settings the user is looking at on the current tab.
        const v = (key) => readFormatValue(activeMode, key);
        const folderSepRaw = v('folderSeparatorFormat');
        const fileSepRaw   = v('fileSeparatorFormat');
        const indexFormat  = v('indexFormat');
        const dateFormat   = v('dateFormat');
        const dateSepRaw   = v('dateSeparatorFormat');
        const timeFormat   = v('timeFormat');
        const idFormat     = v('idFormat');
        const titleSpace   = v('titleSpaceFormat');
        const titleCase    = v('titleCaseFormat');

        const folderSep = getSeparatorChar(folderSepRaw);
        const fileSep = getSeparatorChar(fileSepRaw);

        // Title Space governs the title pill in image filenames only. For
        // the folder/archive context, force resolveTitleSep to fall back to
        // the folder pill separator by passing 'default' — keeps the live
        // preview in lock-step with background.js's titleSepFolder rule.
        const folderData = getDataValues(folderSepRaw, indexFormat, dateFormat, dateSepRaw, timeFormat, idFormat, 'default', titleCase);
        const fileData   = getDataValues(fileSepRaw,   indexFormat, dateFormat, dateSepRaw, timeFormat, idFormat, titleSpace, titleCase);

        const summary = document.getElementById('preview-summary');
        if (!summary) return;

        const lines = [previewRow('download', `downloads/${currentBaseFolder}/`, 'is-base', 0)];

        if (activeMode === 'folder') {
            const folderName = getFormulaString(dropzones.folder.folder, folderData, folderSep);
            lines.push(previewRow('folder', `${folderName}/`, 'is-folder', 1));
            for (let i = 1; i <= NUM_PREVIEW_IMAGES; i++) {
                const imgName = buildPreviewImageName(dropzones.folder.image, fileData, fileSep, indexFormat, i);
                lines.push(previewRow('image', `${imgName}.jpg`, 'is-image', 2));
            }
        } else if (activeMode === 'zip') {
            const archiveName = getFormulaString(dropzones.zip.archive, folderData, folderSep);
            lines.push(previewRow('archive', `${archiveName}.zip`, 'is-archive', 1));
            for (let i = 1; i <= NUM_PREVIEW_IMAGES; i++) {
                const imgName = buildPreviewImageName(dropzones.zip.image, fileData, fileSep, indexFormat, i);
                lines.push(previewRow('image', `${imgName}.jpg`, 'is-image', 2));
            }
        } else if (activeMode === 'individual') {
            for (let i = 1; i <= NUM_PREVIEW_IMAGES; i++) {
                const imgName = buildPreviewImageName(dropzones.individual, fileData, fileSep, indexFormat, i);
                lines.push(previewRow('image', `${imgName}.jpg`, 'is-image', 1));
            }
        }

        summary.innerHTML = lines.join('');

        // Pill badge in the card header — "3 photos" / "3 photos + 1 zip" /
        // "3 photos + 1 folder". Cheap, but it tells the user at a glance how
        // many files this configuration will actually produce.
        const countEl = document.getElementById('preview-summary-count');
        if (countEl) {
            const photos = `${NUM_PREVIEW_IMAGES} ${NUM_PREVIEW_IMAGES === 1 ? 'photo' : 'photos'}`;
            const wrapper = activeMode === 'folder' ? ' + 1 folder'
                          : activeMode === 'zip'    ? ' + 1 zip'
                          : '';
            countEl.textContent = photos + wrapper;
        }
    }

    const pillToState = (pill) => {
        const type = pill.getAttribute('data-type');
        if (type === 'user_text') return { type: 'user_text', staticTextId: pill.getAttribute('data-static-text-id'), generatedText: pill.getAttribute('data-generated-text') };
        else return { type };
    };

    // Snapshot of one mode's format prefs, read from that mode's selects.
    // Folder Pill Sep is auto-included for Folder/ZIP and skipped for
    // Individual (no folder/archive name to assemble there).
    function readFormatPrefs(mode) {
        const prefs = {};
        formatKeysForMode(mode).forEach(key => {
            prefs[key] = readFormatValue(mode, key);
        });
        return prefs;
    }

    saveBtn.addEventListener('click', () => {
        // globalPrefs now only carries truly-global flags (the active tab and
        // the prompt-for-title toggle). All format-related keys live per-mode
        // under modeState[mode].formatPrefs — see schema in defaultState.
        const globalPrefs = {
            promptCustomTitle: promptTitleToggle.checked,
            activeMode: getActiveMode()
        };

        const saveZoneState = (dropzone) => Array.from(dropzone.querySelectorAll('.pill')).map(pillToState);

        const fallbackState = (group) => ({
            truncate: group.truncate.value,
            missingTitle: group.missingTitle.value,
            placeholderText: (group.placeholderText.value || '').replace(/[\\/:*?"<>|]/g, '').trim(),
            singleFileIndex: group.singleFileIndex.value
        });

        const modeState = {
            folder: {
                folder: saveZoneState(dropzones.folder.folder),
                image: saveZoneState(dropzones.folder.image),
                fallbacks: fallbackState(fallbacks.folder),
                formatPrefs: readFormatPrefs('folder')
            },
            zip: {
                archive: saveZoneState(dropzones.zip.archive),
                image: saveZoneState(dropzones.zip.image),
                fallbacks: fallbackState(fallbacks.zip),
                formatPrefs: readFormatPrefs('zip')
            },
            individual: {
                formula: saveZoneState(dropzones.individual),
                fallbacks: fallbackState(fallbacks.individual),
                formatPrefs: readFormatPrefs('individual')
            }
        };

        const toolboxPills = Array.from(toolbox.querySelectorAll('.pill[data-type="user_text"]')).map(pillToState);

        chrome.storage.sync.set({
            globalPrefs,
            modeState,
            // Mirror the active mode into the top-level downloadMode key that
            // the popup and background.js read first, so picking a mode here
            // actually drives downloads and the popup dropdown reflects it.
            downloadMode: getActiveMode(),
            toolboxStaticTextDefs: toolboxPills,
            lastUniqueStaticTextId: uniqueStaticTextId,
            keyboardShortcutEnabled: keyboardShortcutToggle.checked
        }, () => {
            // chrome.storage.sync has a 100KB quota and an 8KB per-key cap.
            // Without this check, a quota-exceeded error returns silently and
            // the toast still says "saved successfully" — the user walks away
            // thinking their formula stuck when it didn't. Real bug.
            if (chrome.runtime.lastError) {
                console.error('[Options] storage.sync.set failed:', chrome.runtime.lastError.message);
                showToast('Save failed: ' + chrome.runtime.lastError.message);
                return;
            }
            saveBtn.classList.add('saved');
            showToast('Settings saved successfully', 'success');
            setTimeout(() => saveBtn.classList.remove('saved'), 1800);
        });
    });

    function stateToPill(pillState) {
        const pill = document.createElement('div');
        pill.className = 'pill';
        pill.setAttribute('data-type', pillState.type);

        if (pillState.type === 'user_text') {
            pill.className += ' user-typed-text';
            pill.setAttribute('data-generated-text', pillState.generatedText);
            pill.setAttribute('data-static-text-id', pillState.staticTextId);

            let displayString = pillState.generatedText || 'Custom';
            pill.innerHTML = `<span style="white-space: pre;">${displayString.replace(/ /g, '&nbsp;')}</span>`;
        } else if (pillState.type === 'unique_id') {
            pill.className += ' unique-id';
            pill.textContent = 'Unique ID';
        } else {
            let formattedText = pillState.type.split('_').map(word => word.charAt(0).toUpperCase() + word.slice(1)).join(' ');
            pill.textContent = formattedText;
        }
        return pill;
    }

    // Build a fresh formatPrefs object for one mode, copying every key the
    // mode supports from FORMAT_DEFAULTS. Used by defaultState below and as
    // the seed for each mode during the migration from old globalPrefs.
    function defaultFormatPrefsFor(mode) {
        const out = {};
        formatKeysForMode(mode).forEach(k => { out[k] = FORMAT_DEFAULTS[k]; });
        return out;
    }

    const defaultState = {
        globalPrefs: {
            promptCustomTitle: false,
            activeMode: 'folder'
        },
        downloadMode: 'folder',
        toolboxStaticTextDefs: [],
        lastUniqueStaticTextId: 0,
        keyboardShortcutEnabled: true,
        modeState: {
            folder: {
                folder: [{ type: 'subreddit' }],
                image: [{ type: 'title' }, { type: 'index' }],
                fallbacks: { truncate: 'auto', missingTitle: 'omit', singleFileIndex: 'never' },
                formatPrefs: defaultFormatPrefsFor('folder')
            },
            zip: {
                archive: [{ type: 'title' }],
                image: [{ type: 'index' }],
                fallbacks: { truncate: 'auto', missingTitle: 'omit', singleFileIndex: 'never' },
                formatPrefs: defaultFormatPrefsFor('zip')
            },
            individual: {
                formula: [{ type: 'title' }, { type: 'index' }],
                fallbacks: { truncate: 'auto', missingTitle: 'omit', singleFileIndex: 'never' },
                formatPrefs: defaultFormatPrefsFor('individual')
            }
        }
    };

    // Migration helper: pre-2.3 builds stored format prefs in globalPrefs
    // (a single shared set). After this rev each mode carries its own
    // formatPrefs. If a saved config is missing per-mode formatPrefs but
    // has the legacy globalPrefs keys, copy the legacy values into all
    // three modes so the user keeps their existing setup.
    function ensureFormatPrefsMigrated(data) {
        const legacy = data.globalPrefs || {};
        const ms = data.modeState || {};

        ['folder', 'zip', 'individual'].forEach(mode => {
            if (!ms[mode]) return;
            if (ms[mode].formatPrefs) return; // already migrated
            const seeded = {};
            formatKeysForMode(mode).forEach(key => {
                seeded[key] = legacy[key] != null
                    ? legacy[key]
                    // The very first build used a single `separatorFormat` for
                    // both folder and file seps — keep that fallback.
                    : (key === 'fileSeparatorFormat' || key === 'folderSeparatorFormat')
                        ? (legacy.separatorFormat || FORMAT_DEFAULTS[key])
                        : FORMAT_DEFAULTS[key];
            });
            ms[mode].formatPrefs = seeded;
        });
    }

    function applySettings(data) {
        currentBaseFolder = data.preferredFolder || 'reddit_downloads';

        // Migrate older configs that stored format prefs globally into the
        // new per-mode shape. After this call data.modeState[mode].formatPrefs
        // is guaranteed populated for all three modes.
        ensureFormatPrefsMigrated(data);

        // Push each mode's saved formatPrefs into that mode's selects.
        ['folder', 'zip', 'individual'].forEach(mode => {
            const prefs = (data.modeState[mode] && data.modeState[mode].formatPrefs) || defaultFormatPrefsFor(mode);
            formatKeysForMode(mode).forEach(key => {
                const sel = getFormatSelect(mode, key);
                if (sel) sel.value = prefs[key] != null ? prefs[key] : FORMAT_DEFAULTS[key];
            });
        });

        promptTitleToggle.checked = data.globalPrefs.promptCustomTitle || false;
        keyboardShortcutToggle.checked = data.keyboardShortcutEnabled !== false;
        uniqueStaticTextId = data.lastUniqueStaticTextId || 0;

        const restoredMode = data.globalPrefs.activeMode || 'folder';
        tabLinks.forEach(l => l.classList.remove('active'));
        panels.forEach(p => p.classList.remove('active'));
        document.querySelector(`.tab-link[data-mode="${restoredMode}"]`).classList.add('active');
        document.getElementById(`panel-${restoredMode}`).classList.add('active');
        setModeDescription(restoredMode);

        // Wipe any user_text pills already in the toolbox, then re-add from saved state.
        Array.from(toolbox.querySelectorAll('.pill[data-type="user_text"]')).forEach(p => p.remove());
        if (data.toolboxStaticTextDefs) {
            data.toolboxStaticTextDefs.forEach(pillState => {
                const pill = stateToPill(pillState);
                makePillDeletable(pill);
                toolbox.insertBefore(pill, addStaticTextBtn);
            });
        }

        const loadZoneState = (zoneEl, pillStates) => {
            zoneEl.innerHTML = '';
            (pillStates || []).forEach(pillState => {
                const pill = stateToPill(pillState);
                zoneEl.appendChild(pill);
            });
        };

        const loadFallbacks = (fallbackGroup, fallbackStates) => {
            const states = fallbackStates || {};
            if (fallbackGroup.truncate) fallbackGroup.truncate.value = states.truncate || 'auto';
            if (fallbackGroup.missingTitle) fallbackGroup.missingTitle.value = states.missingTitle || 'omit';
            if (fallbackGroup.placeholderText) fallbackGroup.placeholderText.value = states.placeholderText || '';
            if (fallbackGroup.singleFileIndex) fallbackGroup.singleFileIndex.value = states.singleFileIndex || 'never';
            syncPlaceholderVisibility(fallbackGroup);
        };

        loadZoneState(dropzones.folder.folder, data.modeState.folder.folder);
        loadZoneState(dropzones.folder.image, data.modeState.folder.image);
        loadFallbacks(fallbacks.folder, data.modeState.folder.fallbacks);

        loadZoneState(dropzones.zip.archive, data.modeState.zip.archive);
        loadZoneState(dropzones.zip.image, data.modeState.zip.image);
        loadFallbacks(fallbacks.zip, data.modeState.zip.fallbacks);

        loadZoneState(dropzones.individual, data.modeState.individual.formula);
        loadFallbacks(fallbacks.individual, data.modeState.individual.fallbacks);

        // Setting .value programmatically doesn't fire change — but the custom
        // dropdown widgets only update their visible labels in response to a
        // change event. Fire one on each native select after loading so every
        // trigger paints the correct current option. The existing change
        // listeners (updatePreview, syncPlaceholderVisibility) are idempotent,
        // so running them an extra time here is harmless.
        document.querySelectorAll('select').forEach(s => {
            s.dispatchEvent(new Event('change', { bubbles: true }));
        });

        updatePreview();
    }

    // ---- Backup & reset ----
    function showConfirm({ title, message, okText, danger }, onConfirm) {
        const overlay = document.getElementById('confirm-overlay');
        document.getElementById('confirm-title').textContent = title;
        document.getElementById('confirm-message').textContent = message;
        const okBtn = document.getElementById('confirm-ok');
        okBtn.textContent = okText || 'Confirm';
        okBtn.classList.toggle('confirm-danger', !!danger);
        overlay.classList.add('show');

        const cleanup = () => {
            overlay.classList.remove('show');
            okBtn.replaceWith(okBtn.cloneNode(true));
            document.getElementById('confirm-cancel').replaceWith(document.getElementById('confirm-cancel').cloneNode(true));
            overlay.removeEventListener('click', backdropHandler);
            document.removeEventListener('keydown', keyHandler, true);
        };
        const backdropHandler = (e) => { if (e.target === overlay) cleanup(); };
        // Escape dismisses the dialog the same way Cancel does. Capture phase
        // so the destructive action is never one Enter-key-press away when
        // the user just wanted to back out.
        const keyHandler = (e) => {
            if (e.key === 'Escape') { e.preventDefault(); cleanup(); }
        };
        overlay.addEventListener('click', backdropHandler);
        document.addEventListener('keydown', keyHandler, true);
        document.getElementById('confirm-cancel').addEventListener('click', cleanup);
        document.getElementById('confirm-ok').addEventListener('click', () => {
            cleanup();
            onConfirm();
        });
    }

    document.getElementById('export-btn').addEventListener('click', () => {
        chrome.storage.sync.get(null, (data) => {
            const payload = {
                _exportFormat: 1,
                _exportedAt: new Date().toISOString(),
                ...data
            };
            const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            const ts = new Date().toISOString().replace(/[:.]/g, '-').split('T')[0];
            a.download = `reddit-gallery-downloader-settings-${ts}.json`;
            document.body.appendChild(a);
            a.click();
            a.remove();
            setTimeout(() => URL.revokeObjectURL(url), 100);
            showToast('Settings exported', 'success');
        });
    });

    document.getElementById('import-btn').addEventListener('click', () => {
        document.getElementById('import-file-input').click();
    });

    document.getElementById('import-file-input').addEventListener('change', (e) => {
        const file = e.target.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = (evt) => {
            try {
                const parsed = JSON.parse(evt.target.result);
                if (!parsed.globalPrefs || !parsed.modeState || !parsed.modeState.folder) {
                    showToast('That file does not look like a valid settings export.');
                    return;
                }
                showConfirm({
                    title: 'Replace your current settings?',
                    message: 'Importing will overwrite all naming formulas, format options, and toggles. Your current settings will be lost.',
                    okText: 'Import & Replace',
                    danger: true
                }, () => {
                    const cleanData = {
                        globalPrefs: parsed.globalPrefs,
                        modeState: parsed.modeState,
                        toolboxStaticTextDefs: parsed.toolboxStaticTextDefs || [],
                        lastUniqueStaticTextId: parsed.lastUniqueStaticTextId || 0,
                        keyboardShortcutEnabled: parsed.keyboardShortcutEnabled !== false,
                        preferredFolder: parsed.preferredFolder,
                        downloadMode: parsed.downloadMode,
                        buttonTheme: parsed.buttonTheme,
                        buttonPosition: parsed.buttonPosition,
                        buttonSize: parsed.buttonSize,
                        customButtonLabel: parsed.customButtonLabel
                    };
                    Object.keys(cleanData).forEach(k => cleanData[k] === undefined && delete cleanData[k]);
                    chrome.storage.sync.clear(() => {
                        chrome.storage.sync.set(cleanData, () => {
                            // If the import payload exceeds the 100KB sync
                            // quota, lastError fires and storage is in a
                            // half-cleared state. Tell the user explicitly
                            // so they don't think the import succeeded.
                            if (chrome.runtime.lastError) {
                                console.error('[Options] import storage.sync.set failed:', chrome.runtime.lastError.message);
                                showToast('Import failed: ' + chrome.runtime.lastError.message);
                                return;
                            }
                            applySettings({ ...defaultState, ...cleanData });
                            showToast('Settings imported successfully', 'success');
                        });
                    });
                });
            } catch (err) {
                showToast('Could not parse that file. Make sure it is valid JSON.');
            }
        };
        reader.readAsText(file);
        e.target.value = '';
    });

    document.getElementById('reset-btn').addEventListener('click', () => {
        showConfirm({
            title: 'Reset everything to defaults?',
            message: 'All your formulas, format options, custom static text pills, and button preferences will be erased. You can\'t undo this.',
            okText: 'Reset',
            danger: true
        }, () => {
            chrome.storage.sync.clear(() => {
                chrome.storage.sync.set(defaultState, () => {
                    if (chrome.runtime.lastError) {
                        console.error('[Options] reset storage.sync.set failed:', chrome.runtime.lastError.message);
                        showToast('Reset partial-failed: ' + chrome.runtime.lastError.message);
                        return;
                    }
                    applySettings(defaultState);
                    showToast('Settings reset to defaults', 'success');
                });
            });
        });
    });

    chrome.storage.sync.get(null, (allData) => {
        let data = allData || {};

        // First run, or storage got into a weird state. Merge in the defaults instead of
        // overwriting, otherwise we'd nuke things like preferredFolder/buttonTheme that
        // the popup already wrote.
        if (!data.globalPrefs || !data.modeState || !data.modeState.folder) {
            data = { ...defaultState, ...data };
            data.globalPrefs = { ...defaultState.globalPrefs, ...(data.globalPrefs || {}) };
            data.modeState = data.modeState && data.modeState.folder ? data.modeState : defaultState.modeState;
            chrome.storage.sync.set({
                globalPrefs: data.globalPrefs,
                modeState: data.modeState,
                toolboxStaticTextDefs: data.toolboxStaticTextDefs || [],
                lastUniqueStaticTextId: data.lastUniqueStaticTextId || 0
            });
        }

        applySettings(data);
    });

    // -----------------------------------------------------------------
    // Footer running total
    //
    // background.js writes totalFilesDownloaded into chrome.storage.sync
    // after every successful download. The footer reads it back to show a
    // small "1,234 downloads · 8 hours saved" line next to the
    // version pill. Milestone celebrations themselves live on the Reddit
    // page (content.js — that's where the user actually clicks Download,
    // so it's the right place to congratulate them) — there is intentionally
    // no modal on this page.
    // -----------------------------------------------------------------
    const MILESTONE_SECONDS_PER_FILE = 20; // conservative manual save+name time

    function formatTimeSaved(files) {
        const secs = files * MILESTONE_SECONDS_PER_FILE;
        const mins = Math.round(secs / 60);
        if (mins < 90) return `${mins} minutes`;
        const hrs = Math.round((secs / 3600) * 10) / 10;
        if (hrs < 36) return `${hrs} hours`;
        const days = Math.round((secs / 86400) * 10) / 10;
        return `${hrs} hours (about ${days} days)`;
    }

    function updateFooterStats(totalFiles) {
        const stat = document.getElementById('footer-stat');
        if (!stat) return;
        if (totalFiles && totalFiles > 0) {
            stat.textContent = `${totalFiles.toLocaleString()} downloads · ${formatTimeSaved(totalFiles)} saved`;
            stat.hidden = false;
        } else {
            stat.hidden = true;
        }
    }

    function refreshFooterStats() {
        chrome.storage.sync.get(['totalFilesDownloaded'], (s) => {
            updateFooterStats(s.totalFilesDownloaded || 0);
        });
    }
    refreshFooterStats();

    // Live-update the footer if a download completes in another tab while
    // the options page is open.
    if (chrome.storage && chrome.storage.onChanged) {
        chrome.storage.onChanged.addListener((changes, ns) => {
            if (ns !== 'sync') return;
            if (changes.totalFilesDownloaded) refreshFooterStats();
        });
    }

    // Surface the real manifest version in the footer so the badge doesn't
    // drift from the actual build the user is running.
    try {
        const mv = chrome.runtime.getManifest && chrome.runtime.getManifest();
        if (mv && mv.version) {
            const vEl = document.getElementById('footer-version');
            if (vEl) vEl.textContent = `v${mv.version}`;
        }
    } catch (_) { /* no-op — keep hardcoded fallback */ }

    // -----------------------------------------------------------------
    // License / Pro status
    //
    // Rendering lives in license-ui.js (loaded ahead of us by options.html) so
    // this surface and the popup can't drift apart. See CONTRACT.md §6.
    // -----------------------------------------------------------------

    loadLicenseBanner({
        banner: document.getElementById('license-banner'),
        titleEl: document.getElementById('license-title'),
        subEl: document.getElementById('license-sub'),
        actionsEl: document.getElementById('license-actions'),
    }, { activate: 'Activate license' }, 'Options');
});
