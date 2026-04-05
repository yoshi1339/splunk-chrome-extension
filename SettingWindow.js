// ==================================================================
// SettingWindow.js
// 設定ウィンドウのロジック
// - 消音モード / スケジュール / 履歴表示の設定を chrome.storage で管理
// ==================================================================

(() => {

  // ------------------------------------------------------------------
  // 初期チェック：Chrome拡張機能環境でなければ処理を中断
  // ------------------------------------------------------------------
  if (!chrome || !chrome.storage) {
    console.warn('[SettingWindow] chrome.storage が利用できません。拡張環境で実行してください。');
    return;
  }

  // ------------------------------------------------------------------
  // デフォルト値の定義
  // ------------------------------------------------------------------
  const DEFAULTS = {
    muteMode: false,                                                  // 消音モード：デフォルトOFF
    scheduleMode: { enabled: false, start: '22:00', end: '07:00' },  // スケジュール：デフォルト無効
    showHistory: false                                                // 履歴表示：デフォルトOFF
  };

  // ------------------------------------------------------------------
  // DOM要素の取得
  // ------------------------------------------------------------------
  const $ = id => document.getElementById(id);
  const muteCheckbox   = $('muteMode');       // 消音モードのチェックボックス
  const startInput     = $('scheduleStart');  // スケジュール開始時刻の入力欄
  const endInput       = $('scheduleEnd');    // スケジュール終了時刻の入力欄
  const showHistoryBtn = $('showHistoryBtn'); // 履歴表示トグルボタン
  const closeBtn       = $('close-btn');      // 設定パネルを閉じるボタン

  // ------------------------------------------------------------------
  // ユーティリティ：デバウンス処理
  // 連続入力を抑制し、最後の入力からwaitミリ秒後に1回だけ関数を実行する
  // ------------------------------------------------------------------
  function debounce(fn, wait = 300) {
    let t = null;
    return (...args) => {
      clearTimeout(t);
      t = setTimeout(() => fn(...args), wait);
    };
  }

  // ------------------------------------------------------------------
  // 設定の保存：各設定項目を chrome.storage.local に保存する
  // ------------------------------------------------------------------

  // 消音モードを保存
  function saveMuteMode(val) {
    chrome.storage.local.set({ muteMode: !!val });
  }

  // スケジュール設定を保存
  // 開始・終了の両方が入力されている場合のみ enabled = true にする
  function saveSchedule(start, end) {
    start = (typeof start === 'string' && start.trim()) ? start.trim() : '';
    end   = (typeof end   === 'string' && end.trim())   ? end.trim()   : '';
    const enabled = !!(start && end);
    const payload = {
      scheduleMode: {
        enabled,
        start: enabled ? start : DEFAULTS.scheduleMode.start,
        end:   enabled ? end   : DEFAULTS.scheduleMode.end
      }
    };
    chrome.storage.local.set(payload);
  }

  // 履歴表示設定を保存
  function saveShowHistory(val) {
    chrome.storage.local.set({ showHistory: !!val });
  }

  // スケジュール保存はデバウンス処理（300ms後に実行）
  const debouncedSaveSchedule = debounce((s, e) => saveSchedule(s, e), 300);

  // ------------------------------------------------------------------
  // 設定の読み込み：storage から取得して各UI要素に反映する
  // ------------------------------------------------------------------
  function loadSettings() {
    chrome.storage.local.get(['muteMode', 'scheduleMode', 'showHistory'], (res) => {
      // 取得した値が正しい型でなければデフォルト値を使用
      const muteMode     = (typeof res.muteMode === 'boolean') ? res.muteMode : DEFAULTS.muteMode;
      const scheduleMode = (res.scheduleMode && typeof res.scheduleMode === 'object') ? res.scheduleMode : DEFAULTS.scheduleMode;
      const showHistory  = (typeof res.showHistory === 'boolean') ? res.showHistory : DEFAULTS.showHistory;

      // 各UI要素に値を反映
      if (muteCheckbox) muteCheckbox.checked = !!muteMode;
      if (startInput)   startInput.value = scheduleMode.enabled ? (scheduleMode.start || DEFAULTS.scheduleMode.start) : '';
      if (endInput)     endInput.value   = scheduleMode.enabled ? (scheduleMode.end   || DEFAULTS.scheduleMode.end)   : '';

      updateShowHistoryButton(showHistory);

      // 前回履歴表示がONだった場合は自動的に展開する
      if (showHistory) {
        toggleHistoryUI(true);
      }
    });
  }

  // ------------------------------------------------------------------
  // 履歴ボタンの表示状態を更新
  // ON/OFFでボタンテキストと背景色を切り替える
  // ------------------------------------------------------------------
  function updateShowHistoryButton(enabled) {
    if (!showHistoryBtn) return;
    showHistoryBtn.dataset.enabled  = enabled ? '1' : '0';
    showHistoryBtn.textContent      = enabled ? '履歴を表示中（クリックで非表示）' : '履歴を表示';
    showHistoryBtn.style.background = enabled ? '#1f2937' : '#334155';
  }

  // ------------------------------------------------------------------
  // 履歴表示コンテナの確保
  // 既に存在すれば再利用、なければ動的に生成してDOMに挿入する
  // ------------------------------------------------------------------
  function ensureHistoryContainer() {
    let c = document.getElementById('historyContainer');
    if (c) return c; // 既存コンテナがあれば再利用

    // コンテナを新規生成してスタイルを設定
    c = document.createElement('div');
    c.id = 'historyContainer';
    Object.assign(c.style, {
      marginTop:    '10px',
      maxHeight:    '260px',
      overflowY:    'auto',
      background:   '#0b1220',
      border:       '1px solid rgba(255,255,255,0.04)',
      borderRadius: '8px',
      padding:      '8px',
      boxSizing:    'border-box',
      color:        '#e5e7eb',
      fontSize:     '13px'
    });

    // settings-grid の直後に挿入、なければ body に追加
    const grid = document.getElementById('settings-grid');
    if (grid && grid.parentNode) {
      grid.parentNode.insertBefore(c, grid.nextSibling);
    } else {
      document.body.appendChild(c);
    }
    return c;
  }

  // ------------------------------------------------------------------
  // 履歴リストの描画
  // storage から alertsHistory を取得してリスト形式で表示する
  // ------------------------------------------------------------------
  function renderHistoryList() {
    const container = ensureHistoryContainer();
    // 取得中のプレースホルダーを表示
    container.innerHTML = '<div style="color:#94a3b8;margin-bottom:8px;">履歴を取得中…</div>';

    chrome.storage.local.get(['alertsHistory'], (res) => {
      const arr = Array.isArray(res.alertsHistory) ? res.alertsHistory : [];

      // 履歴が空の場合はメッセージを表示して終了
      if (arr.length === 0) {
        container.innerHTML = '<div style="color:#94a3b8;">履歴はありません。</div>';
        return;
      }

      // ヘッダー（件数表示 + クリアボタン）を生成
      const header = document.createElement('div');
      header.style.display        = 'flex';
      header.style.justifyContent = 'space-between';
      header.style.alignItems     = 'center';
      header.style.marginBottom   = '8px';

      const title = document.createElement('div');
      title.textContent      = `履歴 (${arr.length})`;
      title.style.color      = '#cbd5e1';
      title.style.fontWeight = '700';
      header.appendChild(title);

      // 履歴を全件消去するクリアボタン
      const clearBtn = document.createElement('button');
      clearBtn.textContent = 'クリア';
      Object.assign(clearBtn.style, {
        background:   '#334155',
        color:        '#e5e7eb',
        border:       'none',
        padding:      '6px 10px',
        borderRadius: '8px',
        cursor:       'pointer'
      });
      clearBtn.addEventListener('click', () => {
        if (!confirm('履歴を完全に消去しますか？')) return;
        // 確認後、storage の alertsHistory を空にして再描画
        chrome.storage.local.set({ alertsHistory: [] }, () => {
          renderHistoryList();
        });
      });
      header.appendChild(clearBtn);

      container.innerHTML = '';
      container.appendChild(header);

      // 履歴アイテムのリストを生成（最大200件）
      const list = document.createElement('div');
      list.style.display       = 'flex';
      list.style.flexDirection = 'column';
      list.style.gap           = '8px';

      arr.slice(0, 200).forEach((r) => {
        const item = document.createElement('div');
        Object.assign(item.style, {
          background: 'rgba(255,255,255,0.02)',
          padding:    '8px',
          borderRadius: '8px',
          display:    'flex',
          alignItems: 'flex-start',
          gap:        '8px',
          wordBreak:  'break-word'
        });

        const text = document.createElement('div');
        text.style.flex     = '1';
        text.style.color    = '#e5e7eb';
        text.style.fontSize = '13px';
        // text フィールドがあればそれを使用、なければシステム名＋日時またはJSONで表示
        text.textContent = r.text || (r.system
          ? (r.system + '：' + new Date(r.ts || Date.now()).toLocaleString())
          : JSON.stringify(r.raw || r));

        item.appendChild(text);
        list.appendChild(item);
      });

      container.appendChild(list);
    });
  }

  // ------------------------------------------------------------------
  // 履歴UIのトグル
  // visible=true で描画、false でコンテナをDOMから削除する
  // ------------------------------------------------------------------
  function toggleHistoryUI(visible) {
    const c = document.getElementById('historyContainer');
    if (!visible) {
      // 非表示：コンテナをDOMから取り除く
      if (c && c.parentNode) c.parentNode.removeChild(c);
      return;
    }
    // 表示：最新の履歴を描画
    renderHistoryList();
  }

  // ------------------------------------------------------------------
  // イベントリスナーの登録
  // ------------------------------------------------------------------

  // 消音チェックボックス：変更時に即座に storage へ保存
  if (muteCheckbox) {
    muteCheckbox.addEventListener('change', (e) => {
      const v = e.target.checked;
      saveMuteMode(v);
    });
  }

  // 開始時刻入力：inputイベントはデバウンス、changeイベントは即時保存
  if (startInput) {
    try { startInput.type = 'time'; } catch (_) { }
    startInput.addEventListener('input', (e) => {
      const s = e.target.value;
      const endVal = endInput ? endInput.value : '';
      debouncedSaveSchedule(s, endVal);
    });
    startInput.addEventListener('change', (e) => {
      saveSchedule(e.target.value, endInput ? endInput.value : '');
    });
  }

  // 終了時刻入力：inputイベントはデバウンス、changeイベントは即時保存
  if (endInput) {
    try { endInput.type = 'time'; } catch (_) { }
    endInput.addEventListener('input', (e) => {
      const sVal = startInput ? startInput.value : '';
      const eVal = e.target.value;
      debouncedSaveSchedule(sVal, eVal);
    });
    endInput.addEventListener('change', (e) => {
      saveSchedule(startInput ? startInput.value : '', e.target.value);
    });
  }

  // 履歴ボタン：クリックで表示/非表示をトグルし、状態を storage に保存
  if (showHistoryBtn) {
    showHistoryBtn.addEventListener('click', () => {
      const currently = showHistoryBtn.dataset.enabled === '1';
      const next = !currently;
      saveShowHistory(next);
      updateShowHistoryButton(next);
      // 親ウィンドウにも履歴トグル状態を通知
      try { parent.postMessage({ type: 'TOGGLE_HISTORY', payload: { visible: next } }, '*'); } catch (e) { }
      toggleHistoryUI(next);
    });
  }

  // スケジュールリセットボタン：時刻入力をクリアしてスケジュールを無効化
  const resetBtn = document.getElementById('resetScheduleBtn');
  if (resetBtn) {
    resetBtn.addEventListener('click', () => {
      startInput.value = '';
      endInput.value   = '';
      chrome.storage.local.set({
        scheduleMode: { enabled: false, start: '', end: '' }
      });
    });
  }

  // 閉じるボタン：設定パネルを閉じるよう親ウィンドウに通知
  if (closeBtn) {
    closeBtn.addEventListener('click', () => {
      try { parent.postMessage({ type: 'TOGGLE_SETTING_IFRAME', payload: { visible: false } }, '*'); } catch (e) { }
    });
  }

  // ------------------------------------------------------------------
  // storage の変更をリアルタイム監視
  // 他の箇所（UI_Panel等）で設定が変更された場合にUIへ即時反映する
  // ------------------------------------------------------------------
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local') return;

    // 消音モードの変更を反映
    if (changes.muteMode) {
      if (muteCheckbox) muteCheckbox.checked = !!changes.muteMode.newValue;
    }
    // スケジュール設定の変更を反映
    if (changes.scheduleMode) {
      const sm = changes.scheduleMode.newValue || DEFAULTS.scheduleMode;
      if (startInput) startInput.value = sm.enabled ? sm.start : '';
      if (endInput)   endInput.value   = sm.enabled ? sm.end   : '';
    }
    // 履歴表示設定の変更を反映
    if (changes.showHistory) {
      updateShowHistoryButton(!!changes.showHistory.newValue);
    }
  });

  // ------------------------------------------------------------------
  // 初期化：ページ読み込み時に storage から設定を読み込んでUIに反映
  // ------------------------------------------------------------------
  loadSettings();

  // ------------------------------------------------------------------
  // 親ウィンドウからのメッセージ受信ハンドラ
  // ------------------------------------------------------------------
  window.addEventListener('message', (ev) => {
    try {
      const data = ev.data || {};

      // 設定パネルが表示された際に履歴リストを最新状態に更新
      if (data && data.type === 'SETTINGS_VISIBLE') {
        const vis = !!(data.payload && data.payload.visible);
        if (vis) {
          renderHistoryList();
        }
      }

      // 外部から履歴の再描画を要求された場合
      if (data && data.type === 'REFRESH_HISTORY') {
        renderHistoryList();
      }

    } catch (e) {
      console.warn('[SettingWindow] message handler error', e);
    }
  }, false);

})();