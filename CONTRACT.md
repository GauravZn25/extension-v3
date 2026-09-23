# RedditDL Pro — licensing contract (internal spec)

Single source of truth for the paywall. Every piece (Worker, `license.js`,
`background.js`, `welcome.js`, `popup.js`, `options.js`, `transparency.js`) must
match this. If you need to change a shape while implementing, change this file
first, then match it everywhere.

**v3 (2026-09-01) — the model is now: the buyer pays the developer, the
developer donates it on.** Previous versions routed money to the charity
directly (give.do, v2) or through Stripe subscriptions (v1). Both are gone from
the codebase — not dormant, deleted. There is one rail now.

## 1. The model

| | |
|---|---|
| **Free trial** | First **100 successful gallery downloads**, no licence or account |
| **Who is paid** | The developer, via Ko-fi (which accepts card *and* PayPal) |
| **Where the money goes** | 100% donated on to CanKids…KidsCan, receipts published |
| **Activation** | Automatic. Ko-fi's webhook mints the licence within seconds |
| **How the buyer unlocks** | Types the email they paid with; no key to copy-paste |

### 1.0 The free trial

`FREE_GALLERY_LIMIT = 100` in `license.js`, counted in
`redditdl_free_galleries_used` (`chrome.storage.sync`).

- **Counted per gallery, not per file.** One click = one credit, whether it
  saves 1 image or 40. That is what "100 free downloads" means to a user.
- **Only a successful download charges a credit.** `count > 0` is the
  condition — a gallery that yields nothing must not cost the user part of
  their trial for the extension's own failure.
- **The access decision is resolved once, up front** (`checkDownloadAccess`)
  and reused when charging, so a concurrent click can't cause a download that
  was admitted on the trial to be charged against different state.
- **A licence short-circuits it entirely.** A paying user never consumes a
  credit and is never shown trial copy.
- Remaining count rides along on every `getLicenseStatus` reply and on a
  successful `fetchAndDownload`, so the popup, the options page and the button
  can all show it without a second round trip. Running out must never be a
  surprise mid-task.

This is a trial, not DRM. Clearing extension data resets it, and that is fine
— it exists to let people try the thing before paying, not to be uncircumventable.

It is also what keeps the Web Store listing honest: without it, the extension
installs and does nothing until you pay, which is the single biggest
deceptive-installation rejection risk for this listing.

### 1.1 Prices

| Tier | Price (USD) | Licence length |
|---|---|---|
| Monthly | $1 | 30 days |
| Yearly | $5 | 365 days |
| Lifetime | $10 | never expires |

Tier is derived from the **amount paid**, not from a product the buyer picks —
Ko-fi lets supporters type any amount, so the Worker maps it onto the ladder:

```
>= $9.99  → lifetime
>= $4.99  → annual
>= $0.99  → monthly
<  $0.99  → no licence minted (logged; recoverable via /admin/grant)
```

Thresholds sit a cent low because currency conversion can land a payment a
fraction short. Overpaying gets the higher tier; that is intended.

Ko-fi URL: `https://ko-fi.com/gauravzn`. Hard-coded in `welcome.html`,
`popup.js`, `options.js`, `content.js` — it is a real, stable URL, not a
placeholder.

### 1.2 The charity claim — exact permitted wording

The headline claim is **"100% goes to CanKids…KidsCan"**. It must always be
accompanied, on the same page, by the fee qualification: Ko-fi and its
processor deduct their cut before the money reaches the developer, and 100% of
what *arrives* is what gets donated on.

Never claim the money bypasses the developer's account — under v3 it does not.
Never claim a donation cadence ("quarterly") that isn't being honoured. Never
link to receipts that don't exist. Receipts live as **public monthly updates on
the Ko-fi page**, not in this repo — `transparency.html` points at them rather
than restating a number that could go stale. The claim is only true for as long
as those monthly posts actually happen.

### 1.3 Renewal

There is no auto-billing. Monthly and yearly licences simply expire, and the
UI says **"expires"**, never "renews". Paying again before expiry *extends*
from the existing period end rather than restarting from today — see
`extendLicense` — so nobody loses days by paying early.

