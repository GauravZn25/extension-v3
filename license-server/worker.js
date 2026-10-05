// Object Name    : redditdl-license (Cloudflare Worker)
// Object Type    : HTTP API / license server
// Purpose        : Turn a Ko-fi or PayPal payment into a RedditDL Pro license
//                  key automatically, and answer /verify for the extension.
// Created By     : Gaurav Jain
// Created Date   : 01-Sep-2026
// Modified By    : Gaurav Jain | 01-Sep-2026 | v3 rewrite — replaced the
//                  give.do manual-claim rail and the dormant Stripe rail with
//                  Ko-fi + PayPal webhooks that mint instantly.
// Modified By    : Gaurav Jain | 02-Sep-2026 | Review fixes — reserve the txn
//                  guard before minting, resolve the PayPal buyer email from
//                  the order, refuse to mint without an email, ignore Ko-fi
//                  test payloads and Commissions, add revoke/delete.
// Dependencies   : Workers KV binding `LICENSES`; secrets KOFI_VERIFICATION_TOKEN,
//                  ADMIN_SECRET, and (optional) PAYPAL_CLIENT_ID / PAYPAL_SECRET /
//                  PAYPAL_WEBHOOK_ID. See CONTRACT.md for the full spec.
//
// Routes:
//   POST /webhook/kofi     — Ko-fi fires this on every payment; mints/extends a license
//   POST /webhook/paypal   — PayPal fires this on PAYMENT.CAPTURE.COMPLETED; same
//   POST /retrieve         — buyer swaps the email they paid with for their key
//   GET  /verify           — polled by the extension's background service worker
//   GET  /stats            — public running total, drives the transparency page
//   POST /admin/grant      — manual mint (comps, refunds, grandfathering)
//   POST /admin/revoke     — kill a license (refund, chargeback)
//   POST /admin/delete     — erase a license and its indexes (data-deletion requests)
//   GET  /admin/licenses   — owner's own ledger

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DAY_SECONDS = 24 * 60 * 60;

// Absorbs webhook lag and clock skew so a renewing subscriber is never locked
// out for the few hours between their period ending and Ko-fi's next payment.
const GRACE_PERIOD_SECONDS = 3 * DAY_SECONDS;

const PLAN_DURATION_SECONDS = {
    monthly: 30 * DAY_SECONDS,
    annual: 365 * DAY_SECONDS,
    lifetime: null,
    // Legacy plans — no longer sold, still honoured for anyone holding one.
    semiannual: 182 * DAY_SECONDS,
    grandfathered: null,
};

// Price ladder (USD). Thresholds sit a cent low because Ko-fi reports the
// gross the supporter chose and some currencies land a fraction short after
// conversion — a $0.99 conversion of a $1 payment should still be monthly.
const PRICE_LADDER = [
    { minUSD: 9.99, plan: 'lifetime' },
    { minUSD: 4.99, plan: 'annual' },
    { minUSD: 0.99, plan: 'monthly' },
];

// Ko-fi payment types that buy a license. "Commission" is deliberately absent:
// it is custom paid work, not a license purchase, and letting a $10 commission
// mint a lifetime key would also book its full value as a charity obligation.
const KOFI_LICENSING_TYPES = ['Donation', 'Subscription', 'Shop Order'];

// Ko-fi's own "send test webhook" button posts this fixed transaction id. It
// must never mint or count, or the first thing the owner does while wiring the
// webhook up permanently inflates the public donation total.
const KOFI_TEST_TRANSACTION_ID = '00000000-1111-2222-3333-444444444444';

// KV keys cap at 512 bytes; a longer /verify key can only be junk, and letting
// it reach KV turns a bad request into a 500.
const MAX_LICENSE_KEY_LENGTH = 200;

// /retrieve is public and takes an email, so it is the one route worth
// rate-limiting. KV's eventual consistency makes this a speed bump against
// casual scraping rather than a hard guarantee — see CONTRACT.md.
// Generous on purpose. The unlock form retries 4 times by itself while waiting
// for Ko-fi's webhook, an impatient buyer retries by hand, and offices/campuses
// share one IP behind CGNAT — a limit tight enough to be "secure" would mostly
// refuse people who had just paid. The thing being protected is a $1-$10
// licence key, so the trade sits firmly on the side of never blocking a payer.
const RETRIEVE_RATE_LIMIT = { maxPerWindow: 40, windowSeconds: 600 };

// Bounds the ledger read so it cannot exceed the Workers per-request subrequest
// budget as the license count grows. Truncation is reported in the response.
const ADMIN_LIST_MAX = 40;

