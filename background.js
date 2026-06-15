if (typeof importScripts !== 'undefined') {
    try { importScripts('jszip.min.js'); } catch (e) { console.log('JSZip not found, ZIP mode may fail.'); }
}

const MAX_NAME_LENGTH = 110;
const PLACEHOLDER_TITLE = 'No Title';

const generateBase36Hash = () => Math.random().toString(36).substring(2, 10);
const cleanName = (str) => str.replace(/[<>:"/\\|?*]/g, '-').trim();
const cleanPath = (str) => str.replace(/[<>:"|?*]/g, '-').trim();

// Pulls the file extension off a Reddit image URL. The naive `.pop()` returns
// junk for paths that don't actually contain a dot, so we sanity-check it.
function getExtFromUrl(url) {
    const tail = (url || '').split('?')[0].split('#')[0].split('.').pop();
    return /^[a-z0-9]{1,5}$/i.test(tail) ? tail : 'jpg';
}

// Reddit serves a lot of previews as WebP. Plenty of Windows image viewers and
// gallery apps still don't open them cleanly, so we decode and re-encode to JPEG
// before saving. createImageBitmap + OffscreenCanvas both work in MV3 service
// workers, so we don't need a content-script roundtrip.
async function blobToJpeg(blob) {
    const bitmap = await createImageBitmap(blob);
    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
    canvas.getContext('2d').drawImage(bitmap, 0, 0);
    bitmap.close();
    return canvas.convertToBlob({ type: 'image/jpeg', quality: 0.95 });
}

function blobToDataUrl(blob) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = reject;
        reader.readAsDataURL(blob);
    });
}

// Used by Folder and Individual modes. Returns the URL to hand to chrome.downloads
// plus the extension we should write. Direct passthrough for jpg/png/gif. For WebP
// we fetch + decode + re-encode + base64 it as a data URL so the saved file is JPEG.
//
// chrome.downloads.download caps data: URLs (limit varies across Chromium builds,
// but ~25MB+ starts failing reliably on some platforms). For oversized sources
// we skip the JPEG re-encode and fall back to the raw WebP rather than producing
// a silent 0/N download count.
const WEBP_CONVERT_MAX_BYTES = 25 * 1024 * 1024;

async function prepareDownload(url) {
    const ext = getExtFromUrl(url);
    if (ext.toLowerCase() !== 'webp') return { url, ext };
    try {
        const res = await fetch(url);
        if (!res.ok) {
            console.warn(`[RedditDL] prepareDownload: WebP source fetch returned ${res.status}; passing original URL through.`, url);
            return { url, ext };
        }
        const srcBlob = await res.blob();
        if (srcBlob.size > WEBP_CONVERT_MAX_BYTES) {
            console.warn(`[RedditDL] prepareDownload: skipping WebP→JPEG re-encode, source is ${Math.round(srcBlob.size / 1048576)}MB; saving original .webp.`);
            return { url, ext };
        }
        const jpeg = await blobToJpeg(srcBlob);
        const dataUrl = await blobToDataUrl(jpeg);
        // Catch the case where the JPEG round-trip produced something so big
        // it's likely to be rejected by chrome.downloads anyway — gives us
        // a breadcrumb when a conversion appears to "succeed" but the
        // subsequent download silently fails.
        if (dataUrl.length > 90 * 1024 * 1024) {
            console.warn(`[RedditDL] prepareDownload: WebP→JPEG produced a ~${Math.round(dataUrl.length / 1048576)}MB data: URL — chrome.downloads may reject it.`);
        }
        return { url: dataUrl, ext: 'jpg' };
    } catch (e) {
        console.warn('[RedditDL] prepareDownload: WebP -> JPEG conversion failed, saving original:', e);
        return { url, ext };
    }
}

const formatDateFromDate = (d, format, sep) => {
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    const yyyy = d.getFullYear();
    const yy = yyyy.toString().slice(-2);

    if (format === 'dd-mm-yyyy' || format === 'uk') return `${dd}${sep}${mm}${sep}${yyyy}`;
    if (format === 'dd-mm-yy') return `${dd}${sep}${mm}${sep}${yy}`;
    if (format === 'mm-dd-yyyy' || format === 'us') return `${mm}${sep}${dd}${sep}${yyyy}`;
    if (format === 'mm-dd-yy') return `${mm}${sep}${dd}${sep}${yy}`;
    return `${yyyy}${sep}${mm}${sep}${dd}`;
};

const formatTimeFromDate = (d, format, sep) => {
    let hh = d.getHours();
    const mm = String(d.getMinutes()).padStart(2, '0');
    const ss = String(d.getSeconds()).padStart(2, '0');

    if (format === '12h') {
        const ampm = hh >= 12 ? 'PM' : 'AM';
        hh = hh % 12 || 12;
        return `${String(hh).padStart(2, '0')}${sep}${mm}${sep}${ss}${sep}${ampm}`;
    }
    return `${String(hh).padStart(2, '0')}${sep}${mm}${sep}${ss}`;
};

const formatIndex = (index, format) => {
    const padded = String(index).padStart(2, '0');
    if (format === 'parentheses') return `(${padded})`;
    if (format === 'brackets') return `[${padded}]`;
    return padded;
};

const generateUniqueId = (format) => {
    // Pulls a chunk of randomness for whichever shape the user picked. Keep
    // this in sync with the dropdown in options.html and the preview map in
    // options.js (ID_FORMAT_PREVIEWS).
    if (format === 'numeric')   return Math.floor(100000 + Math.random() * 900000).toString();
    if (format === 'numeric8')  return Math.floor(10000000 + Math.random() * 90000000).toString();
    if (format === 'hex8')      return Math.floor(Math.random() * 0xffffffff).toString(16).padStart(8, '0');
    if (format === 'alpha6') {
        const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
        let s = '';
        for (let i = 0; i < 6; i++) s += chars[Math.floor(Math.random() * chars.length)];
        return s;
    }
    if (format === 'letters') {
        const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
        let s = '';
        for (let i = 0; i < 6; i++) s += chars[Math.floor(Math.random() * chars.length)];
        return s;
    }
    if (format === 'timestamp') return Math.floor(Date.now() / 1000).toString();
    // Default: hex 6 (the original behaviour pre-v2.2).
    return Math.floor(Math.random() * 16777215).toString(16).padStart(6, '0');
};

const applyTitleCase = (str, format) => {
    if (!str) return str;
    if (format === 'lower')    return str.toLowerCase();
    if (format === 'upper')    return str.toUpperCase();
    if (format === 'title')    return str.split(/(\s+)/).map(t => {
        if (/\s/.test(t)) return t;
        // Preserve all-caps tokens of 2+ characters that contain at least one
        // letter — BMW, USA, M3, R2D2. The user typed them that way on
        // purpose, so the naive "Cap-then-lowercase" rule would mangle them.
        if (t.length >= 2 && t === t.toUpperCase() && /[A-Z]/.test(t)) return t;
        return t.charAt(0).toUpperCase() + t.slice(1).toLowerCase();
    }).join('');
    if (format === 'sentence') return str.charAt(0).toUpperCase() + str.slice(1).toLowerCase();
    return str;
};

const buildNameString = (pills, data, sepChar, missingTitleRule, customPlaceholder, opts) => {
    if (!pills || pills.length === 0) return data.fallbackHash;

    const effectivePlaceholder = (customPlaceholder && customPlaceholder.trim()) || PLACEHOLDER_TITLE;
    const omitIndex = !!(opts && opts.omitIndex);

    const effectivePills = pills.filter(pill => {
        if (pill.type === 'title' && (!data.title || data.title === '') && missingTitleRule === 'omit') {
            return false;
        }
        // Joe's report: when "For single-image galleries" is set to "Don't
        // add index" but the formula contains an Index pill, the saved file
        // still ends up with "(01)" because the Index pill emits the value
        // independent of the single-file rule. The user's expectation is
        // that "Don't add index" means: omit the index on single-image
        // galleries no matter where it sits in the formula. We honour that
        // by dropping the index pill from the formula in this case.
        if (pill.type === 'index' && omitIndex) {
            return false;
        }
        return true;
    });

    if (effectivePills.length === 0) return data.fallbackHash;

    let result = '';
    let prevWasUserText = false;
    let isFirstEmitted = true;

    effectivePills.forEach((pill) => {
        const isUserText = (pill.type === 'user_text');

        let value = '';
        if (isUserText) value = pill.generatedText || '';
        else if (pill.type === 'title') value = data.title || (missingTitleRule === 'placeholder' ? effectivePlaceholder : '');
        else if (pill.type === 'index') value = data.index;
        else if (pill.type === 'subreddit') value = data.subreddit;
        else if (pill.type === 'author') value = data.author;
        else if (pill.type === 'upload_date') value = data.uploadDate;
        else if (pill.type === 'dl_date') value = data.dlDate;
        else if (pill.type === 'time') value = data.time;
        else if (pill.type === 'unique_id') value = data.uniqueId;

        if (value === '' || value === undefined || value === null) return;

        if (!isFirstEmitted) {
            if (!isUserText && !prevWasUserText) {
                result += sepChar;
            }
        }
        result += value;
        prevWasUserText = isUserText;
        isFirstEmitted = false;
    });

    let finalStr = cleanName(result) || data.fallbackHash;
    return finalStr.substring(0, MAX_NAME_LENGTH).trim();
};

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === "fetchAndDownload") {
        executeGalleryDownload(request.url, request.title, sendResponse);
        return true;
    }
});

