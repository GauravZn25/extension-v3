// Object Name    : license-ui.js
// Object Type    : Shared page script (popup.html, options.html)
// Purpose        : Render the licence / free-trial banner identically on every
//                  surface that shows one.
// Created By     : Gaurav Jain
// Created Date   : 17-Sep-2026
// Dependencies   : background.js "getLicenseStatus" + "openPaywall" handlers
//
// One copy rather than two: popup.js and options.js held verbatim duplicates of
// this logic and had already drifted apart. A licence state rendered correctly
// in the popup but wrongly in options is worse than either being wrong.

const KOFI_URL = 'https://ko-fi.com/gauravzn';

function formatRenewalDate(unixSeconds) {
    if (!unixSeconds) return 'soon';
    return new Date(unixSeconds * 1000).toLocaleDateString(undefined, {
        year: 'numeric', month: 'short', day: 'numeric',
    });
}

// A stored licence that is simply past its date still comes back with a plan
// and status:"active" — only a genuinely unknown key gets status:"not_found".
// That distinction is what separates a lapsed payer from someone who has never
// paid, and it must not be collapsed: telling a customer whose monthly licence
// expired yesterday that they are on a free trial and need no licence is how
// you lose the renewal.
function hasStoredLicense(license) {
    if (license.valid) return false;
    return Boolean(license.plan) || Boolean(license.status && license.status !== 'not_found');
}

// "Expired" is only honest when the licence actually had an end date and it
// passed. A lifetime holder, or anyone whose licence simply couldn't be
// confirmed because the server was unreachable, has NOT expired — telling them
// to pay again for something they already own is the single worst message this
// UI could produce.
function isUnconfirmedRatherThanExpired(license) {
    if (license.unconfirmed) return true;
    return license.plan === 'lifetime' || license.plan === 'grandfathered';
}

function addKofiLink(actionsEl, label) {
    const link = document.createElement('a');
    link.className = 'license-action-link';
    link.href = KOFI_URL;
    link.target = '_blank';
    link.rel = 'noopener';
    link.textContent = label;
    actionsEl.appendChild(link);
}

function addPaywallButton(actionsEl, label) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'license-action-btn';
    btn.textContent = label;
    // content.js can't call chrome.tabs itself, so background.js already
    // exposes openPaywall — reuse it rather than adding a second way to open
    // the same tab.
    btn.addEventListener('click', () => chrome.runtime.sendMessage({ action: 'openPaywall' }));
    actionsEl.appendChild(btn);
}

// Developer    : Gaurav Jain
// Created Date : 17-Sep-2026
// Purpose      : Paint the banner for whichever of the six licence states applies.
// `els` carries the surface's own elements; `labels.activate` differs only
// because the popup is narrower than the options page.
function renderLicenseBanner(license, els, labels) {
    const { banner, titleEl, subEl, actionsEl } = els;
    if (!banner || !titleEl || !subEl || !actionsEl) return;

    banner.classList.remove('is-active', 'is-lifetime');
    actionsEl.innerHTML = '';
    subEl.textContent = '';

    const isLifetime = license.valid && (license.plan === 'lifetime' || license.plan === 'grandfathered');

    if (isLifetime) {
        banner.classList.add('is-lifetime');
        titleEl.textContent = 'RedditDL Pro — Lifetime';
        // No renewal row — a lifetime licence never expires.
    } else if (license.valid) {
        banner.classList.add('is-active');
        // "Expires", not "renews" — nothing auto-bills on this rail, so the
        // user has to pay again themselves.
        titleEl.textContent = 'RedditDL Pro — expires ' + formatRenewalDate(license.currentPeriodEnd);
        addKofiLink(actionsEl, 'Extend on Ko-fi');
    } else if (license.status === 'checking') {
        // A stored key whose cached verdict hasn't arrived yet. Telling a
        // paying user they aren't activated would be wrong and would push them
        // toward paying twice.
        titleEl.textContent = 'RedditDL Pro — checking your licence…';
        subEl.textContent = 'One moment.';
    } else if (hasStoredLicense(license) && isUnconfirmedRatherThanExpired(license)) {
        // Our problem, not theirs. Say so, and don't ask them for money.
        titleEl.textContent = 'RedditDL Pro — reconnecting…';
        subEl.textContent = "Couldn't reach the licence server. Your licence is safe and downloads keep working — this clears itself.";
    } else if (hasStoredLicense(license)) {
        titleEl.textContent = 'RedditDL Pro — licence expired';
        subEl.textContent = license.currentPeriodEnd
            ? `Ran out ${formatRenewalDate(license.currentPeriodEnd)}. Pay again on Ko-fi with the same email to extend it.`
            : 'Pay again on Ko-fi with the same email to extend it.';
        addKofiLink(actionsEl, 'Renew on Ko-fi');
    } else if (license.trialRemaining > 0) {
        banner.classList.add('is-active');
        titleEl.textContent = `Free trial — ${license.trialRemaining} of ${license.freeLimit} downloads left`;
        subEl.textContent = 'No licence needed yet.';
        addPaywallButton(actionsEl, 'Get a licence');
    } else {
        titleEl.textContent = 'Free trial used up';
        subEl.textContent = `All ${license.freeLimit} free downloads are gone.`;
        addPaywallButton(actionsEl, labels.activate);
    }

    banner.hidden = false;
}

// Developer    : Gaurav Jain
// Created Date : 17-Sep-2026
// Purpose      : Fetch the status and paint it, re-polling while it is unresolved.
// The "checking" state resolves asynchronously once /verify answers, and
// neither surface re-rendered before — so a paying user could sit on
// "checking your licence…" until they closed and reopened the page.
function loadLicenseBanner(els, labels, logTag) {
    let attemptsLeft = 5;

    // Never leave the banner on "checking…" with no way out. If the verdict
    // still hasn't resolved, say so plainly and give the user a button — a
    // paying customer staring at a spinner forever has no idea whether their
    // money worked.
    const giveUp = () => {
        const { banner, titleEl, subEl, actionsEl } = els;
        if (!banner || !titleEl || !subEl || !actionsEl) return;
        actionsEl.innerHTML = '';
        titleEl.textContent = "RedditDL Pro — couldn't confirm your licence";
        subEl.textContent = 'The licence server did not answer. Downloads are unaffected if you already had one.';
        const retry = document.createElement('button');
        retry.type = 'button';
        retry.className = 'license-action-btn';
        retry.textContent = 'Try again';
        retry.addEventListener('click', () => loadLicenseBanner(els, labels, logTag));
        actionsEl.appendChild(retry);
        banner.hidden = false;
    };

    const poll = () => {
        chrome.runtime.sendMessage({ action: 'getLicenseStatus' }, (license) => {
            // background.js may not have the handler wired up yet, or the
            // service worker is asleep — lastError fires with no payload.
            if (chrome.runtime.lastError || !license) {
                console.warn(`[${logTag}] getLicenseStatus failed:`, chrome.runtime.lastError && chrome.runtime.lastError.message);
                giveUp();
                return;
            }
            renderLicenseBanner(license, els, labels);
            if (license.status !== 'checking') return;
            if (attemptsLeft-- > 0) setTimeout(poll, 1500);
            else giveUp();
        });
    };

    poll();
}