## 2. Worker HTTP API

Base: `https://<WORKER_DOMAIN>` — one Cloudflare Worker, one KV namespace.
All responses carry permissive CORS headers and `OPTIONS` is handled.

### `POST /webhook/kofi`
- Ko-fi posts `application/x-www-form-urlencoded` with one `data` field holding JSON.
- Authenticated by `data.verification_token` matching secret `KOFI_VERIFICATION_TOKEN`, compared in constant time. Mismatch → `401`.
- **Ko-fi's fixed test transaction id is recognised and ignored.** The owner will press "Send test" while wiring this up, and it must not mint or inflate the public counter.
- **Only `Donation`, `Subscription` and `Shop Order` buy a licence.** A `Commission` is paid work, not a purchase — granting a lifetime key for one would also book its value as a charity obligation.
- **Amount is in the Ko-fi page's currency**, which is a per-account setting. Only USD maps onto the ladder; anything else is acked, logged and left for `/admin/grant`. SETUP.md §1 makes setting the page to USD a hard step, because otherwise *every* payment silently mints nothing.
- Mints or extends, then always returns `200`: Ko-fi retries on non-2xx, and a bug here must not become a retry storm.

**Idempotency.** `txn:<source>:<id>` is **reserved before minting** (written as
`"pending"`, then overwritten with the real key). Writing it afterwards leaves a
window where a webhook redelivery mints a second key and double-counts the total.

**No email, no licence.** If a payload carries no email address there is no way
for the buyer to ever reach the key, so minting one would quietly take their
money. The Worker refuses, logs an error naming the transaction, and leaves it
for `/admin/grant`.