// Lifetime counter + milestone celebrations.
// Stored in chrome.storage.sync (already-granted "storage" permission — no
// manifest changes). totalFilesDownloaded is a running tally; milestonesShown
// remembers which round-numbers we've already celebrated so the popup never
// fires twice for the same threshold even across machines via Chrome sync.
// pendingMilestone is the freshest unclaimed milestone — set here, consumed
// (and cleared) by content.js or options.js when shown to the user.
const MILESTONES = [100, 500, 1000, 10000];

function recordDownloadCount(addedCount, callback) {
    if (!addedCount || addedCount <= 0) { callback(null, 0); return; }
    chrome.storage.sync.get(['totalFilesDownloaded', 'milestonesShown', 'pendingMilestone'], (s) => {
        const prev = s.totalFilesDownloaded || 0;
        const shown = Array.isArray(s.milestonesShown) ? s.milestonesShown.slice() : [];
        const updated = prev + addedCount;

        // Cross a milestone if the user passed through it on THIS download AND
        // we haven't already celebrated it. Only fire one at a time — if a
        // single download blows past 100 and 1000 (e.g., 12-image gallery on a
        // 99-count user — won't happen, but be defensive on imports), the
        // higher milestone takes precedence and the lower is silently marked
        // shown so we don't backlog popups.
        let crossed = null;
        for (const m of MILESTONES) {
            if (m > prev && m <= updated && !shown.includes(m)) {
                shown.push(m);
                crossed = m; // keep the highest one crossed in this batch
            }
        }

        const toSet = { totalFilesDownloaded: updated };
        if (crossed !== null) {
            toSet.milestonesShown = shown;
            // Don't overwrite an existing pendingMilestone with a *smaller*
            // one — if the user hasn't dismissed the previous celebration yet,
            // we keep the higher number visible.
            const existing = s.pendingMilestone || 0;
            toSet.pendingMilestone = Math.max(existing, crossed);
        }
        chrome.storage.sync.set(toSet, () => callback(crossed, updated));
    });
}

