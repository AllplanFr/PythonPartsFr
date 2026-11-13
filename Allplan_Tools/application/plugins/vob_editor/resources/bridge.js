(() => {
    const badgeSelector = '#lovable-badge, [id^="lovable-badge"], [class*="lovable-badge"], lovable-badge';
    const hideLovableBadge = () => {
        document.querySelectorAll(badgeSelector).forEach((badge) => badge.remove());
    };
    const badgeObserver = new MutationObserver(hideLovableBadge);
    badgeObserver.observe(document.documentElement, { childList: true, subtree: true });
    hideLovableBadge();

    window.__connectAllplanLauncher("vob_editor");
})();
