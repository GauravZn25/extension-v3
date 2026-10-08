# Handover — everything you need to run this

Written for the person operating RedditDL Pro, which may be you on a new
machine a year from now. Read this before touching anything.

The code explains itself. This file is the part the code can't tell you: what
lives where, what is irreplaceable, and what you have to actually do.

---

## 1. The three irreplaceable things

Everything else can be rebuilt. These cannot.

| Item | Where it lives | If you lose it |
|---|---|---|
| **`ADMIN_SECRET`** | Only in Cloudflare, **write-only** — no command reads it back | Generate a new one and `wrangler secret put ADMIN_SECRET`. Nothing breaks: no licence, customer or payment depends on it. It only guards your own admin calls. |
| **`grandfather.local.ps1`** | Your disk only — **gitignored**, holds two supporters' real email addresses | Recoverable from your Ko-fi supporters list, but keep a private copy. |
| **Cloudflare account access** | Your Cloudflare login | **This is the real one.** Lose the account and every paying customer's licence record goes with it. Keep the login in a password manager and don't let the account lapse. |

**Put `ADMIN_SECRET` in a password manager today if it isn't already.**

Customer licences live in Cloudflare KV. They survive your laptop dying, being
replaced, or never existing. Nothing about this system depends on a machine of
yours being switched on.

---

## 2. Moving to a new machine

```bash
git clone https://github.com/GauravZn25/extension-v3.git
cd extension-v3
npm install -g wrangler
wrangler login
```

Then copy `grandfather.local.ps1` across by hand (it is deliberately not in git).

That is the whole migration. The Worker keeps running throughout — it is on
Cloudflare's servers, not yours. You never need a terminal open.

---

## 3. What is where

| Thing | Location |
|---|---|
| Extension source | this repo |
| Licence server source | `license-server/worker.js` |
| Licence server **running** | Cloudflare, `redditdl-license.reddit-downloader.workers.dev` |
| Customer licences | Cloudflare KV namespace `LICENSES` |
| Payments | Ko-fi (`ko-fi.com/gauravzn`) |
| Privacy policy (public) | `https://gauravzn.github.io/reddit-downloader/` — served from the `GauravZn/reddit-downloader` repo, `/docs` folder |
| Support console | `license-server/admin.html` — open from disk, never host it |
| Support email | gauravjain.tech@gmail.com |

Two GitHub accounts are in play: code lives under **GauravZn25**, the public
privacy policy under **GauravZn**. Both are yours. Don't "tidy" this without
updating the privacy-policy URL in the Web Store listing.

---

## 4. The settings that silently break everything

Check these first whenever something is wrong.

- **Ko-fi page currency must be USD.** Any other currency and the Worker skips
  every single payment — money taken, no licence, and `/stats` still reads
  zero, which looks identical to "no sales yet".
- **Ko-fi webhook URL** must be exactly
  `https://redditdl-license.reddit-downloader.workers.dev/webhook/kofi`.
  If it is wrong, payments never reach you and **nothing is recorded anywhere** —
  this is the one failure with no safety net on our side. Your only signal is a
  payment in Ko-fi's supporters list with no matching licence.
- **`KOFI_VERIFICATION_TOKEN`** in Cloudflare must match Ko-fi's token exactly.
  A mismatch 401s every real webhook, silently.

---

## 5. Routine

**Weekly** — open `license-server/admin.html`, connect, look at the banner.
Green means nothing to do. Ten seconds.

**Monthly** — see `SETUP.md` §6. Check `/stats`, donate that amount to
CanKids, post the receipt publicly on Ko-fi. The extension's transparency page
tells users a missing month means the donation has not been made, so a gap is
visible to anyone who looks.

**When a customer emails** — see `SETUP.md` §4a, or just use the console's
lookup box, which writes the reply for you.

---

## 6. Deploying changes

```powershell
# extension
.\build.ps1                      # NEVER hand-zip - that ships the backend source
# upload dist\reddit-picture-gallery-downloader.zip to the Web Store

# licence server
cd license-server
wrangler deploy
```

`build.ps1` fails the build on unreplaced placeholders, missing files and
malformed zip paths. Trust it over your own zipping.

Run `node tests\path-safety.test.js` after touching anything that builds a
filename. It proves no Reddit post title, however hostile, can produce a path
Chrome rejects — a bug that previously made downloads silently save nothing.

---

## 7. Decisions worth not re-litigating

**Access fails open.** A paying user is never blocked by our uncertainty —
server unreachable, storage unreadable, KV wiped, all of it still downloads.
Access is only withdrawn when the server explicitly says the licence is not
valid. This is safe because a licence key is only ever stored after a
successful verification, so a non-payer has no key to be uncertain about.
The owner's call: an occasional free download is cheaper than one person
tweeting that they paid and got nothing.

**The trial is 100 galleries, not files.** One click is one credit whether it
saves 1 image or 40, and only a download that actually saved something costs a
credit.

**Tier comes from the amount paid**, not a product the buyer picks. $2 gets
monthly, $7 gets annual. Ko-fi Shop Items at fixed prices would remove that
ambiguity if it ever causes complaints.

**Donating directly to CanKids unlocks nothing.** CanKids has no connection to
this software. The UI says so explicitly in two places — don't soften it.
