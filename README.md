# Error Hunter

> A Chrome Extension (Manifest V3) for QA testers to monitor and capture JavaScript console errors and failed network requests on staging builds.

![Screenshot placeholder](screenshot-placeholder.png)
*Screenshot of the Error Hunter popup showing captured errors with filtering and actions.*

---

## Features

- **Console Error Capture** — Intercepts `console.error`, uncaught exceptions (`window.onerror`), and unhandled Promise rejections in real time.
- **Network Error Capture** — Intercepts `fetch` and `XMLHttpRequest` for requests returning 4xx/5xx status codes or network failures.
- **Start / Stop Monitoring** — Click **Start Monitoring** to begin capturing; click **Stop Monitoring** to clear all captured errors and stop interception.
- **Badge Indicator** — Red badge on the extension icon showing the current error count at a glance.
- **Filter Tabs** — Filter errors by type: All, Console, or Network.
- **Expand / Collapse Details** — Click any error to expand and view stack traces, full URLs, timestamps, and HTTP status codes.
- **Copy Per-Error** — Click the 📋 button on any error to copy its formatted details to the clipboard. Shows ✓ feedback on success.
- **Export HTML Report** — Click **Export Report** to download a self-contained HTML report with all errors, summary cards, and a sortable table.

## Installation

1. Open Chrome and navigate to `chrome://extensions`
2. Enable **Developer mode** (toggle in the top right)
3. Click **Load unpacked**
4. Select the `Error-Hunter` directory
5. The extension icon will appear in the toolbar

## How to Use

1. Navigate to the staging build you want to test
2. Click the Error Hunter icon in the toolbar
3. Click **Start Monitoring**
4. Interact with the application normally
5. Errors will appear in the popup list in real-time
6. Click **Stop Monitoring** to clear all captured errors and stop interception
7. Use the filter tabs to view Console errors or Network errors separately
8. Click individual errors to expand and view full details
9. Click the 📋 button to copy a single error's details
10. Click **Export Report** to download a full HTML report of all visible errors

## Permissions

| Permission      | Purpose                                                      |
|-----------------|--------------------------------------------------------------|
| `storage`       | Session storage for persisting errors across page navigations |
| `tabs`          | Accessing tab information for error context                   |
| `scripting`     | Content script injection for error interception               |
| `<all_urls>`    | Intercepting network requests on all URLs                     |

## Project Structure

```
Error-Hunter/
├── manifest.json              # Extension manifest (MV3)
├── .gitignore                 # Git ignore rules
├── icons/
│   ├── icon16.png
│   ├── icon48.png
│   └── icon128.png
├── src/
│   ├── content.js             # Content script: error interception logic
│   ├── service-worker.js      # Service worker: badge, storage, messaging
│   ├── popup.html             # Popup UI structure
│   ├── popup.css              # Popup dark theme styles
│   └── popup.js               # Popup logic and rendering
└── tests/
    ├── run-tests.js           # Test runner (orchestrates all tests)
    ├── test-content.js        # Tests: content script utilities
    ├── test-manifest.js       # Tests: manifest validation
    ├── test-page.html         # Test page for manual browser testing
    ├── test-popup.js          # Tests: popup rendering & clipboard
    └── test-service-worker.js # Tests: service worker messaging & state
```

## Running Tests

Tests run with Node.js (no external dependencies required):

```bash
node tests/run-tests.js
```

The test runner loads each test module, executes its assertions, and prints a summary with pass/fail counts and detailed failure information.
