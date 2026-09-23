// Object Name    : license.js
// Object Type    : Background service-worker module
// Purpose        : Verify, activate and cache the RedditDL Pro license, and
//                  proxy every license-server call for the extension's pages.
// Created By     : Gaurav Jain
// Created Date   : 01-Sep-2026
// Modified By    : Gaurav Jain | 01-Sep-2026 | v3 — Ko-fi/PayPal rail, async
//                  download gate, alarm-driven revalidation, /retrieve + /stats
//                  proxying so WORKER_DOMAIN lives in exactly one file.
// Dependencies   : background.js (importScripts), chrome.storage.sync, chrome.alarms
//
// Loaded via importScripts, so everything here is a plain global — same
// non-module pattern as jszip.min.js. See CONTRACT.md §5-6 for the storage
// schema and message shapes this must match.

// The ONE place the deployed Worker host is written. welcome.js,
// transparency.js, popup.js and options.js all reach the server by messaging
// this file instead of holding their own copy.
const WORKER_DOMAIN = "redditdl-license.reddit-downloader.workers.dev";

// Scheme and trailing slash are stripped rather than assumed absent: the same
// host also goes into manifest.json, where it DOES need "https://" because a
// match pattern requires one. Pasting that form here used to yield
// "https://https://host" and break every licence call.
const LICENSE_API_BASE = `https://${WORKER_DOMAIN.replace(/^https?:\/\//, '').replace(/\/+$/, '')}`;

const LICENSE_KEY_STORAGE_KEY = 'redditdl_license_key';
const LICENSE_CACHE_STORAGE_KEY = 'redditdl_license_cache';

// Free trial: this many successful gallery downloads before a licence is
// needed. Counted per gallery (one click), not per file — a 40-image gallery
// costs the same one credit as a single image, which is what users expect
// "100 free downloads" to mean.
const FREE_GALLERY_LIMIT = 100;
const TRIAL_USED_STORAGE_KEY = 'redditdl_free_galleries_used';

// Kept in storage.local, not sync: it is a per-device throttle, not part of the
// licence, and it must survive a service-worker teardown to be worth anything.
const LAST_ATTEMPT_STORAGE_KEY = 'redditdl_last_verify_attempt';

// Re-check with the server once a day. If the server is unreachable, keep
// trusting the last known-good answer for five days rather than punishing a
// paying user for an outage they can't do anything about.
const REVALIDATE_AFTER_MS = 24 * 60 * 60 * 1000;

// There is deliberately NO grace-window expiry any more. An unreachable server
// means we could not ask, and a customer who paid must not be locked out
// because of our outage — however long it lasts. Access is withdrawn only when
// the server explicitly answers that the licence is not valid. See
// licenseStanding(). A non-payer has no stored key, so this cannot be used to
// bypass the paywall by taking the server offline.

// How long a NEGATIVE verdict is trusted before re-checking. Deliberately short:
// the most common reason a licence reads invalid is that it just expired, and
// the user's very next action is usually to pay again. At the normal 24h
// interval they would stay locked out for most of a day after paying.
const REVALIDATE_INVALID_AFTER_MS = 5 * 60 * 1000;

// Stops a download-time revalidation from retrying on every single click while
// the server is down — without it, a stale cache plus an outage means one
// failed network round trip per button press.
const REFRESH_BACKOFF_MS = 5 * 60 * 1000;

const REVALIDATE_ALARM = 'redditdl-license-revalidate';

let inMemoryLicenseKey = null;
let inMemoryLicenseCache = null;
let inMemoryTrialUsed = 0;
// False until a storage read has actually told us the count. Guards
// consumeFreeGallery from persisting a number it only guessed at.
let trialHydrated = false;
// True when storage could not be read at all, after retries. The gate fails
// OPEN in that state — see checkDownloadAccess. Wrongly blocking someone who
// paid is far worse than wrongly allowing a download during a rare fault.
let hydrationFailed = false;
let lastRefreshAttemptAt = 0;

const HYDRATE_MAX_ATTEMPTS = 3;
const HYDRATE_RETRY_BASE_MS = 400;

