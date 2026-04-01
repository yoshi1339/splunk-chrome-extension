// ===================================================================
// グローバル状態変数
// ===================================================================
let running         = false;  // 監視の実行状態
let settingsFrame   = null;   // 設定パネルのiframe要素
let alarmAudio      = null;   // アラーム音のAudioオブジェクト
let settingsVisible = false;  // 設定パネルの表示状態

// chrome.storage から読み込んだ設定をランタイムにキャッシュ
let runtimeSettings = {
  muteMode:     false,
  scheduleMode: { enabled: false, start: '22:00', end: '07:00' },
  showHistory:  false
};

// 履歴の最大保持件数
const HISTORY_MAX = 200;

// IDショートカット関数
function $(id) { return document.getElementById(id); }

// ===================================================================
// iframeのリサイズ要求：コンテンツサイズを親ウィンドウに通知
// ===================================================================
function postResize() {
  try {
    const card = document.getElementById('card');
    const w = Math.ceil((card || document.documentElement).scrollWidth);
    const h = Math.ceil(Math.max(
      document.documentElement.scrollHeight,
      document.body.scrollHeight
    ));
    // 親（AlertMonitor_iframe.js）に現在のサイズを通知してiframeをリサイズさせる
    window.parent.postMessage({ type: 'RESIZE_REQUEST', payload: { width: w, height: h } }, '*');
  } catch (_) {}
}

// ===================================================================
// アラーム音の再生・停止
// ===================================================================

// アラーム音を再生（ループ）
function playAlarm() {
  try {
    if (!alarmAudio) {
      // 初回のみAudioオブジェクトを生成（拡張機能リソースのWAVファイル）
      alarmAudio = new Audio(chrome.runtime.getURL("AlarmSound.wav"));
      alarmAudio.loop = true;
    }
    alarmAudio.currentTime = 0;
    alarmAudio.play().catch(e => console.warn("[Alarm] 再生エラー:", e));
  } catch (e) {
    console.error("[Alarm] 例外:", e);
  }
}

// アラーム音を停止してUIをリセット
function stopAlarm() {
  try {
    if (alarmAudio) {
      alarmAudio.pause();
      alarmAudio.currentTime = 0;
    }
  } catch (e) {
    console.error("[Alarm] 停止例外:", e);
  }
  // 停止ボタンを非表示にしてサイズを再計算
  const stopBtn = $("stopAlarm");
  if (stopBtn) stopBtn.style.display = "none";
  requestAnimationFrame(postResize);
}

// ===================================================================
// 設定の読み込みと変更監視
// ===================================================================

// chrome.storage から設定を取得してランタイムキャッシュに反映
function loadSettingsFromStorage() {
  try {
    chrome.storage.local.get(['muteMode', 'scheduleMode', 'showHistory'], (res) => {
      runtimeSettings.muteMode     = (typeof res.muteMode === 'boolean')                        ? res.muteMode     : runtimeSettings.muteMode;
      runtimeSettings.scheduleMode = (res.scheduleMode && typeof res.scheduleMode === 'object') ? res.scheduleMode : runtimeSettings.scheduleMode;
      runtimeSettings.showHistory  = (typeof res.showHistory === 'boolean')                     ? res.showHistory  : runtimeSettings.showHistory;
    });
  } catch (e) {
    console.warn('[UI] loadSettingsFromStorage error:', e);
  }
}

// storage の変更をリアルタイムでランタイムキャッシュに同期（設定変更を即反映）
if (chrome && chrome.storage && chrome.storage.onChanged) {
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local') return;
    if (changes.muteMode)     runtimeSettings.muteMode     = !!changes.muteMode.newValue;
    if (changes.scheduleMode) runtimeSettings.scheduleMode = changes.scheduleMode.newValue || runtimeSettings.scheduleMode;
    if (changes.showHistory)  runtimeSettings.showHistory  = !!changes.showHistory.newValue;
  });
}

// ===================================================================
// スケジュール判定ユーティリティ
// ===================================================================

// "HH:MM" 形式の時刻文字列を分単位の整数に変換
function timeStrToMinutes(timeStr) {
  if (!timeStr || typeof timeStr !== 'string') return null;
  const m = timeStr.match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return null;
  const hh = Number(m[1]), mm = Number(m[2]);
  return hh * 60 + mm;
}