const CORS_HEADERS = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, X-Admin-Secret',
    'Access-Control-Max-Age': '86400',
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function jsonResponse(data, status = 200) {
    return new Response(JSON.stringify(data), {
        status,
        headers: { 'Content-Type': 'application/json', ...CORS_HEADERS },
    });
}

function nowSeconds() {
    return Math.floor(Date.now() / 1000);
}

// Opaque 64-hex-char bearer token the buyer pastes into the extension.
function generateLicenseKey() {
    return (crypto.randomUUID() + crypto.randomUUID()).replace(/-/g, '');
}

function bufferToHex(buffer) {
    return [...new Uint8Array(buffer)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

// Walks the whole string every time so a caller can't discover a secret one
// character at a time by measuring how long the comparison took. The initial
// length check does leak the secret's length, which is acceptable for a
// 64-char random value — length alone doesn't narrow a brute force usefully.
function timingSafeEqual(a, b) {
    if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
    let mismatch = 0;
    for (let i = 0; i < a.length; i++) mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
    return mismatch === 0;
}

// Emails are hashed for the *index key* so a KV key listing doesn't enumerate
// addresses. This is not anonymisation — the lic: record stores the plaintext
// email, because the owner needs it to match a payment to a license.
async function emailIndexKey(email) {
    const normalized = String(email).trim().toLowerCase();
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(normalized));
    return `email:${bufferToHex(digest)}`;
}

function isPlausibleEmail(value) {
    return typeof value === 'string' && value.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
}

// Developer    : Gaurav Jain
// Created Date : 01-Sep-2026
// Purpose      : Map a paid amount in USD onto one of the three sold tiers.
function planFromAmountUSD(amountUSD) {
    const amount = Number(amountUSD);
    if (!Number.isFinite(amount) || amount <= 0) return null;
    const match = PRICE_LADDER.find((step) => amount >= step.minUSD);
    return match ? match.plan : null;
}

// ---------------------------------------------------------------------------
// License records
// ---------------------------------------------------------------------------

function computePeriodEnd(plan, fromSeconds) {
    const duration = PLAN_DURATION_SECONDS[plan];
    return duration === null || duration === undefined ? null : fromSeconds + duration;
}

// A license is live when it never expires, or when it is active and we are
// still inside the paid period plus the grace cushion.
function isLicenseValid(record) {
    if (!record) return false;
    if (record.status !== 'active') return false;
    // Loose equality on purpose: a record written before `currentPeriodEnd`
    // existed has it undefined, and that must read as "never expires", not as
    // an expiry of NaN.
    if (record.currentPeriodEnd == null) return true;
    return nowSeconds() < record.currentPeriodEnd + GRACE_PERIOD_SECONDS;
}

// Developer    : Gaurav Jain
// Created Date : 01-Sep-2026
// Purpose      : Create a license and index it by email.
// Every payment rail funnels through here so the record shape has one owner.
async function mintLicense(env, { email, plan, amountUSD, source, txnId, note }) {
    const createdAt = nowSeconds();
    const licenseKey = generateLicenseKey();
    const record = {
        email: email ?? null,
        plan,
        status: 'active',
        currentPeriodEnd: computePeriodEnd(plan, createdAt),
        source,
        txnId: txnId ?? null,
        amountUSD: Number.isFinite(Number(amountUSD)) ? Number(amountUSD) : null,
        note: note ?? null,
        createdAt,
    };

    await env.LICENSES.put(`lic:${licenseKey}`, JSON.stringify(record));
    if (email) await env.LICENSES.put(await emailIndexKey(email), licenseKey);
    return { licenseKey, record };
}

// Developer    : Gaurav Jain
// Created Date : 01-Sep-2026
// Purpose      : Extend a returning supporter's existing license instead of
//                minting a second key they would have to re-paste.
// Renewals stack from whichever is later — the current period end, or now — so
// paying early never silently burns the remaining days, and paying long after
// expiry gives a full fresh period rather than backdating it.
async function extendLicense(env, licenseKey, plan, amountUSD, txnId) {
    const existing = await env.LICENSES.get(`lic:${licenseKey}`, 'json');
    if (!existing) return null;

    const duration = PLAN_DURATION_SECONDS[plan];
    let currentPeriodEnd;
    if (duration === null || duration === undefined) {
        currentPeriodEnd = null; // upgraded to lifetime
    } else if (existing.currentPeriodEnd == null) {
        currentPeriodEnd = null; // already lifetime — never downgrade
    } else {
        const base = Math.max(nowSeconds(), Number(existing.currentPeriodEnd) || 0);
        currentPeriodEnd = base + duration;
    }

    const updated = {
        ...existing,
        plan: currentPeriodEnd === null ? 'lifetime' : plan,
        status: 'active',
        txnId: txnId ?? existing.txnId,
        currentPeriodEnd,
        amountUSD: Number.isFinite(Number(amountUSD)) ? Number(amountUSD) : existing.amountUSD,
    };
    await env.LICENSES.put(`lic:${licenseKey}`, JSON.stringify(updated));
    return { licenseKey, record: updated };
}

// Developer    : Gaurav Jain
// Created Date : 01-Sep-2026
// Purpose      : Single entry point every payment webhook shares — dedupe by
//                transaction id, then either extend or mint.
// The txn: guard is RESERVED before minting, not written after: webhooks retry,
// and writing it afterwards leaves a window where a redelivery mints a second
// key and double-counts the donation total.
async function grantFromPayment(env, { email, amountUSD, source, txnId, note }) {
    const plan = planFromAmountUSD(amountUSD);
    if (!plan) {
        await recordOrphanPayment(env, { email, amountUSD, source, txnId, reason: 'below_minimum' });
        return { skipped: 'below_minimum' };
    }

    // Without an email there is no way for the buyer to ever reach the key, so
    // minting one would quietly take their money. Fail loud instead: the
    // payment is recoverable by hand with /admin/grant.
    if (!email) {
        await recordOrphanPayment(env, { email: null, amountUSD, source, txnId, reason: 'missing_email' });
        return { skipped: 'missing_email' };
    }

    const txnKey = txnId ? `txn:${source}:${txnId}` : null;
    if (txnKey) {
        const existingTxn = await env.LICENSES.get(txnKey);
        // Only a COMPLETED reservation blocks a redelivery. A "pending" one
        // means a previous attempt died mid-mint — falling through and minting
        // again is right, because a duplicate licence is a trivial problem and
        // a permanently un-mintable payment is somebody's money gone.
        if (existingTxn && existingTxn !== 'pending') {
            console.log(`[redditdl-license] ${source} payment ${txnId} already processed — ignoring redelivery.`);
            return { licenseKey: existingTxn, deduped: true };
        }
        // TTL so a crashed mint self-heals instead of poisoning the transaction
        // forever. Long enough to dedupe a burst of redeliveries, short enough
        // that a manual resend an hour later still works.
        await env.LICENSES.put(txnKey, 'pending', { expirationTtl: 300 });
    }

    let result = null;
    try {
        const existingKey = await env.LICENSES.get(await emailIndexKey(email));
        if (existingKey) result = await extendLicense(env, existingKey, plan, amountUSD, txnId);
        if (!result) result = await mintLicense(env, { email, plan, amountUSD, source, txnId, note });
    } catch (err) {
        // Release the reservation before giving up, so a retry isn't deduped
        // against a mint that never happened.
        if (txnKey) await env.LICENSES.delete(txnKey).catch(() => {});
        await recordOrphanPayment(env, { email, amountUSD, source, txnId, reason: 'mint_failed', detail: String(err && err.message) });
        throw err;
    }

    if (txnKey) await env.LICENSES.put(txnKey, result.licenseKey);
    await addToStats(env, amountUSD);
    return result;
}

// Developer    : Gaurav Jain
// Created Date : 18-Sep-2026
// Purpose      : Durably record a payment that was charged but minted nothing.
// Every skip path used to leave only a console line, which is not persisted —
// so a mis-set page currency could silently swallow every sale and the owner
// would see an empty /stats indistinguishable from "no sales yet". These
// records are what GET /admin/orphans reads.
async function recordOrphanPayment(env, { email, amountUSD, currency, source, txnId, reason, detail }) {
    try {
        const id = txnId || crypto.randomUUID();
        await env.LICENSES.put(`orphan:${source}:${id}`, JSON.stringify({
            email: email ?? null,
            amountUSD: amountUSD ?? null,
            currency: currency ?? null,
            source,
            txnId: txnId ?? null,
            reason,
            detail: detail ?? null,
            at: nowSeconds(),
        }));
        console.error(`[redditdl-license] ORPHAN PAYMENT (${reason}) ${source}:${id} — charged but no licence minted. See GET /admin/orphans.`);
    } catch (err) {
        console.error('[redditdl-license] Could not even record the orphan payment:', err);
    }
}

// Best-effort running total. Workers KV has no atomic increment, so two
// payments landing in the same instant can lose one increment — acceptable
// here, and the payment platforms remain the authoritative record.
async function addToStats(env, amountUSD) {
    const existing = (await env.LICENSES.get('stats:pipeline', 'json')) || {
        totalUSD: 0, paymentCount: 0, lastUpdatedAt: null,
    };
    await env.LICENSES.put('stats:pipeline', JSON.stringify({
        totalUSD: Math.round((existing.totalUSD + (Number(amountUSD) || 0)) * 100) / 100,
        paymentCount: (existing.paymentCount || existing.supporterCount || 0) + 1,
        lastUpdatedAt: nowSeconds(),
    }));
}

// ---------------------------------------------------------------------------
// POST /webhook/kofi
// ---------------------------------------------------------------------------
//
// Ko-fi posts application/x-www-form-urlencoded with a single `data` field
// holding the JSON payload, and authenticates by including the account's own
// verification token inside that JSON rather than by signing the request.

// Developer    : Gaurav Jain
// Created Date : 01-Sep-2026
// Purpose      : Turn a Ko-fi payment into a license the buyer can retrieve.
async function handleKofiWebhook(request, env) {
    if (!env.KOFI_VERIFICATION_TOKEN) {
        console.error('[redditdl-license] KOFI_VERIFICATION_TOKEN is not set — refusing the webhook.');
        return jsonResponse({ error: 'not_configured' }, 503);
    }

    let payload;
    try {
        const form = await request.formData();
        payload = JSON.parse(form.get('data'));
    } catch (err) {
        console.error('[redditdl-license] Ko-fi webhook body was not parseable:', err);
        return jsonResponse({ error: 'invalid_payload' }, 400);
    }

    if (!timingSafeEqual(String(payload.verification_token || ''), env.KOFI_VERIFICATION_TOKEN)) {
        console.error('[redditdl-license] Ko-fi webhook verification token mismatch.');
        return jsonResponse({ error: 'invalid_token' }, 401);
    }

    if (payload.kofi_transaction_id === KOFI_TEST_TRANSACTION_ID) {
        console.log('[redditdl-license] Ko-fi test webhook received — token is correct, nothing minted.');
        return jsonResponse({ received: true, note: 'test_payload_ignored' });
    }

    if (payload.type && !KOFI_LICENSING_TYPES.includes(payload.type)) {
        // Recorded rather than dropped: a Commission is not meant to buy a
        // licence, but if someone paid one expecting access the owner needs to
        // be able to see it and grant by hand.
        await recordOrphanPayment(env, {
            email: payload.email || null,
            amountUSD: parseFloat(payload.amount),
            currency: payload.currency,
            source: 'kofi',
            txnId: payload.kofi_transaction_id || null,
            reason: 'non_licensing_type',
            detail: String(payload.type),
        });
        return jsonResponse({ received: true, note: 'non_licensing_type' });
    }

    // Ko-fi reports `amount` as a decimal string in the *page's* currency,
    // which is a per-account setting. Only USD maps onto the price ladder;
    // anything else is logged for a manual grant rather than guessed at with a
    // stale exchange rate. SETUP.md tells the owner to set the page to USD.
    const currency = String(payload.currency || 'USD').toUpperCase();
    if (currency !== 'USD') {
        // The likeliest catastrophe on this whole rail: one wrong account
        // setting silently swallows EVERY sale. Durable record, loud log.
        await recordOrphanPayment(env, {
            email: payload.email || null,
            amountUSD: parseFloat(payload.amount),
            currency,
            source: 'kofi',
            txnId: payload.kofi_transaction_id || null,
            reason: 'non_usd_currency',
            detail: `Ko-fi page currency is ${currency}. Set it to USD in Ko-fi settings.`,
        });
        return jsonResponse({ received: true, note: 'non_usd_requires_manual_grant' });
    }

    try {
        await grantFromPayment(env, {
            email: payload.email || null,
            amountUSD: parseFloat(payload.amount),
            source: 'kofi',
            txnId: payload.kofi_transaction_id || null,
            note: typeof payload.message === 'string' ? payload.message.slice(0, 500) : null,
        });
    } catch (err) {
        // Ko-fi retries on non-2xx. A bug on our side must not turn into a
        // retry storm, so it is logged and acked — but never silently: the
        // orphan record is what makes this payment findable afterwards.
        console.error('[redditdl-license] Ko-fi webhook handling failed:', err);
        await recordOrphanPayment(env, {
            email: payload.email || null,
            amountUSD: parseFloat(payload.amount),
            currency,
            source: 'kofi',
            txnId: payload.kofi_transaction_id || null,
            reason: 'handler_threw',
            detail: String(err && err.message),
        });
    }

    return jsonResponse({ received: true });
}

// ---------------------------------------------------------------------------
// POST /webhook/paypal
// ---------------------------------------------------------------------------

function paypalApiBase(env) {
    return env.PAYPAL_ENV === 'sandbox'
        ? 'https://api-m.sandbox.paypal.com'
        : 'https://api-m.paypal.com';
}

async function getPaypalAccessToken(env) {
    const res = await fetch(`${paypalApiBase(env)}/v1/oauth2/token`, {
        method: 'POST',
        headers: {
            Authorization: `Basic ${btoa(`${env.PAYPAL_CLIENT_ID}:${env.PAYPAL_SECRET}`)}`,
            'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: 'grant_type=client_credentials',
    });
    if (!res.ok) {
        console.error('[redditdl-license] PayPal OAuth token request failed:', res.status);
        return null;
    }
    const { access_token: accessToken } = await res.json();
    return accessToken || null;
}

// Developer    : Gaurav Jain
// Created Date : 01-Sep-2026
// Purpose      : Ask PayPal itself whether a webhook it sent is genuine.
// PayPal signs with a rotating certificate rather than a shared secret, so
// verification is a call back to their API instead of a local HMAC.
async function verifyPaypalSignature(env, headers, event, accessToken) {
    const res = await fetch(`${paypalApiBase(env)}/v1/notifications/verify-webhook-signature`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
            auth_algo: headers.get('paypal-auth-algo'),
            cert_url: headers.get('paypal-cert-url'),
            transmission_id: headers.get('paypal-transmission-id'),
            transmission_sig: headers.get('paypal-transmission-sig'),
            transmission_time: headers.get('paypal-transmission-time'),
            webhook_id: env.PAYPAL_WEBHOOK_ID,
            // The parsed object, not the raw string — PayPal re-serializes it
            // their way before checking the signature.
            webhook_event: event,
        }),
    });
    if (!res.ok) {
        console.error('[redditdl-license] PayPal signature verification call failed:', res.status);
        return false;
    }
    const { verification_status: status } = await res.json();
    return status === 'SUCCESS';
}