// Developer    : Gaurav Jain
// Created Date : 18-Sep-2026
// Purpose      : Load licence + trial state, retrying a transient read failure.
// A single failed read used to blank the licence key and mark the trial spent,
// which told a lifetime customer "Free trial used up" and blocked every
// download. Unknown state must never be treated as "unlicensed".
function readLicenseState(attempt, done) {
    chrome.storage.sync.get([LICENSE_KEY_STORAGE_KEY, LICENSE_CACHE_STORAGE_KEY, TRIAL_USED_STORAGE_KEY], (data) => {
        if (chrome.runtime.lastError || !data) {
            if (attempt < HYDRATE_MAX_ATTEMPTS) {
                setTimeout(() => readLicenseState(attempt + 1, done), HYDRATE_RETRY_BASE_MS * attempt);
                return;
            }
            console.error('[RedditDL license] Could not read licence state after retries:', chrome.runtime.lastError && chrome.runtime.lastError.message);
            hydrationFailed = true;
            trialHydrated = false;
            done();
            return;
        }

        inMemoryLicenseKey = data[LICENSE_KEY_STORAGE_KEY] || null;
        inMemoryLicenseCache = data[LICENSE_CACHE_STORAGE_KEY] || null;
        inMemoryTrialUsed = Number(data[TRIAL_USED_STORAGE_KEY]) || 0;
        trialHydrated = true;
        hydrationFailed = false;
        done();
    });
}

// MV3 tears the service worker down after ~30s idle and re-runs this file on
// wake, so this read is on the critical path of the very first download click.
// Everything that reads the cache awaits this promise first — a sync-only check
// reported "license required" to genuinely licensed users on that first click.
const licenseReady = new Promise((resolve) => {
    readLicenseState(1, () => {
        chrome.storage.local.get([LAST_ATTEMPT_STORAGE_KEY], (local) => {
            lastRefreshAttemptAt = (local && local[LAST_ATTEMPT_STORAGE_KEY]) || 0;
            resolve();
        });
    });
});

// storage.sync replicates across the user's Chrome profiles, but a running
// service worker only reads it once at startup. Without this listener, someone
// who pays on their laptop stays locked out on their desktop until that
// worker happens to restart — they have paid, and the second machine says no.
if (chrome.storage.onChanged) {
    chrome.storage.onChanged.addListener((changes, area) => {
        if (area !== 'sync') return;
        if (changes[LICENSE_KEY_STORAGE_KEY]) {
            inMemoryLicenseKey = changes[LICENSE_KEY_STORAGE_KEY].newValue || null;
        }
        if (changes[LICENSE_CACHE_STORAGE_KEY]) {
            inMemoryLicenseCache = changes[LICENSE_CACHE_STORAGE_KEY].newValue || null;
        }
        if (changes[TRIAL_USED_STORAGE_KEY]) {
            // Highest count wins. Syncing the number backwards would hand out
            // extra free downloads every time two devices disagreed.
            inMemoryTrialUsed = Math.max(inMemoryTrialUsed, Number(changes[TRIAL_USED_STORAGE_KEY].newValue) || 0);
        }
    });
}

// Periodic background revalidation. Without it the cache only ever refreshes
// when the user happens to open the popup or options page, so a heavy user who
// never opens either would silently fall off the five-day grace cliff mid-use.
//
// create() REPLACES an existing alarm of the same name and restarts its period,
// and this file re-runs on every service-worker wake — so calling it
// unconditionally would keep pushing the deadline back and the alarm would
// never fire for exactly the active users it protects. Only create it if it
// isn't already scheduled.
if (chrome.alarms) {
    chrome.alarms.get(REVALIDATE_ALARM, (existing) => {
        if (!existing) chrome.alarms.create(REVALIDATE_ALARM, { periodInMinutes: 60 * 12 });
    });
    chrome.alarms.onAlarm.addListener(async (alarm) => {
        if (alarm.name !== REVALIDATE_ALARM) return;
        await licenseReady;
        if (inMemoryLicenseKey) await refreshLicenseCache(inMemoryLicenseKey);
    });
}

// Persisted so the throttle actually holds across the ~30s service-worker
// lifecycle. In memory alone it reset constantly, so every download click paid
// a full failed round trip whenever the server was unreachable.
function recordRefreshAttempt() {
    lastRefreshAttemptAt = Date.now();
    chrome.storage.local.set({ [LAST_ATTEMPT_STORAGE_KEY]: lastRefreshAttemptAt });
}

// ---------------------------------------------------------------------------
// Server calls
// ---------------------------------------------------------------------------

// Throws on network failure or non-2xx — callers decide whether that means
// "grace window" or "hard failure".
// Bounded: this sits on the download critical path when a licensed user's
// cache has gone stale, and fetch has no default timeout — a hung connection
// would leave the Download button spinning indefinitely. On timeout the caller
// falls into the grace window, which is the correct outcome anyway.
const VERIFY_TIMEOUT_MS = 8000;

