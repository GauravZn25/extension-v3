const MAX_SAFE_LENGTH = 110;

// Base layout. The 11 theme variants live in themes.js (loaded ahead of us
// via manifest.json) so the popup's live preview pulls from the same source.
const baseStyles = `
  .reddit-gallery-dl-btn {
    position: fixed !important;
    z-index: 2147483647 !important;
    cursor: pointer !important;
    display: flex !important;
    align-items: center !important;
    gap: 8px !important;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif !important;
    transition: all 0.2s ease-in-out !important;
    font-weight: 600 !important;
  }

  .reddit-gallery-dl-btn[data-pos="bottom-right"] { bottom: 30px !important; right: 30px !important; top: auto !important; left: auto !important; }
  .reddit-gallery-dl-btn[data-pos="bottom-left"]  { bottom: 30px !important; left: 30px !important; top: auto !important; right: auto !important; }
  .reddit-gallery-dl-btn[data-pos="top-right"]    { top: 80px !important; right: 30px !important; bottom: auto !important; left: auto !important; }
  .reddit-gallery-dl-btn[data-pos="top-left"]     { top: 80px !important; left: 30px !important; bottom: auto !important; right: auto !important; }

  .reddit-gallery-dl-btn[data-size="compact"] { padding: 8px 16px !important; font-size: 13px !important; }
  .reddit-gallery-dl-btn[data-size="normal"]  { padding: 14px 28px !important; font-size: 15px !important; }
  .reddit-gallery-dl-btn[data-size="large"]   { padding: 18px 36px !important; font-size: 17px !important; }
`;

const styleSheet = document.createElement("style");
styleSheet.innerText = baseStyles + '\n' + buildThemeStyles('.reddit-gallery-dl-btn', { important: true });
document.head.appendChild(styleSheet);

const MINIMAL_LABEL_THEMES = new Set(['theme-premium', 'theme-mono', 'theme-neon']);

function escapeHtml(str) {
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

function getButtonContent(customLabel) {
    if (customLabel) return `<span>${escapeHtml(customLabel)}</span>`;
    return `<span style="font-size: 18px;">🚀</span><span>Download Gallery</span>`;
}

function getLoadingText() {
    return "Downloading...";
}

function getSuccessText(themeName, count, total) {
    const trailing = (total && total !== count) ? `${count}/${total}` : `${count}`;
    if (MINIMAL_LABEL_THEMES.has(themeName)) return `${trailing} Saved`;
    return `✅ ${trailing} Files Saved!`;
}

function getFailText(themeName) {
    if (MINIMAL_LABEL_THEMES.has(themeName)) return "No Images";
    return "❌ No Images";
}

// Milestone celebration UI. Mounted on demand by attachClickHandler when
// background.js reports the user just crossed 100 / 500 / 1k / 10k downloads.
// Lives in the host page DOM (no shadow root needed — we already inject the
// floating button at the document level) and tears itself down on dismiss
// so we don't leak listeners. All styles are inlined with !important on the
// interactive bits because Reddit's stylesheet has very aggressive button +
// pointer-events resets and we want a guaranteed-clickable Maybe-later /
// close button regardless of what the page does to global selectors.
const MILESTONE_SECONDS_PER_FILE_CONTENT = 20;
function formatMilestoneTime(files) {
    const secs = files * MILESTONE_SECONDS_PER_FILE_CONTENT;
    const mins = Math.round(secs / 60);
    if (mins < 90) return `${mins} minutes`;
    const hrs = Math.round((secs / 3600) * 10) / 10;
    if (hrs < 36) return `${hrs} hours`;
    return `${hrs} hours`;
}
function showMilestoneOverlay(milestone, totalFiles) {
    // Don't stack overlays if the user is mid-celebration.
    if (document.getElementById('reddit-dl-milestone-overlay')) return;

    const overlay = document.createElement('div');
    overlay.id = 'reddit-dl-milestone-overlay';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.style.cssText = [
        'position:fixed', 'inset:0', 'background:rgba(20,20,28,0.6)',
        'backdrop-filter:blur(4px)', '-webkit-backdrop-filter:blur(4px)',
        'z-index:2147483647', 'display:flex', 'align-items:center',
        'justify-content:center',
        'font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif',
        'animation:reddit-dl-fade 0.22s ease',
        'pointer-events:auto'
    ].join(';');

    const niceTotal = (totalFiles || milestone).toLocaleString();
    const niceMile = milestone.toLocaleString();
    const timeSaved = formatMilestoneTime(totalFiles || milestone);

    // pointer-events:auto !important + cursor:pointer !important on every
    // interactive element. Reddit's global stylesheet has been observed to
    // set `pointer-events: none` on certain button shapes which was the
    // proximate cause of "Maybe later does nothing" in the last build.
    const btnReset = 'pointer-events:auto !important;cursor:pointer !important;';
    overlay.innerHTML = `
        <style>
            @keyframes reddit-dl-fade { from { opacity: 0 } to { opacity: 1 } }
            @keyframes reddit-dl-pop {
                from { transform: translateY(10px) scale(0.96); opacity: 0; }
                to   { transform: translateY(0) scale(1); opacity: 1; }
            }
            #reddit-dl-milestone-overlay button,
            #reddit-dl-milestone-overlay a { ${btnReset} }
        </style>
        <div data-role="card" style="
            position:relative;width:min(420px,calc(100% - 32px));background:#fff;color:#1f2330;
            border-radius:18px;padding:30px 28px 22px;box-shadow:0 20px 60px rgba(0,0,0,0.35);
            text-align:center;animation:reddit-dl-pop 0.32s cubic-bezier(0.34,1.56,0.64,1);">
            <button type="button" data-role="close" aria-label="Close" style="
                position:absolute;top:10px;right:12px;background:none;border:none;font-size:22px;
                line-height:1;color:#a1a6b3;padding:4px 8px;border-radius:6px;">×</button>
            <div style="font-size:38px;line-height:1;margin-bottom:10px;">🎉</div>
            <h2 style="font-family:'Fredoka','Quicksand',sans-serif;font-size:22px;font-weight:600;
                       margin:0 0 6px;letter-spacing:-0.01em;color:#1f2330;">
                ${niceMile} downloads — thank you!
            </h2>
            <p style="margin:0 0 14px;color:#5b6273;font-size:14px;">
                That's roughly <strong style="color:#1f2330;">${timeSaved}</strong> of right-clicking,
                renaming and dragging you didn't have to do.
            </p>
            <p style="margin:0 0 18px;color:#5b6273;font-size:13px;line-height:1.55;">
                Folks used to pay <strong style="color:#1f2330;">$3 a month</strong> for inferior tools
                that did less than this one does for free. If it's been worth a fraction of that,
                a small tip goes a long way — proceeds go to
                <strong style="color:#1f2330;">children fighting cancer</strong>.
            </p>
            <a data-role="cta" href="https://ko-fi.com/gauravzn" target="_blank" rel="noopener" style="
                display:inline-flex;align-items:center;justify-content:center;gap:8px;background:#ff5e5b;
                color:#fff;padding:11px 24px;border-radius:999px;font-weight:600;font-size:14px;
                text-decoration:none;box-shadow:0 4px 14px rgba(255,94,91,0.32);">
                ☕ Tip on Ko-fi
            </a>
            <button type="button" data-role="dismiss" style="
                display:block;margin:12px auto 0;background:none;border:none;color:#a1a6b3;
                font:inherit;font-size:12.5px;padding:6px 10px;border-radius:6px;">
                Maybe later
            </button>
            <div style="margin-top:14px;font-size:11px;color:#a1a6b3;">${niceTotal} files saved with this extension</div>
        </div>
    `;

    // Mount before we wire listeners — the elements need to be in the DOM
    // for querySelector to find them. We scope every lookup to the overlay
    // itself (no document.getElementById) so a future ID collision with
    // Reddit's own DOM can't redirect a click to some unrelated element.
    document.body.appendChild(overlay);

    let cleaned = false;
    const cleanup = () => {
        if (cleaned) return; // guard against double-dismiss (button click + escape)
        cleaned = true;
        overlay.remove();
        document.removeEventListener('keydown', onKey, true);
        try {
            if (chrome && chrome.storage && chrome.storage.sync) {
                chrome.storage.sync.remove('pendingMilestone');
            }
        } catch (_) { /* extension context invalidated — nothing to do */ }
    };
    const onKey = (e) => { if (e.key === 'Escape') cleanup(); };

    // Stop click propagation on each interactive bit so Reddit's
    // document-level capture handlers (lightbox close, J/K navigation) can't
    // intercept our click before it reaches us. Capture phase + explicit
    // preventDefault on the buttons; the anchor keeps its default navigation.
    const wireClose = (el) => {
        if (!el) return;
        el.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            cleanup();
        }, true);
    };
    wireClose(overlay.querySelector('[data-role="close"]'));
    wireClose(overlay.querySelector('[data-role="dismiss"]'));

    const cta = overlay.querySelector('[data-role="cta"]');
    if (cta) {
        cta.addEventListener('click', (e) => {
            e.stopPropagation(); // keep default — the anchor opens Ko-fi
            setTimeout(cleanup, 50);
        }, true);
    }

    overlay.addEventListener('click', (e) => {
        if (e.target === overlay) cleanup();
    });
    document.addEventListener('keydown', onKey, true);
}