// Developer    : Gaurav Jain
// Created Date : 02-Sep-2026
// Purpose      : Find the buyer's email for a capture event.
// A PAYMENT.CAPTURE.COMPLETED resource carries no payer object — the only
// email on it is the merchant's. The buyer's address lives on the parent
// order, so it takes a second call to fetch it.
async function paypalBuyerEmail(env, event, accessToken) {
    const orderId = event.resource?.supplementary_data?.related_ids?.order_id;
    if (!orderId) return null;

    const res = await fetch(`${paypalApiBase(env)}/v2/checkout/orders/${orderId}`, {
        headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!res.ok) {
        console.error(`[redditdl-license] Could not fetch PayPal order ${orderId}:`, res.status);
        return null;
    }
    const order = await res.json();
    return order.payer?.email_address || order.payment_source?.paypal?.email_address || null;
}

// Developer    : Gaurav Jain
// Created Date : 01-Sep-2026
// Purpose      : Turn a completed PayPal capture into a license.
async function handlePaypalWebhook(request, env) {
    if (!env.PAYPAL_CLIENT_ID || !env.PAYPAL_SECRET || !env.PAYPAL_WEBHOOK_ID) {
        return jsonResponse({ error: 'not_configured' }, 503);
    }

    // Parse before spending any PayPal API calls, so unauthenticated junk is
    // rejected cheaply instead of burning two live requests then throwing.
    let event;
    try {
        event = await request.json();
    } catch (err) {
        return jsonResponse({ error: 'invalid_payload' }, 400);
    }
    if (!event || typeof event !== 'object' || !event.event_type) {
        return jsonResponse({ error: 'invalid_payload' }, 400);
    }

    const accessToken = await getPaypalAccessToken(env);
    if (!accessToken) {
        // Our credentials or PayPal are the problem, not the caller's request.
        // 503 lets PayPal retry a genuine event later.
        return jsonResponse({ error: 'paypal_unavailable' }, 503);
    }

    if (!(await verifyPaypalSignature(env, request.headers, event, accessToken))) {
        console.error('[redditdl-license] PayPal webhook signature verification failed.');
        return jsonResponse({ error: 'invalid_signature' }, 401);
    }

    if (event.event_type !== 'PAYMENT.CAPTURE.COMPLETED') {
        return jsonResponse({ received: true, ignored: event.event_type });
    }

    try {
        const capture = event.resource || {};
        const amount = capture.amount || {};
        if (String(amount.currency_code || 'USD').toUpperCase() !== 'USD') {
            console.warn(`[redditdl-license] PayPal capture ${capture.id} is in ${amount.currency_code} — needs a manual grant.`);
            return jsonResponse({ received: true, note: 'non_usd_requires_manual_grant' });
        }
        await grantFromPayment(env, {
            email: await paypalBuyerEmail(env, event, accessToken),
            amountUSD: parseFloat(amount.value),
            source: 'paypal',
            txnId: capture.id || event.id || null,
            note: capture.custom_id || null,
        });
    } catch (err) {
        console.error('[redditdl-license] PayPal webhook handling failed:', err);
    }

    return jsonResponse({ received: true });
}

// ---------------------------------------------------------------------------
// POST /retrieve
// ---------------------------------------------------------------------------

// Rate limit keyed on the caller's IP. Read-then-write over eventually
// consistent KV, so concurrent requests can slip past — a speed bump against
// casual scraping, not a hard guarantee.
async function isRateLimited(env, ip) {
    const key = `rl:${ip}`;
    const count = Number(await env.LICENSES.get(key)) || 0;
    if (count >= RETRIEVE_RATE_LIMIT.maxPerWindow) return true;
    await env.LICENSES.put(key, String(count + 1), { expirationTtl: RETRIEVE_RATE_LIMIT.windowSeconds });
    return false;
}

// Developer    : Gaurav Jain
// Created Date : 01-Sep-2026
// Purpose      : Let a buyer swap the email they paid with for their key,
//                so activation is instant and needs no action from the owner.
// Tradeoff: knowing a supporter's email is enough to read their key. For a
// $1-$10 license that is the right trade against making people wait on a
// human, and it is why this route is rate-limited.
async function handleRetrieve(request, env) {
    const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
    if (await isRateLimited(env, ip)) {
        return jsonResponse({ ok: false, error: 'rate_limited' }, 429);
    }

    let body;
    try {
        body = await request.json();
    } catch (err) {
        return jsonResponse({ ok: false, error: 'invalid_json' }, 400);
    }

    const email = body && body.email;
    if (!isPlausibleEmail(email)) {
        return jsonResponse({ ok: false, error: 'invalid_email' }, 400);
    }

    const licenseKey = await env.LICENSES.get(await emailIndexKey(email));
    if (!licenseKey) {
        return jsonResponse({ ok: false, error: 'not_found' }, 404);
    }

    const record = await env.LICENSES.get(`lic:${licenseKey}`, 'json');
    if (!record) {
        return jsonResponse({ ok: false, error: 'not_found' }, 404);
    }

    return jsonResponse({
        ok: true,
        licenseKey,
        plan: record.plan,
        currentPeriodEnd: record.currentPeriodEnd,
        valid: isLicenseValid(record),
    });
}

// ---------------------------------------------------------------------------
// GET /verify?key=<licenseKey>
// ---------------------------------------------------------------------------

async function handleVerify(request, env) {
    const key = new URL(request.url).searchParams.get('key');
    if (!key) return jsonResponse({ error: 'missing_key' }, 400);

    const notFound = { valid: false, plan: null, status: 'not_found', currentPeriodEnd: null, source: null };
    if (key.length > MAX_LICENSE_KEY_LENGTH) return jsonResponse(notFound);

    const record = await env.LICENSES.get(`lic:${key}`, 'json');
    // The extension polls this on a schedule, so an unknown key is a normal
    // answer rather than an error.
    if (!record) return jsonResponse(notFound);

    return jsonResponse({
        valid: isLicenseValid(record),
        plan: record.plan,
        status: record.status,
        currentPeriodEnd: record.currentPeriodEnd,
        source: record.source,
    });
}

// ---------------------------------------------------------------------------
// GET /stats
// ---------------------------------------------------------------------------

async function handleStats(env) {
    const stats = (await env.LICENSES.get('stats:pipeline', 'json')) || {
        totalUSD: 0, paymentCount: 0, lastUpdatedAt: null,
    };
    return jsonResponse({
        totalUSD: stats.totalUSD || 0,
        // supporterCount was the pre-02-Sep field name; keep reading it so an
        // already-populated counter doesn't reset to zero on deploy.
        paymentCount: stats.paymentCount ?? stats.supporterCount ?? 0,
        lastUpdatedAt: stats.lastUpdatedAt ?? null,
    });
}

// ---------------------------------------------------------------------------
// Admin routes
// ---------------------------------------------------------------------------

function isAdminAuthorized(request, env) {
    const provided = request.headers.get('X-Admin-Secret');
    return Boolean(provided && env.ADMIN_SECRET && timingSafeEqual(provided, env.ADMIN_SECRET));
}

async function readJsonBody(request) {
    try {
        return await request.json();
    } catch (err) {
        return null;
    }
}

// Resolves either { licenseKey } or { email } to a license key.
async function resolveLicenseKey(env, body) {
    if (body.licenseKey) return String(body.licenseKey);
    if (isPlausibleEmail(body.email)) return env.LICENSES.get(await emailIndexKey(body.email));
    return null;
}

// Developer    : Gaurav Jain
// Created Date : 01-Sep-2026
// Purpose      : Mint a license by hand — comps, non-USD payments, and the
//                Ko-fi supporters who paid before licensing existed.
async function handleAdminGrant(request, env) {
    if (!isAdminAuthorized(request, env)) return jsonResponse({ error: 'unauthorized' }, 401);

    const body = await readJsonBody(request);
    if (!body) return jsonResponse({ error: 'invalid_json' }, 400);

    const { email, plan, note } = body;
    if (!Object.prototype.hasOwnProperty.call(PLAN_DURATION_SECONDS, plan)) {
        return jsonResponse({ error: 'invalid_plan' }, 400);
    }

    // Unlike a payment grant this does not touch /stats — there is no verified
    // amount behind it, so counting it would mean inventing a number.
    const { licenseKey, record } = await mintLicense(env, {
        email: email || null,
        plan,
        amountUSD: null,
        source: 'manual-grant',
        txnId: null,
        note: note || null,
    });
    return jsonResponse({ ok: true, licenseKey, plan: record.plan, currentPeriodEnd: record.currentPeriodEnd });
}

// Developer    : Gaurav Jain
// Created Date : 02-Sep-2026
// Purpose      : Kill a license after a refund or chargeback.
// Flips status rather than deleting, so the record survives for support and
// history; isLicenseValid already refuses anything not "active".
async function handleAdminRevoke(request, env) {
    if (!isAdminAuthorized(request, env)) return jsonResponse({ error: 'unauthorized' }, 401);

    const body = await readJsonBody(request);
    if (!body) return jsonResponse({ error: 'invalid_json' }, 400);

    const licenseKey = await resolveLicenseKey(env, body);
    if (!licenseKey) return jsonResponse({ error: 'not_found' }, 404);

    const record = await env.LICENSES.get(`lic:${licenseKey}`, 'json');
    if (!record) return jsonResponse({ error: 'not_found' }, 404);

    await env.LICENSES.put(`lic:${licenseKey}`, JSON.stringify({
        ...record,
        status: 'canceled',
        note: body.reason ? `${record.note ? record.note + ' | ' : ''}revoked: ${body.reason}` : record.note,
    }));
    return jsonResponse({ ok: true, licenseKey, status: 'canceled' });
}

// Developer    : Gaurav Jain
// Created Date : 02-Sep-2026
// Purpose      : Erase a license and its indexes for a data-deletion request.
// privacy.html promises this, so it has to be one call rather than three
// hand-computed KV deletes.
async function handleAdminDelete(request, env) {
    if (!isAdminAuthorized(request, env)) return jsonResponse({ error: 'unauthorized' }, 401);

    const body = await readJsonBody(request);
    if (!body) return jsonResponse({ error: 'invalid_json' }, 400);

    const licenseKey = await resolveLicenseKey(env, body);
    if (!licenseKey) return jsonResponse({ error: 'not_found' }, 404);

    const record = await env.LICENSES.get(`lic:${licenseKey}`, 'json');
    if (!record) return jsonResponse({ error: 'not_found' }, 404);

    await env.LICENSES.delete(`lic:${licenseKey}`);
    if (record.email) await env.LICENSES.delete(await emailIndexKey(record.email));
    if (record.source && record.txnId) await env.LICENSES.delete(`txn:${record.source}:${record.txnId}`);

    return jsonResponse({ ok: true, deleted: licenseKey });
}

// Developer    : Gaurav Jain
// Created Date : 18-Sep-2026
// Purpose      : Look a customer up by the email they paid with.
// The one question support actually asks. Without it the owner could only page
// through an arbitrary 40 licences, which answers nothing once there are more
// customers than that.
async function handleAdminLookup(request, env) {
    if (!isAdminAuthorized(request, env)) return jsonResponse({ error: 'unauthorized' }, 401);

    const email = new URL(request.url).searchParams.get('email');
    if (!isPlausibleEmail(email)) return jsonResponse({ error: 'invalid_email' }, 400);

    const licenseKey = await env.LICENSES.get(await emailIndexKey(email));
    if (!licenseKey) return jsonResponse({ found: false, email });

    const record = await env.LICENSES.get(`lic:${licenseKey}`, 'json');
    if (!record) return jsonResponse({ found: false, email, note: 'index points at a missing record' });

    return jsonResponse({ found: true, licenseKey, valid: isLicenseValid(record), ...record });
}

// Developer    : Gaurav Jain
// Created Date : 23-Sep-2026
// Purpose      : Correct the public donation counter.
// The counter is shown publicly on the transparency page, so the owner needs a
// way to undo test payments — and to fix it if a lost-update race ever skews
// it. Body: { totalUSD, paymentCount } — omit either to leave it alone.
async function handleAdminSetStats(request, env) {
    if (!isAdminAuthorized(request, env)) return jsonResponse({ error: 'unauthorized' }, 401);

    const body = await readJsonBody(request);
    if (!body) return jsonResponse({ error: 'invalid_json' }, 400);

    const existing = (await env.LICENSES.get('stats:pipeline', 'json')) || { totalUSD: 0, paymentCount: 0, lastUpdatedAt: null };
    const updated = {
        totalUSD: Number.isFinite(Number(body.totalUSD)) ? Number(body.totalUSD) : existing.totalUSD,
        paymentCount: Number.isFinite(Number(body.paymentCount)) ? Number(body.paymentCount) : (existing.paymentCount ?? 0),
        lastUpdatedAt: nowSeconds(),
    };
    await env.LICENSES.put('stats:pipeline', JSON.stringify(updated));
    return jsonResponse({ ok: true, ...updated });
}

// Developer    : Gaurav Jain
// Created Date : 18-Sep-2026
// Purpose      : List payments that were charged but produced no licence.
// This is the reconciliation route — the only way to discover that a wrong
// account setting has been quietly swallowing sales.
async function handleAdminOrphans(request, env) {
    if (!isAdminAuthorized(request, env)) return jsonResponse({ error: 'unauthorized' }, 401);

    const page = await env.LICENSES.list({ prefix: 'orphan:', limit: ADMIN_LIST_MAX });
    const records = await Promise.all(page.keys.map((k) => env.LICENSES.get(k.name, 'json')));

    const orphans = [];
    page.keys.forEach((k, i) => {
        if (records[i]) orphans.push({ id: k.name.slice('orphan:'.length), ...records[i] });
    });
    orphans.sort((a, b) => (b.at || 0) - (a.at || 0));

    return jsonResponse({
        orphans,
        returned: orphans.length,
        truncated: !page.list_complete,
        note: orphans.length ? 'Each of these is a payment that took money and minted nothing. Grant them by hand with POST /admin/grant.' : undefined,
    });
}

// Owner's ledger view. Bounded so it can't outgrow the per-request subrequest
// budget; truncation is reported rather than silent.
async function handleAdminListLicenses(request, env) {
    if (!isAdminAuthorized(request, env)) return jsonResponse({ error: 'unauthorized' }, 401);

    const page = await env.LICENSES.list({ prefix: 'lic:', limit: ADMIN_LIST_MAX });
    const records = await Promise.all(page.keys.map((k) => env.LICENSES.get(k.name, 'json')));

    const licenses = [];
    page.keys.forEach((k, i) => {
        if (records[i]) licenses.push({ licenseKey: k.name.slice('lic:'.length), ...records[i] });
    });
    licenses.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));

    return jsonResponse({
        licenses,
        returned: licenses.length,
        truncated: !page.list_complete,
        note: page.list_complete ? undefined : `Showing the first ${ADMIN_LIST_MAX}. Use wrangler kv key list for the full set.`,
    });
}

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

