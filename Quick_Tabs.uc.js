(function () {
    'use strict';

    // Configuration preferences
    const QUICK_TABS_THEME_PREF = "extensions.quicktabs.theme";
    const QUICK_TABS_TASKBAR_TRIGGER_PREF = "extensions.quicktabs.taskbar.trigger";
    const QUICK_TABS_ACCESS_KEY_PREF = "extensions.quicktabs.context_menu.access_key";
    const QUICK_TABS_MAX_CONTAINERS_PREF = "extensions.quicktabs.maxContainers";
    const QUICK_TABS_DEFAULT_WIDTH_PREF = "extensions.quicktabs.defaultWidth";
    const QUICK_TABS_DEFAULT_HEIGHT_PREF = "extensions.quicktabs.defaultHeight";
    const QUICK_TABS_TASKBAR_MIN_WIDTH_PREF = "extensions.quicktabs.taskbar.minWidth";
    const QUICK_TABS_ANIMATIONS_ENABLED_PREF = "extensions.quicktabs.animations.enabled";

    // Configuration helper functions
    const getPref = (prefName, defaultValue = "") => {
        try {
            const prefService = Services.prefs;
            if (prefService.prefHasUserValue(prefName)) {
                switch (prefService.getPrefType(prefName)) {
                    case prefService.PREF_STRING:
                        return prefService.getStringPref(prefName);
                    case prefService.PREF_INT:
                        return prefService.getIntPref(prefName);
                    case prefService.PREF_BOOL:
                        return prefService.getBoolPref(prefName);
                }
            }
        } catch (e) {
            console.warn(`QuickTabs: Failed to read preference ${prefName}:`, e);
        }
        return defaultValue;
    };

    const setPref = (prefName, value) => {
        try {
            const prefService = Services.prefs;
            if (typeof value === 'boolean') {
                prefService.setBoolPref(prefName, value);
            } else if (typeof value === 'number') {
                prefService.setIntPref(prefName, value);
            } else {
                prefService.setStringPref(prefName, value);
            }
        } catch (e) {
            console.warn(`QuickTabs: Failed to set preference ${prefName}:`, e);
        }
    };

    // Load configuration
    const THEME = getPref(QUICK_TABS_THEME_PREF, "dark");
    const TASKBAR_TRIGGER = getPref(QUICK_TABS_TASKBAR_TRIGGER_PREF, "hover");
    const ACCESS_KEY = getPref(QUICK_TABS_ACCESS_KEY_PREF, "T");
    const MAX_CONTAINERS = getPref(QUICK_TABS_MAX_CONTAINERS_PREF, 5);
    const DEFAULT_WIDTH = getPref(QUICK_TABS_DEFAULT_WIDTH_PREF, 450);
    const DEFAULT_HEIGHT = getPref(QUICK_TABS_DEFAULT_HEIGHT_PREF, 500);
    const TASKBAR_MIN_WIDTH = getPref(QUICK_TABS_TASKBAR_MIN_WIDTH_PREF, 200);
    const ANIMATIONS_ENABLED = getPref(QUICK_TABS_ANIMATIONS_ENABLED_PREF, true);
    
    // Global state
    let quickTabContainers = new Map(); // id -> container info
    let nextContainerId = 1;
    let taskbarExpanded = false;
    let commandListenerAdded = false;

    // Quick Tab command state for passing parameters
    let quickTabCommandData = {
        url: '',
        title: '',
        sourceTab: null
    };

    // Utility function to get favicon
    const getFaviconUrl = (url) => {
        try {
            const hostName = new URL(url).hostname;
            return `https://s2.googleusercontent.com/s2/favicons?domain_url=https://${hostName}&sz=16`;
        } catch (e) {
            return 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 16 16"><rect width="16" height="16" fill="%23666"/><text x="8" y="12" text-anchor="middle" fill="white" font-size="10">T</text></svg>';
        }
    };

    // Utility function to get tab title (borrowed from tidy-tabs.uc.js approach)
    const getTabTitle = (url) => {
        try {
            const parsedUrl = new URL(url);
            let hostname = parsedUrl.hostname.replace(/^www\./, '');
            
            if (hostname && hostname !== 'localhost' && hostname !== '127.0.0.1') {
                return hostname;
            } else {
                const pathSegment = parsedUrl.pathname.split('/')[1];
                return pathSegment || 'Quick Tab';
            }
        } catch (e) {
            return 'Quick Tab';
        }
    };

    // Function to get tab data (URL, title) from tab element
    const getTabData = (tab) => {
        if (!tab || !tab.isConnected) {
            return {
                url: '',
                title: 'Quick Tab'
            };
        }
        
        try {
            // Get the browser associated with the tab
            const browser = tab.linkedBrowser || tab._linkedBrowser || gBrowser?.getBrowserForTab?.(tab);
            let url = '';
            let title = '';
            
            // Get URL
            if (browser?.currentURI?.spec && !browser.currentURI.spec.startsWith('about:')) {
                url = browser.currentURI.spec;
            }
            
            // Get title using existing function
            title = getTabTitleFromElement(tab);
            
            return {
                url: url || '',
                title: title || 'Quick Tab'
            };
        } catch (e) {
            console.error('QuickTabs: Error getting tab data:', e);
            return {
                url: '',
                title: 'Quick Tab'
            };
        }
    };

    // Function to get proper tab title from tab element
    const getTabTitleFromElement = (tab) => {
        if (!tab || !tab.isConnected) return 'Quick Tab';
        
        try {
            // Method from tidy-tabs.uc.js - try multiple ways to get the title
            const labelFromAttribute = tab.getAttribute('label');
            const labelFromElement = tab.querySelector('.tab-label, .tab-text')?.textContent;
            const browser = tab.linkedBrowser || tab._linkedBrowser || gBrowser?.getBrowserForTab?.(tab);
            
            let title = labelFromAttribute || labelFromElement || '';
            
            // If we have a proper title that's not generic, use it
            if (title && 
                title !== 'New Tab' && 
                title !== 'about:blank' && 
                title !== 'Loading...' && 
                !title.startsWith('http:') && 
                !title.startsWith('https:')) {
                return title.trim();
            }
            
            // Fallback to URL-based title
            if (browser?.currentURI?.spec && !browser.currentURI.spec.startsWith('about:')) {
                return getTabTitle(browser.currentURI.spec);
            }
            
            return 'Quick Tab';
        } catch (e) {
            console.error('QuickTabs: Error getting tab title:', e);
            return 'Quick Tab';
        }
    };

    // Function to truncate text with ellipsis
    const truncateText = (text, maxLength = 25) => {
        if (!text || text.length <= maxLength) {
            return text;
        }
        return text.substring(0, maxLength - 3) + '...';
    };

    // CSS injection function
    const injectCSS = () => {
        const existingStyle = document.getElementById('quicktabs-styles');
        if (existingStyle) {
            existingStyle.remove();
        }

        const themes = {
            dark: {
                containerBg: '#1e1f1f',
                containerBorder: '#404040',
                headerBg: '#2a2a2a',
                headerColor: '#e0e0e0',
                buttonBg: 'rgba(255, 255, 255, 0.1)',
                buttonHover: 'rgba(255, 255, 255, 0.2)',
                taskbarBg: '#1a1a1a',
                taskbarBorder: '#333'
            },
            light: {
                containerBg: '#ffffff',
                containerBorder: '#e0e0e0',
                headerBg: '#f0f0f0',
                headerColor: '#333',
                buttonBg: 'rgba(0, 0, 0, 0.1)',
                buttonHover: 'rgba(0, 0, 0, 0.2)',
                taskbarBg: '#f9f9f9',
                taskbarBorder: '#ddd'
            }
        };

        const currentTheme = themes[THEME] || themes.dark;

        const css = `
            /* Quick Tab Container Styles */
            .quicktab-container {
                position: fixed;
                width: ${DEFAULT_WIDTH}px;
                height: ${DEFAULT_HEIGHT}px;
                min-width: 200px;
                min-height: 150px;
                max-width: 80vw;
                max-height: 80vh;
                background-color: ${currentTheme.containerBg};
                border: 1px solid ${currentTheme.containerBorder};
                border-radius: 8px;
                box-shadow: 0 4px 12px rgba(0, 0, 0, 0.2);
                z-index: 9998;
                display: flex;
                flex-direction: column;
                overflow: hidden;
                font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
                opacity: 0;
                transform: scale(0.8);
            }

            .quicktab-container.visible {
                opacity: 1;
                transform: scale(1);
            }

            .quicktab-container.minimized {
                display: none;
            }

            /* Header Styles */
            .quicktab-header {
                display: flex;
                align-items: center;
                padding: 8px 12px;
                background-color: ${currentTheme.headerBg};
                border-bottom: 1px solid ${currentTheme.containerBorder};
                color: ${currentTheme.headerColor};
                cursor: grab;
                user-select: none;
                border-radius: 8px 8px 0 0;
                gap: 8px;
            }

            .quicktab-header:active {
                cursor: grabbing;
            }

            .quicktab-favicon {
                width: 16px;
                height: 16px;
                flex-shrink: 0;
            }

            .quicktab-title {
                flex: 1;
                font-size: 13px;
                font-weight: 500;
                overflow: hidden;
                white-space: nowrap;
                text-overflow: ellipsis;
                min-width: 0;
            }

            .quicktab-button {
                width: 28px;
                height: 28px;
                border: none;
                border-radius: 4px;
                background-color: ${currentTheme.buttonBg};
                color: ${currentTheme.headerColor};
                cursor: pointer;
                display: flex;
                align-items: center;
                justify-content: center;
                font-size: 16px;
                flex-shrink: 0;
            }

            .quicktab-button:hover {
                background-color: ${currentTheme.buttonHover};
            }

            .quicktab-button:disabled {
                opacity: 0.5;
                cursor: not-allowed;
            }

            .quicktab-button:disabled:hover {
                background-color: ${currentTheme.buttonBg};
            }

            /* Browser content area */
            .quicktab-content {
                flex: 1;
                width: 100%;
                border: none;
                background-color: white;
                overflow: hidden;
            }

            /* Resize handle */
            .quicktab-resize-handle {
                position: absolute;
                bottom: 0;
                right: 0;
                width: 12px;
                height: 12px;
                background: linear-gradient(-45deg, transparent 0%, transparent 30%, ${currentTheme.containerBorder} 30%, ${currentTheme.containerBorder} 100%);
                cursor: se-resize;
                z-index: 10;
            }

            /* Taskbar Styles */
            #quicktabs-taskbar {
                position: fixed;
                bottom: 10px;
                right: 10px;
                background-color: ${currentTheme.taskbarBg};
                border: 1px solid ${currentTheme.taskbarBorder};
                border-radius: 6px;
                box-shadow: 0 2px 8px rgba(0, 0, 0, 0.2);
                z-index: 9999;
                min-width: 110px;
                max-width: 300px;
                ${ANIMATIONS_ENABLED ? 'transition: all 0.3s cubic-bezier(0.175, 0.885, 0.32, 1.275);' : ''}
                overflow: hidden;
            }

            #quicktabs-taskbar.collapsed {
                width: auto;
                min-width: 110px;
                height: 40px;
            }



            #quicktabs-taskbar.expanded {
                min-height: 40px;
                min-width: ${TASKBAR_MIN_WIDTH}px;
                width: auto;
                max-height: 300px;
            }

            .quicktabs-taskbar-toggle {
                height: 40px;
                width: auto;
                min-width: 40px;
                padding: 0 8px;
                border: none;
                background: none;
                color: ${currentTheme.headerColor};
                cursor: pointer;
                display: flex;
                align-items: center;
                justify-content: center;
                flex-direction: row;
                font-size: 14px;
                flex-shrink: 0;
            }

            .quicktabs-taskbar-toggle:hover {
                background-color: ${currentTheme.buttonHover};
            }

            .quicktabs-taskbar-items {
                display: none;
                flex-direction: column;
                gap: 2px;
                padding: 8px;
                max-height: 200px;
                overflow-y: auto;
            }

            #quicktabs-taskbar.expanded .quicktabs-taskbar-items {
                display: flex;
            }

            .quicktabs-taskbar-item {
                display: flex;
                align-items: center;
                gap: 8px;
                padding: 6px 8px;
                border-radius: 4px;
                cursor: pointer;
                ${ANIMATIONS_ENABLED ? 'transition: transform 0.1s ease;' : ''}
                min-width: 180px;
                max-width: 250px;
                width: 100%;
                color: ${currentTheme.headerColor};
            }

            .quicktabs-taskbar-item:hover {
                background-color: ${currentTheme.buttonHover};
                ${ANIMATIONS_ENABLED ? 'transform: translateX(3px);' : ''}
            }

            .quicktabs-taskbar-item.minimized {
                opacity: 0.7;
            }

            .quicktabs-taskbar-item .favicon {
                width: 16px;
                height: 16px;
                flex-shrink: 0;
            }

            .quicktabs-taskbar-item .title {
                flex: 1;
                font-size: 12px;
                overflow: hidden;
                white-space: nowrap;
                text-overflow: ellipsis;
                min-width: 0;
                max-width: 180px;
            }

            .quicktabs-taskbar-item .close {
                width: 20px;
                height: 20px;
                border: none;
                background: none;
                color: ${currentTheme.headerColor};
                cursor: pointer;
                opacity: 0.6;
                font-size: 14px;
                flex-shrink: 0;
            }

            .quicktabs-taskbar-item .close:hover {
                opacity: 1;
                background-color: ${currentTheme.buttonHover};
                border-radius: 2px;
            }


        `;

        const styleElement = document.createElement('style');
        styleElement.id = 'quicktabs-styles';
        styleElement.textContent = css;
        document.head.appendChild(styleElement);
    };

    // Create browser element
    function createBrowserElement() {
        console.log('QuickTabs: Attempting to create XUL browser element...');
        try {
            const browser = document.createXULElement("browser");
            browser.setAttribute("type", "content");
            browser.setAttribute("remote", "true");
            browser.setAttribute("maychangeremoteness", "true");
            browser.setAttribute("disablehistory", "true");
            browser.setAttribute("flex", "1");
            browser.setAttribute("noautohide", "true");
            console.log('QuickTabs: XUL browser element created successfully');
            return browser;
        } catch (e) {
            console.log('QuickTabs: XUL creation failed, trying namespace method:', e.message);
            try {
                const browser = document.createElementNS("http://www.mozilla.org/keymaster/gatekeeper/there.is.only.xul", "browser");
                browser.setAttribute("type", "content");
                browser.setAttribute("remote", "true");
                console.log('QuickTabs: Namespace browser element created successfully');
                return browser;
            } catch (e) {
                console.error('QuickTabs: Both browser creation methods failed:', e.message);
                return null;
            }
        }
    }

    // Load content in browser
    function loadContentInBrowser(browser, url) {
        console.log('QuickTabs: Loading content in browser for URL:', url);
        try {
            const uri = Services.io.newURI(url);
            const principal = Services.scriptSecurityManager.getSystemPrincipal();
            browser.loadURI(uri, {triggeringPrincipal: principal});
            console.log('QuickTabs: Content loaded successfully with principal');
            return true;
        } catch (e) {
            console.log('QuickTabs: Principal loading failed, trying simple loadURI:', e.message);
            try {
                browser.loadURI(url);
                console.log('QuickTabs: Content loaded successfully with simple loadURI');
                return true;
            } catch (e) {
                console.error('QuickTabs: Both loading methods failed:', e.message);
                return false;
            }
        }
    }

    // Create Quick Tab container
    function createQuickTabContainer(url, title = '') {
        console.log('QuickTabs: Creating container for URL:', url);
        if (quickTabContainers.size >= MAX_CONTAINERS) {
            console.warn('QuickTabs: Maximum number of containers reached (', MAX_CONTAINERS, ')');
            // Show user-friendly notification
            const notification = document.createElement('div');
            notification.style.cssText = `
                position: fixed; top: 20px; right: 20px; z-index: 10000;
                background: #ff6b6b; color: white; padding: 12px 20px;
                border-radius: 6px; font-size: 14px; font-weight: 500;
            `;
            notification.textContent = `Quick Tabs limit reached (${MAX_CONTAINERS})`;
            document.body.appendChild(notification);
            setTimeout(() => notification.remove(), 3000);
            return null;
        }

        const containerId = nextContainerId++;
        console.log('QuickTabs: Assigned container ID:', containerId);
        const container = document.createElement('div');
        container.className = 'quicktab-container';
        container.id = `quicktab-${containerId}`;

        // Create header
        const header = document.createElement('div');
        header.className = 'quicktab-header';

        const favicon = document.createElement('img');
        favicon.className = 'quicktab-favicon';
        favicon.src = getFaviconUrl(url);
        favicon.alt = '';

        const titleElement = document.createElement('div');
        titleElement.className = 'quicktab-title';
        const displayTitle = title || getTabTitle(url);
        titleElement.textContent = truncateText(displayTitle, 30);
        titleElement.title = displayTitle; // Full title on hover

        const backButton = document.createElement('button');
        backButton.className = 'quicktab-button';
        backButton.innerHTML = '←';
        backButton.title = 'Back';

        const forwardButton = document.createElement('button');
        forwardButton.className = 'quicktab-button';
        forwardButton.innerHTML = '→';
        forwardButton.title = 'Forward';

        const openInTabButton = document.createElement('button');
        openInTabButton.className = 'quicktab-button';
        openInTabButton.innerHTML = '↗';
        openInTabButton.title = 'Open in New Tab';

        const minimizeButton = document.createElement('button');
        minimizeButton.className = 'quicktab-button';
        minimizeButton.innerHTML = '−';
        minimizeButton.title = 'Minimize';

        const closeButton = document.createElement('button');
        closeButton.className = 'quicktab-button';
        closeButton.innerHTML = '×';
        closeButton.title = 'Close';

        header.appendChild(favicon);
        header.appendChild(titleElement);
        header.appendChild(backButton);
        header.appendChild(forwardButton);
        header.appendChild(openInTabButton);
        header.appendChild(minimizeButton);
        header.appendChild(closeButton);

        // Create browser content
        console.log('QuickTabs: Creating browser element...');
        const browser = createBrowserElement();
        if (!browser) {
            console.error('QuickTabs: Failed to create browser element');
            return null;
        }
        console.log('QuickTabs: Browser element created successfully');

        browser.className = 'quicktab-content';

        // Create resize handle
        const resizeHandle = document.createElement('div');
        resizeHandle.className = 'quicktab-resize-handle';

        // Assemble container
        container.appendChild(header);
        container.appendChild(browser);
        container.appendChild(resizeHandle);

        // Set initial position (centered with cascade)
        const offset = (containerId - 1) * 30;
        const centerX = (window.innerWidth - DEFAULT_WIDTH) / 2;
        const centerY = (window.innerHeight - DEFAULT_HEIGHT) / 2;
        container.style.left = `${centerX + offset}px`;
        container.style.top = `${centerY + offset}px`;
        console.log('QuickTabs: Positioning container at center with offset:', {centerX, centerY, offset});

        document.body.appendChild(container);

        // Get proper initial title
        const initialTitle = title || getTabTitle(url);
        
        // Container info object
        const containerInfo = {
            id: containerId,
            element: container,
            browser: browser,
            url: url,
            title: initialTitle,
            favicon: favicon,
            titleElement: titleElement,
            backButton: backButton,
            forwardButton: forwardButton,
            openInTabButton: openInTabButton,
            minimized: false
        };

        quickTabContainers.set(containerId, containerInfo);

        // Event listeners
        setupContainerEvents(containerInfo);

        // Load content
        console.log('QuickTabs: Loading content in browser...');
        loadContentInBrowser(browser, url);

        // Function to update title and URL from various sources
        const updateContainerTitle = () => {
            try {
                let pageTitle = null;
                let currentUrl = null;
                
                // Get current URL from browser
                try {
                    if (browser.currentURI?.spec) {
                        currentUrl = browser.currentURI.spec;
                    } else if (browser.contentDocument?.location?.href) {
                        currentUrl = browser.contentDocument.location.href;
                    }
                } catch (e) {
                    console.warn('QuickTabs: Could not get current URL:', e);
                }
                
                // Update URL in container info if it changed
                if (currentUrl && currentUrl !== containerInfo.url && !currentUrl.startsWith('about:')) {
                    console.log('QuickTabs: URL changed from', containerInfo.url, 'to', currentUrl);
                    containerInfo.url = currentUrl;
                    // Update favicon for new URL
                    favicon.src = getFaviconUrl(currentUrl);
                }
                
                // Update back/forward button states
                try {
                    let canGoBack = false;
                    let canGoForward = false;
                    
                    // Try multiple methods to check navigation availability
                    if (browser.webNavigation) {
                        try {
                            canGoBack = browser.webNavigation.canGoBack;
                            canGoForward = browser.webNavigation.canGoForward;
                            console.log('QuickTabs: WebNavigation states - Back:', canGoBack, 'Forward:', canGoForward);
                        } catch (webNavErr) {
                            console.warn('QuickTabs: WebNavigation state check failed:', webNavErr);
                            // Fallback: just enable buttons and let the navigation handle it
                            canGoBack = true;
                            canGoForward = true;
                        }
                    } else if (browser.contentDocument?.defaultView?.history) {
                        try {
                            const history = browser.contentDocument.defaultView.history;
                            canGoBack = history.length > 1;
                            canGoForward = false; // Can't easily check forward with history API
                            console.log('QuickTabs: History API states - Back:', canGoBack, 'Forward:', canGoForward);
                        } catch (histErr) {
                            console.warn('QuickTabs: History API state check failed:', histErr);
                            canGoBack = true;
                            canGoForward = true;
                        }
                    } else {
                        // Just enable buttons and let navigation methods handle availability
                        canGoBack = true;
                        canGoForward = true;
                        console.log('QuickTabs: Using fallback - enabling both buttons');
                    }
                    
                    backButton.disabled = !canGoBack;
                    forwardButton.disabled = !canGoForward;
                } catch (e) {
                    console.warn('QuickTabs: Could not update navigation button states, enabling both:', e);
                    // Fallback: enable both buttons
                    backButton.disabled = false;
                    forwardButton.disabled = false;
                }
                
                // Try multiple methods to get the page title
                if (browser.contentTitle) {
                    pageTitle = browser.contentTitle;
                } else if (browser.contentDocument?.title) {
                    pageTitle = browser.contentDocument.title;
                }
                
                // If we got a valid page title, use it
                if (pageTitle && pageTitle.trim() !== '' && pageTitle !== 'Loading...' && 
                    pageTitle !== 'New Tab' && !pageTitle.startsWith('http')) {
                    console.log('QuickTabs: Page title updated to:', pageTitle);
                    titleElement.textContent = truncateText(pageTitle, 30); // Slightly longer for header
                    titleElement.title = pageTitle; // Full title on hover
                    containerInfo.title = pageTitle;
                    updateTaskbar();
                } else {
                    // Use URL-based title as fallback
                    const currentUrlForTitle = currentUrl || containerInfo.url;
                    const fallbackTitle = getTabTitle(currentUrlForTitle);
                    if (fallbackTitle !== containerInfo.title) {
                        console.log('QuickTabs: Using fallback title:', fallbackTitle);
                        titleElement.textContent = truncateText(fallbackTitle, 30);
                        titleElement.title = fallbackTitle; // Full title on hover
                        containerInfo.title = fallbackTitle;
                        updateTaskbar();
                    }
                }
            } catch (e) {
                console.error('QuickTabs: Error updating title:', e);
            }
        };

        // Update page title when DOM title changes
        browser.addEventListener('DOMTitleChanged', updateContainerTitle);

        // Update title on page load
        browser.addEventListener('load', () => {
            setTimeout(updateContainerTitle, 500);
            setTimeout(updateContainerTitle, 2000); // Try again after 2 seconds
        });

        // Update title when page is shown (back/forward navigation)
        browser.addEventListener('pageshow', () => {
            setTimeout(updateContainerTitle, 100);
        });

        // Update title when DOM content is loaded
        browser.addEventListener('DOMContentLoaded', () => {
            setTimeout(updateContainerTitle, 100);
        });

        // Listen for location changes (URL changes)
        browser.addEventListener('locationchange', () => {
            console.log('QuickTabs: Location changed, updating title');
            setTimeout(updateContainerTitle, 100);
            setTimeout(updateContainerTitle, 1000); // Try again after 1 second
        });

        // Also try to update title periodically for the first 10 seconds
        const titleUpdateInterval = setInterval(() => {
            updateContainerTitle();
        }, 1000);
        
        setTimeout(() => {
            clearInterval(titleUpdateInterval);
        }, 10000); // Stop trying after 10 seconds

        // Initial button state update
        setTimeout(() => {
            try {
                let canGoBack = false;
                let canGoForward = false;
                
                // Try multiple methods to check navigation availability
                if (browser.webNavigation) {
                    try {
                        canGoBack = browser.webNavigation.canGoBack;
                        canGoForward = browser.webNavigation.canGoForward;
                        console.log('QuickTabs: Initial WebNavigation states - Back:', canGoBack, 'Forward:', canGoForward);
                    } catch (webNavErr) {
                        console.warn('QuickTabs: Initial WebNavigation state check failed:', webNavErr);
                        canGoBack = false; // Initially no back history
                        canGoForward = false; // Initially no forward history
                    }
                } else if (browser.contentDocument?.defaultView?.history) {
                    try {
                        const history = browser.contentDocument.defaultView.history;
                        canGoBack = history.length > 1;
                        canGoForward = false; // Can't easily check forward with history API
                        console.log('QuickTabs: Initial History API states - Back:', canGoBack, 'Forward:', canGoForward);
                    } catch (histErr) {
                        console.warn('QuickTabs: Initial History API state check failed:', histErr);
                        canGoBack = false;
                        canGoForward = false;
                    }
                } else {
                    // Initially, both should be disabled until user navigates
                    canGoBack = false;
                    canGoForward = false;
                    console.log('QuickTabs: Initial fallback states - Back:', canGoBack, 'Forward:', canGoForward);
                }
                
                backButton.disabled = !canGoBack;
                forwardButton.disabled = !canGoForward;
            } catch (e) {
                console.warn('QuickTabs: Could not set initial navigation button states:', e);
                // Safe fallback: disable both initially
                backButton.disabled = true;
                forwardButton.disabled = true;
            }
        }, 1000);

        // Show container
        console.log('QuickTabs: Showing container...');
        container.classList.add('visible');

        console.log('QuickTabs: Container created and configured successfully');
        updateTaskbar();
        return containerInfo;
    }

    // Setup container event listeners
    function setupContainerEvents(containerInfo) {
        const { element, titleElement, browser, backButton, forwardButton, openInTabButton } = containerInfo;
        const header = element.querySelector('.quicktab-header');
        const allButtons = element.querySelectorAll('.quicktab-button');
        const minimizeButton = allButtons[3]; // Back, Forward, OpenInTab, Minimize, Close
        const closeButton = allButtons[4];
        const resizeHandle = element.querySelector('.quicktab-resize-handle');

        // Dragging functionality
        let isDragging = false;
        let dragStartX, dragStartY, elementStartX, elementStartY;

        header.addEventListener('mousedown', (e) => {
            if (e.target === backButton || e.target === forwardButton || 
                e.target === openInTabButton || e.target === minimizeButton || 
                e.target === closeButton) return;
            
            isDragging = true;
            dragStartX = e.clientX;
            dragStartY = e.clientY;
            
            const rect = element.getBoundingClientRect();
            elementStartX = rect.left;
            elementStartY = rect.top;
            
            element.style.zIndex = '9999';
            e.preventDefault();
        });

        document.addEventListener('mousemove', (e) => {
            if (!isDragging) return;
            
            const deltaX = e.clientX - dragStartX;
            const deltaY = e.clientY - dragStartY;
            
            let newX = elementStartX + deltaX;
            let newY = elementStartY + deltaY;
            
            // Keep within viewport
            newX = Math.max(0, Math.min(newX, window.innerWidth - element.offsetWidth));
            newY = Math.max(0, Math.min(newY, window.innerHeight - element.offsetHeight));
            
            element.style.left = `${newX}px`;
            element.style.top = `${newY}px`;
        });

        document.addEventListener('mouseup', () => {
            if (isDragging) {
                isDragging = false;
                element.style.zIndex = '9998';
            }
        });

        // Resize functionality
        let isResizing = false;
        let resizeStartX, resizeStartY, startWidth, startHeight;

        resizeHandle.addEventListener('mousedown', (e) => {
            isResizing = true;
            resizeStartX = e.clientX;
            resizeStartY = e.clientY;
            startWidth = element.offsetWidth;
            startHeight = element.offsetHeight;
            e.preventDefault();
        });

        document.addEventListener('mousemove', (e) => {
            if (!isResizing) return;
            
            const deltaX = e.clientX - resizeStartX;
            const deltaY = e.clientY - resizeStartY;
            
            let newWidth = Math.max(200, startWidth + deltaX);
            let newHeight = Math.max(150, startHeight + deltaY);
            
            // Keep within viewport
            const rect = element.getBoundingClientRect();
            newWidth = Math.min(newWidth, window.innerWidth - rect.left);
            newHeight = Math.min(newHeight, window.innerHeight - rect.top);
            
            element.style.width = `${newWidth}px`;
            element.style.height = `${newHeight}px`;
        });

        document.addEventListener('mouseup', () => {
            isResizing = false;
        });

        // Button events
        backButton.addEventListener('click', (e) => {
            e.stopPropagation();
            let navigationSuccessful = false;
            
            // Method 1: Try webNavigation.goBack()
            if (!navigationSuccessful && browser.webNavigation) {
                try {
                    console.log('QuickTabs: Attempting to go back using webNavigation...');
                    browser.webNavigation.goBack();
                    navigationSuccessful = true;
                    console.log('QuickTabs: Navigated back using webNavigation');
                } catch (err) {
                    console.warn('QuickTabs: webNavigation.goBack() failed:', err);
                }
            }
            
            // Method 2: Try history.back()
            if (!navigationSuccessful && browser.contentDocument?.defaultView?.history) {
                try {
                    console.log('QuickTabs: Attempting to go back using history.back()...');
                    browser.contentDocument.defaultView.history.back();
                    navigationSuccessful = true;
                    console.log('QuickTabs: Navigated back using history.back()');
                } catch (err) {
                    console.warn('QuickTabs: history.back() failed:', err);
                }
            }
            
            // Method 3: Try browser.goBack()
            if (!navigationSuccessful && typeof browser.goBack === 'function') {
                try {
                    console.log('QuickTabs: Attempting to go back using browser.goBack()...');
                    browser.goBack();
                    navigationSuccessful = true;
                    console.log('QuickTabs: Navigated back using browser.goBack()');
                } catch (err) {
                    console.warn('QuickTabs: browser.goBack() failed:', err);
                }
            }
            
            if (!navigationSuccessful) {
                console.log('QuickTabs: All back navigation methods failed');
            }
        });

        forwardButton.addEventListener('click', (e) => {
            e.stopPropagation();
            let navigationSuccessful = false;
            
            // Method 1: Try webNavigation.goForward()
            if (!navigationSuccessful && browser.webNavigation) {
                try {
                    console.log('QuickTabs: Attempting to go forward using webNavigation...');
                    browser.webNavigation.goForward();
                    navigationSuccessful = true;
                    console.log('QuickTabs: Navigated forward using webNavigation');
                } catch (err) {
                    console.warn('QuickTabs: webNavigation.goForward() failed:', err);
                }
            }
            
            // Method 2: Try history.forward()
            if (!navigationSuccessful && browser.contentDocument?.defaultView?.history) {
                try {
                    console.log('QuickTabs: Attempting to go forward using history.forward()...');
                    browser.contentDocument.defaultView.history.forward();
                    navigationSuccessful = true;
                    console.log('QuickTabs: Navigated forward using history.forward()');
                } catch (err) {
                    console.warn('QuickTabs: history.forward() failed:', err);
                }
            }
            
            // Method 3: Try browser.goForward()
            if (!navigationSuccessful && typeof browser.goForward === 'function') {
                try {
                    console.log('QuickTabs: Attempting to go forward using browser.goForward()...');
                    browser.goForward();
                    navigationSuccessful = true;
                    console.log('QuickTabs: Navigated forward using browser.goForward()');
                } catch (err) {
                    console.warn('QuickTabs: browser.goForward() failed:', err);
                }
            }
            
            if (!navigationSuccessful) {
                console.log('QuickTabs: All forward navigation methods failed');
            }
        });

        openInTabButton.addEventListener('click', (e) => {
            e.stopPropagation();
            try {
                const currentUrl = containerInfo.url || 
                    browser.currentURI?.spec || 
                    browser.contentDocument?.location?.href;
                
                if (currentUrl && !currentUrl.startsWith('about:')) {
                    // Create proper principal for the new tab
                    const uri = Services.io.newURI(currentUrl);
                    const principal = Services.scriptSecurityManager.createContentPrincipal(uri, {});
                    
                    gBrowser.addTab(currentUrl, {
                        triggeringPrincipal: principal,
                        allowInheritPrincipal: false
                    });
                    console.log('QuickTabs: Opened URL in new tab:', currentUrl);
                    
                    // Close the Quick Tab container after opening in new tab
                    closeContainer(containerInfo);
                    console.log('QuickTabs: Closed Quick Tab container after opening in new tab');
                } else {
                    console.warn('QuickTabs: No valid URL to open in new tab');
                }
            } catch (err) {
                console.error('QuickTabs: Error opening in new tab:', err);
            }
        });

        minimizeButton.addEventListener('click', (e) => {
            e.stopPropagation();
            minimizeContainer(containerInfo);
        });

        closeButton.addEventListener('click', (e) => {
            e.stopPropagation();
            closeContainer(containerInfo);
        });

        // Focus handling
        element.addEventListener('mousedown', () => {
            bringToFront(containerInfo);
        });
    }

    // Minimize container
    function minimizeContainer(containerInfo) {
        containerInfo.element.classList.add('minimized');
        containerInfo.minimized = true;
        updateTaskbar();
    }

    // Restore container
    function restoreContainer(containerInfo) {
        containerInfo.element.classList.remove('minimized');
        containerInfo.minimized = false;
        bringToFront(containerInfo);
        updateTaskbar();
    }

    // Close container
    function closeContainer(containerInfo) {
        const container = containerInfo.element;
        container.style.opacity = '0';
        container.style.transform = 'scale(0.8)';
        
        setTimeout(() => {
            container.remove();
            quickTabContainers.delete(containerInfo.id);
            updateTaskbar();
        }, 300);
    }

    // Bring container to front
    function bringToFront(containerInfo) {
        const allContainers = document.querySelectorAll('.quicktab-container');
        allContainers.forEach(container => {
            container.style.zIndex = '9998';
        });
        containerInfo.element.style.zIndex = '9999';
    }

    // Create and manage taskbar
    function createTaskbar() {
        let taskbar = document.getElementById('quicktabs-taskbar');
        if (taskbar) return taskbar;

        taskbar = document.createElement('div');
        taskbar.id = 'quicktabs-taskbar';
        taskbar.className = 'collapsed';

        const toggle = document.createElement('button');
        toggle.className = 'quicktabs-taskbar-toggle';
        const strokeColor = THEME === 'light' ? '#333' : 'currentColor';
        toggle.innerHTML = `
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" width="16" height="16" style="margin-right: 6px;">
                <rect x="10" y="10" width="80" height="80" rx="10" ry="10" fill="none" stroke="${strokeColor}" stroke-width="3"/>
                <line x1="10" y1="30" x2="90" y2="30" stroke="${strokeColor}" stroke-width="3"/>
                <circle cx="81" cy="20" r="4" fill="none" stroke="${strokeColor}" stroke-width="3"/>
                <path d="M 35 70 L 65 40 M 50 40 L 65 40 L 65 55" stroke="${strokeColor}" stroke-width="4" fill="none" stroke-linecap="round" stroke-linejoin="round"/>
            </svg>
            <span style="font-size: 12px; font-weight: 600;">Quick Tabs</span>
        `;
        toggle.title = 'Quick Tabs';

        const itemsContainer = document.createElement('div');
        itemsContainer.className = 'quicktabs-taskbar-items';

        taskbar.appendChild(toggle);
        taskbar.appendChild(itemsContainer);
        document.body.appendChild(taskbar);

        // Setup taskbar events
        if (TASKBAR_TRIGGER === 'hover') {
            taskbar.addEventListener('mouseenter', () => expandTaskbar());
            taskbar.addEventListener('mouseleave', () => collapseTaskbar());
        } else {
            toggle.addEventListener('click', () => toggleTaskbar());
        }

        return taskbar;
    }

    function expandTaskbar() {
        const taskbar = document.getElementById('quicktabs-taskbar');
        if (taskbar) {
            taskbar.classList.remove('collapsed');
            taskbar.classList.add('expanded');
            taskbarExpanded = true;
        }
    }

    function collapseTaskbar() {
        const taskbar = document.getElementById('quicktabs-taskbar');
        if (taskbar) {
            taskbar.classList.remove('expanded');
            taskbar.classList.add('collapsed');
            taskbarExpanded = false;
        }
    }

    function toggleTaskbar() {
        if (taskbarExpanded) {
            collapseTaskbar();
        } else {
            expandTaskbar();
        }
    }

    // Update taskbar contents
    function updateTaskbar() {
        console.log('QuickTabs: Updating taskbar with', quickTabContainers.size, 'containers');
        const taskbar = createTaskbar();
        const itemsContainer = taskbar.querySelector('.quicktabs-taskbar-items');
        
        // Clear existing items
        itemsContainer.innerHTML = '';

        if (quickTabContainers.size === 0) {
            console.log('QuickTabs: No containers, hiding taskbar');
            taskbar.style.display = 'none';
            return;
        }

        console.log('QuickTabs: Showing taskbar with containers');
        taskbar.style.display = 'block';

        // Add items for each container
        quickTabContainers.forEach((containerInfo) => {
            const item = document.createElement('div');
            item.className = `quicktabs-taskbar-item ${containerInfo.minimized ? 'minimized' : ''}`;

            const favicon = document.createElement('img');
            favicon.className = 'favicon';
            favicon.src = containerInfo.favicon.src;
            favicon.alt = '';

            const title = document.createElement('div');
            title.className = 'title';
            title.textContent = truncateText(containerInfo.title, 25);
            title.title = containerInfo.title; // Full title on hover

            const closeBtn = document.createElement('button');
            closeBtn.className = 'close';
            closeBtn.innerHTML = '×';
            closeBtn.title = 'Close';

            item.appendChild(favicon);
            item.appendChild(title);
            item.appendChild(closeBtn);

            // Event listeners
            item.addEventListener('click', (e) => {
                if (e.target === closeBtn) return;
                
                if (containerInfo.minimized) {
                    restoreContainer(containerInfo);
                } else {
                    bringToFront(containerInfo);
                }
                
                if (TASKBAR_TRIGGER === 'click') {
                    collapseTaskbar();
                }
            });

            closeBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                closeContainer(containerInfo);
            });

            itemsContainer.appendChild(item);
        });
    }

    // Context menu functionality
    function addContextMenuItem() {
        console.log('QuickTabs: Attempting to add context menu item...');
        const contextMenu = document.getElementById("contentAreaContextMenu");
        if (!contextMenu) {
            console.log('QuickTabs: Context menu not found, retrying in 500ms');
            setTimeout(addContextMenuItem, 500);
            return;
        }

        if (document.getElementById("quicktabs-context-menuitem")) {
            console.log('QuickTabs: Context menu item already exists');
            return;
        }

        const menuItem = document.createXULElement("menuitem");
        menuItem.id = "quicktabs-context-menuitem";
        menuItem.setAttribute("label", "Open Quick Tab");
        menuItem.setAttribute("accesskey", ACCESS_KEY);
        
        menuItem.addEventListener("command", handleContextMenuClick);
        
        // Insert into context-navigation group
        const navigationGroup = contextMenu.querySelector("#context-navigation");
        
        if (navigationGroup) {
            console.log('QuickTabs: Found navigation group, inserting menu item');
            // Insert at the end of the navigation group
            if (navigationGroup.nextSibling) {
                contextMenu.insertBefore(menuItem, navigationGroup.nextSibling);
            } else {
                contextMenu.appendChild(menuItem);
            }
        } else {
            console.log('QuickTabs: Navigation group not found, trying fallback locations');
            // Fallback: try to find other navigation-related items
            const backItem = contextMenu.querySelector("#context-back");
            const forwardItem = contextMenu.querySelector("#context-forward");
            const reloadItem = contextMenu.querySelector("#context-reload");
            
            let insertionPoint = null;
            if (reloadItem) {
                insertionPoint = reloadItem;
                console.log('QuickTabs: Using reload item as insertion point');
            } else if (forwardItem) {
                insertionPoint = forwardItem;
                console.log('QuickTabs: Using forward item as insertion point');
            } else if (backItem) {
                insertionPoint = backItem;
                console.log('QuickTabs: Using back item as insertion point');
            }
            
            if (insertionPoint) {
                if (insertionPoint.nextSibling) {
                    contextMenu.insertBefore(menuItem, insertionPoint.nextSibling);
                } else {
                    contextMenu.appendChild(menuItem);
                }
            } else {
                console.log('QuickTabs: No suitable insertion point found');
                return;
            }
        }

        contextMenu.addEventListener("popupshowing", updateContextMenuVisibility);
        console.log('QuickTabs: Context menu item added successfully');
    }

    function handleContextMenuClick() {
        console.log('QuickTabs: Context menu clicked');
        let linkUrl = "";
        let linkTitle = "";
        
        try {
            if (typeof gContextMenu !== 'undefined' && gContextMenu.linkURL) {
                linkUrl = gContextMenu.linkURL;
                console.log('QuickTabs: Found link URL:', linkUrl);
                
                // Try to get the link text as initial title
                if (gContextMenu.linkTextStr) {
                    linkTitle = gContextMenu.linkTextStr.trim();
                    console.log('QuickTabs: Found link text:', linkTitle);
                } else if (gContextMenu.target) {
                    // Try to get text content from the clicked element
                    linkTitle = gContextMenu.target.textContent?.trim() || 
                               gContextMenu.target.title?.trim() || 
                               gContextMenu.target.alt?.trim() || '';
                    console.log('QuickTabs: Found target text:', linkTitle);
                }
                
                // Clean up the title if it's too long or not useful
                if (linkTitle && linkTitle.length > 50) {
                    linkTitle = linkTitle.substring(0, 47) + '...';
                }
                if (linkTitle && (linkTitle.toLowerCase().includes('http') || linkTitle === linkUrl)) {
                    linkTitle = ''; // Don't use URLs as titles
                }
            } else {
                console.log('QuickTabs: gContextMenu or linkURL not available');
            }
        } catch (e) {
            console.error("QuickTabs: Error getting link URL:", e);
        }
        
        if (linkUrl) {
            console.log('QuickTabs: Creating Quick Tab for:', linkUrl, 'with title:', linkTitle || 'none');
            createQuickTabContainer(linkUrl, linkTitle);
        } else {
            console.log('QuickTabs: No link URL found, cannot create Quick Tab');
        }
    }

    function updateContextMenuVisibility() {
        console.log('QuickTabs: Updating context menu visibility');
        const menuItem = document.getElementById("quicktabs-context-menuitem");
        if (!menuItem) {
            console.log('QuickTabs: Menu item not found for visibility update');
            return;
        }
        
        let hasLink = false;
        
        try {
            if (typeof gContextMenu !== 'undefined') {
                hasLink = gContextMenu.onLink === true;
                console.log('QuickTabs: onLink status:', hasLink);
                if (hasLink && gContextMenu.linkURL) {
                    console.log('QuickTabs: Link URL available:', gContextMenu.linkURL);
                }
            } else {
                console.log('QuickTabs: gContextMenu not available');
            }
        } catch (e) {
            console.error('QuickTabs: Error checking link status:', e);
        }
        
        menuItem.hidden = !hasLink;
        console.log('QuickTabs: Menu item visibility set to:', !hasLink ? 'hidden' : 'visible');
    }

    // Initialization
    function init() {
        console.log('QuickTabs: Starting initialization...');
        console.log('QuickTabs: Configuration:');
        console.log('  Theme:', THEME);
        console.log('  Taskbar Trigger:', TASKBAR_TRIGGER);
        console.log('  Access Key:', ACCESS_KEY);
        console.log('  Max Containers:', MAX_CONTAINERS);
        console.log('  Default Size:', `${DEFAULT_WIDTH}x${DEFAULT_HEIGHT}`);
        console.log('  Taskbar Min Width:', TASKBAR_MIN_WIDTH);
        console.log('  Animations Enabled:', ANIMATIONS_ENABLED);
        
        // Inject CSS
        console.log('QuickTabs: Injecting CSS...');
        injectCSS();
        
        // Setup commands
        console.log('QuickTabs: Setting up commands...');
        setupCommands();
        
        // Add context menu item
        console.log('QuickTabs: Adding context menu item...');
        addContextMenuItem();
        
        console.log('QuickTabs: Initialized successfully');
    }

    // Command setup and handling
    function setupCommands() {
        const zenCommands = document.querySelector("commandset#zenCommandSet");
        if (!zenCommands) {
            console.log('QuickTabs: zenCommandSet not found, retrying in 500ms');
            setTimeout(setupCommands, 500);
            return;
        }

        // Add Quick Tab commands if they don't exist
        if (!zenCommands.querySelector("#cmd_zenOpenQuickTab")) {
            try {
                const commandFragment = window.MozXULElement.parseXULToFragment(`<command id="cmd_zenOpenQuickTab"/>`);
                zenCommands.appendChild(commandFragment.firstChild);
                console.log('QuickTabs: Added cmd_zenOpenQuickTab command');
            } catch (e) {
                console.error('QuickTabs: Error adding cmd_zenOpenQuickTab:', e);
            }
        }

        if (!zenCommands.querySelector("#cmd_zenOpenQuickTabFromCurrent")) {
            try {
                const commandFragment = window.MozXULElement.parseXULToFragment(`<command id="cmd_zenOpenQuickTabFromCurrent"/>`);
                zenCommands.appendChild(commandFragment.firstChild);
                console.log('QuickTabs: Added cmd_zenOpenQuickTabFromCurrent command');
            } catch (e) {
                console.error('QuickTabs: Error adding cmd_zenOpenQuickTabFromCurrent:', e);
            }
        }

        // Add command listener if not already added
        if (!commandListenerAdded) {
            try {
                zenCommands.addEventListener('command', handleQuickTabCommands);
                commandListenerAdded = true;
                console.log('QuickTabs: Command listener added successfully');
            } catch (e) {
                console.error('QuickTabs: Error adding command listener:', e);
            }
        }
    }

    function handleQuickTabCommands(event) {
        try {
            switch (event.target.id) {
                case 'cmd_zenOpenQuickTab':
                    handleOpenQuickTabCommand();
                    break;
                case 'cmd_zenOpenQuickTabFromCurrent':
                    handleOpenQuickTabFromCurrentCommand();
                    break;
            }
        } catch (e) {
            console.error('QuickTabs: Error handling command:', e);
        }
    }

    function handleOpenQuickTabCommand() {
        console.log('QuickTabs: cmd_zenOpenQuickTab triggered');
        
        const url = quickTabCommandData.url || '';
        const title = quickTabCommandData.title || '';
        
        if (!url) {
            console.warn('QuickTabs: No URL provided for Quick Tab');
            return;
        }

        // Reset command data after use
        quickTabCommandData = { url: '', title: '', sourceTab: null };
        
        createQuickTabContainer(url, title);
    }

    function handleOpenQuickTabFromCurrentCommand() {
        console.log('QuickTabs: cmd_zenOpenQuickTabFromCurrent triggered');
        
        try {
            const currentTab = gBrowser.selectedTab;
            if (!currentTab) {
                console.warn('QuickTabs: No current tab selected');
                return;
            }

            const currentTabData = getTabData(currentTab);
            
            if (!currentTabData.url || currentTabData.url === 'about:blank') {
                console.warn('QuickTabs: Current tab has no valid URL');
                return;
            }

            createQuickTabContainer(currentTabData.url, currentTabData.title);
        } catch (e) {
            console.error('QuickTabs: Error opening Quick Tab from current tab:', e);
        }
    }

    // Public API functions for other scripts to use
    window.QuickTabs = {
        // Open a Quick Tab with specified URL and optional title
        openQuickTab: function(url, title = '') {
            if (!url) {
                console.warn('QuickTabs: URL is required');
                return false;
            }
            
            console.log('QuickTabs: API call to open Quick Tab:', url);
            return createQuickTabContainer(url, title);
        },

        // Open a Quick Tab from the current selected tab
        openQuickTabFromCurrent: function() {
            console.log('QuickTabs: API call to open Quick Tab from current tab');
            
            try {
                const currentTab = gBrowser.selectedTab;
                if (!currentTab) {
                    console.warn('QuickTabs: No current tab selected');
                    return false;
                }

                const currentTabData = getTabData(currentTab);
                
                if (!currentTabData.url || currentTabData.url === 'about:blank') {
                    console.warn('QuickTabs: Current tab has no valid URL');
                    return false;
                }

                return createQuickTabContainer(currentTabData.url, currentTabData.title);
            } catch (e) {
                console.error('QuickTabs: Error in API call:', e);
                return false;
            }
        },

        // Trigger command with data (for use by other scripts)
        triggerOpenQuickTab: function(url, title = '') {
            if (!url) {
                console.warn('QuickTabs: URL is required');
                return;
            }
            
            quickTabCommandData.url = url;
            quickTabCommandData.title = title;
            
            // Trigger the command
            const command = document.querySelector('#cmd_zenOpenQuickTab');
            if (command) {
                const event = new Event('command', { bubbles: true });
                command.dispatchEvent(event);
            } else {
                console.warn('QuickTabs: cmd_zenOpenQuickTab command not found');
            }
        },

        // Trigger command for current tab
        triggerOpenQuickTabFromCurrent: function() {
            const command = document.querySelector('#cmd_zenOpenQuickTabFromCurrent');
            if (command) {
                const event = new Event('command', { bubbles: true });
                command.dispatchEvent(event);
            } else {
                console.warn('QuickTabs: cmd_zenOpenQuickTabFromCurrent command not found');
            }
        },

        // Get info about current Quick Tab containers
        getContainerInfo: function() {
            return {
                count: quickTabContainers.size,
                maxContainers: MAX_CONTAINERS,
                containers: Array.from(quickTabContainers.values()).map(info => ({
                    id: info.id,
                    url: info.url,
                    title: info.title,
                    minimized: info.minimized
                }))
            };
        }
    };

    // Initialize when DOM is ready
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        setTimeout(init, 100);
    }
})();