// Custom-title dialog, standing in for window.prompt(). Chrome's native prompt
// box trims leading/trailing whitespace from anything pasted into it
// (TextfieldModel::Paste in Chromium), so pasting " by Some Photographer" onto
// the end of the default title lost its space and saved "Some Subjectby Some
// Photographer" (Joe's report). A page <input> pastes exactly what's on the
// clipboard.
//
// <dialog>.showModal() puts it in the browser's top layer — above Reddit's
// lightbox whatever its z-index — makes the page behind it inert the way the
// native prompt did, and fires 'cancel' on Esc. Styles are inline !important
// for the same reason as the milestone overlay: Reddit's global resets.
// Resolves to the entered text, or null when cancelled — window.prompt's
// contract, so callers treat it the same.
let titlePromptOpen = false;
function showTitlePrompt(message, defaultValue) {
    if (typeof HTMLDialogElement === 'undefined' || typeof HTMLDialogElement.prototype.showModal !== 'function') {
        return Promise.resolve(window.prompt(message, defaultValue));
    }
    return new Promise((resolve) => {
        // Single-quoted family names: these strings land inside style="…"
        // attributes, where a double quote would end the attribute early.
        const font = "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";
        const btn = `display:inline-block !important;pointer-events:auto !important;cursor:pointer !important;` +
            `font:600 14px/1 ${font} !important;padding:10px 20px !important;border-radius:999px !important;margin:0 !important;`;

        const dialog = document.createElement('dialog');
        dialog.id = 'reddit-dl-title-prompt';
        dialog.setAttribute('aria-labelledby', 'reddit-dl-title-prompt-heading');
        dialog.style.cssText = [
            'position:fixed !important', 'inset:0 !important', 'margin:auto !important',
            'display:block !important', 'box-sizing:border-box !important',
            'width:min(480px,calc(100% - 32px)) !important', 'max-width:none !important',
            'height:fit-content !important', 'padding:24px 24px 20px !important',
            'border:none !important', 'border-radius:18px !important',
            'background:#fff !important', 'color:#1f2330 !important',
            'box-shadow:0 20px 60px rgba(0,0,0,0.35) !important',
            `font-family:${font} !important`, 'text-align:left !important'
        ].join(';');
        dialog.innerHTML = `
            <style>
                #reddit-dl-title-prompt::backdrop { background: rgba(20,20,28,0.6); backdrop-filter: blur(4px); }
                #reddit-dl-title-prompt input:focus {
                    outline: none !important; border-color: #FF4500 !important;
                    box-shadow: 0 0 0 3px rgba(255,69,0,0.18) !important;
                }
            </style>
            <h2 id="reddit-dl-title-prompt-heading" style="display:block !important;margin:0 0 8px !important;font:600 18px/1.3 ${font} !important;color:#1f2330 !important;">
                Gallery title
            </h2>
            <p data-role="message" style="display:block !important;margin:0 0 14px !important;font:400 13px/1.5 ${font} !important;color:#5b6273 !important;white-space:pre-wrap !important;overflow-wrap:anywhere !important;"></p>
            <input type="text" data-role="input" autocomplete="off" spellcheck="false" style="
                display:block !important;width:100% !important;box-sizing:border-box !important;margin:0 !important;
                padding:10px 12px !important;border:1.5px solid #d6d9e0 !important;border-radius:10px !important;
                background:#fff !important;color:#1f2330 !important;font:400 15px/1.4 ${font} !important;">
            <div style="display:flex !important;justify-content:flex-end !important;gap:10px !important;margin-top:18px !important;">
                <button type="button" data-role="cancel" style="${btn}background:transparent !important;color:#5b6273 !important;border:1px solid #d6d9e0 !important;">Cancel</button>
                <button type="button" data-role="ok" style="${btn}background:linear-gradient(135deg,#FF4500 0%,#FF8C00 100%) !important;color:#fff !important;border:none !important;">Download</button>
            </div>
        `;
        // Text goes in via textContent / value, never innerHTML — titles are
        // user content.
        dialog.querySelector('[data-role="message"]').textContent = message;
        const input = dialog.querySelector('[data-role="input"]');
        input.value = defaultValue;

        let done = false;
        const finish = (value) => {
            if (done) return;
            done = true;
            titlePromptOpen = false;
            try { dialog.close(); } catch (_) { /* already closed */ }
            dialog.remove();
            resolve(value);
        };

        // Title typing must never reach Reddit's own hotkeys (J/K, /, …).
        ['keydown', 'keyup', 'keypress'].forEach((type) => {
            dialog.addEventListener(type, (e) => e.stopPropagation());
        });
        input.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && !e.isComposing) {
                e.preventDefault();
                finish(input.value);
            }
        });
        dialog.addEventListener('cancel', (e) => { // Esc
            e.preventDefault();
            finish(null);
        });
        const wireButton = (role, getValue) => {
            dialog.querySelector(`[data-role="${role}"]`).addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                finish(getValue());
            });
        };
        wireButton('ok', () => input.value);
        wireButton('cancel', () => null);

        document.body.appendChild(dialog);
        try {
            dialog.showModal();
        } catch (e) {
            console.warn('[RedditDL] title dialog could not open, using the browser prompt:', e);
            dialog.remove();
            resolve(window.prompt(message, defaultValue));
            return;
        }
        titlePromptOpen = true;
        input.focus();
        input.select(); // like the native prompt: Enter keeps it, typing replaces it
    });
}

