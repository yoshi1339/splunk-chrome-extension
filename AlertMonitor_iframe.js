// ===================================================================
// ユーティリティ：Promiseの例外を無視して安全に実行する
// ===================================================================
function noThrow(p) {
  try {
    return p && typeof p.then === 'function' ? p.catch(() => undefined) : undefined;
  } catch (_) { return undefined; }
}

// chrome.storage.local から値を取得するPromiseラッパー
function getLocal(keys) {
  return new Promise(r => chrome.storage.local.get(keys, r));
}

// chrome.storage.local に値を保存するPromiseラッパー
function setLocal(obj) {
  return new Promise(r => chrome.storage.local.set(obj, r));
}

// ===================================================================
// 数値抽出ユーティリティ
// ===================================================================

// テキスト文字列から最初の数値を抽出する（全角数字・カンマ・スペース対応）
function extractNumericText(text) {
  const t = String(text || '').normalize('NFKC').replace(/[, \s]/g, '');
  const m = t.match(/[-+]?\d*\.?\d+/);
  return m ? Number(m[0]) : NaN;
}

// DOM要素のtextContentから数値を抽出する
function extractNumericFromNode(node) {
  return extractNumericText(node?.textContent);
}

// ===================================================================
// グローバル状態変数
// ===================================================================
let uiFrame = null;         // UIパネルのiframe要素
let uiReady = false;        // UIパネルの準備完了フラグ
let settingsVisible = false; // 設定パネルの表示状態

// ===================================================================
// UIパネル（iframe）の管理
// ===================================================================

// UIパネルのiframeを確保・生成する（既存なら再利用）
function ensureUIFrame() {
  if (uiFrame && document.body.contains(uiFrame)) return uiFrame;

  // Splunkの row1 要素を親として挿入を試みる（なければ body に追加）
  const targetParent = document.getElementById('row1');
  if (!targetParent) console.warn("[Ext] 'row1' not found. Insert UI iframe under body.");

  // iframeを生成し、UI_Panel.html を読み込む
  uiFrame = document.createElement('iframe');
  uiFrame.id = 'ext-ui-frame';
  uiFrame.src = chrome.runtime.getURL('UI_Panel.html');

  // iframeのスタイル設定（位置・サイズ・見た目）
  Object.assign(uiFrame.style, {
    position: 'relative',
    display: 'inline-block',
    margin: '8px 0',
    zIndex: '0',
    height: '50px',
    border: '0',
    boxShadow: '0 12px 24px rgba(0,0,0,.2)',
    borderRadius: '16px',
    background: 'transparent',
    boxSizing: 'border-box',
    overflowX: 'hidden',
    maxWidth: 'calc(100vw - 48px)',
    left: '0',
    right: '0',
    transform: 'none',
    transition: 'none'
  });

  (targetParent || document.body).appendChild(uiFrame);

  // アニメーションをすべて無効化（ちらつき防止）
  try {
    uiFrame.style.setProperty('transition', 'none', 'important');
    uiFrame.style.setProperty('animation', 'none', 'important');
  } catch (_) {}

  return uiFrame;
}

// UIパネルにpostMessageでメッセージを送信する
function postToUI(message) {
  try {
    ensureUIFrame();
    uiFrame?.contentWindow?.postMessage(message, '*');
  } catch (_) {}
}

// ===================================================================
// MutationObserver によるDOM監視の管理
// ===================================================================
let running = false;   // 監視中フラグ
let observer = null;   // MutationObserver インスタンス

// DOM監視を開始する（ベースライン取得後、各ターゲット要素を監視）
async function startObserve() {
  if (observer) return; // 既に監視中なら再起動しない

  await snapshotBaseline(); // 現在の値をベースラインとして保存

  observer = new MutationObserver(callback);

  // 各対象IDの要素を検索して監視登録
  TARGET_IDS.forEach(id => {
    const target = document.getElementById(id);
    if (target) {
      observer.observe(target, { childList: true, subtree: true });
      console.log(`[Observer] 監視開始: ${id}`);
    } else {
      console.warn(`[Observer] IDが見つかりませんでした: ${id}`);
    }
  });

  running = true;
  // UIに「実行中」状態を通知
  postToUI({ type: 'STATE', payload: { running: true } });
}

// DOM監視を停止する
function stopObserve() {
  if (!observer) return;
  observer.disconnect();
  observer = null;
  running = false;
  // UIに「停止中」状態とアラーム停止を通知
  postToUI({ type: 'STATE', payload: { running: false } });
  postToUI({ type: 'STOP_ALARM' });
}

