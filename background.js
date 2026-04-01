// ツールバーアイコンがクリックされたときに発火するイベントリスナー
chrome.action.onClicked.addListener(async (tab) => {
  try {
    // タブIDが存在しない場合は処理を中断
    if (!tab.id) return;

    // アクティブなタブに AlertMonitor_iframe.js を動的に注入する
    // （クリックするたびに注入を試みる。スクリプト側で多重起動を防止する）
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      files: ["AlertMonitor_iframe.js"]
    });

  } catch (e) {
    // 注入に失敗した場合（例：chrome:// ページや権限なしページ）のエラーログ
    console.error("Failed to inject AlertMonitor_iframe.js:", e);
  }
});