let cachedSettings = null;

// The <shreddit-post> the user most recently clicked inside (e.g. the post
// whose image they opened in the lightbox). findActivePostElement falls back
// to this when Reddit's lightbox leaves us with neither a dialog-hosted post
// nor a /comments/<id>/ URL to match on — the state behind Joe's r/FoodPorn
// reports, where a feed image-click on a post with non-English-character
// titles resolved to the wrong (topmost) post. Set by a capture-phase click
// listener registered near the bottom of this file.
let lastClickedPost = null;

// Defensive wrapper around chrome.storage.sync.get. The raw API is normally
// available in content scripts when the extension declares "storage" in
// permissions, but in some real-world states it isn't:
//
//   - Enterprise policy disables sync at the profile level.
//   - The tab is a sandboxed iframe / extension iframe with reduced APIs.
//   - Transient extension-context invalidation between an update and the
//     next runtime tick (the content script is still running with a stale
//     handle to chrome.* but storage.sync has been torn down).
//
// In any of those, chrome.storage.sync is undefined and `.get()` throws
// "Cannot read properties of undefined (reading 'get')" — which kills the
// caller and leaves the floating button never mounted. Falling through with
// empty data lets the rest of the script keep working with default
// appearance and no saved formulas, which is a strictly better failure mode.
function safeStorageGet(keys, callback) {
    if (!chrome || !chrome.storage || !chrome.storage.sync) {
        console.warn('[RedditDL] chrome.storage.sync unavailable; falling back to defaults.');
        callback({});
        return;
    }
    try {
        chrome.storage.sync.get(keys, (data) => {
            if (chrome.runtime && chrome.runtime.lastError) {
                console.warn('[RedditDL] chrome.storage.sync.get lastError:', chrome.runtime.lastError.message);
                callback({});
                return;
            }
            callback(data || {});
        });
    } catch (e) {
        console.warn('[RedditDL] chrome.storage.sync.get threw:', e);
        callback({});
    }
}

function loadSettings(callback) {
    safeStorageGet(['buttonTheme', 'buttonPosition', 'buttonSize', 'customButtonLabel', 'keyboardShortcutEnabled', 'globalPrefs', 'modeState'], (s) => {
        cachedSettings = {
            theme: s.buttonTheme || 'theme-native',
            position: s.buttonPosition || 'bottom-right',
            size: s.buttonSize || 'normal',
            customLabel: (s.customButtonLabel || '').trim().slice(0, 40),
            keyboardShortcutEnabled: s.keyboardShortcutEnabled !== false,
            globalPrefs: s.globalPrefs || {},
            modeState: s.modeState || {}
        };
        callback(cachedSettings);
    });
}

function applyButtonAppearance(btn, settings) {
    btn.className = 'reddit-gallery-dl-btn';
    btn.setAttribute('data-theme', settings.theme);
    btn.setAttribute('data-pos', settings.position);
    btn.setAttribute('data-size', settings.size);
    // Don't trample the loading/done text if a download is currently running.
    // The click handler resets the label itself when the cycle finishes.
    if (btn.dataset.busy !== 'true') {
        btn.innerHTML = getButtonContent(settings.customLabel);
    }
}

function isPostPage() {
    // Real post pages always carry /comments/ or /gallery/ in the path —
    // those are unambiguous, button shows immediately even before the
    // shreddit-post element has finished mounting.
    if (window.location.pathname.includes('/comments/')) return true;
    if (window.location.pathname.includes('/gallery/')) return true;
    // #lightbox in the URL means a modal is open over a feed page, but
    // it doesn't tell us *which* post is in the modal. Only claim this
    // is a post page if findActivePostElement actually identifies one —
    // otherwise the button would be clickable in a state where Download
    // can't tell which post to grab, and would deterministically pull
    // the topmost feed entry (the original failure mode).
    if (window.location.href.includes('#lightbox')) {
        return !!findActivePostElement();
    }
    return false;
}

function manageFloatingButton() {
    let btn = document.getElementById('reddit-custom-dl-btn');

    if (!isPostPage()) {
        if (btn) btn.remove();
        return;
    }
    if (btn) {
        // The lightbox gets appended to body AFTER us. Same max z-index, DOM-order
        // wins the tiebreaker, so our button ends up hidden underneath. Bumping it
        // back to the end keeps it on top.
        if (document.body.lastElementChild !== btn) {
            document.body.appendChild(btn);
        }
        return;
    }

    loadSettings((settings) => {
        // The page might have navigated away while storage.get was in flight.
        if (!isPostPage()) return;
        if (document.getElementById('reddit-custom-dl-btn')) return;

        const newBtn = document.createElement("button");
        newBtn.id = "reddit-custom-dl-btn";
        applyButtonAppearance(newBtn, settings);
        document.body.appendChild(newBtn);
        attachClickHandler(newBtn);
    });
}