export default {
    async fetch(request, env) {
        const { pathname } = new URL(request.url);
        const method = request.method;

        try {
            if (method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS_HEADERS });

            if (method === 'POST' && pathname === '/webhook/kofi') return await handleKofiWebhook(request, env);
            if (method === 'POST' && pathname === '/webhook/paypal') return await handlePaypalWebhook(request, env);
            if (method === 'POST' && pathname === '/retrieve') return await handleRetrieve(request, env);
            if (method === 'GET' && pathname === '/verify') return await handleVerify(request, env);
            if (method === 'GET' && pathname === '/stats') return await handleStats(env);
            if (method === 'POST' && pathname === '/admin/grant') return await handleAdminGrant(request, env);
            if (method === 'POST' && pathname === '/admin/revoke') return await handleAdminRevoke(request, env);
            if (method === 'POST' && pathname === '/admin/delete') return await handleAdminDelete(request, env);
            if (method === 'GET' && pathname === '/admin/lookup') return await handleAdminLookup(request, env);
            if (method === 'POST' && pathname === '/admin/stats') return await handleAdminSetStats(request, env);
            if (method === 'GET' && pathname === '/admin/orphans') return await handleAdminOrphans(request, env);
            if (method === 'GET' && pathname === '/admin/licenses') return await handleAdminListLicenses(request, env);

            return jsonResponse({ error: 'not_found' }, 404);
        } catch (err) {
            console.error('[redditdl-license] Unhandled error:', err);
            return jsonResponse({ error: 'internal_error' }, 500);
        }
    },
};
