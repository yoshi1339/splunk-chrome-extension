// ===================================================================
// 初期チェック：Chrome拡張機能環境でなければ処理を中断
// ===================================================================
(() => {
  if (!chrome || !chrome.storage) {
    console.warn('[SettingWindow] chrome.storage が利用できません。拡張環境で実行してください。');
    return;
  }

  // ===================================================================
  // 設定のデフォルト値
  // ===================================================================
  const DEFAULTS = {
    muteMode: false,                               // 消音モード：デフォルトOFF
    scheduleMode: { enabled: false, start: '22:00', end: '07:00' }, // スケジュール：デフォルト無効
    showHistory: false                             // 履歴表示：デフォルトOFF
  };

  // ===================================================================
  // DOM要素の取得
  // ===================================================================
  const $ = id => document.getElementById(id);
  const muteCheckbox   = $('muteMode');       // 消音チェックボックス
  const startInput     = $('scheduleStart');  // スケジュール開始時刻
  const endInput       = $('scheduleEnd');    // スケジュール終了時刻
  const showHistoryBtn = $('showHistoryBtn'); // 履歴表示ボタン
  const closeBtn       = $('close-btn');      // 閉じるボタン

  // ===================================================================
  // デバウンス：連続入力を抑制して一定時間後に関数を実行
  // ===================================================================
  function debounce(fn, wait = 300) {
    let t = null;
    return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), wait); };
  }

  // ===================================================================
  // 設定の保存関数
  // ===================================================================

  // 消音モードを storage に保存
  function saveMuteMode(val) {
    chrome.storage.local.set({ muteMode: !!val });
  }

  // スケジュール設定を storage に保存（両方入力済みの場合のみ有効化）
  function saveSchedule(start, end) {
    start = (typeof start === 'string' && start.trim()) ? start.trim() : '';
    end   = (typeof end   === 'string' && end.trim())   ? end.trim()   : '';
    const enabled = !!(start && end); // 両方入力済みなら enabled = true
    const payload = {
      scheduleMode: {
        enabled,
        start: enabled ? start : DEFAULTS.scheduleMode.start,
        end:   enabled ? end   : DEFAULTS.scheduleMode.end
      }
    };
    chrome.storage.local.set(payload);
  }

  // 履歴表示設定を storage に保存
  function saveShowHistory(val) {
    chrome.storage.local.set({ showHistory: !!val });
  }

  // スケジュール保存をデバウンス処理（300ms後に実行）
  const debouncedSaveSchedule = debounce((s, e) => saveSchedule(s, e), 300);

  // ===================================================================
  // 設定の読み込み：storage から取得してUIに反映
  // ===================================================================
  function loadSettings() {
    chrome.storage.local.get(['muteMode', 'scheduleMode', 'showHistory'], (res) => {
      // 値が正しい型でなければデフォルト値を使用
      const muteMode     = (typeof res.muteMode === 'boolean') ? res.muteMode : DEFAULTS.muteMode;
      const scheduleMode = (res.scheduleMode && typeof res.scheduleMode === 'object') ? res.scheduleMode : DEFAULTS.scheduleMode;
      const showHistory  = (typeof res.showHistory === 'boolean') ? res.showHistory : DEFAULTS.showHistory;

      // 各UI要素に値を反映
      if (muteCheckbox) muteCheckbox.checked = !!muteMode;
      if (startInput)   startInput.value = scheduleMode.enabled ? (scheduleMode.start || DEFAULTS.scheduleMode.start) : '';
      if (endInput)     endInput.value   = scheduleMode.enabled ? (scheduleMode.end   || DEFAULTS.scheduleMode.end)   : '';

      updateShowHistoryButton(showHistory);
      if (showHistory) { toggleHistoryUI(true); } // 前回履歴表示ONなら自動展開
    });
  }

  // ===================================================================
  // 履歴ボタンの表示状態を更新（テキスト・色をON/OFFで切り替え）
  // ===================================================================
  function updateShowHistoryButton(enabled) {
    if (!showHistoryBtn) return;
    showHistoryBtn.dataset.enabled = enabled ? '1' : '0';
    showHistoryBtn.textContent     = enabled ? '履歴を表示中（クリックで非表示）' : '履歴を表示';
    showHistoryBtn.style.background = enabled ? '#1f2937' : '#334155';
  }

  // ===================================================================
  // 履歴表示コンテナの生成（なければ動的に作成してDOMに挿入）
  // ===================================================================
  function ensureHistoryContainer() {
    let c = document.getElementById('historyContainer');
    if (c) return c; // 既に存在すれば再利用

    // 新規コンテナを生成してスタイルを設定
    c = document.createElement('div');
    c.id = 'historyContainer';
    Object.assign(c.style, {
      marginTop: '10px',
      maxHeight: '260px',
      overflowY: 'auto',
      background: '#0b1220',
      border: '1px solid rgba(255,255,255,0.04)',
      borderRadius: '8px',
      padding: '8px',
      boxSizing: 'border-box',
      color: '#e5e7eb',
      fontSize: '13px'
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

  // ===================================================================
  // 履歴リストの描画：storage から alertsHistory を取得して一覧表示
  // ===================================================================
  function renderHistoryList() {
    const container = ensureHistoryContainer();
    container.innerHTML = ''; // 既存内容をクリア

    chrome.storage.local.get(['alertsHistory'], (res) => {
      const arr = Array.isArray(res.alertsHistory) ? res.alertsHistory : [];

      if (arr.length === 0) {
        // 履歴がない場合の空状態メッセージ
        container.innerHTML = '<div style="color:#6b7280;padding:8px;">履歴はありません。</div>';
        return;
      }

      // 履歴を新しい順に表示
      arr.forEach(record => {
        const item = document.createElement('div');
        item.style.cssText = 'padding:4px 0; border-bottom:1px solid rgba(255,255,255,0.04);';
        item.textContent = record.text || '';
        container.appendChild(item);
      });
    });
  }

  // ===================================================================
  // 履歴UIのトグル：表示/非表示を切り替えてstorageに保存
  // ===================================================================
  function toggleHistoryUI(force) {
    const current = showHistoryBtn?.dataset?.enabled === '1';
    const next = (typeof force === 'boolean') ? force : !current;

    if (next) {
      renderHistoryList(); // 表示する場合は最新履歴を描画
    } else {
      // 非表示にする場合はコンテナを削除
      const c = document.getElementById('historyContainer');
      if (c) c.remove();
    }

    updateShowHistoryButton(next);
    saveShowHistory(next); // 状態をstorageに保存
  }

  // ===================================================================
  // イベントリスナーの登録
  // ===================================================================

  // 消音チェックボックスの変更時に即座に保存
  if (muteCheckbox) {
    muteCheckbox.addEventListener('change', () => saveMuteMode(muteCheckbox.checked));
  }

  // 開始時刻変更時にデバウンスして保存
  if (startInput) {
    startInput.addEventListener('input', () => debouncedSaveSchedule(startInput.value, endInput?.value));
  }

  // 終了時刻変更時にデバウンスして保存
  if (endInput) {
    endInput.addEventListener('input', () => debouncedSaveSchedule(startInput?.value, endInput.value));
  }

  // スケジュールリセットボタン：両時刻をクリアして設定を無効化
  const resetBtn = $('resetSchedule');
  if (resetBtn) {
    resetBtn.addEventListener('click', () => {
      if (startInput) startInput.value = '';
      if (endInput)   endInput.value   = '';
      saveSchedule('', ''); // 空文字を保存することで enabled = false になる
    });
  }

  // 履歴ボタンのクリック：表示/非表示をトグル
  if (showHistoryBtn) {
    showHistoryBtn.addEventListener('click', () => toggleHistoryUI());
  }

  // 閉じるボタン：設定パネルを閉じる（親ウィンドウに通知）
  if (closeBtn) {
    closeBtn.addEventListener('click', () => {
      window.parent.postMessage(
        { type: 'TOGGLE_SETTING_IFRAME', payload: { visible: false } },
        '*'
      );
    });
  }

  // ===================================================================
  // 初期化：ページ読み込み時に設定を読み込む
  // ===================================================================
  loadSettings();

})();