// Returns the <shreddit-post> element that the user is *actually* looking
// at right now. This is harder than it sounds because Reddit's feed +
// lightbox combo can put the page in any of three states:
//
//   1. Real post page — URL is /r/foo/comments/abc/.../, one shreddit-post
//      in the DOM, easy.
//   2. Subreddit feed — URL is /r/foo/, many shreddit-post in the DOM, no
//      "active" post until you click one.
//   3. Lightbox over the feed — feed posts are still in the DOM, AND a
//      separate post element is rendered inside an open dialog. The URL
//      sometimes pushes to /comments/abc/... and sometimes just appends
//      #lightbox to the feed URL — the latter is the case that broke us.
//
// Strategy: prefer a shreddit-post inside an open dialog (state 3). Then
// match by permalink against the URL (state 1). Only fall back to "first
// shreddit-post in DOM" if we're confidently on a post page; on a bare
// feed URL, returning the first feed post is wrong — that's the topmost
// feed entry, not the post the user actually opened. (Joe's bug.)
function findActivePostElement() {
    // Open dialog selectors covering Reddit's various lightbox host
    // elements over time. Order matters — the most specific markers
    // ("open" attribute, aria-modal) come first so we don't pick up
    // long-lived async loaders that aren't currently presenting a post.
    const modalSelectors = [
        'faceplate-dialog[open]',
        'dialog[open]',
        '[aria-modal="true"]',
        '[role="dialog"]',
        'shreddit-async-loader[bundlename*="lightbox" i]',
        'shreddit-async-loader[bundlename*="post" i]',
        'faceplate-dialog'
    ];
    for (const sel of modalSelectors) {
        const containers = document.querySelectorAll(sel);
        for (const container of containers) {
            const dialogPost = container.querySelector('shreddit-post[permalink]');
            if (dialogPost) return dialogPost;
        }
    }

    // No lightbox host — match by permalink against the current URL.
    const cleanCurrent = window.location.pathname.replace(/\/$/, '');
    const allPosts = document.querySelectorAll('shreddit-post');

    // Strongest signal first: the Reddit post ID. /r/<sub>/comments/<id>/<slug>/
    // — the id is 5-7 ASCII chars and uniquely identifies the post regardless
    // of how the slug is encoded. Comparing whole paths with `startsWith`
    // failed for non-English titles (Joe's r/FoodPorn report — "Cà Phê Muối"
    // came through as `c%C3%A0_ph%C3%AA_mu%E1%BB%91i` in window.location while
    // the shreddit-post `permalink` attribute was Unicode-normalised
    // `cà_phê_muối`), so the path-equality fell through and we returned
    // the topmost feed entry. Matching by id sidesteps the entire
    // encoding question.
    const idFromPath = (p) => {
        const m = (p || '').match(/\/comments\/([a-z0-9]+)/i);
        return m ? m[1].toLowerCase() : null;
    };
    const currentPostId = idFromPath(cleanCurrent);
    if (currentPostId) {
        for (const post of allPosts) {
            if (idFromPath(post.getAttribute('permalink')) === currentPostId) {
                return post;
            }
        }
    }

    // No post id in URL — keep the original path-prefix match for the rare
    // routes that don't carry /comments/<id>/ (older /gallery/<id>/ shapes
    // and the like). Decode both sides so percent-encoded Unicode doesn't
    // throw the comparison off here either.
    const safeDecode = (s) => { try { return decodeURIComponent(s); } catch (_) { return s; } };
    const decodedCurrent = safeDecode(cleanCurrent);
    for (const post of allPosts) {
        const permalink = post.getAttribute('permalink');
        if (!permalink) continue;
        const cleanPerma = permalink.replace(/\/$/, '');
        const decodedPerma = safeDecode(cleanPerma);
        if (decodedCurrent === decodedPerma || decodedCurrent.startsWith(decodedPerma + '/')) {
            return post;
        }
    }

    // The post the user most recently interacted with (clicked an image on,
    // opening the lightbox). Strongest remaining signal when the lightbox
    // hosts no shreddit-post of its own AND Reddit didn't push the post's
    // permalink to the URL — exactly Joe's r/FoodPorn case, where the feed
    // URL and the non-English-character permalink both fail the matches
    // above. Verify it's still attached so we never resolve a stale element.
    if (lastClickedPost && lastClickedPost.isConnected) {
        return lastClickedPost;
    }

    // Last-resort fallback. Only safe if the URL identifies a post
    // (contains /comments/) — on a bare /r/foo/ feed URL, "first
    // shreddit-post in DOM" is the topmost feed entry, deterministically
    // wrong on every click. Returning null here lets getRawTitle fall
    // through to document.title and the click handler skip the URL
    // override, which is the correct behavior when we genuinely can't
    // identify an active post.
    if (cleanCurrent.includes('/comments/') && allPosts.length >= 1) {
        return allPosts[0];
    }
    return null;
}

// Reads the title from a shreddit-post element if present, otherwise falls
// back to document.title / <h1> (with the boilerplate filter from the
// earlier fix). Pulled out so the click handler can call findActivePostElement
// once and pass the result to both getRawTitleFromPost and the URL builder
// — keeps title and URL in lock-step instead of diverging when the URL is
// ambiguous.
function getRawTitleFromPost(activePost) {
    if (activePost && activePost.getAttribute('post-title')) {
        return activePost.getAttribute('post-title').trim();
    }
    let candidate = '';
    if (document.title) {
        candidate = document.title.split(' : ')[0].split(' | ')[0];
    } else {
        const standardH1 = document.querySelector('h1');
        if (standardH1) candidate = standardH1.innerText;
    }
    candidate = candidate.trim();
    if (!candidate) return '';
    // Strip Reddit's own boilerplate document.title (shown when there's no
    // real post title) WITHOUT eating legitimate post titles that merely start
    // with the word "Reddit" — e.g. "Reddit - my story", "Reddit: a
    // retrospective", or a post literally titled "Reddit". Match only the
    // exact known boilerplate strings, never "reddit - <anything>".
    if (/^reddit(\.com)?\s*$/i.test(candidate)) return '';
    if (/^reddit\s*[-–—:|]\s*(dive into anything|the heart of the internet|the front page of the internet)\s*$/i.test(candidate)) return '';
    return candidate;
}

// Backward-compat shim for any code path that still calls getRawTitle()
// without the active post in hand.
function getRawTitle() {
    return getRawTitleFromPost(findActivePostElement());
}