chrome.runtime.onInstalled.addListener((details) => {
    if (details.reason === chrome.runtime.OnInstalledReason.INSTALL) {
        chrome.tabs.create({ url: 'welcome.html' });
    } else if (details.reason === chrome.runtime.OnInstalledReason.UPDATE) {
        console.log("Extension Updated!");
    }
});

async function executeGalleryDownload(redditUrl, cleanPromptTitle, sendResponse) {
    // Tag every log line with a short request id so a user with multiple
    // tabs / rapid-fire clicks can untangle which "No Images" line belongs
    // to which click. Use the URL tail as the id since it's unique per post
    // and keeps logs human-readable.
    const reqId = (redditUrl.match(/\/comments\/([a-z0-9]+)/i) || [])[1] || 'unknown';
    const tag = `[RedditDL ${reqId}]`;
    const reqStart = Date.now();
    console.log(tag, 'executeGalleryDownload start', { redditUrl, cleanPromptTitle });

    try {
        const fetchUrl = redditUrl + '.json';
        console.log(tag, 'fetching', fetchUrl);
        let response;
        try {
            response = await fetch(fetchUrl);
        } catch (netErr) {
            console.error(tag, 'fetch threw — likely network error / blocked / offline:', netErr);
            sendResponse({ success: false, count: 0, reason: 'fetch_threw' });
            return;
        }
        console.log(tag, 'fetch returned', {
            status: response.status,
            ok: response.ok,
            contentType: response.headers.get('content-type')
        });
        if (!response.ok) {
            console.error(tag, `Reddit JSON endpoint returned non-OK status ${response.status}; aborting (no images path).`);
            sendResponse({ success: false, count: 0, reason: `http_${response.status}` });
            return;
        }

        let json;
        try {
            json = await response.json();
        } catch (parseErr) {
            console.error(tag, 'response.json() failed — body was probably HTML (rate limit / login wall):', parseErr);
            sendResponse({ success: false, count: 0, reason: 'json_parse_failed' });
            return;
        }

        if (!json || !Array.isArray(json) || !json[0] || !json[0].data || !Array.isArray(json[0].data.children) || !json[0].data.children[0]) {
            console.error(tag, 'unexpected JSON shape from Reddit (missing data.children[0]):', json);
            sendResponse({ success: false, count: 0, reason: 'unexpected_json_shape' });
            return;
        }

        const post = json[0].data.children[0].data;
        // High-signal post summary up front. Anything past this point that
        // still ends in "No Images" can be cross-referenced against this
        // dump to figure out *why* — gallery vs single-image, removed,
        // crosspost, video, etc.
        console.log(tag, 'post summary', {
            id: post.id,
            subreddit: post.subreddit,
            author: post.author,
            permalink: post.permalink,
            is_gallery: !!post.is_gallery,
            has_media_metadata: !!post.media_metadata,
            has_gallery_data: !!(post.gallery_data && post.gallery_data.items),
            media_metadata_count: post.media_metadata ? Object.keys(post.media_metadata).length : 0,
            gallery_items_count: (post.gallery_data && post.gallery_data.items && post.gallery_data.items.length) || 0,
            url: post.url,
            domain: post.domain,
            post_hint: post.post_hint,
            removed_by_category: post.removed_by_category || null,
            is_video: !!post.is_video,
            is_self: !!post.is_self,
            crosspost_parent: post.crosspost_parent || null
        });

        // Extract image URLs from a single post object. Returns the URLs
        // we resolved plus any per-item skip reasons. Pulled into a helper
        // so we can run it twice — once against the top-level post, then
        // (if that yields nothing) against the crosspost parent. Reddit's
        // API does NOT denormalize gallery_data/media_metadata into the
        // crosspost record, so without this hop every crossposted gallery
        // silently fails as "No Images".
        const extractImageUrls = (postData, sourceLabel) => {
            const urls = [];
            const reasons = [];

            if (postData.is_gallery && postData.media_metadata) {
                const galleryItems = (postData.gallery_data && postData.gallery_data.items) || [];
                console.log(tag, `${sourceLabel}: gallery path, ${galleryItems.length} item(s) in gallery_data.items`);
                if (galleryItems.length === 0) {
                    console.warn(tag, `${sourceLabel}: gallery_data.items is empty even though is_gallery=true — Reddit sometimes does this for partially-removed galleries.`);
                }
                for (const item of galleryItems) {
                    const media = postData.media_metadata[item.media_id];
                    if (!media) {
                        reasons.push({ source: sourceLabel, id: item.media_id, why: 'no media_metadata entry' });
                        continue;
                    }
                    if (media.status && media.status !== 'valid') {
                        // status=='failed' on Reddit's side means the image was
                        // never finalized; status=='unprocessed' on a fresh
                        // post means we got to it before Reddit did.
                        reasons.push({ source: sourceLabel, id: item.media_id, why: `status=${media.status}` });
                        continue;
                    }
                    if (!media.s || !media.s.u) {
                        // 's' is the "source" preview. Videos/GIFs use 's.gif'
                        // or 's.mp4' instead of 's.u' — log enough to tell which.
                        reasons.push({
                            source: sourceLabel,
                            id: item.media_id,
                            why: 'no s.u',
                            mediaShape: { e: media.e, m: media.m, s_keys: media.s ? Object.keys(media.s) : null }
                        });
                        continue;
                    }
                    urls.push(media.s.u.replace(/&amp;/g, '&'));
                }
            } else if (postData.url && postData.url.match(/\.(jpeg|jpg|png|gif|webp)(\?|$)/i)) {
                // WebP is included so single-image posts hosted as .webp don't get dropped.
                // The query-string allowance handles preview URLs like /foo.jpg?width=...
                console.log(tag, `${sourceLabel}: single-image path matched`, { url: postData.url });
                urls.push(postData.url.replace(/&amp;/g, '&'));
            } else {
                console.warn(tag, `${sourceLabel}: neither a gallery nor a recognised single-image URL`, {
                    is_gallery: !!postData.is_gallery,
                    has_media_metadata: !!postData.media_metadata,
                    url: postData.url,
                    domain: postData.domain,
                    post_hint: postData.post_hint,
                    has_crosspost_parent: !!(postData.crosspost_parent_list && postData.crosspost_parent_list.length)
                });
            }
            return { urls, reasons };
        };

        let imageUrls = [];
        const skipReasons = [];
        const topLevel = extractImageUrls(post, 'top-level post');
        imageUrls = topLevel.urls;
        skipReasons.push(...topLevel.reasons);

        // Crosspost fallback. For a crossposted gallery, gallery_data /
        // media_metadata live on the original post in crosspost_parent_list[0],
        // never on the crosspost record itself. post.url on the crosspost
        // points back at the source post's URL (no .jpg/.png suffix), so
        // the single-image regex misses too — net result without this hop
        // is silent "No Images" on every crossposted gallery.
        //
        // Naming pills (subreddit, author, title) stay sourced from the
        // crosspost record below, which is the right default: the user is
        // viewing the crosspost, so files should land under that subreddit
        // and author. Only the image URLs come from the parent.
        if (imageUrls.length === 0 && post.crosspost_parent_list && post.crosspost_parent_list.length) {
            const parent = post.crosspost_parent_list[0];
            console.log(tag, 'top-level yielded 0 images — recursing into crosspost parent', {
                from_subreddit: post.subreddit,
                from_id: post.id,
                parent_subreddit: parent.subreddit,
                parent_id: parent.id,
                parent_is_gallery: !!parent.is_gallery,
                parent_has_media_metadata: !!parent.media_metadata,
                parent_url: parent.url
            });
            const parentResult = extractImageUrls(parent, 'crosspost parent');
            imageUrls = parentResult.urls;
            skipReasons.push(...parentResult.reasons);
        }

        if (skipReasons.length) {
            console.warn(tag, `skipped ${skipReasons.length} gallery item(s):`, skipReasons);
        }
        console.log(tag, `resolved ${imageUrls.length} image URL(s) total`);

        if (imageUrls.length === 0) {
            // Final breadcrumb before the failure path. Dump the fields most
            // useful for diagnosis without dumping the entire ~30KB post
            // object (which would crowd the console).
            console.error(tag, 'NO IMAGES FOUND — emitting failure response. Diagnostic snapshot:', {
                is_gallery: !!post.is_gallery,
                media_metadata_keys: post.media_metadata ? Object.keys(post.media_metadata) : null,
                gallery_data: post.gallery_data || null,
                url: post.url,
                domain: post.domain,
                post_hint: post.post_hint,
                removed_by_category: post.removed_by_category || null,
                skipReasons
            });
            sendResponse({ success: false, count: 0, reason: 'no_images_resolved' });
            return;
        }

        chrome.storage.sync.get(['globalPrefs', 'modeState', 'downloadMode', 'preferredFolder'], async (storage) => {
            const globalPrefs = storage.globalPrefs || {};
            const modeState = storage.modeState || {};

            const activeMode = storage.downloadMode || globalPrefs.activeMode || 'folder';
            const baseFolder = storage.preferredFolder ? cleanPath(storage.preferredFolder) : 'reddit_downloads';

            // Format prefs live per-mode: each mode (Folder/ZIP/Individual)
            // owns its own separators, date format, ID style, etc. We pick
            // the active mode's prefs here. The fallback chain keeps older
            // configs working: per-mode formatPrefs first, then legacy
            // globalPrefs keys (for users on a build that pre-dates the
            // per-mode split), then hardcoded defaults.
            const modePrefs = (modeState[activeMode] && modeState[activeMode].formatPrefs) || {};
            const pref = (key, fallback) => modePrefs[key] != null ? modePrefs[key]
                                          : globalPrefs[key] != null ? globalPrefs[key]
                                          : fallback;

            const getSep = (val) => val === 'dash' ? '-' : val === 'space' ? ' ' : val === 'none' ? '' : '_';
            const folderSep = getSep(pref('folderSeparatorFormat', globalPrefs.separatorFormat || 'space'));
            const fileSep = getSep(pref('fileSeparatorFormat', globalPrefs.separatorFormat || 'space'));

            // 'default' means "use whatever the element separator is". Anything else is a literal char.
            const resolveTitleSep = (val, fallback) => {
                if (!val || val === 'default') return fallback;
                if (val === 'keep') return ' ';
                return getSep(val);
            };
            const titleSpaceFormat = pref('titleSpaceFormat', 'default');
            // The title pill inside a folder/archive name is treated like
            // every other folder pill (Subreddit, Author, etc.) — it always
            // follows the Folder Pill Separation Character. The Title Space
            // setting governs ONLY the title pill inside image filenames,
            // so changing it never reshapes folder names.
            const titleSepFolder = folderSep;
            const titleSepFile = resolveTitleSep(titleSpaceFormat, fileSep);

            const getDateSep = (val) => {
                if (val === 'underscore') return '_';
                if (val === 'space') return ' ';
                if (val === 'dot') return '.';
                if (val === 'none') return '';
                return '-';
            };
            const dateSep = getDateSep(pref('dateSeparatorFormat', 'dash'));

            const indexFormat = pref('indexFormat', 'standard');
            const uniqueId = generateUniqueId(pref('idFormat', 'hex'));
            const fallbackHash = generateBase36Hash();

            const dateFormat = pref('dateFormat', 'yyyy-mm-dd');
            const timeFormat = pref('timeFormat', '24h');
            const titleCaseFormat = pref('titleCaseFormat', 'original');

            const now = new Date();
            const uploadDateObj = post.created_utc ? new Date(post.created_utc * 1000) : now;

            const cleanTitle = applyTitleCase(cleanPromptTitle || '', titleCaseFormat);

            const buildData = (sep, titleSep) => ({
                title: cleanTitle ? cleanTitle.split(/\s+/).join(titleSep) : '',
                subreddit: cleanName(post.subreddit || 'unknown_sub').split(/\s+/).join(sep),
                author: cleanName(post.author || 'unknown_user').split(/\s+/).join(sep),
                uploadDate: formatDateFromDate(uploadDateObj, dateFormat, dateSep),
                dlDate: formatDateFromDate(now, dateFormat, dateSep),
                time: formatTimeFromDate(now, timeFormat, sep),
                uniqueId: uniqueId,
                fallbackHash: fallbackHash
            });

            const folderData = buildData(folderSep, titleSepFolder);
            const fileData = buildData(fileSep, titleSepFile);

            console.log(tag, 'orchestration start', { activeMode, baseFolder, urlCount: imageUrls.length });
            let count = 0;
            try {
                if (activeMode === 'zip') {
                    count = await downloadAsZip(imageUrls, folderData, fileData, modeState.zip, folderSep, fileSep, indexFormat, baseFolder, tag);
                } else if (activeMode === 'individual') {
                    count = await downloadAsIndividual(imageUrls, fileData, modeState.individual, fileSep, indexFormat, baseFolder, tag);
                } else {
                    count = await downloadAsFolder(imageUrls, folderData, fileData, modeState.folder, folderSep, fileSep, indexFormat, baseFolder, tag);
                }
                // Distinguishes "we found URLs but every download was rejected
                // by chrome.downloads" from "we never found any URLs". Both
                // surface as "No Images" to the user; the console makes the
                // difference legible.
                if (count === 0) {
                    console.error(tag, `orchestration finished with 0/${imageUrls.length} successful downloads — chrome.downloads rejected every URL. See preceding [RedditDL] warnings for the per-file reasons.`);
                } else if (count < imageUrls.length) {
                    console.warn(tag, `orchestration finished with partial success: ${count}/${imageUrls.length} downloaded.`);
                } else {
                    console.log(tag, `orchestration finished cleanly: ${count}/${imageUrls.length} in ${Date.now() - reqStart}ms.`);
                }
                // Record the lifetime count and attach any newly-crossed
                // milestone to the response so content.js can pop the
                // celebration overlay right where the user just clicked.
                recordDownloadCount(count, (milestone, total) => {
                    sendResponse({ success: count > 0, count: count, total: imageUrls.length, milestone, totalFiles: total });
                });
            } catch (err) {
                console.error(tag, 'orchestration threw:', err);
                sendResponse({ success: false, count: 0, total: imageUrls.length, reason: 'orchestration_threw' });
            }
        });

    } catch (error) {
        console.error(tag, 'unexpected error in executeGalleryDownload:', error);
        sendResponse({ success: false, count: 0, reason: 'unexpected_error' });
    }
}

