# Setup — RedditDL Pro licensing

_Last updated: 01-Sep-2026_

The ordered runbook for everything outside the code that only you can do: the
Ko-fi setup, the Cloudflare deploy, the secrets, and the Web Store submission.
The code side is already done per [CONTRACT.md](CONTRACT.md) — this file is
purely "click here, run this, paste that."

> `[ ]` is an action you take. `→` is what you should have in hand afterward.
> Do the sections in order; later steps need values earlier ones produce.

---

## 1. Ko-fi

Ko-fi is the payment rail. It accepts **both card and PayPal**, so supporters
who want to pay with PayPal are covered without a separate PayPal integration.

- [ ] Sign in at [ko-fi.com](https://ko-fi.com). The account is already `ko-fi.com/gauravzn` — that URL is hard-coded in the extension, so **don't rename the page**.
- [ ] Ko-fi dashboard → **Settings → Payments**. Connect Stripe and/or PayPal as receiving methods so the money actually lands in your account.
- [ ] ⚠️ **Set your Ko-fi page currency to USD.** Settings → Payments → currency. This is not cosmetic: Ko-fi reports payment amounts in the page's currency, and the Worker only maps **USD** onto the price ladder. On any other currency every payment is logged and skipped, and **nobody gets a licence** — silently, apart from a line in `wrangler tail`.
- [ ] Ko-fi dashboard → **More → API** → the **Webhooks** tab. Click **Advanced** to reveal the **Verification Token**, then copy it.
  → This is `KOFI_VERIFICATION_TOKEN`. Keep it private — it is what proves a webhook really came from Ko-fi.
- [ ] On the same page, set the **Webhook URL** to `https://<WORKER_DOMAIN>/webhook/kofi`. You won't have `<WORKER_DOMAIN>` until §2, so come back and fill this in then.
- [ ] Ko-fi's **"Send test"** button on that page is safe to use — the Worker recognises Ko-fi's fixed test transaction id, confirms your token is right, and deliberately mints nothing and counts nothing.
- [ ] Optional but recommended — make the amounts one-click. Ko-fi → **Shop** → add three items priced $1, $5 and $10 ("RedditDL Pro — Monthly / Yearly / Lifetime"). Shop orders fire the same webhook, so nothing in the code changes. Without this, buyers type the amount themselves, which also works.

**Nothing about tiers is configured on Ko-fi's side.** The Worker derives the
tier from the amount paid ([CONTRACT.md §1.1](CONTRACT.md#11-prices)).

---

## 2. Cloudflare

- [ ] Create an account at [cloudflare.com](https://cloudflare.com). The free Workers plan is enough; the free KV tier allows 1,000 writes/day, far past what this will use.
- [ ] `npm install -g wrangler`, then `wrangler login`.
- [ ] From `license-server/`, create the KV namespace:

  ```bash
  wrangler kv namespace create redditdl-license-kv
  ```

  → Wrangler prints an `id`. Open `license-server/wrangler.toml` and replace
  `REPLACE_ME_AFTER_wrangler_kv_namespace_create` with it. Leave
  `binding = "LICENSES"` alone — `worker.js` references that name directly.

- [ ] Generate an admin secret — a long random string you don't reuse anywhere:

  ```powershell
  -join ((1..48) | ForEach-Object { '{0:x}' -f (Get-Random -Maximum 16) })
  ```

  → Save it in a password manager. You need it for every `/admin/*` call.

- [ ] Set the secrets:

  ```bash
  wrangler secret put ADMIN_SECRET             # required
  wrangler secret put KOFI_VERIFICATION_TOKEN  # required — from §1
  ```

  PayPal is only needed if you want to accept **direct** PayPal payments
  outside Ko-fi. Skip these three otherwise; the Worker doesn't throw without
  them, the route just refuses to verify:

  ```bash
  wrangler secret put PAYPAL_CLIENT_ID
  wrangler secret put PAYPAL_SECRET
  wrangler secret put PAYPAL_WEBHOOK_ID
  ```

- [ ] Deploy: `wrangler deploy`
- [ ] → Wrangler prints the live URL, e.g. `https://redditdl-license.<subdomain>.workers.dev`. The bare host is your `<WORKER_DOMAIN>`.
- [ ] Go back to §1 and paste `https://<WORKER_DOMAIN>/webhook/kofi` into Ko-fi's Webhook URL field.

---

## 3. Fill in the Worker domain

Thanks to the v3 refactor the domain lives in **two** places, not four —
`license.js` is the single runtime constant, and the manifest needs the host
permission.

| File | Line | Replace |
|---|---|---|
| `license.js` | 19 | `REPLACE_WITH_YOUR_WORKER_DOMAIN.workers.dev` → your host |
| `manifest.json` | 14 | `https://REPLACE-WITH-YOUR-WORKER-DOMAIN.workers.dev/*` → `https://<your host>/*` |

- [ ] Make both edits, then confirm nothing was missed:

  ```powershell
  Select-String -Path *.js,*.html,*.json -Pattern "REPLACE_WITH_|REPLACE-WITH-"
  ```

  → Should return nothing. `build.ps1` also **fails the build** if any survive,
  so this is belt-and-braces.

---

## 4. Test the whole loop before you submit

Do not skip this. It is the only way to know the paywall works.

- [ ] `chrome://extensions` → Developer mode → **Load unpacked** → this folder.
- [ ] Confirm the extension loads with **zero warnings**.
- [ ] `wrangler tail` in one terminal, to watch the Worker live.
- [ ] Pay yourself $1 on Ko-fi (you'll get most of it back; the fee is the cost of the test).
- [ ] Watch `wrangler tail` show the webhook arriving and a licence being minted.
- [ ] In the extension: Welcome tab → **Already paid? Unlock it here** → your Ko-fi email → it should activate within seconds.
- [ ] Go to a Reddit gallery and download one. It should work.
- [ ] Check the ledger: `Invoke-RestMethod -Uri "https://<WORKER_DOMAIN>/admin/licenses" -Headers @{ "X-Admin-Secret" = "<secret>" }`

### Refunds, chargebacks and deletion requests

Two routes exist for after the fact. Both take either `{"licenseKey":"..."}` or
`{"email":"..."}`:

```powershell
# Kill a licence (refund / chargeback) - the record survives, marked canceled
Invoke-RestMethod -Method Post -Uri "https://<WORKER_DOMAIN>/admin/revoke" -Headers @{ "X-Admin-Secret" = "<secret>" } -ContentType "application/json" -Body '{"email":"them@example.com","reason":"refunded"}'

# Erase a licence and its indexes (a data-deletion request)
Invoke-RestMethod -Method Post -Uri "https://<WORKER_DOMAIN>/admin/delete" -Headers @{ "X-Admin-Secret" = "<secret>" } -ContentType "application/json" -Body '{"email":"them@example.com"}'
```

`privacy.html` promises deletion on request, so `/admin/delete` is the route
that keeps that promise. Deletion also deactivates the licence.

---

## 4a. "I paid but it doesn't work" — the support runbook

The email you will actually get. Work top to bottom; most cases stop at step 1.

Set these once per session:

```powershell
$B = "https://redditdl-license.reddit-downloader.workers.dev"
$H = @{ "X-Admin-Secret" = "<your ADMIN_SECRET>" }
```

### Step 1 — Look them up by the email they paid with

```powershell
Invoke-RestMethod -Uri "$B/admin/lookup?email=THEIR@EMAIL" -Headers $H
```

| What comes back | What it means | What to tell them |
|---|---|---|
| `found: True`, `valid: True` | **The licence is fine.** They almost certainly typed a different address, or need to reload. | "Your licence is active under `<email>`. Open the extension's Welcome tab → *Already paid? Unlock it here* → enter exactly that address. If it still fails, reload the Reddit tab." |
| `found: True`, `valid: False` | Genuinely expired. Check `currentPeriodEnd`. | "Your licence ran out on `<date>`. Pay again on Ko-fi with the same email and it reactivates straight away." |
| `found: False` | No licence for that address → **step 2**. | Don't reply yet. |

### Step 2 — Check whether the payment was swallowed

```powershell
Invoke-RestMethod -Uri "$B/admin/orphans" -Headers $H
```

This lists payments that took money and minted nothing. Look for their email or amount.

| `reason` | What went wrong |
|---|---|
| `non_usd_currency` | **Your Ko-fi page is not set to USD.** Fix that first — it is silently breaking *every* sale. |
| `below_minimum` | They paid under $1. |
| `missing_email` | Ko-fi sent no address. |
| `non_licensing_type` | They paid via a Commission, not a donation or shop item. |
| `mint_failed` / `handler_threw` | A genuine fault on our side. |

Found them? → **step 3**.

### Step 3 — Nothing in orphans either? Check Ko-fi itself

Open your Ko-fi dashboard → **Supporters**, and find the payment. If it isn't
there, they did not pay you (wrong account, failed card, or mistaken). If it
*is* there, the webhook never arrived — check Ko-fi → More → API → Webhooks
still points at `https://<WORKER_DOMAIN>/webhook/kofi`.

### Step 4 — Grant it by hand

Once you have confirmed a real payment in Ko-fi, just issue the licence:

```powershell
Invoke-RestMethod -Method Post -Uri "$B/admin/grant" -Headers $H `
  -ContentType "application/json" `
  -Body '{"email":"THEIR@EMAIL","plan":"monthly","note":"manual - Ko-fi txn 12345"}'
```

`plan` is `monthly`, `annual`, or `lifetime` — match what they paid for. Then:

> "Sorted — open the extension's Welcome tab → *Already paid? Unlock it here* → enter `<their email>`. Sorry for the trouble."

They never need the key itself; the email lookup finds it.

**When in doubt, grant it.** A wrongly-granted $1 licence costs you a dollar. A
wrongly-refused one costs you a public accusation of taking money for nothing.

---

## 5. Grandfather your existing supporters

Anyone who paid on Ko-fi before licensing existed should get a free lifetime
key rather than being locked out by the update.

The two supporters on record are already filled into **`grandfather.local.ps1`**.
That file is **gitignored** (`*.local.ps1`) on purpose — it holds real
third-party email addresses, which must not reach git or the extension package.
Don't move those addresses into this file or any file `build.ps1` packages.

- [ ] Run it once, after the Worker is deployed:

  ```powershell
  .\grandfather.local.ps1 -WorkerDomain "<your host>" -AdminSecret "<secret>"
  ```

  → Prints a lifetime key per supporter and a summary table.

- [ ] If anyone else has paid since, add them to the `$supporters` array in that script and re-run.

- [ ] Because the grant is indexed by email, they don't even need the key — they can just use **Unlock it here** with that address. Email them to say so; it's far less error-prone than pasting a 64-character key.
- [ ] Manual grants deliberately don't count toward `/stats` — there's no verified amount behind them.

---

## 6. Donate the money on, and publish the receipt

This is the recurring obligation the charity claim creates. The claim is only
true if you actually do this.

Do this **once a month**:

- [ ] Check what has come in: `https://<WORKER_DOMAIN>/stats`.
- [ ] Donate that amount to CanKids…KidsCan at [cankidsindia.org/donate](https://cankidsindia.org/donate/).
- [ ] Post the receipt as a **public update on your Ko-fi page** ([ko-fi.com/gauravzn](https://ko-fi.com/gauravzn) → Posts → new post). Include the month, the amount, and the receipt reference.

No code change and no release is needed — `transparency.html` links to the Ko-fi
page rather than restating the figure, so publishing the post *is* publishing
the receipt.

**Set a monthly calendar reminder.** `transparency.html` tells readers that a
missing month means the donation hasn't been made and invites them to chase it,
so a gap is visible to anyone who looks. The "100%" claim on the welcome page
and in the store listing is only defensible while these posts keep appearing.

---

## 7. Chrome Web Store submission

- [ ] Build the package (this is the only supported way — zipping the folder by hand ships the backend source and internal docs):

  ```powershell
  .\build.ps1
  ```

  → `dist\reddit-picture-gallery-downloader.zip`, roughly 1.5 MB. The script
  refuses to build if any placeholder survives.

- [ ] **Publish the privacy policy at a public URL.** `privacy.html` is written and ships in the package, but the Web Store needs a URL it can open without installing the extension. Easiest: push this repo to GitHub, enable **GitHub Pages**, and use `https://<user>.github.io/<repo>/privacy.html`.
- [ ] Developer Dashboard → your listing → upload the zip.
- [ ] **Privacy practices** tab — this is the part that changed, and getting it wrong is the most likely rejection:
  - Single purpose: *"Download image galleries from Reddit in their original resolution."*
  - Declare that you collect **personally identifiable information** (email address) and **authentication information** (the licence key).
  - Justify each permission: `downloads` — saving images the user chose; `storage` — settings and licence; `alarms` — periodic licence revalidation; host permissions for `reddit.com` / `redd.it` — reading gallery pages; the Worker host — licence verification.
  - Paste the privacy policy URL.
  - Confirm you are not selling data and not using it for anything unrelated.
- [ ] **Store listing** — the description must make the paid model obvious *before* install. The manifest description already does; keep the long description consistent with it.
- [ ] Submit for review. Expect a few days, and expect the paid-model disclosure to be the thing they look at.

---

## Done when

- [ ] `Select-String` for `REPLACE_WITH_|REPLACE-WITH-` returns nothing (§3).
- [ ] `.\build.ps1` succeeds and prints a zip path (§7).
- [ ] A real $1 payment minted a licence and unlocked a real download (§4).
- [ ] `GET /stats` returns non-zero (§4).
- [ ] Existing Ko-fi supporters have lifetime grants and know how to use them (§5).
- [ ] The privacy policy is live at a public URL (§7).
- [ ] The Privacy practices tab declares the email address and licence key (§7).
