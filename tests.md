# Test plan — Reddit Picture Gallery Downloader

_Last updated: 2026-05-09_

Run through this before publishing a new version to the Chrome Web Store. Sections are independent; tackle them in any order. If you only have five minutes, skip to the [smoke test](#smoke-test-5-minutes) at the bottom.

> Conventions: `[ ]` is the action you take. `→` is what you should observe. If something doesn't match, file it as a bug before shipping.

---

## 0. Setup before testing

- [ ] Disable any *other* Reddit downloader extensions you might have installed — they'll fight over the same buttons and confuse the test.
- [ ] At `chrome://extensions`: enable **Developer mode**, click **Load unpacked**, and point it at the project folder.
- [ ] At `chrome://settings/downloads`: turn **OFF** "Ask where to save each file before downloading". Otherwise every gallery test will spam Save dialogs and you'll lose your mind.
- [ ] Note your base download folder. Open it in a file explorer alongside Chrome so you can verify what lands.
- [ ] Open DevTools on a Reddit post (F12) and keep the Console tab visible. Errors there tell you something's broken even when the UI looks fine.

---

## 1. First-run / onboarding

- [ ] Fresh install (or remove + re-add the unpacked extension).
- [ ] → A new tab opens automatically pointing at `welcome.html`.
- [ ] → The page renders both in light mode and dark mode (toggle Chrome's theme to confirm).
- [ ] Click **"Got it, close tab"** → tab closes.
- [ ] Re-add the extension, click **"⚙️ Customize Naming"** instead → options page opens.
- [ ] Reload the *unpacked* extension (don't remove). → The welcome tab does **NOT** open again. (Welcome only triggers on `INSTALL`, not `UPDATE`.)

---

## 2. Toolbar popup

- [ ] Click the toolbar icon. → Popup opens at 340 px wide. Whole popup fits without a scrollbar.
- [ ] Header icon is the extension icon (`icon128.png`, the same image pinned to the toolbar). Header text reads **"Reddit Picture Gallery Downloader"** with `Quick settings · v3.0` (or whatever the manifest version is) on the line below. The version comes from `chrome.runtime.getManifest()` — not a hardcoded string.
- [ ] **Base Download Folder** input is pre-filled with `reddit_downloads` (or your last-saved value).
- [ ] **Download Mode** dropdown shows three options.
- [ ] **Button Label** is empty by default with a helper-text-tinted "(optional)" qualifier next to the label.
- [ ] **Style** dropdown lists 11 themes. Selecting each instantly updates the live preview button below.
- [ ] **Position** and **Size** dropdowns update the meta text under the preview ("bottom right · normal", etc.).
- [ ] The live preview button does **NOT** lift / glow / change colour when you hover over it — `pointer-events: none` keeps it in its resting state, which is what you'll actually see on Reddit.
- [ ] Action row at the bottom is **horizontal**: Save (full-width primary, ink-coloured) on the left, gear-icon-only Customize button on the right. Hovering the gear icon shows the tooltip "Customize Naming & Formulas".
- [ ] Click **Save**. → Button switches to the saved state with a checkmark animation; the popup auto-closes after about 850 ms.
- [ ] Click the gear icon. → Options page opens in a new tab.

---

## 3. Live preview matches the actual button

The popup preview and the real floating button now share the same `themes.js` source — they shouldn't drift. Spot-check a handful:

- [ ] Pick **Native** in the popup. Save. Open a Reddit post. → The floating button looks identical to the preview (orange gradient pill with rocket emoji).
- [ ] **Glass** — translucent. Make sure it's actually visible against a real Reddit post (the preview's background isn't an image, so a small visual gap is OK as long as the button's clearly there).
- [ ] **Neon** — black with cyan glow and outline. The real button glows the same way.
- [ ] **Soft** — neumorphic shadows.
- [ ] Hover over the floating button on Reddit — it lifts/shadows-up. Hover the popup preview — same hover effect.

Anything wildly different between popup and reality means `themes.js` got out of sync somehow.

---

## 4. Floating button visibility on different page types

- [ ] `https://www.reddit.com/` (home feed) → button **NOT** visible.
- [ ] `https://www.reddit.com/r/pics/` (subreddit feed) → button **NOT** visible.
- [ ] `https://www.reddit.com/r/pics/comments/abc123/something/` (post page) → button **visible**.
- [ ] `https://www.reddit.com/gallery/abc123/` → button **visible**.
- [ ] On a post with a gallery, click an image to open Reddit's lightbox. URL becomes `…/#lightbox`. → Button **stays visible** on top of the lightbox overlay. (This is the v2.2 fix.)
- [ ] Close the lightbox. → Button stays visible on the post.
- [ ] Navigate (in same tab) back to the home feed. → Button disappears.
- [ ] Navigate forward to another post. → Button reappears.

Old reddit:

- [ ] `https://old.reddit.com/r/pics/comments/abc123/something/` → button **visible** (old reddit URLs still match `/comments/`).

---

## 5. Folder Mode download

- [ ] Open the popup, set Download Mode = **Folder**, save.
- [ ] Open a 4-image gallery (try r/pics, r/wallpapers, r/photography).
- [ ] Click Download Gallery.
- [ ] → Button reads `Downloading...` (no hourglass emoji), then `✅ 4 Files Saved!`.
- [ ] In your downloads folder, a new sub-folder appears named per the **Folder Naming Formula** (default: subreddit name).
- [ ] Inside the sub-folder: 4 image files named per the **Image Filename Formula** (default: `Title 01`, `Title 02`, etc).
- [ ] All 4 images open at full resolution in your image viewer.
- [ ] Filenames don't contain weird characters (no `<`, `>`, `:`, etc.).

---

## 6. ZIP Mode download

- [ ] Switch Download Mode = **ZIP**, save.
- [ ] Click Download on the same gallery.
- [ ] → A `.zip` file lands directly in your base downloads folder. No sub-folder.
- [ ] Extract the zip. → Filenames inside match the ZIP-mode "Image Filename Formula".
- [ ] All images open correctly.
- [ ] Try with a 12+ image gallery to stress the data-URL roundtrip the service worker uses for ZIP files.

---

## 7. Individual Mode download

- [ ] Switch Download Mode = **Individual**, save.
- [ ] Click Download.
- [ ] → Images land directly in your base folder. **No sub-folder, no zip.**
- [ ] Filenames follow the Individual-mode formula.

---

## 8. WebP conversion

This is the v2.2 headline. Reddit's preview CDN often serves `.webp` and Windows Photos can't open them.

- [ ] Find a recent image post. Open DevTools → Network → filter for "img". Click Download. Look at the source URLs in the JSON — they often end in `.webp`.
- [ ] Verify the saved files have `.jpg` extension, not `.webp`.
- [ ] Open one in Windows Photos / macOS Preview / your default image viewer. → Displays normally.
- [ ] Find a *single-image* WebP post (not a gallery — just a regular link post that resolves to a `.webp` URL). Click Download. → File downloads as `.jpg`. (This was the v2.2 single-image-fallback fix; pre-2.2 it was silently dropped with "No Images".)
- [ ] Find a JPG-only gallery (older posts often work). Download. → Saves quickly, no conversion overhead. (Direct `chrome.downloads` path, not the fetch+decode+re-encode path.)
- [ ] In ZIP mode, download a WebP gallery. → ZIP contains `.jpg` files, not `.webp`.

Cross-check: open `chrome://extensions` → click **service worker** under your extension → console should be quiet (no `WebP -> JPEG conversion failed` warnings unless something genuinely went wrong).

---

## 9. Missing-title behavior

- [ ] Find a post with no real title or one whose title is generic boilerplate ("reddit.com" etc.). If you can't find one organically, you can simulate by clearing the prompt in test 10 below.
- [ ] Default `missingTitle: 'omit'` → saved filename does NOT contain the word "Title" or any timestamp string. Title pill is omitted entirely.
- [ ] Open Options. Switch the rule to **Use a placeholder**. Leave the placeholder text input blank. Save.
- [ ] Download the same post. → File now contains "No Title".
- [ ] Type a custom placeholder ("MyDefault"). Save. Download again. → File contains "MyDefault".
- [ ] In Options, with rule = **Omit title from name**, the placeholder text input should be hidden (no dangling input box).

---

## 10. Title prompt

- [ ] Enable **Prompt for Custom Title before downloading** in Options. Save.
- [ ] Click Download on any post. → Browser's native prompt opens, pre-filled with the post's title.
- [ ] While the prompt is open, try Reddit shortcuts (J, K, /). → They do NOT do anything. The native prompt blocks page-level keystrokes.
- [ ] Press Enter without changing anything. → File saves with the original title.
- [ ] Try again, type a custom name. → File saves with custom name.
- [ ] Try again, press Esc. → Download cancels. The button returns to ready state without leaving "Downloading..." stuck.
- [ ] Find a titleless post (or test the fallback another way). Click Download with prompt enabled. → Default value in the prompt is a timestamp like `Untitled-2026-05-06-14-30` formatted with your **Date Format** + **Date Separator** + **Pill Separator** + **Time Format** settings.
- [ ] Switch Date Format to **Day, Month, Year** + Date Separator to **Dot** + Pill Separator to **Underscore**. Save. Trigger the fallback prompt again. → Default updates to something like `Untitled_06.05.2026_14_30`. (This is the v2.2 fix — used to be hardcoded `May-6-2026_14-30`.)

---

## 11. Path-too-long handling

- [ ] Find a post with a very long title (>110 chars; some news/announcement subs have these).
- [ ] Default `truncate: 'auto'` → title gets cut to 110 chars, file saves successfully.
- [ ] Switch to **Ask User and Halt Download**. Save.
- [ ] Click Download on the long-title post. → Native prompt appears asking you to confirm/edit the title. Submit. → File saves with whatever you submitted.

---

## 12. Single-image galleries

- [ ] Find a single-image post (not a gallery — just one image).
- [ ] Default `singleFileIndex: 'never'` → file saves WITHOUT an `_01` suffix.
- [ ] Switch to **Always add index**. Save. Re-download. → File now has the index suffix in your chosen index style (`01`, `(01)`, or `[01]`).

---

## 13. Filename builder (drag-and-drop)

- [ ] Open Options. In the **Folder Mode** tab, drag pills around in the **Folder Naming Formula** and **Image Filename Formula** dropzones.
- [ ] → Live preview at the bottom of the panel updates as pills move.
- [ ] Double-click a pill in a formula. → It disappears. Preview updates.
- [ ] Empty a formula entirely. → Preview shows a random hash (e.g. `a3b7c9d1`). At download time, this gets replaced with a fresh hash so the file still has a name.
- [ ] Click **+ Add Static Text** in the toolbox. Type "MyPrefix". Press Enter. → New pill appears in the toolbox.
- [ ] Drag the static-text pill into a formula. Preview updates.
- [ ] Drop the pill back in the toolbox or another formula. Confirm it works as a regular pill.
- [ ] Save settings. Reload the options page (close + reopen the tab). → Custom static text pill is still in the toolbox. Formulas still match what you saved.

Edge cases:

- [ ] In a formula with multiple static text pills back-to-back (e.g. `[Title][MyPrefix][Index]`), the separator between Title and Index is omitted because static text pills don't add separators on either side. Preview should reflect this.
- [ ] Static text containing forbidden filesystem chars (`<`, `>`, `:`, `"`, `/`, `\`, `|`, `?`, `*`) → They get replaced with `-` and a toast notifies you.

---

## 14. Format Tweaks (per-mode in v2.3)

In v2.3 the **Format tweaks 🎨** block lives at the bottom of each panel — Folder, ZIP, and Individual each carry their own copy of the 9 controls (Folder Pill Separation Character, Title Pill Separation Character, Index Format, Title Case, Title Space Options, Unique ID Format, Date Format, Date Separator, Time Format). Individual Mode omits Folder Pill Separation Character (no folder/archive name to assemble there).

The grid order should read:

| Row | Col 1 | Col 2 | Col 3 |
|-----|-------|-------|-------|
| 1 — pill joins | Folder Pill Sep | Title Pill Sep | Index Format |
| 2 — per-pill | Title Case | Title Space Options | Unique ID Format |
| 3 — date & time | Date Format | Date Separator | Time Format |

(In Individual Mode, row 1 col 1 is empty — there's no Folder Pill Sep there.)

Per-control behaviour:

- [ ] **Title Case** — try Original / lowercase / UPPERCASE / Title Case / Sentence case. Live preview's Title element changes accordingly.
- [ ] **Title Space Options**:
    - "Match Title Pill Separator" → uses whatever Title Pill Separation Character is set to.
    - "Keep spaces in title" → preserves spaces.
    - "Underscore" / "Dash" / "None" → literal char.
- [ ] **Date Format** — try each option. Date element in preview changes (Year-Month-Day vs Day-Month-Year etc.).
- [ ] **Date Separator** — character between date parts. Try dash / underscore / dot / space / none. Preview updates.
- [ ] **Time Format** — `24h` shows `14:30:00`-style; `12h` adds `AM`/`PM` at the end with the title pill separator (e.g. `02-30-00-PM`).
- [ ] **Index Format** — `01` / `(01)` / `[01]`.
- [ ] **Unique ID Format** — 7 options: Hex 6 / Hex 8 / Numeric 6 / Numeric 8 / Alphanumeric / Letters / Timestamp. Each shows a deterministic preview value when picked.
- [ ] **Folder Pill Separation Character** vs **Title Pill Separation Character** — change one, only the relevant pieces of the preview update. Folder Pill Sep only affects folder/ZIP-archive names; Title Pill Sep affects image filenames.

---

## 15. Three modes have independent settings (everything!)

This is a v2.3 expansion. In v2.2 the format options were shared across all three modes; in v2.3 every per-mode tab carries its own complete set of preferences.

- [ ] In **Folder Mode** tab, set the folder formula to `Subreddit + Author + Title`. Save.
- [ ] Switch to **ZIP Mode** tab. The archive formula should still be the saved ZIP formula (default: just Title), NOT what you set in Folder.
- [ ] Same check for **Individual Mode**.
- [ ] Same for fallback rules: each tab has its own truncate / missingTitle / singleFileIndex settings.
- [ ] **Format Tweaks per mode**: in Folder Mode, set Title Case = `UPPERCASE` and Date Format = `Year, Month, Day`. Save. Switch to ZIP Mode → its Title Case and Date Format are still at their own values (default `Keep Original` / `Year, Month, Day`), unaffected by Folder. Set ZIP Mode to `lowercase` + `Day, Month, Year`. Save. Switch back to Folder → still `UPPERCASE` + `Year, Month, Day`.
- [ ] Repeat with Individual Mode — its 8 format controls are independent of Folder and ZIP. (8 because no Folder Pill Sep.)
- [ ] At the top of the Format Tweaks block, the helper text reads "These format choices apply to **{Folder|ZIP|Individual} Mode** only. Switch tabs to set them differently for the other modes." It should match the active tab.
- [ ] Now confirm downloads use the active mode's format prefs: in Folder Mode set Title Pill Sep = `dash`. In ZIP Mode set Title Pill Sep = `underscore`. Save. Switch the toolbar popup to Folder Mode and download a 4-image gallery → image filenames inside the folder use dashes between pills. Switch the toolbar popup to ZIP Mode, redownload → image filenames inside the ZIP use underscores. Folder Mode's setting did not bleed into ZIP.

### 15a. Migration from v2.2

If you're upgrading from v2.2 (where format prefs were global), the upgrade path should be transparent:

- [ ] Before installing v2.3, on a v2.2 install, set non-default values in Element Format Options (e.g. Title Case = `UPPERCASE`, Date Format = `Day, Month, Year`, Pill Separator = `dash`). Save. Note the values.
- [ ] Reload the unpacked extension at v2.3 (don't clear storage — that's the whole point of the migration test).
- [ ] Open Options. Switch through all three tabs. → Each mode's Format Tweaks should show the same values you had set globally on v2.2 (UPPERCASE, Day-Month-Year, dash). The migration copied your global prefs into all three modes.
- [ ] Now diverge: change Folder Mode's Title Case to `lowercase`. Save. Reload Options. → Folder Mode reads `lowercase`, ZIP and Individual still read `UPPERCASE`. Per-mode storage is in effect.

---

## 16. Themes (visual sweep)

For each of the 11 themes, set it via the popup, save, open a Reddit post, and confirm:

| Theme | Visual cue | Hover effect |
|---|---|---|
| Native | Orange gradient pill + rocket emoji | Lifts 3px, shadow grows |
| Premium | Black, sleek, no rocket on minimal status text | Background lightens to #202020 |
| Modern | Solid blue | Darker blue, lifts 2px |
| Minimal | White pill with light gray border | Light gray bg, border darkens |
| Glass | Translucent | Slightly more opaque |
| Gradient | Purple/pink/orchid gradient | Lifts 3px |
| Neon | Black bg, cyan border + glow + text-shadow | Glow intensifies |
| Soft | Neumorphic, soft outer shadows | Inset shadow on hover |
| Mint | Green pill | Darker green |
| Sunset | Red/yellow gradient | Lifts, shadow grows |
| Mono | Outline only, color matches Reddit text | Slight bg tint |

- [ ] Loading state (`Downloading...`) shows during fetch on every theme.
- [ ] Success state (`✅ X Files Saved!` or `X Saved` for minimal themes premium/mono/neon) shows after.
- [ ] Failure state (`❌ No Images` or `No Images`) shows when fetch fails.

---

## 17. Position and size

- [ ] Try each position: bottom-right, bottom-left, top-right, top-left. Confirm the floating button actually moves to the right corner.
- [ ] Try each size: compact, normal, large. Padding and font-size visibly scale.
- [ ] At top-left + Reddit's own header, the button doesn't get overlapped by Reddit's UI (it's `top: 80px` to clear the header).

---

## 18. Custom button label

- [ ] Type `Get them` in the popup's Custom Button Label. Save. → Reddit button reads exactly `Get them`. No rocket emoji.
- [ ] Type `🐸 Save it` → button reads `🐸 Save it`.
- [ ] Type `🚀 Download Gallery` (or any string with a rocket) → rocket appears as part of your typed string.
- [ ] Clear the label (back to empty). Save. → Button reverts to default `🚀 Download Gallery`.
- [ ] Live preview in the popup mirrors all of the above.

---

## 19. Mid-download settings change

This is a v2.2 fix — the button used to flicker back to the default label if you saved settings during a download.

- [ ] Open a post with 10+ images (slower download = bigger window to test).
- [ ] Click Download. Button shows `Downloading...`.
- [ ] Quickly open the popup, change the theme, click Save.
- [ ] → Button's color/styling updates immediately. The text stays `Downloading...` (does NOT flicker back to default).
- [ ] When the download completes, button shows `✅ X Files Saved!`. After 3 seconds, it reverts to the *new* theme's default label (not the old one). Mid-download label changes also propagate.

---

## 20. Alt + Shift + D keyboard shortcut

The shortcut moved from plain Alt+D (taken by Chrome/Firefox/Edge for the address bar) to Alt+Shift+D in 2026-05-10's build. The handler now uses `e.code === 'KeyD'` instead of `e.key`, so non-Latin keyboard layouts and macOS Option-key dead-key behaviour both work.

- [ ] Default state: shortcut is enabled.
- [ ] Open a post. Press **Alt + Shift + D**. → Download starts (same as clicking the button).
- [ ] Press plain **Alt + D**. → Address bar focuses (browser default), download does NOT start.
- [ ] Click into a comment box. Press Alt + Shift + D while typing. → Should NOT trigger the download. Your input lands in the comment.
- [ ] Click into Reddit's search bar. Press Alt + Shift + D. → Same — typing wins.
- [ ] Press **Ctrl + Alt + Shift + D**. → Should NOT trigger (modifier safety — only the exact combo triggers).
- [ ] Press **Alt + Shift + D** with the floating button hidden (not a post page). → Nothing happens (no button to click).
- [ ] In Options, turn OFF the keyboard shortcut. Save.
- [ ] Open a Reddit post (or refresh the existing tab so the change picks up). Press Alt + Shift + D. → Nothing happens.
- [ ] Re-enable. Save. Refresh. → Shortcut works again.
- [ ] (macOS only) Switch to a US layout, press Alt + Shift + D. → Triggers. The handler keys off `e.code`, so the macOS Alt-key dead-glyph (`∂` on plain Alt+D, `Î` on Alt+Shift+D) doesn't matter.

---

## 21. Backup / Reset

- [ ] In Options, set up a clearly distinctive config: weird formula, custom static text pill, every formatting option different from default in **at least two of the three modes** (e.g. Folder Mode UPPERCASE, ZIP Mode lowercase) so the per-mode round-trip can be verified, missing-title rule = placeholder with custom text, etc.
- [ ] Click **Export Settings**. → JSON file downloads, named `reddit-gallery-downloader-settings-YYYY-MM-DD.json`.
- [ ] Open the JSON in a text editor — confirm it has `globalPrefs`, `modeState`, `toolboxStaticTextDefs`, `_exportFormat: 1`, `_exportedAt`. Each `modeState[mode]` should have its own `formatPrefs` object (folder + zip have all 9 keys including `folderSeparatorFormat`; individual has 8, no `folderSeparatorFormat`).
- [ ] **Tips & Recipes** button is visible in the same Backup & reset row, between Import and Reset. Click it → `tips.html` opens in a new tab.
- [ ] Click **Reset to Defaults**. Confirm in the dialog. → All settings revert. The custom static text pill disappears.
- [ ] Click **Import Settings**. Pick the JSON. Confirm "Import & Replace". → All your settings restore exactly.
- [ ] Reload the options page. → Settings still match.
- [ ] Open a Reddit post. → Floating button reflects restored theme/position/size.
- [ ] Try importing a malformed JSON file (any random JSON). → Toast shows "That file does not look like a valid settings export." No settings change.
- [ ] Try importing a non-JSON file (rename a `.txt` to `.json`). → Toast shows "Could not parse that file."

---

## 22. Edge cases (graceful failure)

- [ ] **Deleted post** — paste a URL of a known-deleted post (one with `[removed]` content). Click Download. → "❌ No Images" or similar graceful failure. No crash. No console errors that would scare a user.
- [ ] **Private subreddit** (you're not a member) — Download. → Same graceful failure.
- [ ] **Self-text post** (no images, just text) — Download. → "No Images".
- [ ] **Video post** — Download. → "No Images". (Videos are intentionally not supported.)
- [ ] **Cross-post** of an image post — Download. → Should still get the original images.
- [ ] **Post with externally-hosted images** (e.g. imgur, gfycat) — depends on URL. If post.url ends in `.jpg/.png/.gif/.webp` → downloads. Otherwise → "No Images".
- [ ] **Network offline** — Disable internet. Click Download. → "❌ No Images" eventually. Re-enable internet. Try again. → Works.

---

## 23. Storage sync (only if you actually use Chrome sync)

- [ ] Sign into Chrome on Machine A. Configure the extension. Save.
- [ ] Sign into the same Chrome account on Machine B. Install the extension fresh.
- [ ] Open the options page on Machine B. → Settings should match Machine A within a minute or two (Chrome's sync isn't instant).

If you don't have two machines, skip this.

---

## 24. Onboarding link (welcome page)

- [ ] On the welcome page, the `chrome://settings/downloads` reference is shown as a styled badge, not a clickable link. (Chrome blocks `chrome://` from being linked from extension pages — that's an OS-level restriction, not a bug.) → User can read and copy the URL.
- [ ] Below the three feature cards, a "See more tips →" inline link is visible. Hover → arrow shifts right and gap grows slightly.
- [ ] Click it → `tips.html` opens in a new tab.

---

## 24a. Tips & Recipes page (v2.3)

- [ ] Open `tips.html` directly (or via the link from welcome / from the Backup & reset row in Options). It loads in light mode with a subtle dotted paper texture.
- [ ] Header has a handwritten "a few favourites..." overline in tan (slightly tilted) above the H1 "Tips & recipes". Subtitle reads "Seven small habits that pay off forever."
- [ ] **Seven** tip cards visible (single-column reading layout, capped at 720px). Tip seven, "Edit the custom-title prompt faster", added 2026-05-09.
- [ ] Each card has a handwritten marker ("tip one." through "tip seven." in lowercase Caveat, slightly tilted) in the warm accent colour.
- [ ] Hover any card → it lifts 4px, shadow grows, the top hairline thickens to 5px, and the border picks up the accent colour.
- [ ] Each card has a "Set this up" recipe block with a numbered ordered list. Pill chips inside the recipes (orange "Subreddit", "Title" pills; ink "Unique ID" pill) match the styling on the Settings page so it's clear what's being referenced.
- [ ] Switch Chrome to dark mode → page becomes near-black, all six accent colours have dark-mode variants, dot pattern still visible faintly.
- [ ] Click "Back to welcome" at the top → returns to welcome.html.
- [ ] Click the GitHub link in the footer → opens `https://github.com/GauravZn/reddit-downloader` in a new tab.

---

## 24b. Custom dropdown widget (v2.3)

Every `<select>` on the Options page is wrapped with a custom widget — the OS-rendered blue selection highlight should never appear.

- [ ] Click any dropdown trigger → the listbox opens **below** the trigger. No flip-up even on the bottom-most dropdowns.
- [ ] Selected option is highlighted with `--bg-elev` (cream-grey, never blue).
- [ ] Hover an option → same cream-grey hover state.
- [ ] Click an option → the trigger label updates and the listbox closes.
- [ ] Click outside the listbox → it closes.
- [ ] Press Escape with the listbox open → closes.
- [ ] Press Arrow Down / Up while focus is on the trigger → cycles through options without re-opening the listbox.
- [ ] Open the rightmost-column dropdown (Unique ID Format) on a wide window → listbox opens at full width below trigger. Now narrow the window so the dropdown is near the right edge → on next open, listbox shifts left so it stays inside the viewport.
- [ ] On a short window where the dropdown is near the bottom of the viewport → listbox still opens downward, but its `max-height` is reduced so it fits in the available space. Internal scrolling lets you reach all options. The scrollbar inside the listbox is **hidden** (works via wheel/keyboard but no visible bar).
- [ ] Scroll the right panel while a dropdown is open → the dropdown closes (repositioning mid-scroll would be jittery). Reopen and the new position is correct.

---

## 25. Console hygiene

Throughout testing, keep an eye on the browser console (F12 → Console) and the service-worker console (`chrome://extensions` → **service worker** under your extension):

- [ ] No `Uncaught` errors at any point. (Warnings about WebP fallbacks are OK if you intentionally hit them.)
- [ ] No CSP violations.
- [ ] No deprecation warnings about manifest V2 → V3 APIs.

---

## 26. v2.3 hotfix sweep — added 2026-05-09

A round of fixes shipped on 2026-05-09. Most of these are regressions on long-standing edge cases that surfaced in user reports (Joe's "wrong title in lightbox" being the headline). Run through this section in addition to the smoke test before publishing.

### 26.1 Title-detection fixes

- [ ] **Title containing "reddit" survives.** Find a post whose title literally contains "reddit" or "Reddit" (r/AskReddit weekly threads, posts about Reddit itself work). Click Download. → The title pill in the saved filename contains the actual post title, not a fallback timestamp / placeholder. **Pre-fix:** `getRawTitle()` discarded any title containing the substring "reddit", silently sending an empty title to background.

- [ ] **Permalink match is strict (startsWith, not includes).** On a feed page where multiple posts are rendered inline, the title-detection logic only matches a `shreddit-post` whose permalink is a path-segment prefix of the current URL — not just any substring match. (Hard to trigger directly; trust the path-prefix match in [content.js findActivePostElement](content.js#L388).)

### 26.2 Lightbox / "wrong title" bug — Joe's report

The fix you came here to verify. Reddit's lightbox sometimes opens without pushing URL state to the post permalink, and the old code would deterministically grab the topmost feed post. The fix walks open-dialog containers first, then matches by permalink, and refuses to fall back to "first post in DOM" on a bare feed URL.

- [ ] Go to a subreddit feed (e.g. r/pics).
- [ ] Open the **page** DevTools (F12 on the Reddit tab itself, NOT the service worker DevTools), filter Console for `RedditDL`.
- [ ] Scroll down ~10 posts. Click a photo on a post somewhere in the middle of the visible feed to open the lightbox.
- [ ] Click Download Gallery (or press Alt+Shift+D).
- [ ] In the `[RedditDL] click {…}` log line, verify:
    - `usedActivePost: true`
    - `activePostPermalink` matches the post you clicked, **NOT** the topmost feed entry.
- [ ] The saved files match the clicked post's images and title.
- [ ] Hit Reddit's back-arrow to return to the feed. Open a different photo's lightbox. → Same — the right post is identified each time.
- [ ] **Failure mode to watch for:** if `usedActivePost: false` on a lightbox click, my dialog selectors missed Reddit's host element. Inspect the lightbox dialog in the Elements panel, copy its tag name + relevant attributes, and add it to the `modalSelectors` list in [content.js findActivePostElement](content.js#L339).

- [ ] **Button hidden when no post is resolvable.** In a state where the URL has `#lightbox` but no matching dialog/post is in the DOM, the button should disappear. The old code would show the button anyway and the click would silently grab the topmost feed post.

### 26.3 Diagnostic logging — `[RedditDL]` prefix

Both consoles now emit a tagged log stream so any future "No Images" report can be diagnosed from the logs alone.

- [ ] **Service worker console.** Go to `chrome://extensions` → "service worker" link under the extension → Console tab → filter `RedditDL`.
- [ ] Click Download on any working gallery post. → A tagged stream `[RedditDL <postId>] …` appears with: fetch URL, response status + content-type, post summary (id, subreddit, is_gallery, has_media_metadata, gallery_items_count, post_hint, removed_by_category, …), resolved image count, orchestration mode, per-image rejections (if any), final timing line.
- [ ] Click Download on a deleted/private/unsupported post. → Failure path emits `NO IMAGES FOUND — emitting failure response` followed by a diagnostic snapshot of the post object. Response carries `reason: 'no_images_resolved'` (or another tagged reason).
- [ ] Click Download on a video post / self-text post / cross-post. → Each gets a distinct log path explaining why it didn't qualify (gallery items skipped with `mediaShape`, single-image regex didn't match, etc.).
- [ ] **Page console** (F12 on the Reddit tab itself, separate from the service worker console). → `[RedditDL] click {…}` log on every button press, with the URL, raw title detected, `usedActivePost`, and `activePostPermalink`. If sendMessage fails (service worker died), an explicit `sendMessage failed after Xms` log appears.

### 26.4 Static-text pill deletion

- [ ] Open Options → click **+ Add Static Text** in the toolbox → type "TestPill" → Enter.
- [ ] Drag the new pill into the **Folder Naming Formula**.
- [ ] Double-click the pill. → It disappears, preview updates immediately.
- [ ] Repeat with a static-text pill in the **Image Filename Formula** and in the **ZIP archive** dropzone — all three should delete cleanly.
- [ ] **Pre-fix:** double-click on a static-text pill did nothing because `e.target` was the inner `<span>`, not the pill div, so `classList.contains('pill')` was false.

### 26.5 Confirm-modal Escape key

- [ ] Open Options → click **Reset to Defaults** → confirm modal appears.
- [ ] Press **Escape**. → Modal closes, no reset performed.
- [ ] Open Options → click **Import Settings** → pick any settings JSON → confirm modal appears.
- [ ] Press **Escape**. → Modal closes, no import performed.
- [ ] (Cancel button still works as before; Escape is additive.)

### 26.6 Title Space Options scope

The Title Space dropdown now governs only the title pill in image filenames — it does NOT touch folder/archive title pills (which always follow the Folder Pill Sep, like every other folder-context pill).

- [ ] Open Options → Folder Mode → drop a Title pill into the **Folder Naming Formula**.
- [ ] Cycle through every value of **Title Space Options** (Match Title Pill Sep, Keep spaces, Underscore, Dash, None).
- [ ] → The folder line in the live preview does NOT change between picks. The Title pill in the folder formula always uses the **Folder Pill Separation Character**.
- [ ] The Image Filename line in the preview *does* change with each pick.
- [ ] Same in ZIP Mode — archive name fixed, image filename changes.
- [ ] Hover the **(?)** info icon next to "Title Space Options" → tooltip says it applies only to image filenames, with folder/ZIP archive names following the Folder Pill Sep regardless.

### 26.7 Title-case preserves all-caps acronyms

- [ ] Find a post with an all-caps acronym in its title (BMW, USA, NASA, M3, R2D2 — r/cars, r/spacex, or r/whatcaristhis usually have these).
- [ ] In Options, set Title Case = **Title Case**. Save.
- [ ] Download the post. → The acronym stays uppercase in the saved filename ("BMW", not "Bmw"). Other words still get title-cased normally.
- [ ] Same check via the live preview — drop a Title pill, type a custom static-text "BMW", switch Title Case picks. (BMW only goes through the title-pill path, so this is a sanity-check on the in-preview implementation matching background.js.)

### 26.8 Fallback prompt time has seconds

- [ ] Enable **Prompt for Custom Title before downloading**. Save.
- [ ] Find a titleless post (or simulate by clearing the prompt's pre-filled value). Click Download.
- [ ] → The default prompt value is `Untitled<sep>YYYY<sep>MM<sep>DD<sep>HH<sep>MM<sep>SS` — six time-component fields, including seconds. e.g. `Untitled-2026-05-09-14-30-22`.
- [ ] In 12h Time Format, the trailing `AM`/`PM` is appended after seconds: `Untitled-2026-05-09-02-30-22-PM`.
- [ ] **Pre-fix:** only HH and MM in the fallback, mismatched the saved file's `time` / `dl_date` pill which always carried HH:MM:SS.

### 26.9 Faster button mount (subtree:true)

- [ ] Direct-navigate to a Reddit post URL (paste in address bar, hit Enter). The floating button should appear within ~1 frame of the post element mounting — not waiting for a History API event or hashchange.
- [ ] Click between feed and post pages rapidly. Button should appear/disappear smoothly without lag.
- [ ] Reload a post page. Button appears as soon as the post mounts.
- [ ] **Pre-fix:** `MutationObserver` watched only direct children of `<body>` (subtree:false), so deep-mounted posts triggered no observation and the button waited for a History/hashchange event before appearing.

### 26.10 Toggle "on" colour

- [ ] Open Options → toggle **"Prompt for Custom Title before downloading"** on. → The toggle's slider turns **mint green** (`#10b981` in light mode, `#34d399` in dark mode), not the page's ink colour.
- [ ] Toggle off → returns to the unselected ink-grey state.
- [ ] Same check on **"Enable Alt + Shift + D keyboard shortcut"** toggle.
- [ ] Switch Chrome to dark mode → the lifted `#34d399` mint shows clearly against the dark surface.

### 26.11 Tips & Recipes — seven tips

- [ ] Open `tips.html`. Subtitle reads "Seven small habits that pay off forever."
- [ ] **Seven** tip cards visible (was six). Tip seven titled "Edit the custom-title prompt faster".
- [ ] Tip seven explains <kbd>Ctrl</kbd> + <kbd>←</kbd> / <kbd>→</kbd> for word-by-word navigation in the prompt input. Recipe block has three steps (toggle on, click Download, use Ctrl+Arrow).

### 26.12 Themes.js paren-aware splitting

Regression check on the more-robust CSS declaration splitter that landed today.

- [ ] Open the popup → cycle through all 11 themes via the Style dropdown. → Every theme's preview button renders correctly with all expected styling (gradients, shadows, borders, glows).
- [ ] Open a Reddit post → the floating button matches the popup preview for whichever theme is active.
- [ ] Open the Reddit page's DevTools → Elements → find the injected `<style>` element. → Each theme's CSS rule has all properties tagged with `!important`, no truncated declarations.
- [ ] **Pre-fix:** `stamp()` split on every `;`, which would silently break if any future theme value contained a `;` inside parens or quotes (e.g. `url("data:...;base64,...")`).

### 26.13 Crosspost gallery support

For a crossposted gallery, Reddit's API leaves `media_metadata` empty on the crosspost record — the actual gallery data lives on the original post inside `crosspost_parent_list[0]`. Pre-fix this silently produced "No Images" on every crosspost. The fix tries the top-level post first, then recurses into the parent if nothing comes back.

- [ ] Find a crossposted gallery post. Easiest source: any subreddit with a heavy crosspost culture (r/CrosspostArchive, r/PicsAndVids, or pick a recent crosspost from r/all). The post should show "crossposted from r/<original>" under the title.
- [ ] Click Download Gallery.
- [ ] In the service worker console, you should see: `top-level yielded 0 images — recursing into crosspost parent { from_subreddit, from_id, parent_subreddit, parent_id, parent_is_gallery: true, … }`.
- [ ] All gallery images download correctly.
- [ ] **Naming check:** the saved folder/file names use the **crosspost's** subreddit / author (where the user is viewing), not the parent's. e.g. if you crossposted from r/pics to r/photography and the user is on r/photography, the Subreddit pill resolves to "photography".
- [ ] **Single-image crosspost:** find a crossposted single-image post (post.url ending in `.jpg`/`.png`/etc.). Download. → Should work via the top-level extraction without needing the crosspost recurse (single-image crossposts denormalize the URL into post.url, only galleries don't).
- [ ] **Deleted crosspost parent:** find a crosspost whose original was removed. Download. → Honest failure with diagnostic snapshot, no crash. The parent recurse runs but yields nothing, and the final "NO IMAGES FOUND" snapshot includes the parent's `removed_by_category` for diagnosis.

### 26.14 ZIP / WebP download diagnostics

- [ ] Find a 12+ image WebP gallery (high-res photo subs are good — r/photographs, r/EarthPorn).
- [ ] Switch to **ZIP Mode**. Click Download.
- [ ] In the service worker console, look for `[RedditDL <postId>] zip mode: N/M blobs added, ~XMB pre-compression`.
- [ ] If the ZIP exceeds 100MB pre-compression, a warning prints: "chrome.downloads may reject data: URLs this large — consider Folder mode for very large galleries."
- [ ] In **Folder Mode**, downloading a single very large WebP image (>25MB source) should log: "Skipping WebP→JPEG re-encode: source is XMB; saving original .webp."
- [ ] If `chrome.downloads.download` rejects any URL, `startDownload` now prints the error message and the encoded data-URL size — no more silent zero-success.

---

## Smoke test (5 minutes)

If you're short on time, just do these eight. If they all pass, ship it:

1. Install fresh → welcome tab opens. Click "See more tips →" → tips.html loads with **7** cards (subtitle reads "Seven small habits…").
2. Open a 4-image gallery, default settings, click Download → folder created, 4 images saved with correct names.
3. Open the lightbox by clicking an image → button still visible on top.
4. **(2026-05-09 fix)** From a subreddit feed, click a photo on a post somewhere down the feed → lightbox opens. Open the page console (F12 on the Reddit tab), filter `RedditDL`, click Download → `[RedditDL] click` log shows `usedActivePost: true` and an `activePostPermalink` matching the post you clicked, not the topmost feed entry.
5. Switch to ZIP mode via the popup → re-download → ZIP arrives, contents look right.
6. Pick a non-default theme (Neon) → Reddit button matches popup preview.
7. Find a single-image WebP post → download → file is `.jpg` and opens cleanly.
8. In Options, set Folder Mode Title Case = `UPPERCASE` and ZIP Mode Title Case = `lowercase`. Save. Switch tabs to verify both stuck. Download a gallery in Folder Mode → filenames are uppercase. Download in ZIP Mode → filenames inside the ZIP are lowercase. Per-mode prefs are working.

---

## When something fails

Before filing it as a bug:

1. Note the exact post URL, the exact settings, and what the button/console showed.
2. Check the service worker console for warnings/errors.
3. Reload the extension (`chrome://extensions` → reload icon) and try once more — sometimes Chrome caches old service workers.
4. If still broken, capture a screen recording before changing anything, then file it.