// 現在時刻がスケジュール時間帯内かどうかを判定（日跨ぎにも対応）
function isNowInSchedule(scheduleMode) {
  if (!scheduleMode || !scheduleMode.enabled) return false;
  const startMin = timeStrToMinutes(scheduleMode.start);
  const endMin   = timeStrToMinutes(scheduleMode.end);
  if (startMin === null || endMin === null) return false;

  const now    = new Date();
  const nowMin = now.getHours() * 60 + now.getMinutes();

  if (startMin <= endMin) {
    return (nowMin >= startMin && nowMin < endMin); // 通常範囲（例：09:00〜18:00）
  } else {
    return (nowMin >= startMin) || (nowMin < endMin); // 日跨ぎ範囲（例：22:00〜07:00）
  }
}

// ===================================================================
// アラート履歴の管理
// ===================================================================

// アラート情報を storage の alertsHistory 配列に追記（最大200件）
function addToHistory(item) {
  try {
    chrome.storage.local.get(['alertsHistory'], (res) => {
      const arr = Array.isArray(res.alertsHistory) ? res.alertsHistory.slice() : [];

      // タイムスタンプを "YYYY/MM/DD HH:mm" 形式にフォーマット
      const formatDateTime = (ts) => {
        const d    = new Date(ts || Date.now());
        const yyyy = d.getFullYear();
        const mm   = String(d.getMonth() + 1).padStart(2, '0');
        const dd   = String(d.getDate()).padStart(2, '0');
        const hh   = String(d.getHours()).padStart(2, '0');
        const min  = String(d.getMinutes()).padStart(2, '0');
        return `${yyyy}/${mm}/${dd} ${hh}:${min}`;
      };

      const system    = item && (item.system || item.id) ? (item.system || item.id) : '不明';
      const formatted = `${system}：${formatDateTime(item && item.ts ? item.ts : Date.now())}`;

      const record = {
        ts:     item && item.ts ? item.ts : Date.now(),
        system,
        text:   formatted,
      };

      arr.unshift(record);                             // 先頭に追加（新しい順）
      if (arr.length > HISTORY_MAX) arr.length = HISTORY_MAX; // 上限超過分を削除
      chrome.storage.local.set({ alertsHistory: arr });
    });
  } catch (e) {
    console.warn('[UI] addToHistory error:', e);
  }
}

// ===================================================================
// 設定パネル（iframe）のインライン表示/非表示
// ===================================================================
function ensureSettingsInline(visible) {
  const host = document.getElementById('settings-container') || document.body;

  if (!settingsFrame) {
    // 設定iframeを新規生成してコンテナに追加
    settingsFrame = document.createElement('iframe');
    settingsFrame.id  = 'settings-frame';
    settingsFrame.src = chrome.runtime.getURL('SettingWindow.html');
    Object.assign(settingsFrame.style, {
      width:        '100%',
      height:       '320px',
      border:       '0',
      borderRadius: '12px',
      background:   '#fff',
      marginTop:    '8px',
      boxSizing:    'border-box',
      overflow:     'visible'
    });
    host.appendChild(settingsFrame);
  }

  if (!visible) {
    // 非表示の場合はiframeをDOMから削除
    settingsFrame.remove();
    settingsFrame = null;
    requestAnimationFrame(postResize);
    return;
  }

  // 表示状態を設定iframeに通知
  try {
    if (visible && settingsFrame && settingsFrame.contentWindow) {
      settingsFrame.contentWindow.postMessage(
        { type: 'SETTINGS_VISIBLE', payload: { visible: true } }, '*'
      );
    }
  } catch (e) {
    console.warn('[UI] failed to postMessage to settings iframe', e);
  }

  // iframe表示後に高さを自動調整（コンテンツ高に合わせる）
  if (visible) {
    setTimeout(() => {
      try {
        const doc = settingsFrame.contentDocument || settingsFrame.contentWindow.document;
        if (doc) {
          const body     = doc.body;
          const html     = doc.documentElement;
          const contentH = Math.max(body ? body.scrollHeight : 0, html ? html.scrollHeight : 0);
          const finalH   = Math.min(Math.max(contentH, 120), 800);
          settingsFrame.style.height = finalH + 'px';
        }
      } catch (e) {
        console.warn('[UI] settings iframe auto-size failed:', e);
      }
      requestAnimationFrame(postResize);
    }, 60); // iframeのレンダリングを待ってから高さを取得
  } else {
    requestAnimationFrame(postResize);
  }
}