async function callVerify(key) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), VERIFY_TIMEOUT_MS);
    try {
        const res = await fetch(`${LICENSE_API_BASE}/verify?key=${encodeURIComponent(key)}`, { signal: controller.signal });
        if (!res.ok) throw new Error(`/verify returned HTTP ${res.status}`);
        return await res.json();
    } finally {
        clearTimeout(timer);
    }
}

function cacheFromVerifyResult(result) {
    return {
        valid: result.valid === true,
        plan: result.plan,
        status: result.status,
        currentPeriodEnd: result.currentPeriodEnd,
        source: result.source,
        checkedAt: Date.now(),
    };
}

// Developer    : Gaurav Jain
// Created Date : 01-Sep-2026
// Purpose      : Re-check a stored key with the server and update both caches.
// On a network failure this deliberately does not invalidate — it falls back
// to the five-day grace window, logging each time so an unreachable server is
// visible in the console rather than silently degrading into a lockout.
async function refreshLicenseCache(key) {
    recordRefreshAttempt();
    try {
        const cache = cacheFromVerifyResult(await callVerify(key));
        inMemoryLicenseCache = cache;
        chrome.storage.sync.set({ [LICENSE_CACHE_STORAGE_KEY]: cache });
        return cache;
    } catch (networkErr) {
        // We could not ASK. That is our problem, never the customer's, so the
        // record is marked unconfirmed and downloads keep working — see
        // licenseStanding(). The last known plan/valid values are preserved so
        // the UI can say "reconnecting" instead of accusing a paying customer
        // of having an expired licence.
        console.log('[RedditDL license] Licence server unreachable — keeping access on and marking the cache unconfirmed.');
        const stale = inMemoryLicenseCache;
        const unconfirmed = stale
            ? { ...stale, unconfirmed: true }
            : { valid: false, plan: null, status: null, currentPeriodEnd: null, source: null, unconfirmed: true, checkedAt: 0 };
        inMemoryLicenseCache = unconfirmed;
        chrome.storage.sync.set({ [LICENSE_CACHE_STORAGE_KEY]: unconfirmed });
        return unconfirmed;
    }
}

// ---------------------------------------------------------------------------
// The download gate
// ---------------------------------------------------------------------------

// Whether the banner should present the licence as confirmed-active. Note this
// is a DISPLAY question, not an access one — the gate (isLicenseValid) is
// deliberately more generous, because an unconfirmed licence still downloads.
function cacheLooksValid(cache) {
    return Boolean(cache && cache.valid === true && cache.unconfirmed !== true);
}

// A stale negative is re-checked far sooner than a stale positive, so someone
// who has just paid again isn't left staring at a paywall they already cleared.
function staleAfterMsFor(cache) {
    return (cache && cache.valid === true) ? REVALIDATE_AFTER_MS : REVALIDATE_INVALID_AFTER_MS;
}

function trialRemaining() {
    return Math.max(0, FREE_GALLERY_LIMIT - inMemoryTrialUsed);
}

// Developer    : Gaurav Jain
// Created Date : 17-Sep-2026
// Purpose      : Decide whether this download may run — licence or free trial.
// background.js calls this instead of isLicenseValid() directly, so the trial
// and the paywall are decided in one place rather than two.
async function checkDownloadAccess() {
    await licenseReady;

    // Storage is unreadable even after retries, so we genuinely do not know
    // whether this person has paid. Fail OPEN. Letting an occasional download
    // through during a storage fault costs a rounding error; blocking someone
    // who paid gets the extension called a scam, and they would be right.
    if (hydrationFailed) {
        console.error('[RedditDL license] Licence state unreadable — allowing this download rather than risk blocking a paying user.');
        return { allowed: true, usingTrial: false, trialRemaining: null };
    }

    // Licence first: a paying user must never be told they are on a trial, and
    // must never consume trial credits.
    if (await isLicenseValid()) {
        return { allowed: true, usingTrial: false, trialRemaining: null };
    }

    const remaining = trialRemaining();
    return { allowed: remaining > 0, usingTrial: true, trialRemaining: remaining };
}