const startDownload = (options) => new Promise((resolve) => {
    try {
        chrome.downloads.download(options, (downloadId) => {
            if (chrome.runtime.lastError || !downloadId) {
                // Surface the real reason. Most opaque failures here are the
                // chrome.downloads data: URL size cap — calling code can't
                // tell the difference without this log line.
                const reason = chrome.runtime.lastError && chrome.runtime.lastError.message;
                const sizeHint = options.url && options.url.startsWith('data:')
                    ? ` (data: URL, ~${Math.round(options.url.length / 1048576)}MB encoded)`
                    : '';
                console.warn(`chrome.downloads.download failed${sizeHint}:`, reason || 'no downloadId returned');
                resolve(false);
            } else {
                resolve(true);
            }
        });
    } catch (e) {
        console.warn('chrome.downloads.download threw:', e);
        resolve(false);
    }
});

const shouldAddTrailingIndex = (totalUrls, hasIndex, singleFileRule) => {
    if (hasIndex) return false;
    if (totalUrls > 1) return true;
    return singleFileRule === 'always';
};

// "Don't add index on single-image galleries" must also strip an Index pill
// already inside the formula — otherwise the user's preference is silently
// ignored when their formula happens to mention {Index}. Multi-image galleries
// always keep the index (otherwise filenames would collide).
const shouldOmitIndexPill = (totalUrls, singleFileRule) => {
    return totalUrls === 1 && singleFileRule === 'never';
};