// Builds a timestamp string used only as the *default value* in the title prompt
// when the post has no real title. Honors the user's Date Format / Date Separator
// / Time Format / Pill Separator settings so it matches everything else they
// see in the live preview. Doesn't get sent to background as a title — empty
// string still goes through, which is what triggers the missing-title rule.
function buildFallbackTitle(prefs) {
    const sep = ((v) => v === 'dash' ? '-' : v === 'space' ? ' ' : v === 'none' ? '' : '_')(
        prefs.fileSeparatorFormat || prefs.separatorFormat || 'space'
    );
    const dateSep = ((v) => v === 'underscore' ? '_' : v === 'space' ? ' ' : v === 'dot' ? '.' : v === 'none' ? '' : '-')(
        prefs.dateSeparatorFormat || 'dash'
    );
    const dateFormat = prefs.dateFormat || 'yyyy-mm-dd';
    const timeFormat = prefs.timeFormat || '24h';

    const now = new Date();
    const dd = String(now.getDate()).padStart(2, '0');
    const mm = String(now.getMonth() + 1).padStart(2, '0');
    const yyyy = now.getFullYear();
    const yy = yyyy.toString().slice(-2);

    let dateStr;
    if (dateFormat === 'dd-mm-yyyy' || dateFormat === 'uk') dateStr = `${dd}${dateSep}${mm}${dateSep}${yyyy}`;
    else if (dateFormat === 'dd-mm-yy')                     dateStr = `${dd}${dateSep}${mm}${dateSep}${yy}`;
    else if (dateFormat === 'mm-dd-yyyy' || dateFormat === 'us') dateStr = `${mm}${dateSep}${dd}${dateSep}${yyyy}`;
    else if (dateFormat === 'mm-dd-yy')                     dateStr = `${mm}${dateSep}${dd}${dateSep}${yy}`;
    else                                                    dateStr = `${yyyy}${dateSep}${mm}${dateSep}${dd}`;

    let hh = now.getHours();
    const mn = String(now.getMinutes()).padStart(2, '0');
    const ss = String(now.getSeconds()).padStart(2, '0');
    let timeStr;
    // Mirror background.js's formatTimeFromDate exactly — both 24h and 12h
    // include seconds. Without this, the prompt's placeholder shows HH:MM
    // while the saved file's time/dl_date pills show HH:MM:SS, and the user
    // sees a mismatch the moment they hit Enter.
    if (timeFormat === '12h') {
        const ampm = hh >= 12 ? 'PM' : 'AM';
        hh = hh % 12 || 12;
        timeStr = `${String(hh).padStart(2, '0')}${sep}${mn}${sep}${ss}${sep}${ampm}`;
    } else {
        timeStr = `${String(hh).padStart(2, '0')}${sep}${mn}${sep}${ss}`;
    }

    return `Untitled${sep}${dateStr}${sep}${timeStr}`;
}

// Bumped whenever the content-script ↔ background message shape changes.
// Chrome keeps running a cached background service worker until the
// extension itself is reloaded on chrome://extensions, so a fresh content.js
// can end up talking to a stale background.js that ignores the page-image
// fallback. background.js echoes this number back; a mismatch gets one clear
// console line instead of a mystery "No Images".
const MESSAGE_PROTOCOL = 2;

// Reddit shut off unauthenticated .json access in mid-2026. background.js
// used to fetch the .json itself, but a service-worker fetch carries none of
// the user's reddit.com cookies, so it was always refused (403). Fetching from
// the Reddit tab is same-origin and carries the session — but in practice
// Reddit refuses many logged-in tabs too, so treat .json as a bonus: the
// page-reading path below (collectDomMedia / fetchPostPageMedia) is the main
// route. Resolves to { post, status } — post is json[0].data.children[0].data
// or null, status is 'ok' or a short failure code for the logs.
async function fetchPostJson(postUrl) {
    let jsonUrl;
    try {
        // Always hit the tab's own origin so the request stays same-origin
        // (and keeps the session cookies) whatever host the permalink names.
        const path = new URL(postUrl, window.location.origin).pathname.replace(/\/$/, '');
        jsonUrl = window.location.origin + path + '.json';
    } catch (_) {
        return { post: null, status: 'bad_url' };
    }
    let res;
    try {
        res = await fetch(jsonUrl, { credentials: 'include', headers: { 'Accept': 'application/json' } });
    } catch (e) {
        console.warn('[RedditDL] post .json fetch threw:', e);
        return { post: null, status: 'fetch_threw' };
    }
    if (!res.ok) {
        // 401/403 is the normal answer now — log, don't warn, so it doesn't
        // land on chrome://extensions › Errors looking like the failure.
        console.log(`[RedditDL] post .json returned ${res.status} — reading images from the page instead.`);
        return { post: null, status: `http_${res.status}` };
    }
    let json;
    try {
        json = await res.json();
    } catch (e) {
        console.warn('[RedditDL] post .json body was not JSON (login wall / challenge page?):', e);
        return { post: null, status: 'json_parse_failed' };
    }
    const post = json && json[0] && json[0].data && json[0].data.children
        && json[0].data.children[0] && json[0].data.children[0].data;
    if (!post) return { post: null, status: 'unexpected_json_shape' };
    return { post, status: 'ok' };
}

// Main route now that Reddit refuses most .json requests: read the image URLs
// straight out of the <shreddit-post>. Gallery and image <img> tags point at
// resized preview.redd.it copies named …/<slug>-v0-<mediaId>.<ext>?width=…;
// the full-resolution original lives at i.redd.it/<mediaId>.<ext>, so we
// rewrite to that and keep the largest preview as a fallback in case the
// original 404s (background.js checks). Video / text / link posts are
// skipped — their only images are thumbnails, and the .json path reports
// "No Images" for those too.
const DOM_SKIP_POST_TYPES = new Set(['video', 'text', 'self', 'link', 'poll']);
const IMAGE_URL_RE = /\.(jpeg|jpg|png|gif|webp)(\?|$)/i;
// i.redd.it/<id>.<ext> only — excludes /snoovatar/… avatars and
// /award_images/… icons that share the host.
const I_REDD_IT_MEDIA_PATH_RE = /^\/[a-z0-9]+\.(jpeg|jpg|png|gif|webp)$/i;

function toOriginalMediaUrl(raw) {
    if (!raw) return null;
    let u;
    try { u = new URL(raw, window.location.href); } catch (_) { return null; }
    const host = u.hostname.toLowerCase();
    if (host === 'i.redd.it') {
        return I_REDD_IT_MEDIA_PATH_RE.test(u.pathname) ? `https://i.redd.it${u.pathname}` : null;
    }
    if (host === 'preview.redd.it') {
        // The media id is whatever follows the last hyphen (the whole name
        // when there's no slug), extension included.
        const file = u.pathname.split('/').pop() || '';
        const tail = file.slice(file.lastIndexOf('-') + 1);
        return /^[a-z0-9]+\.(jpeg|jpg|png|gif|webp)$/i.test(tail) ? `https://i.redd.it/${tail}` : null;
    }
    return null;
}

// Largest candidate from a srcset ("url 640w, url 1080w, …"). Falls back to
// the first entry when descriptors are missing.
function largestSrcsetUrl(srcset) {
    if (!srcset) return null;
    let best = null;
    let bestW = -1;
    for (const part of srcset.split(',')) {
        const [url, desc] = part.trim().split(/\s+/);
        if (!url) continue;
        const w = parseInt(desc, 10) || 0;
        if (w > bestW) { best = url; bestW = w; }
    }
    return best;
}