// ===================================================================
// 親ウィンドウ（コンテンツスクリプト）からのメッセージ受信ハンドラ
// ===================================================================
window.addEventListener('message', (event) => {
  const { type, payload } = event.data || {};
  switch (type) {

    // UIのサイズ変更要求：ビューポートに合わせてiframeをリサイズ
    case 'RESIZE_REQUEST': {
      const { width, height } = payload || {};
      const MIN_W = 360, MIN_H = 80;
      const MAX_H = settingsVisible ? 450 : 80;
      const SIDE_SAFE = 24;
      const VIEWPORT_MARGIN = 0.98;
      const maxViewportW = Math.max(MIN_W, Math.round(window.innerWidth * VIEWPORT_MARGIN) - SIDE_SAFE * 2);
      const finalW = maxViewportW;
      const rawH = Number(height) || MIN_H;
      const finalH = Math.min(Math.max(MIN_H, rawH), MAX_H);
      try {
        ensureUIFrame();
        if (uiFrame) {
          uiFrame.style.setProperty('transition', 'none', 'important');
          uiFrame.style.setProperty('animation', 'none', 'important');
          uiFrame.style.width = finalW + 'px';
          uiFrame.style.height = finalH + 'px';
        }
      } catch (_) {}
      break;
    }

    // 設定パネルを開く要求
    case 'OPEN_SETTINGS': {
      settingsVisible = true;
      postToUI({ type: 'TOGGLE_SETTINGS_INLINE', payload: { visible: true } });
      break;
    }

    // 設定パネルの表示切替要求（UIパネルからの通知）
    case 'TOGGLE_SETTING_IFRAME': {
      settingsVisible = !!(payload && payload.visible);
      postToUI({ type: 'TOGGLE_SETTINGS_INLINE', payload: { visible: !!(payload && payload.visible) } });
      break;
    }

    // 設定パネルのインライン表示切替
    case 'TOGGLE_SETTINGS_INLINE': {
      settingsVisible = !!(payload && payload.visible);
      postToUI({ type: 'TOGGLE_SETTINGS_INLINE', payload: { visible: settingsVisible } });
      break;
    }

    // 設定パネルの表示状態を同期
    case 'SETTINGS_VISIBLE': {
      settingsVisible = !!(payload && payload.visible);
      break;
    }

    // UIパネルの準備完了通知：現在の監視状態を送信する
    case 'UI_READY': {
      uiReady = true;
      postToUI({ type: 'STATE', payload: { running } });
      break;
    }

    // 監視開始リクエスト
    case 'REQUEST_START': startObserve(); break;

    // 監視停止リクエスト
    case 'REQUEST_STOP': stopObserve(); break;

    // 通知クリアリクエスト
    case 'REQUEST_CLEAR': postToUI({ type: 'CLEAR_UI' }); break;

    // アラーム停止リクエスト
    case 'REQUEST_STOP_ALARM': postToUI({ type: 'STOP_ALARM' }); break;
  }
});

// ===================================================================
// MutationObserverのコールバック：DOM変更を検知してインシデント判定
// ===================================================================
function callback(mutations) {
  for (const m of mutations) {
    if (m.type !== 'childList') continue; // 子要素の追加・削除のみ処理
    const enclosingId = findEnclosingId(m.target?.parentElement, null);
    DetectIncidentAndNotify(m.addedNodes, enclosingId);
  }
}