// Developer    : Gaurav Jain
// Created Date : 17-Sep-2026
// Purpose      : Burn one free-trial credit after a download that actually saved.
// Only called on success — a gallery that yielded zero files must not cost the
// user part of their trial for something that didn't work.
async function consumeFreeGallery() {
    await licenseReady;
    // Never write a count derived from a failed read — that would clobber the
    // real one. The download already happened; losing this single credit is
    // the right way to fail.
    if (!trialHydrated) {
        console.warn('[RedditDL license] Trial count never hydrated — not persisting a guessed value.');
        return trialRemaining();
    }

    inMemoryTrialUsed += 1;
    return new Promise((resolve) => {
        chrome.storage.sync.set({ [TRIAL_USED_STORAGE_KEY]: inMemoryTrialUsed }, () => {
            if (chrome.runtime.lastError) {
                console.warn('[RedditDL license] Could not persist trial usage:', chrome.runtime.lastError.message);
            }
            resolve(trialRemaining());
        });
    });
}

// Developer    : Gaurav Jain
// Created Date : 19-Sep-2026
// Purpose      : Classify the stored licence into one of four standings.
// The distinction that matters is "unconfirmed" vs "invalid". A stored licence
// key is ONLY ever written by activateLicenseKey after the server said yes, so
// its presence is proof of a real activation. If we then can't reach the
// server, that is our outage — not grounds to lock the customer out.
function licenseStanding() {
    if (!inMemoryLicenseKey) return 'none';
    const cache = inMemoryLicenseCache;
    if (!cache) return 'unconfirmed';           // key synced from another device, not yet checked here
    if (cache.unconfirmed === true) return 'unconfirmed';
    if (cache.valid === true) return 'valid';

    // A stored key the server no longer recognises means OUR record went
    // missing — a wiped or restored KV namespace, a re-pointed binding. It
    // cannot mean "never paid", because a key is only ever stored after the
    // server confirmed it. Deliberate revocation returns status "canceled",
    // which still lands in 'invalid' and correctly blocks.
    if (cache.status === 'not_found') {
        console.error('[RedditDL license] Server no longer recognises a previously-valid licence key — treating as OUR data loss, not a lapsed customer.');
        return 'unconfirmed';
    }
    return 'invalid';
}

// Developer    : Gaurav Jain
// Created Date : 01-Sep-2026
// Modified By  : Gaurav Jain | 19-Sep-2026 | Only a definite server "no" blocks.
// Purpose      : Whether this user's licence entitles them to download.
async function isLicenseValid() {
    await licenseReady;
    if (!inMemoryLicenseKey) return false;

    const cache = inMemoryLicenseCache;
    const isStale = !cache || (Date.now() - (cache.checkedAt || 0)) > staleAfterMsFor(cache);
    const backoffElapsed = (Date.now() - lastRefreshAttemptAt) > REFRESH_BACKOFF_MS;

    if (isStale && backoffElapsed) {
        await refreshLicenseCache(inMemoryLicenseKey);
    }

    const standing = licenseStanding();
    if (standing === 'unconfirmed') {
        // Deliberate: no time limit on this. A prolonged outage must not
        // gradually lock out everyone who paid, and someone who never paid has
        // no key to be unconfirmed about.
        console.log('[RedditDL license] Licence unconfirmed (server unreachable) — allowing the download.');
        return true;
    }
    return standing === 'valid';
}

// ---------------------------------------------------------------------------
// Message handlers
// ---------------------------------------------------------------------------

// Replies immediately from cache — CONTRACT.md §6 requires the UI never block
// on a network round trip — and revalidates in the background when stale.
async function getCachedLicenseStatus(callback) {
    await licenseReady;
    const key = inMemoryLicenseKey;
    const cache = inMemoryLicenseCache;

    // Trial figures ride along on every reply so the popup and options banners
    // can show "72 of 100 free left" without a second round trip.
    const trial = { trialUsed: inMemoryTrialUsed, trialRemaining: trialRemaining(), freeLimit: FREE_GALLERY_LIMIT };

    if (!key) {
        callback({ valid: false, plan: null, status: null, currentPeriodEnd: null, source: null, ...trial });
        return;
    }

    // A key with no cache is a real state (storage.sync partially synced, or a
    // write that failed): answer "checking" rather than a bare "not licensed",
    // and kick the refresh that resolves it instead of dead-ending here.
    if (!cache) {
        callback({ valid: false, plan: null, status: 'checking', currentPeriodEnd: null, source: null, ...trial });
        refreshLicenseCache(key);
        return;
    }

    callback({
        valid: cacheLooksValid(cache),
        plan: cache.plan,
        status: cache.status,
        currentPeriodEnd: cache.currentPeriodEnd,
        source: cache.source || null,
        // Lets the banner say "couldn't reach the licence server" instead of
        // accusing a paying customer of having an expired licence.
        unconfirmed: cache.unconfirmed === true,
        ...trial,
    });

    if ((Date.now() - (cache.checkedAt || 0)) > staleAfterMsFor(cache)) {
        refreshLicenseCache(key); // fire and forget, reply already sent
    }
}

