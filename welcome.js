// Object Name    : welcome.js
// Object Type    : Extension page script (welcome.html)
// Purpose        : Drive the paywall — unlock-by-email, manual key activation,
//                  and the live donation counter.
// Created By     : Gaurav Jain
// Created Date   : 01-Sep-2026
// Modified By    : Gaurav Jain | 01-Sep-2026 | v3 — replaced the give.do claim
//                  form with instant unlock-by-email; all server calls now go
//                  through background.js so the Worker host has one home.
// Modified By    : Gaurav Jain | 23-Sep-2026 | Auto-unlock: after a pay button
//                  is clicked, watch for the licence to land and unlock without
//                  the buyer doing anything except coming back to the tab.
// Dependencies   : background.js message handlers (license.js)

document.addEventListener('DOMContentLoaded', () => {
    const closeBtn = document.getElementById('closeWelcomeBtn');
    if (closeBtn) {
        closeBtn.addEventListener('click', () => window.close());
    }

    const customizeBtn = document.getElementById('customizeNamingBtnWelcome');
    if (customizeBtn) {
        customizeBtn.addEventListener('click', () => {
            if (chrome.runtime.openOptionsPage) {
                chrome.runtime.openOptionsPage();
            } else {
                window.open(chrome.runtime.getURL('options.html'));
            }
        });
    }

    const PLAN_LABELS = {
        monthly: 'Monthly',
        annual: 'Yearly',
        lifetime: 'Lifetime',
        semiannual: 'Semiannual',
        grandfathered: 'Lifetime',
    };

    const ERROR_MESSAGES = {
        invalid_key: "That license key doesn't look right. Double-check it and try again.",
        network_error: "Couldn't reach the license server. Check your connection and try again.",
        storage_error: "Your license checked out, but Chrome wouldn't save it. Free up some sync storage and try again.",
        not_found: "Still no payment showing for that email. If you've only just paid, wait a minute and try again. Otherwise check it's the same address you used on Ko-fi.",
        expired: "Your licence has run out. Pay again on Ko-fi using the same email, then come back and unlock it here.",
        rate_limited: "Too many attempts. Wait ten minutes and try again.",
    };

    // Ko-fi's webhook and the licence store are both eventually consistent, so
    // a buyer who unlocks the instant they pay can legitimately get a 404 for
    // a few tens of seconds. Retrying quietly beats telling a paying customer
    // to go hunting for a typo that isn't there.
    const RETRIEVE_RETRIES = 3;
    const RETRIEVE_RETRY_DELAY_MS = 10000;

    // Poll schedule for the post-payment watch, in seconds between attempts.
    // Front-loaded because the webhook usually lands in seconds, then backing
    // right off: the whole run is 16 calls over ~10 minutes, comfortably inside
    // the server's 40-per-10-minutes limit even with a few tab-return polls on
    // top. A naive every-5-seconds loop would trip that limit and lock out the
    // very person who just paid.
    const WATCH_SCHEDULE_S = [4, 5, 6, 8, 10, 12, 15, 20, 25, 30, 40, 50, 60, 60, 90, 90];

    // Both the unlock and activate flows reply with the same
    // { ok, plan } | { ok: false, error } shape, so one renderer covers both.
    function showStatus(el, response) {
        if (!el) return;
        el.hidden = false;
        if (response && response.ok) {
            const planLabel = PLAN_LABELS[response.plan] || response.plan;
            el.className = 'license-status success';
            el.textContent = `RedditDL Pro is active — ${planLabel}. You can close this tab and start downloading.`;
        } else {
            const errorKey = response && response.error;
            el.className = 'license-status error';
            el.textContent = ERROR_MESSAGES[errorKey] || 'Something went wrong. Please try again.';
        }
    }

    function showPending(el, message) {
        if (!el) return;
        el.hidden = false;
        el.className = 'license-status';
        el.textContent = message;
    }

    // ------------------------------------------------------------------
    // Auto-unlock after payment.
    //
    // The gap this closes: someone pays on Ko-fi, sees Ko-fi's own thank-you,
    // and has no idea they are supposed to come back here and type an email.
    // They assume it failed. Now the page watches for their licence and
    // unlocks itself the moment it lands.
    // ------------------------------------------------------------------
    const pricingGrid = document.getElementById('pricingGrid');
    const waitingPanel = document.getElementById('waitingPanel');
    const unlockedPanel = document.getElementById('unlockedPanel');
    const watchForm = document.getElementById('watchForm');
    const watchEmail = document.getElementById('watchEmail');
    const watchBtn = document.getElementById('watchBtn');
    const watchStatus = document.getElementById('watchStatus');
    const cancelWatch = document.getElementById('cancelWatch');

    let watchTimer = null;
    let watchStep = 0;
    let watchEmailValue = '';
    let watching = false;

    function showUnlocked(plan) {
        stopWatching();
        const label = PLAN_LABELS[plan] || plan;
        const titleEl = document.getElementById('unlockedTitle');
        const copyEl = document.getElementById('unlockedCopy');
        if (titleEl) titleEl.textContent = `You're unlocked — ${label}`;
        if (copyEl) copyEl.textContent = 'RedditDL Pro is active. Open any Reddit gallery and hit Download — no limits.';
        if (pricingGrid) pricingGrid.hidden = true;
        if (waitingPanel) waitingPanel.hidden = true;
        if (unlockedPanel) {
            unlockedPanel.hidden = false;
            unlockedPanel.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
    }

    function stopWatching() {
        watching = false;
        if (watchTimer) { clearTimeout(watchTimer); watchTimer = null; }
    }

    // Developer    : Gaurav Jain
    // Created Date : 23-Sep-2026
    // Purpose      : Ask the server whether this buyer's licence has arrived.
    // Shared by the timer and the tab-return handler, and guarded so the two
    // can't overlap into a double request.
    let pollInFlight = false;
    function pollOnce(onDone) {
        if (pollInFlight || !watchEmailValue) return;
        pollInFlight = true;
        chrome.runtime.sendMessage({ action: 'retrieveLicense', email: watchEmailValue }, (response) => {
            pollInFlight = false;
            if (chrome.runtime.lastError) { if (onDone) onDone(false); return; }
            if (response && response.ok) {
                showUnlocked(response.plan);
                if (onDone) onDone(true);
                return;
            }
            // rate_limited means we asked too often — back off rather than
            // burning the remaining budget the buyer might need.
            if (response && response.error === 'rate_limited') {
                watchStep = WATCH_SCHEDULE_S.length - 1;
            }
            if (onDone) onDone(false);
        });
    }

    function scheduleNextPoll() {
        if (!watching) return;
        if (watchStep >= WATCH_SCHEDULE_S.length) {
            stopWatching();
            showStatus(watchStatus, { ok: false, error: 'not_found' });
            if (watchBtn) { watchBtn.disabled = false; watchBtn.textContent = 'Check again'; }
            return;
        }
        const waitS = WATCH_SCHEDULE_S[watchStep++];
        watchTimer = setTimeout(() => {
            pollOnce(() => scheduleNextPoll());
        }, waitS * 1000);
    }

    function startWatching(email) {
        watchEmailValue = email;
        watchStep = 0;
        watching = true;
        const titleEl = document.getElementById('waitingTitle');
        const copyEl = document.getElementById('waitingCopy');
        if (titleEl) titleEl.textContent = 'Watching for your payment…';
        if (copyEl) copyEl.textContent = `As soon as Ko-fi confirms ${email}, this page unlocks itself. You don't need to do anything else — just leave this tab open.`;
        if (watchBtn) { watchBtn.disabled = true; watchBtn.textContent = 'Watching…'; }
        showPending(watchStatus, 'Checking every few seconds…');
        pollOnce(() => scheduleNextPoll());
    }

    // The buyer physically returns to this tab after paying, which is a far
    // better signal than any timer — so check immediately when that happens.
    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible' && watching) pollOnce();
    });

    if (pricingGrid) {
        pricingGrid.addEventListener('click', (event) => {
            const btn = event.target.closest('.pay-btn');
            if (!btn) return;
            // The anchor still opens Ko-fi in its own tab — we only add the
            // waiting state alongside it.
            const amount = btn.getAttribute('data-amount');
            const amountEl = document.getElementById('waitingAmount');
            if (amountEl) amountEl.textContent = `$${amount}`;
            if (waitingPanel) {
                waitingPanel.hidden = false;
                waitingPanel.scrollIntoView({ behavior: 'smooth', block: 'center' });
            }
            // Prefill from the manual box if they already typed it there.
            if (watchEmail && !watchEmail.value && retrieveEmailValue()) watchEmail.value = retrieveEmailValue();
            if (watchEmail) setTimeout(() => watchEmail.focus(), 400);
        });
    }

    function retrieveEmailValue() {
        const el = document.getElementById('retrieveEmail');
        return (el && el.value || '').trim();
    }

    if (watchForm) {
        watchForm.addEventListener('submit', (event) => {
            event.preventDefault();
            const email = (watchEmail && watchEmail.value || '').trim();
            if (!email) return;
            startWatching(email);
        });
    }

    if (cancelWatch) {
        cancelWatch.addEventListener('click', () => {
            stopWatching();
            if (waitingPanel) waitingPanel.hidden = true;
            if (watchStatus) watchStatus.hidden = true;
            if (watchBtn) { watchBtn.disabled = false; watchBtn.textContent = 'Watch for my payment'; }
            const titleEl = document.getElementById('waitingTitle');
            if (titleEl) titleEl.textContent = 'Finish your payment on Ko-fi';
        });
    }

    // Someone who already had a licence before opening this page shouldn't be
    // shown a paywall at all.
    chrome.runtime.sendMessage({ action: 'getLicenseStatus' }, (license) => {
        if (chrome.runtime.lastError || !license) return;
        if (license.valid) showUnlocked(license.plan);
    });

    // ------------------------------------------------------------------
    // Unlock by email — the manual path, and the fallback if watching times out.
    // ------------------------------------------------------------------
    const retrieveForm = document.getElementById('retrieveForm');
    const retrieveEmail = document.getElementById('retrieveEmail');
    const retrieveBtn = document.getElementById('retrieveBtn');
    const retrieveStatus = document.getElementById('retrieveStatus');

    if (retrieveForm) {
        retrieveForm.addEventListener('submit', (event) => {
            event.preventDefault();
            const email = (retrieveEmail && retrieveEmail.value || '').trim();
            if (!email) {
                showStatus(retrieveStatus, { ok: false, error: 'not_found' });
                return;
            }

            const originalLabel = retrieveBtn.textContent;
            retrieveBtn.disabled = true;
            retrieveBtn.textContent = 'Checking…';
            showPending(retrieveStatus, 'Looking up your payment…');

            const finish = (response) => {
                retrieveBtn.disabled = false;
                retrieveBtn.textContent = originalLabel;
                if (response && response.ok) { showUnlocked(response.plan); return; }
                showStatus(retrieveStatus, response);
            };

            const attempt = (remaining) => {
                chrome.runtime.sendMessage({ action: 'retrieveLicense', email }, (response) => {
                    if (chrome.runtime.lastError) {
                        finish({ ok: false, error: 'network_error' });
                        return;
                    }
                    // Only a miss is worth retrying — a wrong key, an expired
                    // licence or a rate limit won't change by waiting.
                    if (response && response.error === 'not_found' && remaining > 0) {
                        showPending(retrieveStatus, "Not showing yet — Ko-fi can take up to a minute. Still checking…");
                        setTimeout(() => attempt(remaining - 1), RETRIEVE_RETRY_DELAY_MS);
                        return;
                    }
                    finish(response);
                });
            };

            attempt(RETRIEVE_RETRIES);
        });
    }

    // ------------------------------------------------------------------
    // Manual key activation — fallback for hand-issued keys.
    // ------------------------------------------------------------------
    const activateForm = document.getElementById('activateForm');
    const licenseKeyInput = document.getElementById('licenseKeyInput');
    const activateBtn = document.getElementById('activateLicenseBtn');
    const licenseStatusEl = document.getElementById('licenseStatus');

    if (activateForm) {
        activateForm.addEventListener('submit', (event) => {
            event.preventDefault();
            const key = (licenseKeyInput && licenseKeyInput.value || '').trim();
            if (!key) {
                showStatus(licenseStatusEl, { ok: false, error: 'invalid_key' });
                return;
            }

            activateBtn.disabled = true;
            const originalLabel = activateBtn.textContent;
            activateBtn.textContent = 'Verifying…';
            showPending(licenseStatusEl, 'Verifying your key…');

            chrome.runtime.sendMessage({ action: 'activateLicense', key }, (response) => {
                activateBtn.disabled = false;
                activateBtn.textContent = originalLabel;
                if (chrome.runtime.lastError) {
                    showStatus(licenseStatusEl, { ok: false, error: 'network_error' });
                    return;
                }
                if (response && response.ok) { showUnlocked(response.plan); return; }
                showStatus(licenseStatusEl, response);
            });
        });
    }

    // ------------------------------------------------------------------
    // Live donation counter. Fail-silent: any error leaves it hidden rather
    // than showing a broken or zeroed figure.
    // ------------------------------------------------------------------
    const statsCounterEl = document.getElementById('statsCounter');
    if (statsCounterEl) {
        chrome.runtime.sendMessage({ action: 'getStats' }, (stats) => {
            if (chrome.runtime.lastError || !stats || !stats.ok) return;
            const totalUSD = Number(stats.totalUSD) || 0;
            // Payments, not distinct people — a renewal increments it too.
            const payments = Number(stats.paymentCount) || 0;
            if (payments === 0) return;
            // "Paid in", not "raised for CanKids" — this is what supporters have
            // contributed, not what has been donated on yet. The monthly Ko-fi
            // receipts are the number for that.
            statsCounterEl.innerHTML =
                `<strong>$${totalUSD.toFixed(2)}</strong> paid in so far, across ${payments} payment${payments === 1 ? '' : 's'} — see the <a href="transparency.html" target="_blank" rel="noopener">receipts</a>.`;
            statsCounterEl.hidden = false;
        });
    }
});