// 変更ノードを解析し、閾値超過時にアラートを発報する
async function DetectIncidentAndNotify(nodes, enclosingId) {
  if (!enclosingId) return;

  let curMaxAny = null; // 今回追加されたノードの最大値（全値）
  let curMaxGE1 = null; // 今回追加されたノードの最大値（1以上のみ）

  for (const node of nodes) {
    if (node.nodeType !== Node.ELEMENT_NODE) continue;

    // 直接追加されたノードが .custom-result-value の green/red の場合
    if (
      node.classList &&
      node.classList.contains('custom-result-value') &&
      (node.classList.contains('green') || node.classList.contains('red'))
    ) {
      const v = extractNumericFromNode(node);
      if (Number.isFinite(v)) {
        curMaxAny = curMaxAny === null ? v : Math.max(curMaxAny, v);
        if (v >= 1) curMaxGE1 = curMaxGE1 === null ? v : Math.max(curMaxGE1, v);
      }
    }

    // 追加ノードの子要素も検索（ネストされた .custom-result-value を取得）
    const targets = node.querySelectorAll('.custom-result-value.green, .custom-result-value.red');
    for (const t of targets) {
      const v = extractNumericFromNode(t);
      if (Number.isFinite(v)) {
        curMaxAny = curMaxAny === null ? v : Math.max(curMaxAny, v);
        if (v >= 1) curMaxGE1 = curMaxGE1 === null ? v : Math.max(curMaxGE1, v);
      }
    }
  }

  if (curMaxAny === null) return; // 有効な数値が見つからなければ終了

  // 前回の記録値と比較してアラート発報すべきか判定
  const prevRaw = await getLastValue(enclosingId);
  const prev = typeof prevRaw === 'number' ? prevRaw : 0;
  let shouldNotify = false;

  if (curMaxGE1 !== null) {
    if (prev < 1 && curMaxGE1 >= 1) shouldNotify = true;       // 0→1以上への遷移
    else if (prev >= 1 && curMaxGE1 > prev) shouldNotify = true; // 1以上の値がさらに増加
  }

  // アラート発報：最終アラート情報を保存してUIに通知
  if (shouldNotify) {
    const system = getSystemResponse(enclosingId, 'name');
    const ts = Date.now();
    const info = { id: enclosingId, system, ts };
    await setLocal({ lastAlertInfo: info });
    postToUI({ type: 'ALERT', payload: info });
  }

  // 現在の最大値を記録（次回比較用）
  await setLastValue(enclosingId, curMaxAny);
}

// DOM要素を親方向に辿って最初のID付き要素のIDを返す
function findEnclosingId(cur, fallback) {
  while (cur) {
    if (cur.id) return cur.id;
    cur = cur.parentElement;
  }
  return fallback;
}

// ===================================================================
// 監視対象IDとシステム名のマッピング
// ===================================================================

// 監視対象となるSplunkコンテナのDOM ID一覧
const TARGET_IDS = ['content2', 'content3', 'content4', 'content5', 'content9'];

// DOM IDからシステム名（またはメッセージ）を返す
function getSystemResponse(id, mode) {
  const map = {
    content2: 'システムA',
    content3: 'システムB',
    content4: 'システムC',
    content5: 'システムD',
    content9: 'システムE'
  };
  if (!(id in map)) return `指定された ID「${id}」に対応するシステムは存在しません。`;
  const name = map[id];
  switch (mode) {
    case 1: case 'name':    return name;                              // システム名のみ
    case 2: case 'monitor': return `${name} の監視を実行します。`;     // 監視メッセージ
    case 3: case 'verbose': return `ID: ${id} に対応する ${name} の監視を実行します。`; // 詳細メッセージ
    default: return name;
  }
}

// ===================================================================
// 前回値の永続化（chrome.storage.local）
// ===================================================================

// storage から全IDの最終値マップを取得
async function getLastMap() {
  const r = await getLocal({ lastValues: {} });
  return r.lastValues || {};
}

// 特定IDの最終値を取得
async function getLastValue(id) {
  const m = await getLastMap();
  return m[id];
}

// 特定IDの最終値を保存
async function setLastValue(id, val) {
  const m = await getLastMap();
  m[id] = val;
  await setLocal({ lastValues: m });
}

// ===================================================================
// ベースライン取得：監視開始前の現状値をスナップショット
// ===================================================================

// コンテナ内の .custom-result-value（green/red/yellow）から最大値を収集
function collectMaxForContainer(container) {
  if (!container) return null;
  let maxVal = null;
  if (container.classList?.contains('custom-result-value')) {
    const v0 = extractNumericFromNode(container);
    if (Number.isFinite(v0)) maxVal = maxVal === null ? v0 : Math.max(maxVal, v0);
  }
  const nodes = container.querySelectorAll('.custom-result-value.green, .custom-result-value.red, .custom-result-value.yellow');
  for (const n of nodes) {
    const v = extractNumericFromNode(n);
    if (Number.isFinite(v)) maxVal = maxVal === null ? v : Math.max(maxVal, v);
  }
  return maxVal;
}

// 全監視対象のベースライン値を storage に保存（監視開始前に呼び出す）
async function snapshotBaseline() {
  for (const id of TARGET_IDS) {
    const el = document.getElementById(id);
    const maxVal = collectMaxForContainer(el);
    if (Number.isFinite(maxVal) && maxVal >= 1) {
      await setLastValue(id, maxVal); // 既に1以上の値があればそれをベースラインとする
    } else {
      await setLastValue(id, 0);      // 値がなければ0をベースラインとする
    }
  }
}

// ===================================================================
// 初期化：スクリプト注入時に即時UIを表示して状態を通知
// ===================================================================
(function () {
  ensureUIFrame();
  postToUI({ type: 'STATE', payload: { running } });
})();