### `POST /webhook/paypal`
- Optional second rail for direct PayPal payments (Ko-fi's own PayPal option does *not* need this). Dark unless all three PayPal secrets are set → `503`.
- Body is parsed *before* any PayPal API call, so unauthenticated junk is rejected cheaply instead of burning two live requests.
- Verified by calling PayPal's `/v1/notifications/verify-webhook-signature` with `PAYPAL_CLIENT_ID` / `PAYPAL_SECRET` / `PAYPAL_WEBHOOK_ID`. Unverified → `401`. A transient PayPal outage returns `503` so a genuine event is retried rather than dismissed as a forgery.
- Acts only on `PAYMENT.CAPTURE.COMPLETED`.
- **The buyer's email is not on the capture event.** A capture resource carries only the *merchant's* address; the buyer's lives on the parent order. So the handler resolves `resource.supplementary_data.related_ids.order_id` and fetches `/v2/checkout/orders/{id}` for `payer.email_address`. Reading it off the capture yields `null` and — before the no-email guard existed — minted a licence nobody could ever reach.

### `POST /retrieve`
- Body `{ "email": string }`. Public, rate-limited to 10 calls per 10 minutes per IP (`429` past that).
- Returns `{ ok: true, licenseKey, plan, currentPeriodEnd, valid }`, or `404` `{ ok: false, error: "not_found" }`.
- **Known tradeoff:** knowing a buyer's email is enough to read their key. For a $1–$10 licence that beats making people wait on a human, and it is why the route is rate-limited. Revisit if abuse appears.

### `GET /verify?key=<licenseKey>`
- Returns `{ valid, plan, status, currentPeriodEnd, source }`.
- `valid` is true when `status === "active"` and either `currentPeriodEnd` is null or now is before `currentPeriodEnd + 3 days` (grace absorbs webhook lag).
- Unknown key → `200` with `{ valid: false, status: "not_found" }`. Not a 404 — the extension polls this.

### `GET /stats`
- Public, no PII: `{ totalUSD, paymentCount, lastUpdatedAt }`.
- `paymentCount` counts **payments, not people** — a renewal increments it. UI copy must say "payments", and must say "paid in", never "raised for CanKids": this is money collected, not money donated on. The monthly Ko-fi receipts are the number for that.
- Incremented by payment webhooks only. `/admin/grant` deliberately does not count — there is no verified amount behind a manual grant. Non-USD payments, payments with no email, and Ko-fi test payloads don't count either, so this is a floor.

### `POST /admin/grant`
- Header `X-Admin-Secret` must equal `ADMIN_SECRET` (constant-time). Else `401`.
- Body `{ email, plan, note }`. `plan` is any key of the duration table, including the legacy `semiannual` and `grandfathered`.
- Computes a real `currentPeriodEnd` from the plan — a monthly grant expires in 30 days, it does not live forever.

### `POST /admin/revoke`
- Header-authed. Body `{ licenseKey }` or `{ email }`, plus optional `reason`.
- Flips `status` to `"canceled"` — the record survives for history, and `isLicenseValid` already refuses anything not `"active"`. This is the refund/chargeback path.

### `POST /admin/delete`
- Header-authed. Body `{ licenseKey }` or `{ email }`.
- Deletes the `lic:` record and its `email:` and `txn:` indexes. `privacy.html` promises deletion on request; this is what keeps that promise.

### `GET /admin/licenses`
- Header-authed. The owner's ledger, newest first. Bounded to 40 records per call so it cannot outgrow the Workers per-request subrequest budget; the response carries `truncated: true` when there are more.

## 3. KV namespace `LICENSES`

```
lic:<licenseKey>   → { email, plan, status, currentPeriodEnd, source, txnId, amountUSD, note, createdAt }
email:<sha256hex>  → "<licenseKey>"     reverse index for /retrieve
txn:<source>:<id>  → "pending" | "<licenseKey>"   idempotency, reserved before minting
rl:<ip>            → "<count>"          /retrieve rate limit, expires by TTL
stats:pipeline     → { totalUSD, paymentCount, lastUpdatedAt }
```

The email in the **index key** is hashed so a KV key listing can't enumerate
addresses. That is not anonymisation — the `lic:` record stores the plaintext
email, because the owner needs it to match a payment to a licence. Don't
describe it as anonymous anywhere user-facing.

`plan` ∈ `monthly | annual | lifetime | semiannual | grandfathered` (last two
legacy, honoured but never sold). `source` ∈ `kofi | paypal | manual-grant`.
`status` ∈ `active | canceled`.

## 4. Worker secrets (`wrangler secret put`, never committed)

- `ADMIN_SECRET` — **required.** Guards `/admin/*`.
- `KOFI_VERIFICATION_TOKEN` — **required** for the Ko-fi rail. From Ko-fi → More → API.
- `PAYPAL_CLIENT_ID`, `PAYPAL_SECRET`, `PAYPAL_WEBHOOK_ID` — optional. The Worker must not throw when they are unset; the PayPal route simply refuses to verify.

## 5. Extension-side storage (`chrome.storage.sync`)

`sync`, not `local`, is deliberate — a paid licence follows the user to every
Chrome profile they are signed into.

- `redditdl_license_key: string | null`
- `redditdl_license_cache: { valid, plan, status, currentPeriodEnd, source, checkedAt } | null`
- `redditdl_free_galleries_used: number` — trial credits spent (§1.0). A failed read must **not** be treated as `0`; that hands out a fresh 100 and then overwrites the real count.

`chrome.storage.local` holds `redditdl_last_verify_attempt` — a per-device
throttle, deliberately not synced.

**Revalidation.** A `chrome.alarms` job re-checks every 12 hours; the download
gate also refreshes inline when the cache is stale (24h for a positive verdict,
5 minutes for a negative, so someone who has just re-paid isn't stuck behind a
paywall they already cleared). A 5-minute backoff stops an outage costing a
failed round trip per click.

### 5.1 The access rule — fail open, always

**A paying user must never be blocked by our own uncertainty.** `licenseStanding()`
resolves to one of four values, and only one of them withdraws access:

| Standing | When | Downloads? |
|---|---|---|
| `valid` | Server said yes | ✅ |
| `unconfirmed` | Server unreachable, no cache yet, **or a stored key the server reports as `not_found`** | ✅ |
| `invalid` | Server explicitly answered that the licence is not valid (`canceled`, or past its period) | Trial rules |
| `none` | No stored key — never activated | Trial rules |

There is **no grace-window expiry**. An outage of any length keeps paying users
working. This is safe because `redditdl_license_key` is only ever written by
`activateLicenseKey` *after* the server confirmed the licence — so a non-payer
has no key to be unconfirmed about, and taking the server offline grants nobody
anything.

`not_found` on a **stored** key is treated as our data loss (wiped or restored
KV, re-pointed binding), not as a lapsed customer, for the same reason: a bogus
key never gets stored. Deliberate revocation returns `canceled`, which still
blocks correctly.

If `chrome.storage.sync` cannot be read after 3 retries, the gate also fails
open. Unknown state is never treated as "unlicensed".

The deliberate trade, chosen by the project owner: an occasional free download
for a non-payer is acceptable; a paying customer seeing a paywall is not.

The alarm is load-bearing, not a nicety: without it the cache only refreshed
when the user happened to open the popup.

## 6. Extension-internal messages

All follow the existing `{action: "..."}` convention. Every one of them is
handled in `background.js`'s single `onMessage` listener and implemented in
`license.js`.

- `{ action: "getLicenseStatus" }` → `{ valid, plan, status, currentPeriodEnd, source }`. Answers from cache immediately — the UI must never block on a network round trip — and revalidates in the background when stale. A key with no cache answers `status: "checking"` and kicks a refresh rather than dead-ending on "not licensed".
- `{ action: "activateLicense", key }` → `{ ok: true, valid, plan, status }` | `{ ok: false, error: "invalid_key" | "network_error" | "storage_error" }`. Reports failure if the storage write fails — otherwise the UI says "active" and the licence vanishes on the next service-worker restart.
- `{ action: "retrieveLicense", email }` → same shape, plus `error: "not_found" | "rate_limited"`. Calls `/retrieve` then runs the returned key through the activation path.
- `{ action: "getStats" }` → `{ ok: true, totalUSD, supporterCount, lastUpdatedAt }` | `{ ok: false, error }`. Proxied so `WORKER_DOMAIN` lives in exactly one file.
- `{ action: "openPaywall" }` → opens `welcome.html#paywall`. No response.
- `{ action: "fetchAndDownload", ... }` — existing handler, unchanged shape, with an access pre-check as its first step: if `await checkDownloadAccess()` returns `allowed: false` (no licence **and** no trial credits — §1.0), reply `{ ok: false, reason: "license_required" }` and do nothing else. `content.js` special-cases that reason to open the paywall. On success the reply also carries `trialRemaining` (a number on the trial, `null` when licensed).

**The gate is async on purpose.** MV3 tears the service worker down after ~30s
idle, so a synchronous check runs before `chrome.storage.sync` has hydrated and
tells a paying user they are unlicensed on the first click after every
teardown. `checkDownloadAccess()` awaits hydration.

## 7. manifest.json

`host_permissions` needs the Worker's real host. It ships as
`https://REPLACE-WITH-YOUR-WORKER-DOMAIN.workers.dev/*` — a **syntactically
valid** match pattern, so Chrome loads without a warning, but obviously a
placeholder. `build.ps1` fails the build if it survives to packaging.

`permissions` includes `alarms` for the revalidation job (§5).

## 8. File layout

| File | Role |
|---|---|
| `license-server/worker.js` | The entire backend |
| `license-server/wrangler.toml` | KV binding, vars |
| `license.js` | Extension side: verify, activate, retrieve, stats. **The only file holding `WORKER_DOMAIN`.** |
| `background.js` | Message router + the download gate |
| `welcome.html` / `welcome.js` | Pricing cards, unlock-by-email, key activation, live counter |
| `transparency.html` / `transparency.js` | Live total + link to the monthly Ko-fi receipts |
| `privacy.html` | Privacy policy — required by the Web Store |
| `popup.js` / `options.js` | Licence banner + "Extend on Ko-fi" |
| `build.ps1` | Allowlist packaging; fails on unreplaced placeholders |

**Never put an inline `<script>` in an extension page.** MV3's `extension_pages`
CSP blocks it silently — `transparency.html` shipped a broken counter for
exactly this reason before v3.
