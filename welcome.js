document.addEventListener('DOMContentLoaded', () => {
    const closeBtn = document.getElementById('closeWelcomeBtn');
    if (closeBtn) {
        closeBtn.addEventListener('click', () => window.close());
    }

    const customizeBtn = document.getElementById('customizeNamingBtnWelcome');
    if (customizeBtn) {
        customizeBtn.addEventListener('click', () => {
            if (chrome.runtime.openOptionsPage) {
                chrome.runtime.openOptionsPage();
            } else {
                window.open(chrome.runtime.getURL('options.html'));
            }
        });
    }
});