// Developer    : Gaurav Jain
// Created Date : 01-Sep-2026
// Purpose      : Verify a key with the server and, only if genuinely valid,
//                persist it as the active license.
async function activateLicenseKey(key) {
    // Awaited before touching the in-memory mirrors: if hydration is still in
    // flight it resolves later and overwrites them with the pre-activation
    // values, silently losing a licence the user just paid for.
    await licenseReady;

    let result;
    try {
        result = await callVerify(key);
    } catch (networkErr) {
        console.warn('[RedditDL license] activateLicenseKey: server unreachable:', networkErr);
        return { ok: false, error: 'network_error' };
    }

    if (!result || result.valid !== true) {
        return { ok: false, error: 'invalid_key' };
    }

    const cache = cacheFromVerifyResult(result);

    return new Promise((resolve) => {
        chrome.storage.sync.set({ [LICENSE_KEY_STORAGE_KEY]: key, [LICENSE_CACHE_STORAGE_KEY]: cache }, () => {
            // Reporting success on a failed write would show "Pro is active"
            // and then lose the license on the next service-worker restart.
            if (chrome.runtime.lastError) {
                console.error('[RedditDL license] Could not persist the license:', chrome.runtime.lastError.message);
                resolve({ ok: false, error: 'storage_error' });
                return;
            }
            inMemoryLicenseKey = key;
            inMemoryLicenseCache = cache;
            resolve({ ok: true, valid: true, plan: result.plan, status: result.status });
        });
    });
}

// Developer    : Gaurav Jain
// Created Date : 01-Sep-2026
// Purpose      : Swap the email a buyer paid with for their key and activate
//                it in one step, so nobody has to copy-paste anything.
async function retrieveLicenseByEmail(email) {
    let res;
    try {
        res = await fetch(`${LICENSE_API_BASE}/retrieve`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email }),
        });
    } catch (networkErr) {
        console.warn('[RedditDL license] retrieveLicenseByEmail: server unreachable:', networkErr);
        return { ok: false, error: 'network_error' };
    }

    if (res.status === 404) return { ok: false, error: 'not_found' };
    if (res.status === 429) return { ok: false, error: 'rate_limited' };
    if (!res.ok) return { ok: false, error: 'network_error' };

    let data;
    try {
        data = await res.json();
    } catch (parseErr) {
        return { ok: false, error: 'network_error' };
    }
    if (!data || !data.licenseKey) return { ok: false, error: 'not_found' };

    // A found-but-lapsed licence needs its own message. Handing the expired key
    // to activateLicenseKey would surface "that key doesn't look right", which
    // is wrong and unactionable for someone who just needs to pay again.
    if (data.valid === false) {
        return { ok: false, error: 'expired', plan: data.plan, currentPeriodEnd: data.currentPeriodEnd };
    }

    const result = await activateLicenseKey(data.licenseKey);

    // The server already told us this licence is valid, so "invalid_key" here
    // can only be a race or a hiccup on the second round trip — never the
    // user's fault. Telling someone who typed an EMAIL that their KEY looks
    // wrong is nonsense, and reads as being fobbed off after paying.
    if (!result.ok && result.error === 'invalid_key') {
        console.warn('[RedditDL license] /retrieve said valid but /verify disagreed — reporting as a server issue, not a bad key.');
        return { ok: false, error: 'network_error' };
    }
    return result;
}

// Proxied through here so transparency.js and welcome.js don't need their own
// copy of the Worker host.
async function fetchDonationStats() {
    try {
        const res = await fetch(`${LICENSE_API_BASE}/stats`);
        if (!res.ok) throw new Error(`/stats returned HTTP ${res.status}`);
        const stats = await res.json();
        return { ok: true, ...stats };
    } catch (err) {
        // The counter is deliberately fail-silent — a missing total just hides
        // the line. Logging it as a warning would put a routine network blip in
        // the extension's Errors panel.
        console.log('[RedditDL license] /stats unavailable, hiding the counter:', err && err.message);
        return { ok: false, error: 'network_error' };
    }
}
