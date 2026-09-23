// Inject per-theme styles for the live preview button. Source of truth for the
// themes lives in themes.js (loaded before us); same data backs the actual
// floating button on Reddit, so the preview can't drift from reality.
(function injectThemeStyles() {
    const el = document.createElement('style');
    el.textContent = buildThemeStyles('.preview-btn');
    document.head.appendChild(el);
})();

// Custom dropdown widget — same shape as the one on the options page. Every
// native <select> is wrapped with a trigger + body-anchored listbox so the
// OS-rendered blue selection highlight never appears in the popup either.
// Keeps the popup and the settings page visually identical, and means the
// dropdown background stays grey instead of blue when opened.
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
        const margin = 8;

        // Always anchor below the trigger; cap max-height so the listbox
        // stays inside the small popup viewport.
        const spaceBelow = Math.max(120, window.innerHeight - rect.bottom - margin - 6);
        listbox.style.maxHeight = Math.min(240, spaceBelow) + 'px';

        listbox.style.minWidth = rect.width + 'px';
        listbox.style.maxWidth = Math.min(320, window.innerWidth - 12) + 'px';
        listbox.style.left = rect.left + 'px';
        listbox.style.top = (rect.bottom + 4) + 'px';

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
        requestAnimationFrame(() => listbox.classList.add('is-open'));
        wrapper.classList.add('is-open');
        document.addEventListener('click', onDocClick, true);
        document.addEventListener('keydown', onKeyDown, true);
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
        // Bound to both scroll and resize. A resize event's target is `window`,
        // which is not a Node, and Node.contains() throws on a non-Node rather
        // than returning false — so the guard has to be an instanceof check,
        // not just a truthiness test. Resize falls through to close(), which is
        // right anyway: the listbox is absolutely positioned and its placement
        // is stale the moment the window changes size.
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

    nativeSelect.addEventListener('change', syncLabel);

    nativeSelect.parentNode.insertBefore(wrapper, nativeSelect);
    wrapper.appendChild(nativeSelect);
    wrapper.appendChild(trigger);
    syncLabel();
}

const descriptions = {
    folder: "One sub-folder per gallery, images tucked inside.",
    zip: "One .zip per gallery — easy to share.",
    individual: "Images straight into your downloads folder, no wrapper."
};

function updateDescription() {
    const mode = document.getElementById('downloadMode').value;
    const helper = document.getElementById('modeDescription');
    if (helper) helper.textContent = descriptions[mode];
}

function updatePreview() {
    const theme = document.getElementById('buttonTheme').value;
    const size = document.getElementById('buttonSize').value;
    const customLabel = (document.getElementById('customButtonLabel').value || '').trim();

    const previewBtn = document.getElementById('previewBtn');
    const labelText = previewBtn.querySelector('.preview-label-text');
    const emoji = previewBtn.querySelector('.preview-emoji');

    previewBtn.setAttribute('data-theme', theme);
    previewBtn.setAttribute('data-size', size);

    if (customLabel) {
        labelText.textContent = customLabel;
        emoji.style.display = 'none';
    } else {
        labelText.textContent = 'Download Gallery';
        emoji.style.display = 'inline';
    }
}

// ---- License / Pro status --------------------------------------------------
// Rendering lives in license-ui.js (loaded ahead of us by popup.html) so this
// surface and the options page can't drift apart. See CONTRACT.md §6.

function loadLicenseStatus() {
    loadLicenseBanner({
        banner: document.getElementById('licenseBanner'),
        titleEl: document.getElementById('licenseTitle'),
        subEl: document.getElementById('licenseSub'),
        actionsEl: document.getElementById('licenseActions'),
    }, { activate: 'Activate' }, 'Popup');
}