// ===================================================================
// DOMContentLoaded：ボタンイベントリスナーの登録と初期化
// ===================================================================
document.addEventListener('DOMContentLoaded', () => {
  loadSettingsFromStorage(); // storage から設定を読み込む

  const actBtn      = $('act');
  const settingsBtn = $('settings');
  const stopAlarmBtn = $('stopAlarm');
  const clearBtn    = $('clear');

  // 実行/停止ボタン：監視のON/OFFを切り替えて親に通知
  actBtn.addEventListener('click', () => {
    running = !running;
    window.parent.postMessage(
      { type: running ? 'REQUEST_START' : 'REQUEST_STOP' }, '*'
    );
  });

  // 設定ボタン：設定パネルの表示/非表示をトグルして親と同期
  settingsBtn.addEventListener('click', () => {
    settingsVisible = !settingsVisible;
    window.parent.postMessage(
      { type: 'TOGGLE_SETTING_IFRAME', payload: { visible: settingsVisible } }, '*'
    );
    ensureSettingsInline(settingsVisible);
  });

  // アラーム停止ボタン：アラームを停止して親にも通知
  stopAlarmBtn.addEventListener('click', () => {
    stopAlarm();
    window.parent.postMessage({ type: 'REQUEST_STOP_ALARM' }, '*');
  });

  // 通知クリアボタン：全アラート表示を消去して親に通知
  clearBtn.addEventListener('click', () => {
    window.parent.postMessage({ type: 'REQUEST_CLEAR' }, '*');
  });

  // UI準備完了を親（AlertMonitor_iframe.js）に通知
  window.parent.postMessage({ type: 'UI_READY' }, '*');
});

// ===================================================================
// 親ウィンドウからのメッセージ受信ハンドラ
// ===================================================================
window.addEventListener('message', (event) => {
  const { type, payload } = event.data || {};
  switch (type) {

    // 監視状態の更新
    case 'STATE': updateState(payload); break;

    // アラート通知の表示
    case 'ALERT': showAlert(payload); break;

    // アラート表示をすべてクリア
    case 'CLEAR_UI': clearAlerts(); break;

    // アラーム音を停止
    case 'STOP_ALARM': stopAlarm(); break;

    // 設定パネルのインライン表示切替（親からの指示）
    case 'TOGGLE_SETTINGS_INLINE':
      settingsVisible = !!(payload && payload.visible);
      ensureSettingsInline(settingsVisible);
      requestAnimationFrame(postResize);
      break;

    // 設定パネルの表示切替（子iframeからの伝播）
    case 'TOGGLE_SETTING_IFRAME': {
      const vis = !!(payload && payload.visible);
      settingsVisible = vis;
      ensureSettingsInline(vis);
      // 親に設定パネルの表示状態を通知
      window.parent.postMessage(
        { type: 'SETTINGS_VISIBLE', payload: { visible: vis } }, '*'
      );
      requestAnimationFrame(postResize);
      break;
    }
  }
});

// ===================================================================
// 状態表示の更新：実行中/停止中でバッジとボタンの色・テキストを変更
// ===================================================================
function updateState(payload) {
  const status = $('status');
  const actBtn = $('act');
  running = !!(payload && payload.running);

  if (running) {
    status.textContent  = '拡張機能：実行中';
    status.className    = 'badge dot running';
    actBtn.textContent  = '停止';
    // 緑系のスタイルに変更
    status.style.background   = '#dcfce7';
    status.style.borderColor  = '#86efac';
    status.style.color        = '#166534';
    const dot = status.querySelector('span');
    if (dot) dot.style.background = '#22c55e';
  } else {
    status.textContent  = '拡張機能：停止中';
    status.className    = 'badge dot stopped';
    actBtn.textContent  = '実行';
    // 赤系のスタイルに変更
    status.style.background   = '#fee2e2';
    status.style.borderColor  = '#fecaca';
    status.style.color        = '#991b1b';
    const dot = status.querySelector('span');
    if (dot) dot.style.background = '#ef4444';
  }

  requestAnimationFrame(postResize);
}

