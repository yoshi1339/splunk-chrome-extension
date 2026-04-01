chrome.action.onClicked.addListener(async (tab) => {
  try {
    if (!tab.id) return;
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      files: ["AlertMonitor_iframe.js"]
    });
  } catch (e) {
    console.error("Failed to inject AlertMonitor_iframe.js:", e);
  }
});