function saveOptions() {
    const folderName = document.getElementById('folderName').value.trim() || 'reddit_downloads';
    const downloadMode = document.getElementById('downloadMode').value;
    const buttonTheme = document.getElementById('buttonTheme').value;
    const buttonPosition = document.getElementById('buttonPosition').value;
    const buttonSize = document.getElementById('buttonSize').value;
    const customButtonLabel = document.getElementById('customButtonLabel').value.trim().slice(0, 40);

    // Keep globalPrefs.activeMode in lock-step with the popup's Download Mode.
    // background.js resolves the active mode as downloadMode || globalPrefs.activeMode,
    // and the Options page restores its active tab from globalPrefs.activeMode —
    // writing both here means whichever surface the user touched last wins
    // consistently, instead of a stale popup value silently shadowing Options.
    chrome.storage.sync.get(['globalPrefs'], (cur) => {
        const globalPrefs = Object.assign({}, cur.globalPrefs, { activeMode: downloadMode });
        chrome.storage.sync.set({
            preferredFolder: folderName,
            downloadMode: downloadMode,
            globalPrefs: globalPrefs,
            buttonTheme: buttonTheme,
            buttonPosition: buttonPosition,
            buttonSize: buttonSize,
            customButtonLabel: customButtonLabel
        }, () => {
            const saveBtn = document.getElementById('saveBtn');
            // Surface storage failures (most often the 100KB chrome.storage.sync
            // quota). Without this check the popup would auto-close on a failed
            // save and the user would walk away thinking their settings stuck.
            if (chrome.runtime.lastError) {
                console.error('[Popup] storage.sync.set failed:', chrome.runtime.lastError.message);
                const status = document.getElementById('status');
                if (status) {
                    status.textContent = 'Save failed: ' + chrome.runtime.lastError.message;
                    status.classList.add('show');
                }
                return;
            }
            saveBtn.classList.add('saved');
            setTimeout(() => window.close(), 850);
        });
    });
}

function restoreOptions() {
    chrome.storage.sync.get({
        preferredFolder: 'reddit_downloads',
        downloadMode: null,
        globalPrefs: null,
        buttonTheme: 'theme-native',
        buttonPosition: 'bottom-right',
        buttonSize: 'normal',
        customButtonLabel: ''
    }, (items) => {
        document.getElementById('folderName').value = items.preferredFolder;
        document.getElementById('customButtonLabel').value = items.customButtonLabel || '';

        const safeSelect = (id, value, fallback) => {
            const el = document.getElementById(id);
            const valid = Array.from(el.options).map(opt => opt.value);
            el.value = valid.includes(value) ? value : fallback;
        };
        // Active mode can be set from either surface. Prefer the popup's own
        // downloadMode key, but fall back to globalPrefs.activeMode (written by
        // the Options page) so the dropdown reflects a mode chosen over there.
        const activeMode = items.downloadMode || (items.globalPrefs && items.globalPrefs.activeMode) || 'folder';
        safeSelect('downloadMode', activeMode, 'folder');
        safeSelect('buttonTheme', items.buttonTheme, 'theme-native');
        safeSelect('buttonPosition', items.buttonPosition, 'bottom-right');
        safeSelect('buttonSize', items.buttonSize, 'normal');

        // Programmatic .value = doesn't fire change. Fire one on each native
        // select so the custom dropdown widgets sync their visible labels.
        document.querySelectorAll('select').forEach(s => {
            s.dispatchEvent(new Event('change', { bubbles: true }));
        });

        updateDescription();
        updatePreview();
    });
}

document.getElementById('downloadMode').addEventListener('change', updateDescription);
['buttonTheme', 'buttonPosition', 'buttonSize'].forEach(id => {
    document.getElementById(id).addEventListener('change', updatePreview);
});
document.getElementById('customButtonLabel').addEventListener('input', updatePreview);

// Wrap every native <select> with the custom dropdown widget BEFORE we restore
// values, so the trigger labels paint correctly on first render.
document.addEventListener('DOMContentLoaded', () => {
    document.querySelectorAll('select').forEach(enhanceSelect);
    restoreOptions();
    loadLicenseStatus();

    // Show the real manifest version in the header sub-line (matches the
    // Options-page footer; never a hardcoded string that can drift).
    try {
        const mf = chrome.runtime.getManifest && chrome.runtime.getManifest();
        const vEl = document.getElementById('popup-version');
        if (mf && mf.version && vEl) vEl.textContent = 'v' + mf.version;
    } catch (_) { /* keep the hardcoded fallback */ }
});

document.getElementById('saveBtn').addEventListener('click', saveOptions);

document.getElementById('customizeNamingBtn').addEventListener('click', () => {
    if (chrome.runtime.openOptionsPage) {
        chrome.runtime.openOptionsPage();
    } else {
        window.open(chrome.runtime.getURL('options.html'));
    }
});
