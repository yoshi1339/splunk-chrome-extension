function noThrow(p) { try { return p && typeof p.then === 'function' ? p.catch(() => undefined) : undefined; } catch (_) { return undefined; } }
function getLocal(keys) { return new Promise(r => chrome.storage.local.get(keys, r)); }
function setLocal(obj) { return new Promise(r => chrome.storage.local.set(obj, r)); }

function extractNumericText(text) { const t = String(text || '').normalize('NFKC').replace(/[, \s]/g, ''); const m = t.match(/[-+]?\d*\.?\d+/); return m ? Number(m[0]) : NaN; }
function extractNumericFromNode(node) { return extractNumericText(node?.textContent); }

let uiFrame = null;
let uiReady = false;
let settingsVisible = false;

function ensureUIFrame() {
  if (uiFrame && document.body.contains(uiFrame)) return uiFrame;

  const targetParent = document.getElementById('row1');
  if (!targetParent) console.warn("[Ext] 'row1' not found. Insert UI iframe under <body>.");

  uiFrame = document.createElement('iframe');
  uiFrame.id = 'ext-ui-frame';
  uiFrame.src = chrome.runtime.getURL('UI_Panel.html');
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

  try {
    uiFrame.style.setProperty('transition', 'none', 'important');
    uiFrame.style.setProperty('animation', 'none', 'important');
  } catch (_) { }

  return uiFrame;
}

function postToUI(message) {
  try { ensureUIFrame(); uiFrame?.contentWindow?.postMessage(message, '*'); } catch (_) { }
}

let running = false;
let observer = null;

async function startObserve() {
  if (observer) return;
  await snapshotBaseline();
  observer = new MutationObserver(callback);

  // 各IDを順番に監視
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
  postToUI({ type: 'STATE', payload: { running: true } });
}

function stopObserve() {
  if (!observer) return;
  observer.disconnect();
  observer = null;
  running = false;
  postToUI({ type: 'STATE', payload: { running: false } });
  postToUI({ type: 'STOP_ALARM' });
}

window.addEventListener('message', (event) => {
  const { type, payload } = event.data || {};
  switch (type) {
    case 'RESIZE_REQUEST': {
      const { width, height } = payload || {};
      const MIN_W = 360;
      const MIN_H = 80;
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
      } catch (_) { }
      break;
    }

    case 'OPEN_SETTINGS': {
      settingsVisible = true;
      settingsVisible = true;
      settingsVisible = true;
      postToUI({ type: 'TOGGLE_SETTINGS_INLINE', payload: { visible: true } });
      break;
    }
    case 'TOGGLE_SETTING_IFRAME': {
      settingsVisible = !!(payload && payload.visible);
      settingsVisible = !!(payload && payload.visible);
      settingsVisible = !!(payload && payload.visible);
      postToUI({ type: 'TOGGLE_SETTINGS_INLINE', payload: { visible: !!(payload && payload.visible) } });
      break;
    }

    case 'TOGGLE_SETTINGS_INLINE': {
      settingsVisible = !!(payload && payload.visible);
      postToUI({ type: 'TOGGLE_SETTINGS_INLINE', payload: { visible: settingsVisible } });
      break;
    }

    case 'SETTINGS_VISIBLE': {
      settingsVisible = !!(payload && payload.visible);
      break;
    }

    case 'UI_READY': {
      uiReady = true;
      postToUI({ type: 'STATE', payload: { running } });
      break;
    }

    case 'REQUEST_START': startObserve(); break;
    case 'REQUEST_STOP': stopObserve(); break;
    case 'REQUEST_CLEAR': postToUI({ type: 'CLEAR_UI' }); break;
    case 'REQUEST_STOP_ALARM': postToUI({ type: 'STOP_ALARM' }); break;
  }
});

function callback(mutations) {
  for (const m of mutations) {
    if (m.type !== 'childList') continue;
    const enclosingId = findEnclosingId(m.target?.parentElement, null);
    DetectIncidentAndNotify(m.addedNodes, enclosingId);
  }
}

async function DetectIncidentAndNotify(nodes, enclosingId) {
  if (!enclosingId) return;
  let curMaxAny = null, curMaxGE1 = null;

  for (const node of nodes) {
    if (node.nodeType !== Node.ELEMENT_NODE) continue;

    if (node.classList &&
      node.classList.contains('custom-result-value') &&
      (node.classList.contains('green') || node.classList.contains('red'))) {
      const v = extractNumericFromNode(node);
      if (Number.isFinite(v)) {
        curMaxAny = curMaxAny === null ? v : Math.max(curMaxAny, v);
        if (v >= 1) curMaxGE1 = curMaxGE1 === null ? v : Math.max(curMaxGE1, v);
      }
    }

    const targets = node.querySelectorAll('.custom-result-value.green, .custom-result-value.red');
    for (const t of targets) {
      const v = extractNumericFromNode(t);
      if (Number.isFinite(v)) {
        curMaxAny = curMaxAny === null ? v : Math.max(curMaxAny, v);
        if (v >= 1) curMaxGE1 = curMaxGE1 === null ? v : Math.max(curMaxGE1, v);
      }
    }
  }

  if (curMaxAny === null) return;

  const prevRaw = await getLastValue(enclosingId);
  const prev = typeof prevRaw === 'number' ? prevRaw : 0;

  let shouldNotify = false;
  if (curMaxGE1 !== null) {
    if (prev < 1 && curMaxGE1 >= 1) shouldNotify = true;
    else if (prev >= 1 && curMaxGE1 > prev) shouldNotify = true;
  }

  if (shouldNotify) {
    const system = getSystemResponse(enclosingId, 'name');
    const ts = Date.now();
    const info = { id: enclosingId, system, ts };
    await setLocal({ lastAlertInfo: info });
    postToUI({ type: 'ALERT', payload: info });
  }

  await setLastValue(enclosingId, curMaxAny);
}

function findEnclosingId(cur, fallback) {
  while (cur) { if (cur.id) return cur.id; cur = cur.parentElement; }
  return fallback;
}

const TARGET_IDS = ['content2', 'content3', 'content4', 'content5', 'content9'];
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
    case 1:
    case 'name': return name;
    case 2:
    case 'monitor': return `${name} の監視を実行します。`;
    case 3:
    case 'verbose': return `ID: ${id} に対応する ${name} の監視を実行します。`;
    default: return name;
  }
}

async function getLastMap() { const r = await getLocal({ lastValues: {} }); return r.lastValues || {}; }
async function getLastValue(id) { const m = await getLastMap(); return m[id]; }
async function setLastValue(id, val) { const m = await getLastMap(); m[id] = val; await setLocal({ lastValues: m }); }

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

async function snapshotBaseline() {
  for (const id of TARGET_IDS) {
    const el = document.getElementById(id);
    const maxVal = collectMaxForContainer(el);
    if (Number.isFinite(maxVal) && maxVal >= 1) {
      await setLastValue(id, maxVal);
    } else {
      await setLastValue(id, 0);
    }
  }
}

(function () {
  ensureUIFrame();
  postToUI({ type: 'STATE', payload: { running } });
})();
