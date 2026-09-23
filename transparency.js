// Object Name    : transparency.js
// Object Type    : Extension page script (transparency.html)
// Purpose        : Fill the live donation counter from the license server.
// Created By     : Gaurav Jain
// Created Date   : 01-Sep-2026
// Dependencies   : background.js "getStats" handler (license.js)
//
// External rather than inline: MV3's extension_pages CSP blocks inline
// <script>, so the previous inline version never ran at all and the page sat
// on "Loading the live total…" forever.

(function () {
    var figureEl = document.getElementById('statsFigure');
    var captionEl = document.getElementById('statsCaption');
    if (!figureEl) return;

    function showUnavailable() {
        figureEl.textContent = "The live total couldn't be loaded right now.";
        if (captionEl) captionEl.textContent = 'Try again shortly — the Ko-fi receipts link below is unaffected.';
    }

    chrome.runtime.sendMessage({ action: 'getStats' }, function (stats) {
        if (chrome.runtime.lastError || !stats || !stats.ok) {
            showUnavailable();
            return;
        }

        var totalUSD = Number(stats.totalUSD) || 0;
        // Payments, not distinct people — a renewal counts again.
        var payments = Number(stats.paymentCount) || 0;

        figureEl.innerHTML = '<span class="stats-amount">$' + totalUSD.toFixed(2)
            + '</span> paid in across ' + payments + ' payment' + (payments === 1 ? '' : 's') + '.';

        if (stats.lastUpdatedAt) {
            var updated = new Date(Number(stats.lastUpdatedAt) * 1000);
            captionEl.textContent = 'Last payment ' + updated.toLocaleDateString(undefined, {
                year: 'numeric', month: 'long', day: 'numeric',
            }) + '.';
        } else {
            captionEl.textContent = 'No payments yet — this updates the moment the first one lands.';
        }
    });
})();
