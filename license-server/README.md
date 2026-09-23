# redditdl-license — Cloudflare Worker

The whole backend for RedditDL Pro's paywall. One Worker, one KV namespace, no
npm dependencies. See [CONTRACT.md](../CONTRACT.md) for the spec this
implements and [SETUP.md](../SETUP.md) for the full owner runbook.

**This folder must never ship inside the extension zip.** It is server code and
its route surface is not something to hand every installer.

## Deploy

```bash
npm install -g wrangler
wrangler login

wrangler kv namespace create redditdl-license-kv   # paste the id into wrangler.toml

wrangler secret put ADMIN_SECRET             # required
wrangler secret put KOFI_VERIFICATION_TOKEN  # required for the Ko-fi rail
wrangler secret put PAYPAL_CLIENT_ID         # optional — PayPal rail only
wrangler secret put PAYPAL_SECRET            # optional
wrangler secret put PAYPAL_WEBHOOK_ID        # optional

wrangler deploy
```

Wrangler prints the live URL. That host goes into `manifest.json`,
`license.js`, `welcome.js` and `transparency.js` — see SETUP.md §3.

## Routes

| Route | Auth | Purpose |
|---|---|---|
| `POST /webhook/kofi` | Ko-fi verification token in body | Payment → license, instantly |
| `POST /webhook/paypal` | PayPal signature, verified via their API | Payment → license, instantly |
| `POST /retrieve` | none, rate-limited 10 / 10 min / IP | Buyer swaps their email for their key |
| `GET /verify?key=` | none | Polled by the extension |
| `GET /stats` | none | Public running total |
| `POST /admin/grant` | `X-Admin-Secret` | Manual mint |
| `POST /admin/revoke` | `X-Admin-Secret` | Kill a license (refund / chargeback) |
| `POST /admin/delete` | `X-Admin-Secret` | Erase a license + indexes (deletion requests) |
| `GET /admin/licenses` | `X-Admin-Secret` | Your ledger (max 40 per call) |

## KV records

```
lic:<licenseKey>   → { email, plan, status, currentPeriodEnd, source, txnId, amountUSD, note, createdAt }
email:<sha256>     → "<licenseKey>"      reverse index for /retrieve
txn:<source>:<id>  → "pending" | key     idempotency, reserved BEFORE minting
rl:<ip>            → "<count>"           /retrieve rate limit, TTL-expired
stats:pipeline     → { totalUSD, paymentCount, lastUpdatedAt }
```

## Tail the logs

```bash
wrangler tail
```

Do this for the first real payment. Several conditions mint nothing and are
visible ONLY here: a Ko-fi page set to a currency other than USD, an amount
under $1, a payload with no email address, and a Ko-fi `Commission`. Each logs
a warning naming the transaction so you can grant it by hand.