async function downloadAsFolder(urls, folderData, fileData, folderSettings, folderSep, fileSep, indexFormat, baseFolder, tag) {
    tag = tag || '[RedditDL]';
    const folderPills = folderSettings?.folder || [{ type: 'subreddit' }];
    const imagePills = folderSettings?.image || [{ type: 'title' }, { type: 'index' }];
    const missingTitleRule = folderSettings?.fallbacks?.missingTitle || 'omit';
    const customPlaceholder = folderSettings?.fallbacks?.placeholderText || '';
    const singleFileRule = folderSettings?.fallbacks?.singleFileIndex || 'never';

    const folderName = buildNameString(folderPills, folderData, folderSep, missingTitleRule, customPlaceholder);
    const hasIndex = imagePills.some(pill => pill.type === 'index');
    const addTrailing = shouldAddTrailingIndex(urls.length, hasIndex, singleFileRule);
    const omitIndex = shouldOmitIndexPill(urls.length, singleFileRule);
    console.log(tag, 'folder mode: target folder =', `${baseFolder}/${folderName}`, '| addTrailingIndex =', addTrailing, '| omitIndexPill =', omitIndex);

    let success = 0;
    for (let i = 0; i < urls.length; i++) {
        const indexStr = formatIndex(i + 1, indexFormat);
        let currentFileData = { ...fileData, index: indexStr };
        let fileName = buildNameString(imagePills, currentFileData, fileSep, missingTitleRule, customPlaceholder, { omitIndex });

        if (addTrailing) fileName += `${fileSep}${indexStr}`;

        const prepared = await prepareDownload(urls[i]);
        const fullPath = `${baseFolder}/${folderName}/${fileName}.${prepared.ext}`;

        const ok = await startDownload({ url: prepared.url, filename: fullPath, conflictAction: 'uniquify', saveAs: false });
        if (ok) {
            success++;
        } else {
            console.warn(tag, `folder mode: image ${i + 1}/${urls.length} REJECTED by chrome.downloads`, { src: urls[i], filename: fullPath });
        }
    }
    return success;
}