function readDomPostMeta(post) {
    const permalink = post.getAttribute('permalink') || window.location.pathname;
    const id = (post.getAttribute('id') || '').replace(/^t3_/, '')
        || ((permalink.match(/\/comments\/([a-z0-9]+)/i) || [])[1] || '');
    const subreddit = post.getAttribute('subreddit-name')
        || (post.getAttribute('subreddit-prefixed-name') || '').replace(/^r\//i, '')
        || ((permalink.match(/\/r\/([^/]+)/i) || [])[1] || '');
    const created = Date.parse(post.getAttribute('created-timestamp') || '');
    return {
        id,
        subreddit,
        author: post.getAttribute('author') || '',
        created_utc: isNaN(created) ? null : created / 1000,
        permalink
    };
}

// Every <img> under root, including ones parked in <template>s until a
// carousel reaches them.
function imgsIn(root) {
    const imgs = [...root.querySelectorAll('img')];
    root.querySelectorAll('template').forEach((tpl) => {
        if (tpl.content) imgs.push(...tpl.content.querySelectorAll('img'));
    });
    return imgs;
}

// { url: i.redd.it original, fallbackUrl: largest preview } for one <img>, or
// null when it isn't post media (avatars, icons, other hosts). Slides not yet
// shown carry their URL in data-lazy-src / data-lazy-srcset instead of src.
function readImgMedia(img) {
    const preview = largestSrcsetUrl(img.getAttribute('srcset'))
        || largestSrcsetUrl(img.getAttribute('data-lazy-srcset'))
        || img.getAttribute('src')
        || img.getAttribute('data-lazy-src')
        || img.getAttribute('data-src');
    const original = toOriginalMediaUrl(img.getAttribute('src'))
        || toOriginalMediaUrl(img.getAttribute('data-lazy-src'))
        || toOriginalMediaUrl(img.getAttribute('data-src'))
        || toOriginalMediaUrl(preview);
    if (!original) return null;
    let fallbackUrl = null;
    try { fallbackUrl = new URL(preview, window.location.href).href; } catch (_) { /* keep null */ }
    return { url: original, fallbackUrl: fallbackUrl !== original ? fallbackUrl : null };
}

// Resolves to { supported, postType, items: [{ url, fallbackUrl }],
// slideCount, missingSlides, meta }, or null when there's no post element to
// read (e.g. old.reddit.com).
function collectDomMedia(post) {
    if (!post) return null;
    const postType = (post.getAttribute('post-type') || '').toLowerCase();
    const supported = !DOM_SKIP_POST_TYPES.has(postType);
    const items = [];
    const seen = new Set();
    const add = (url, fallbackUrl) => {
        if (!url || seen.has(url)) return;
        seen.add(url);
        items.push({ url, fallbackUrl: fallbackUrl || null });
    };

    // Single-image posts carry the media URL directly. Mirrors the .json
    // path's single-image rule, which applies to any non-video post.
    const contentHref = post.getAttribute('content-href');
    if (postType !== 'video' && contentHref && IMAGE_URL_RE.test(contentHref)) {
        add(toOriginalMediaUrl(contentHref) || contentHref, null);
    }

    let slideCount = 0;
    let missingSlides = 0;
    if (supported) {
        // Galleries: <shreddit-async-loader bundlename="gallery_carousel">
        // → <gallery-carousel> → <ul><li> per slide. Reading slide by slide
        // keeps gallery order and ignores every other image in the post.
        const slides = [...post.querySelectorAll('gallery-carousel li')];
        slideCount = slides.length;
        for (const li of slides) {
            const media = imgsIn(li).map(readImgMedia).find(Boolean);
            if (media) add(media.url, media.fallbackUrl);
            else missingSlides++;
        }
        // Single images (<shreddit-media-lightbox-listener> → <img>) and
        // anything unrecognised: every post <img>, in document order. The
        // blurred backdrop reuses the main image and dedupes away.
        if (items.length === 0) {
            for (const img of imgsIn(post)) {
                const media = readImgMedia(img);
                if (media) add(media.url, media.fallbackUrl);
            }
        }
    }

    return { supported, postType, items, slideCount, missingSlides, meta: readDomPostMeta(post) };
}

// Backup for when the live post comes up short (a feed/lightbox post whose
// carousel hasn't rendered every slide, or no <shreddit-post> found at all):
// fetch the post's own page same-origin and read the server-rendered markup.
// Only for /comments/<id> URLs, and only a <shreddit-post> with that exact id
// is accepted — never "the first post on the page".
async function fetchPostPageMedia(postUrl) {
    let path;
    try {
        path = new URL(postUrl, window.location.origin).pathname.replace(/\/?$/, '/');
    } catch (_) {
        return { media: null, status: 'bad_url' };
    }
    const wantId = ((path.match(/\/comments\/([a-z0-9]+)/i) || [])[1] || '').toLowerCase();
    if (!wantId) return { media: null, status: 'no_post_id' };
    let html;
    try {
        const res = await fetch(window.location.origin + path, { credentials: 'include', headers: { 'Accept': 'text/html' } });
        if (!res.ok) return { media: null, status: `http_${res.status}` };
        html = await res.text();
    } catch (e) {
        return { media: null, status: 'fetch_threw' };
    }
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const post = [...doc.querySelectorAll('shreddit-post')].find((p) => {
        const id = (p.getAttribute('id') || '').replace(/^t3_/i, '').toLowerCase();
        const permaId = ((p.getAttribute('permalink') || '').match(/\/comments\/([a-z0-9]+)/i) || [])[1] || '';
        return id === wantId || permaId.toLowerCase() === wantId;
    });
    if (!post) return { media: null, status: 'post_not_in_html' };
    return { media: collectDomMedia(post), status: 'ok' };
}

// String-only snapshot of a post for the "no images" log line.
// chrome://extensions › Errors flattens objects to "[object Object]", so this
// is what makes a screenshot of that page diagnosable.
function describePostForLog(post) {
    if (!post) return 'no <shreddit-post> found for this page';
    const imgs = imgsIn(post);
    return JSON.stringify({
        id: post.getAttribute('id'),
        postType: post.getAttribute('post-type'),
        contentHref: post.getAttribute('content-href'),
        hasGalleryCarousel: !!post.querySelector('gallery-carousel'),
        slides: post.querySelectorAll('gallery-carousel li').length,
        imgCount: imgs.length,
        imgSrcs: imgs.slice(0, 5).map((i) => (i.getAttribute('src') || i.getAttribute('data-lazy-src') || '').slice(0, 120))
    });
}

function attachClickHandler(btn) {
    btn.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        // The title dialog is modal but, unlike window.prompt, doesn't freeze
        // script — don't stack a second one (e.g. a programmatic click).
        if (titlePromptOpen) return;

        // Find the active post ONCE and use it for both title and URL —
        // they used to be derived independently (title from DOM, URL from
        // window.location.href) and could disagree when Reddit's lightbox
        // didn't push state to the post's permalink. With both rooted in
        // the same element, you can't end up downloading post A's images
        // while showing post B's title in the prompt.
        const activePost = findActivePostElement();
        const rawTitle = getRawTitleFromPost(activePost);

        // Prefer the active post's permalink as the URL we send to
        // background — that's what guarantees the .json fetch hits the
        // right post, even when Reddit's lightbox left window.location at
        // the bare subreddit URL. Only fall back to window.location.href
        // when no active post could be identified (regular post pages
        // with no lightbox involvement land here too — and that's fine,
        // because in that case window.location.href IS the post URL).
        let currentUrl;
        if (activePost && activePost.getAttribute('permalink')) {
            const perma = activePost.getAttribute('permalink').replace(/\/$/, '');
            currentUrl = window.location.origin + perma;
        } else {
            currentUrl = window.location.href.split('?')[0].split('#')[0].replace(/\/$/, "");
        }

        // Diagnostic breadcrumb — when a user reports "No Images" or "wrong
        // title", these lines are the first thing we want in the console:
        // which post was identified, what URL we're sending, and what the
        // raw page state looks like. `usedActivePost` tells us whether the
        // permalink-from-DOM path won or we fell back to window.location.
        console.log('[RedditDL] click', {
            url: currentUrl,
            rawTitleDetected: rawTitle,
            usedActivePost: !!(activePost && activePost.getAttribute('permalink')),
            activePostPermalink: activePost ? activePost.getAttribute('permalink') : null,
            href: window.location.href
        });

        const executeDownload = async (finalTitle) => {
            // Mark the button busy so applyButtonAppearance won't overwrite the
            // loading/done message if the user saves popup settings mid-fetch.
            btn.dataset.busy = 'true';
            btn.innerHTML = getLoadingText();

            // Post data is gathered here, in the Reddit tab, rather than in
            // background.js — see fetchPostJson for why. The DOM read is
            // cheap and always sent, so background can fall back to it when
            // the .json is refused or yields no images.
            const { post, status: jsonStatus } = await fetchPostJson(currentUrl);
            let domMedia = null;
            let pageStatus = null;
            try {
                domMedia = collectDomMedia(activePost);
                const liveShort = !domMedia
                    || (domMedia.supported && (domMedia.items.length === 0 || domMedia.missingSlides > 0));
                if (!post && liveShort) {
                    const page = await fetchPostPageMedia(currentUrl);
                    pageStatus = page.status;
                    if (page.media && page.media.items.length > (domMedia ? domMedia.items.length : 0)) {
                        domMedia = page.media;
                    }
                }
            } catch (e) {
                // Never let a DOM surprise strand the button on "Downloading…".
                console.warn('[RedditDL] reading images from the page failed:', e);
            }
            if (!post && !(domMedia && domMedia.items.length)) {
                console.warn(`[RedditDL] no images found on the page — .json: ${jsonStatus}, ` +
                    `post page: ${pageStatus}, live post: ${describePostForLog(activePost)}`);
            }

            console.log('[RedditDL] sending fetchAndDownload to background', {
                url: currentUrl,
                finalTitle,
                jsonStatus,
                pageStatus,
                domPostType: domMedia ? domMedia.postType : null,
                domImageCount: domMedia ? domMedia.items.length : null
            });
            const sendStart = Date.now();
            chrome.runtime.sendMessage({
                action: "fetchAndDownload",
                protocol: MESSAGE_PROTOCOL,
                url: currentUrl,
                title: finalTitle,
                post,
                jsonStatus,
                domMedia
            }, (response) => {
                const elapsed = Date.now() - sendStart;
                // chrome.runtime.lastError fires here when the background
                // service worker died before responding, the message channel
                // closed, etc. — a separate failure mode from "we ran but
                // found 0 images". Keep them distinguishable in the console.
                if (chrome.runtime.lastError) {
                    console.error('[RedditDL] sendMessage failed after', elapsed, 'ms:', chrome.runtime.lastError.message);
                }
                if (response && response.protocol !== MESSAGE_PROTOCOL) {
                    console.error('[RedditDL] The extension\'s background script is an older version than this page ' +
                        'script, so it ignores the images read from the page. Open chrome://extensions, click the ' +
                        'reload icon on "Reddit Picture Gallery Downloader", then refresh this tab.');
                }
                const themeNow = btn.getAttribute('data-theme') || 'theme-native';
                if (response && response.success) {
                    console.log('[RedditDL] download cycle ok', { elapsedMs: elapsed, count: response.count, total: response.total });
                    btn.innerHTML = getSuccessText(themeNow, response.count, response.total);
                    // Celebrate round-number milestones (100, 1k, 5k, 10k)
                    // right on the Reddit page so the user sees it the moment
                    // it happens, not the next time they open Options. The
                    // overlay is self-contained (own DOM + styles below).
                    if (response.milestone) {
                        showMilestoneOverlay(response.milestone, response.totalFiles || response.milestone);
                    }
                } else {
                    console.warn('[RedditDL] download cycle reported NO IMAGES / failure ' +
                        JSON.stringify({ elapsedMs: elapsed, response }));
                    btn.innerHTML = getFailText(themeNow);
                }
                setTimeout(() => {
                    delete btn.dataset.busy;
                    // Pull the freshest label/theme in case the user changed them while we were fetching.
                    if (cachedSettings) applyButtonAppearance(btn, cachedSettings);
                    else btn.innerHTML = getButtonContent('');
                }, 3000);
            });
        };

        // Same defensive path as loadSettings — chrome.storage.sync can be
        // undefined in restricted Chrome states. Default to {} and proceed
        // with built-in defaults rather than crash mid-click.
        safeStorageGet(['globalPrefs', 'modeState', 'downloadMode'], (data) => {
            const prefs = data.globalPrefs || {};
            const modeState = data.modeState || {};
            const activeMode = data.downloadMode || prefs.activeMode || 'folder';

            // Format prefs live per-mode (modeState[mode].formatPrefs), NOT in
            // globalPrefs. The title-less fallback timestamp must read from the
            // active mode's formatPrefs so the prompt default matches the
            // separators / date / time the saved file will actually use.
            const formatPrefs = (modeState[activeMode] && modeState[activeMode].formatPrefs) || {};

            const isPromptEnabled = prefs.promptCustomTitle || false;

            const truncateRule = modeState[activeMode]?.fallbacks?.truncate || 'auto';

            let formattedCleanTitle = rawTitle.replace(/[\\/:*?"<>|]/g, "").trim();
            const isTooLong = formattedCleanTitle.length > MAX_SAFE_LENGTH;

            // The prompt needs *something* in its default field. If the post had
            // a real title, use it (truncated). Otherwise fall back to a timestamp
            // built from the user's date/time format settings. Either way,
            // formattedCleanTitle (the value we'll actually send to background)
            // stays empty when the post has no title, so the missing-title rule
            // still fires there.
            const promptDefault = formattedCleanTitle
                ? formattedCleanTitle.substring(0, MAX_SAFE_LENGTH)
                : buildFallbackTitle(formatPrefs);

            const askForTitle = (cb) => {
                const message =
                    `Default title:\n${promptDefault}\n\n` +
                    `Enter a custom title for this gallery (or press Enter to keep the default):`;
                showTitlePrompt(message, promptDefault).then((input) => {
                    if (input !== null) {
                        let typed = input.trim() || "Untitled_Gallery";
                        cb(typed.replace(/[\\/:*?"<>|]/g, ""));
                    }
                });
            };

            if (isPromptEnabled) {
                askForTitle(executeDownload);
            } else if (isTooLong && truncateRule === 'prompt') {
                askForTitle(executeDownload);
            } else {
                if (isTooLong && truncateRule === 'auto') {
                    formattedCleanTitle = formattedCleanTitle.substring(0, MAX_SAFE_LENGTH).trim();
                }
                executeDownload(formattedCleanTitle);
            }
        });
    });
}

// We used to poll every 500ms. MutationObserver does the same job for nearly free.
let observerScheduled = false;
const scheduleCheck = () => {
    if (observerScheduled) return;
    observerScheduled = true;
    requestAnimationFrame(() => {
        observerScheduled = false;
        manageFloatingButton();
    });
};

const bodyObserver = new MutationObserver(scheduleCheck);
const startObserving = () => {
    if (document.body) {
        // subtree: true so we catch shreddit-post and friends the moment
        // they mount anywhere in the DOM, not just as direct children of
        // <body>. Reddit's SPA almost always injects deep, so subtree:false
        // meant we'd sit waiting for a History/hashchange event before the
        // button appeared. The rAF debounce above keeps the cost bounded —
        // manageFloatingButton is a handful of O(1) checks per frame.
        bodyObserver.observe(document.body, { childList: true, subtree: true });
        scheduleCheck();
    } else {
        setTimeout(startObserving, 50);
    }
};
startObserving();

// Reddit is an SPA, so most navigations don't touch <body>. Hook the History API
// and the hash/popstate events so we still notice when the URL changes.
const _pushState = history.pushState;
const _replaceState = history.replaceState;
history.pushState = function () { _pushState.apply(this, arguments); scheduleCheck(); };
history.replaceState = function () { _replaceState.apply(this, arguments); scheduleCheck(); };
window.addEventListener('popstate', scheduleCheck);
window.addEventListener('hashchange', scheduleCheck);

// Alt+Shift+D shortcut. Plain Alt+D is taken by Chrome / Firefox / Edge
// for "focus the address bar", so adding Shift escapes the conflict while
// keeping the "D for Download" mnemonic. Three-key combos are also less
// prone to accidental triggers. We listen at the window in capture phase
// so we run before Reddit's own hotkeys (J/K/A/Z) can swallow the keystroke.
function isTypingTarget(target) {
    if (!target) return false;
    if (target.isContentEditable) return true;
    const tag = (target.tagName || '').toLowerCase();
    if (tag === 'input' || tag === 'textarea' || tag === 'select') return true;
    // Reddit's reply box is a shadow DOM editor; fall back to its role attribute.
    const role = target.getAttribute && target.getAttribute('role');
    if (role === 'textbox' || role === 'combobox') return true;
    return false;
}

function handleKeyboardShortcut(e) {
    if (!cachedSettings || cachedSettings.keyboardShortcutEnabled === false) return;
    // e.code is the physical key position — stable across keyboard layouts.
    // e.key would be '∂' on macOS US-layout under Alt+D, or some other dead-key
    // glyph in non-Latin layouts; e.code is always 'KeyD' for the same physical key.
    if (e.code !== 'KeyD') return;
    if (!e.altKey || !e.shiftKey || e.ctrlKey || e.metaKey) return;
    if (e.repeat) return;
    if (isTypingTarget(e.target)) return;

    const btn = document.getElementById('reddit-custom-dl-btn');
    if (!btn) return;

    e.preventDefault();
    e.stopPropagation();
    btn.click();
}
window.addEventListener('keydown', handleKeyboardShortcut, true);

// Remember the post the user most recently clicked inside. Capture phase so we
// record it before Reddit's lightbox handlers can stopPropagation(). This is
// what lets findActivePostElement resolve the correct post after a feed
// image-click even when the lightbox exposes no shreddit-post and the URL
// stays on the bare feed path (Joe's r/FoodPorn report).
document.addEventListener('click', (e) => {
    const post = e.target && e.target.closest && e.target.closest('shreddit-post');
    if (post) lastClickedPost = post;
}, true);

// Surface a milestone celebration that background.js recorded but whose live
// response never reached the page (service-worker termination / closed message
// channel). background.js stashes the unclaimed milestone in
// storage.pendingMilestone; showMilestoneOverlay clears it again on dismiss,
// so this fires only until the user acknowledges it once.
function checkPendingMilestone() {
    if (!document.body) { setTimeout(checkPendingMilestone, 200); return; }
    safeStorageGet(['pendingMilestone', 'totalFilesDownloaded'], (s) => {
        if (s && s.pendingMilestone) {
            showMilestoneOverlay(s.pendingMilestone, s.totalFilesDownloaded || s.pendingMilestone);
        }
    });
}
checkPendingMilestone();

// Same defensive guard as on storage.sync.get — onChanged may not exist in
// the restricted contexts that drop storage.sync. Without this check, the
// content script throws on script init and never even mounts the button.
if (chrome && chrome.storage && chrome.storage.onChanged) {
    chrome.storage.onChanged.addListener((changes, namespace) => {
        if (namespace !== 'sync') return;
        const relevant = ['buttonTheme', 'buttonPosition', 'buttonSize', 'customButtonLabel', 'keyboardShortcutEnabled'];
        if (!relevant.some(k => changes[k])) return;

        loadSettings((settings) => {
            const activeBtn = document.getElementById("reddit-custom-dl-btn");
            if (activeBtn) applyButtonAppearance(activeBtn, settings);
        });
    });
}