// ===================================================================
// アラート通知のPill（バッジ）を生成してUIに追加
// ===================================================================
function showAlert(info) {
  const pills = $('pills');
  if (!pills) return;
  pills.style.display = 'flex';

  // 履歴に追記
  try { addToHistory(info); } catch (e) { console.warn('[UI] addToHistory failed', e); }

  // Pillコンテナの生成
  const pill = document.createElement('div');
  pill.className = 'pill';
  Object.assign(pill.style, {
    display:    'inline-flex',
    alignItems: 'center',
    gap:        '8px',
    marginRight:'8px',
    borderRadius: '999px',
    fontWeight: '700',
    fontSize:   '13px',
    whiteSpace: 'nowrap',
    transition: 'transform 0.15s ease',
    paddingRight: '8px'
  });

  // ラベル部分（赤背景の丸型バッジ）
  const label = document.createElement('div');
  Object.assign(label.style, {
    display:    'inline-flex',
    alignItems: 'center',
    gap:        '8px',
    padding:    '6px 12px',
    borderRadius: '999px',
    background: '#d90000',   // 赤背景
    color:      '#ffffff',
    border:     '1px solid #b10000',
    fontWeight: '700',
    fontSize:   '13px',
    transform:  'scale(1)',
  });

  // 状態インジケーター（白い丸ドット）
  const dot = document.createElement('span');
  Object.assign(dot.style, {
    width:        '10px',
    height:       '10px',
    borderRadius: '50%',
    background:   '#ffffff',
    display:      'inline-block'
  });

  // システム名と時刻のテキスト
  const txt = document.createElement('span');
  txt.style.lineHeight = '1';
  const rawName = (info && (info.system || info.id)) ? (info.system || info.id) : '不明';
  const timeStr = new Date((info && info.ts) ? info.ts : Date.now())
    .toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  txt.textContent = `${rawName} (${timeStr})`;

  label.appendChild(dot);
  label.appendChild(txt);
  pill.appendChild(label);

  // 消音中の場合に表示するラベル
  const mutedNote = document.createElement('span');
  Object.assign(mutedNote.style, {
    marginLeft: '6px',
    fontSize:   '12px',
    color:      '#fecaca',
    display:    'none',
    alignSelf:  'center'
  });
  mutedNote.textContent = '消音中';
  pill.appendChild(mutedNote);

  pills.appendChild(pill);

  const clearBtn  = $('clear');
  const stopBtn   = $('stopAlarm');

  // サウンド再生すべきか判定（消音モード・スケジュールを考慮）
  const play = shouldPlaySound();

  if (clearBtn) clearBtn.style.display = 'inline-block'; // クリアボタンを表示

  if (play) {
    if (stopBtn) stopBtn.style.display = 'inline-block'; // アラーム停止ボタンを表示
    playAlarm();
  } else {
    if (stopBtn) stopBtn.style.display = 'none';
    mutedNote.style.display = 'inline-block'; // 消音中ラベルを表示
  }

  requestAnimationFrame(postResize);
}

// ===================================================================
// アラーム再生可否の判定：消音モードとスケジュールを考慮
// ===================================================================
function shouldPlaySound() {
  try {
    const sm = runtimeSettings.scheduleMode || { enabled: false };
    if (sm && sm.enabled) {
      return isNowInSchedule(sm); // スケジュール有効時は時間帯内のみ再生
    } else {
      return !runtimeSettings.muteMode; // スケジュール無効時は消音モードの逆
    }
  } catch (e) {
    console.warn('[UI] shouldPlaySound error:', e);
    return !runtimeSettings.muteMode;
  }
}

// ===================================================================
// HTMLエスケープユーティリティ（XSS対策）
// ===================================================================
function escapeHtml(s) {
  if (typeof s !== 'string') return s;
  return s.replace(/[&<>"']/g, (m) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }
  )[m]);
}

// ===================================================================
// 全アラートのクリア：pillを削除しアラームを停止してUIをリセット
// ===================================================================
function clearAlerts() {
  const pills = $('pills');
  pills.innerHTML = '';
  pills.style.display = 'none';
  $('clear').style.display    = 'none';
  $('stopAlarm').style.display = 'none';
  stopAlarm();
  requestAnimationFrame(postResize);
}