async function downloadAsIndividual(urls, fileData, indSettings, fileSep, indexFormat, baseFolder, tag) {
    tag = tag || '[RedditDL]';
    const formulaPills = indSettings?.formula || [{ type: 'title' }, { type: 'index' }];
    const missingTitleRule = indSettings?.fallbacks?.missingTitle || 'omit';
    const customPlaceholder = indSettings?.fallbacks?.placeholderText || '';
    const singleFileRule = indSettings?.fallbacks?.singleFileIndex || 'never';

    const hasIndex = formulaPills.some(pill => pill.type === 'index');
    const addTrailing = shouldAddTrailingIndex(urls.length, hasIndex, singleFileRule);
    const omitIndex = shouldOmitIndexPill(urls.length, singleFileRule);
    console.log(tag, 'individual mode: target =', baseFolder, '| addTrailingIndex =', addTrailing, '| omitIndexPill =', omitIndex);

    let success = 0;
    for (let i = 0; i < urls.length; i++) {
        const indexStr = formatIndex(i + 1, indexFormat);
        let currentFileData = { ...fileData, index: indexStr };
        let fileName = buildNameString(formulaPills, currentFileData, fileSep, missingTitleRule, customPlaceholder, { omitIndex });

        if (addTrailing) fileName += `${fileSep}${indexStr}`;

        const prepared = await prepareDownload(urls[i]);
        const fullPath = `${baseFolder}/${fileName}.${prepared.ext}`;

        const ok = await startDownload({ url: prepared.url, filename: fullPath, conflictAction: 'uniquify', saveAs: false });
        if (ok) {
            success++;
        } else {
            console.warn(tag, `individual mode: image ${i + 1}/${urls.length} REJECTED by chrome.downloads`, { src: urls[i], filename: fullPath });
        }
    }
    return success;
}

