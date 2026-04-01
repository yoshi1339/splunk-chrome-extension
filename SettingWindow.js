(() => {
  if (!chrome || !chrome.storage) {
    console.warn('[SettingWindow] chrome.storage が利用できません。拡張環境で実行してください。');
    return;
  }

  const DEFAULTS = {
    muteMode: false,
    scheduleMode: { enabled: false, start: '22:00', end: '07:00' },
    showHistory: false
  };

  const $ = id => document.getElementById(id);
  const muteCheckbox = $('muteMode');
  const startInput = $('scheduleStart');
  const endInput = $('scheduleEnd');
  const showHistoryBtn = $('showHistoryBtn');
  const closeBtn = $('close-btn');

  function debounce(fn, wait = 300) {
    let t = null;
    return (...args) => {
      clearTimeout(t);
      t = setTimeout(() => fn(...args), wait);
    };
  }

  function saveMuteMode(val) {
    chrome.storage.local.set({ muteMode: !!val });
  }

  function saveSchedule(start, end) {
    start = (typeof start === 'string' && start.trim()) ? start.trim() : '';
    end = (typeof end === 'string' && end.trim()) ? end.trim() : '';
    const enabled = !!(start && end);
    const payload = {
      scheduleMode: {
        enabled,
        start: enabled ? start : DEFAULTS.scheduleMode.start,
        end: enabled ? end : DEFAULTS.scheduleMode.end
      }
    };
    chrome.storage.local.set(payload);
  }

  function saveShowHistory(val) {
    chrome.storage.local.set({ showHistory: !!val });
  }

  const debouncedSaveSchedule = debounce((s, e) => saveSchedule(s, e), 300);

  function loadSettings() {
    chrome.storage.local.get(['muteMode', 'scheduleMode', 'showHistory'], (res) => {
      const muteMode = (typeof res.muteMode === 'boolean') ? res.muteMode : DEFAULTS.muteMode;
      const scheduleMode = (res.scheduleMode && typeof res.scheduleMode === 'object') ? res.scheduleMode : DEFAULTS.scheduleMode;
      const showHistory = (typeof res.showHistory === 'boolean') ? res.showHistory : DEFAULTS.showHistory;

      if (muteCheckbox) muteCheckbox.checked = !!muteMode;
      if (startInput) startInput.value = scheduleMode.enabled ? (scheduleMode.start || DEFAULTS.scheduleMode.start) : '';
      if (endInput) endInput.value = scheduleMode.enabled ? (scheduleMode.end || DEFAULTS.scheduleMode.end) : '';

      updateShowHistoryButton(showHistory);

      if (showHistory) {
        toggleHistoryUI(true);
      }
    });
  }

  function updateShowHistoryButton(enabled) {
    if (!showHistoryBtn) return;
    showHistoryBtn.dataset.enabled = enabled ? '1' : '0';
    showHistoryBtn.textContent = enabled ? '履歴を表示中（クリックで非表示）' : '履歴を表示';
    showHistoryBtn.style.background = enabled ? '#1f2937' : '#334155';
  }

  function ensureHistoryContainer() {
    let c = document.getElementById('historyContainer');
    if (c) return c;
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
    const grid = document.getElementById('settings-grid');
    if (grid && grid.parentNode) {
      grid.parentNode.insertBefore(c, grid.nextSibling);
    } else {
      document.body.appendChild(c);
    }
    return c;
  }

  function renderHistoryList() {
    const container = ensureHistoryContainer();
    container.innerHTML = '<div style="color:#94a3b8;margin-bottom:8px;">履歴を取得中…</div>';

    chrome.storage.local.get(['alertsHistory'], (res) => {
      const arr = Array.isArray(res.alertsHistory) ? res.alertsHistory : [];
      if (arr.length === 0) {
        container.innerHTML = '<div style="color:#94a3b8;">履歴はありません。</div>';
        return;
      }
      const header = document.createElement('div');
      header.style.display = 'flex';
      header.style.justifyContent = 'space-between';
      header.style.alignItems = 'center';
      header.style.marginBottom = '8px';

      const title = document.createElement('div');
      title.textContent = `履歴 (${arr.length})`;
      title.style.color = '#cbd5e1';
      title.style.fontWeight = '700';
      header.appendChild(title);

      const clearBtn = document.createElement('button');
      clearBtn.textContent = 'クリア';
      Object.assign(clearBtn.style, { background: '#334155', color: '#e5e7eb', border: 'none', padding: '6px 10px', borderRadius: '8px', cursor: 'pointer' });
      clearBtn.addEventListener('click', () => {
        if (!confirm('履歴を完全に消去しますか？')) return;
        chrome.storage.local.set({ alertsHistory: [] }, () => {
          renderHistoryList();
        });
      });
      header.appendChild(clearBtn);

      container.innerHTML = '';
      container.appendChild(header);

      const list = document.createElement('div');
      list.style.display = 'flex';
      list.style.flexDirection = 'column';
      list.style.gap = '8px';

      arr.slice(0, 200).forEach((r) => {
        const item = document.createElement('div');
        Object.assign(item.style, {
          background: 'rgba(255,255,255,0.02)',
          padding: '8px',
          borderRadius: '8px',
          display: 'flex',
          alignItems: 'flex-start',
          gap: '8px',
          wordBreak: 'break-word'
        });

        const text = document.createElement('div');
        text.style.flex = '1';
        text.style.color = '#e5e7eb';
        text.style.fontSize = '13px';
        text.textContent = r.text || (r.system ? (r.system + '：' + new Date(r.ts || Date.now()).toLocaleString()) : JSON.stringify(r.raw || r));

        item.appendChild(text);
        list.appendChild(item);
      });

      container.appendChild(list);

    });
  }

  function toggleHistoryUI(visible) {
    const c = document.getElementById('historyContainer');
    if (!visible) {
      if (c && c.parentNode) c.parentNode.removeChild(c);
      return;
    }
    renderHistoryList();
  }

  if (muteCheckbox) {
    muteCheckbox.addEventListener('change', (e) => {
      const v = e.target.checked;
      saveMuteMode(v);
    });
  }

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

  if (showHistoryBtn) {
    showHistoryBtn.addEventListener('click', () => {
      const currently = showHistoryBtn.dataset.enabled === '1';
      const next = !currently;
      saveShowHistory(next);
      updateShowHistoryButton(next);
      try { parent.postMessage({ type: 'TOGGLE_HISTORY', payload: { visible: next } }, '*'); } catch (e) { }
      toggleHistoryUI(next);
    });
  }

  const resetBtn = document.getElementById('resetScheduleBtn');
  if (resetBtn) {
    resetBtn.addEventListener('click', () => {
      startInput.value = '';
      endInput.value = '';
      chrome.storage.local.set({
        scheduleMode: { enabled: false, start: '', end: '' }
      });
    });
  }

  if (closeBtn) {
    closeBtn.addEventListener('click', () => {
      try { parent.postMessage({ type: 'TOGGLE_SETTING_IFRAME', payload: { visible: false } }, '*'); } catch (e) { }
    });
  }

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local') return;
    if (changes.muteMode) {
      if (muteCheckbox) muteCheckbox.checked = !!changes.muteMode.newValue;
    }
    if (changes.scheduleMode) {
      const sm = changes.scheduleMode.newValue || DEFAULTS.scheduleMode;
      if (startInput) startInput.value = sm.enabled ? sm.start : '';
      if (endInput) endInput.value = sm.enabled ? sm.end : '';
    }
    if (changes.showHistory) {
      updateShowHistoryButton(!!changes.showHistory.newValue);
    }
  });

  loadSettings();

  window.addEventListener('message', (ev) => {
    try {
      const data = ev.data || {};
      if (data && data.type === 'SETTINGS_VISIBLE') {
        const vis = !!(data.payload && data.payload.visible);
        if (vis) {
          renderHistoryList();
        }
      }
      if (data && data.type === 'REFRESH_HISTORY') {
        renderHistoryList();
      }
    } catch (e) {
      console.warn('[SettingWindow] message handler error', e);
    }
  }, false);


})();