async function downloadAsZip(urls, folderData, fileData, zipSettings, folderSep, fileSep, indexFormat, baseFolder, tag) {
    tag = tag || '[RedditDL]';
    if (typeof JSZip === 'undefined') {
        console.error(tag, 'JSZip is required for ZIP mode but is not loaded — importScripts likely failed at boot. Falling back to 0 added.');
        return 0;
    }

    const archivePills = zipSettings?.archive || [{ type: 'title' }];
    const imagePills = zipSettings?.image || [{ type: 'index' }];
    const missingTitleRule = zipSettings?.fallbacks?.missingTitle || 'omit';
    const customPlaceholder = zipSettings?.fallbacks?.placeholderText || '';
    const singleFileRule = zipSettings?.fallbacks?.singleFileIndex || 'never';

    const zipName = buildNameString(archivePills, folderData, folderSep, missingTitleRule, customPlaceholder);
    const zip = new JSZip();
    const hasIndex = imagePills.some(pill => pill.type === 'index');
    const addTrailing = shouldAddTrailingIndex(urls.length, hasIndex, singleFileRule);
    const omitIndex = shouldOmitIndexPill(urls.length, singleFileRule);
    console.log(tag, 'zip mode: archive =', `${baseFolder}/${zipName}.zip`, '| addTrailingIndex =', addTrailing, '| omitIndexPill =', omitIndex);

    let added = 0;
    let totalBytes = 0;
    for (let i = 0; i < urls.length; i++) {
        try {
            const res = await fetch(urls[i]);
            if (!res.ok) {
                console.warn(tag, `zip mode: image ${i + 1}/${urls.length} fetch returned ${res.status}`, { src: urls[i] });
                continue;
            }
            let blob = await res.blob();
            let ext = getExtFromUrl(urls[i]);

            // Convert WebP in place — we already have the blob, no need to re-fetch.
            if (blob.type === 'image/webp' || ext.toLowerCase() === 'webp') {
                try {
                    blob = await blobToJpeg(blob);
                    ext = 'jpg';
                } catch (e) {
                    console.warn(tag, 'WebP -> JPEG conversion failed in ZIP, keeping original:', e);
                }
            }

            // Index off the running success count (added), not the loop counter
            // (i) — a fetch that 404'd or threw above did `continue` without
            // incrementing `added`, so this keeps the archive numbering
            // contiguous (01, 02, ...) instead of leaving a gap (01, 03) where
            // an image failed. added is bumped only after the blob is committed
            // below, so `added + 1` is this file's slot.
            const indexStr = formatIndex(added + 1, indexFormat);
            let currentFileData = { ...fileData, index: indexStr };
            let fileName = buildNameString(imagePills, currentFileData, fileSep, missingTitleRule, customPlaceholder, { omitIndex });

            if (addTrailing) fileName += `${fileSep}${indexStr}`;

            zip.file(`${fileName}.${ext}`, blob);
            totalBytes += blob.size;
            added++;
        } catch (err) {
            console.error(tag, `zip mode: failed to fetch image ${i + 1}/${urls.length} for ZIP:`, urls[i], err);
        }
    }
    console.log(tag, `zip mode: ${added}/${urls.length} blobs added, ~${Math.round(totalBytes / 1048576)}MB pre-compression`);

    if (added === 0) return 0;

    const zipBlob = await zip.generateAsync({ type: "blob" });
    // No URL.createObjectURL in service workers, so we go via data URL.
    // chrome.downloads has a hard cap on data: URLs that bites somewhere in
    // the tens-to-hundreds of MB range depending on Chromium build. Warn
    // loudly when the archive crosses a size that's empirically risky so
    // the user has a breadcrumb if the download silently fails.
    if (zipBlob.size > 100 * 1024 * 1024) {
        console.warn(`ZIP archive is ${Math.round(zipBlob.size / 1048576)}MB. chrome.downloads may reject data: URLs this large — consider Folder mode for very large galleries.`);
    }
    const dataUrl = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = reject;
        reader.readAsDataURL(zipBlob);
    });

    const ok = await startDownload({
        url: dataUrl,
        filename: `${baseFolder}/${zipName}.zip`,
        conflictAction: 'uniquify',
        saveAs: false
    });
    return ok ? added : 0;
}
