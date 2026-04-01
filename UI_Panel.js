let running = false;
let settingsFrame = null;
let alarmAudio = null;
let settingsVisible = false;

let runtimeSettings = {
    muteMode: false,
    scheduleMode: { enabled: false, start: '22:00', end: '07:00' },
    showHistory: false
};

const HISTORY_MAX = 200;

function $(id) { return document.getElementById(id); }

function postResize() {
    try {
        const card = document.getElementById('card');
        const w = Math.ceil((card || document.documentElement).scrollWidth);
        const h = Math.ceil(Math.max(
            document.documentElement.scrollHeight,
            document.body.scrollHeight
        ));
        window.parent.postMessage({ type: 'RESIZE_REQUEST', payload: { width: w, height: h } }, '*');
    } catch (_) { }
}

function playAlarm() {
    try {
        if (!alarmAudio) {
            alarmAudio = new Audio(chrome.runtime.getURL("AlarmSound.wav"));
            alarmAudio.loop = true;
        }
        alarmAudio.currentTime = 0;
        alarmAudio.play().catch(e => console.warn("[Alarm] 再生エラー:", e));
    } catch (e) {
        console.error("[Alarm] 例外:", e);
    }
}

function stopAlarm() {
    try {
        if (alarmAudio) {
            alarmAudio.pause();
            alarmAudio.currentTime = 0;
        }
    } catch (e) {
        console.error("[Alarm] 停止例外:", e);
    }
    const stopBtn = $("stopAlarm");
    if (stopBtn) stopBtn.style.display = "none";
    requestAnimationFrame(postResize);
}

function loadSettingsFromStorage() {
    try {
        chrome.storage.local.get(['muteMode', 'scheduleMode', 'showHistory'], (res) => {
            runtimeSettings.muteMode = (typeof res.muteMode === 'boolean') ? res.muteMode : runtimeSettings.muteMode;
            runtimeSettings.scheduleMode = (res.scheduleMode && typeof res.scheduleMode === 'object') ? res.scheduleMode : runtimeSettings.scheduleMode;
            runtimeSettings.showHistory = (typeof res.showHistory === 'boolean') ? res.showHistory : runtimeSettings.showHistory;
        });
    } catch (e) {
        console.warn('[UI] loadSettingsFromStorage error:', e);
    }
}

if (chrome && chrome.storage && chrome.storage.onChanged) {
    chrome.storage.onChanged.addListener((changes, area) => {
        if (area !== 'local') return;
        if (changes.muteMode) runtimeSettings.muteMode = !!changes.muteMode.newValue;
        if (changes.scheduleMode) runtimeSettings.scheduleMode = changes.scheduleMode.newValue || runtimeSettings.scheduleMode;
        if (changes.showHistory) runtimeSettings.showHistory = !!changes.showHistory.newValue;
    });
}

function timeStrToMinutes(timeStr) {
    if (!timeStr || typeof timeStr !== 'string') return null;
    const m = timeStr.match(/^(\d{1,2}):(\d{2})$/);
    if (!m) return null;
    const hh = Number(m[1]), mm = Number(m[2]);
    return hh * 60 + mm;
}

function isNowInSchedule(scheduleMode) {
    if (!scheduleMode || !scheduleMode.enabled) return false;
    const startMin = timeStrToMinutes(scheduleMode.start);
    const endMin = timeStrToMinutes(scheduleMode.end);
    if (startMin === null || endMin === null) return false;
    const now = new Date();
    const nowMin = now.getHours() * 60 + now.getMinutes();
    if (startMin <= endMin) {
        return (nowMin >= startMin && nowMin < endMin);
    } else {
        return (nowMin >= startMin) || (nowMin < endMin);
    }
}

function addToHistory(item) {
    try {
        chrome.storage.local.get(['alertsHistory'], (res) => {
            const arr = Array.isArray(res.alertsHistory) ? res.alertsHistory.slice() : [];

            const formatDateTime = (ts) => {
                const d = new Date(ts || Date.now());
                const yyyy = d.getFullYear();
                const mm = String(d.getMonth() + 1).padStart(2, '0');
                const dd = String(d.getDate()).padStart(2, '0');
                const hh = String(d.getHours()).padStart(2, '0');
                const min = String(d.getMinutes()).padStart(2, '0');
                return `${yyyy}/${mm}/${dd} ${hh}:${min}`;
            };

            const system = item && (item.system || item.id) ? (item.system || item.id) : '不明';
            const formatted = `${system}：${formatDateTime(item && item.ts ? item.ts : Date.now())}`;

            const record = {
                ts: item && item.ts ? item.ts : Date.now(),
                system,
                text: formatted,
            };

            arr.unshift(record);
            if (arr.length > HISTORY_MAX) arr.length = HISTORY_MAX;
            chrome.storage.local.set({ alertsHistory: arr });
        });
    } catch (e) {
        console.warn('[UI] addToHistory error:', e);
    }
}

function ensureSettingsInline(visible) {
    const host = document.getElementById('settings-container') || document.body;
    if (!settingsFrame) {
        settingsFrame = document.createElement('iframe');
        settingsFrame.id = 'settings-frame';
        settingsFrame.src = chrome.runtime.getURL('SettingWindow.html');
        Object.assign(settingsFrame.style, {
            width: '100%',
            height: '320px',
            border: '0',
            borderRadius: '12px',
            background: '#fff',
            marginTop: '8px',
            boxSizing: 'border-box',
            overflow: 'visible'
        });
        host.appendChild(settingsFrame);
    }

    if (!visible) {
        settingsFrame.remove();
        settingsFrame = null;
    }

    try {
        if (visible && settingsFrame && settingsFrame.contentWindow) {
            settingsFrame.contentWindow.postMessage({ type: 'SETTINGS_VISIBLE', payload: { visible: true } }, '*');
        }
    } catch (e) {
        console.warn('[UI] failed to postMessage to settings iframe', e);
    }

    if (visible) {
        setTimeout(() => {
            try {
                const doc = settingsFrame.contentDocument || settingsFrame.contentWindow.document;
                if (doc) {
                    const body = doc.body;
                    const html = doc.documentElement;
                    const contentH = Math.max(
                        body ? body.scrollHeight : 0,
                        html ? html.scrollHeight : 0
                    );
                    const finalH = Math.min(Math.max(contentH, 120), 800);
                    settingsFrame.style.height = finalH + 'px';
                }
            } catch (e) {
                console.warn('[UI] settings iframe auto-size failed:', e);
            }
            requestAnimationFrame(postResize);
        }, 60);
    } else {
        requestAnimationFrame(postResize);
    }
}

document.addEventListener('DOMContentLoaded', () => {
    loadSettingsFromStorage();

    const actBtn = $('act');
    const settingsBtn = $('settings');
    const stopAlarmBtn = $('stopAlarm');
    const clearBtn = $('clear');

    actBtn.addEventListener('click', () => {
        running = !running;
        window.parent.postMessage({ type: running ? 'REQUEST_START' : 'REQUEST_STOP' }, '*');
    });

    settingsBtn.addEventListener('click', () => {
        settingsVisible = !settingsVisible;
        window.parent.postMessage({ type: 'TOGGLE_SETTING_IFRAME', payload: { visible: settingsVisible } }, '*');
        ensureSettingsInline(settingsVisible);
    });

    stopAlarmBtn.addEventListener('click', () => {
        stopAlarm();
        window.parent.postMessage({ type: 'REQUEST_STOP_ALARM' }, '*');
    });

    clearBtn.addEventListener('click', () => {
        window.parent.postMessage({ type: 'REQUEST_CLEAR' }, '*');
    });

    window.parent.postMessage({ type: 'UI_READY' }, '*');
});

window.addEventListener('message', (event) => {
    const { type, payload } = event.data || {};
    switch (type) {
        case 'STATE': updateState(payload); break;
        case 'ALERT': showAlert(payload); break;
        case 'CLEAR_UI': clearAlerts(); break;
        case 'STOP_ALARM': stopAlarm(); break;
        case 'TOGGLE_SETTINGS_INLINE':
            settingsVisible = !!(payload && payload.visible);
            ensureSettingsInline(settingsVisible);
            requestAnimationFrame(postResize);
            break;
        case 'TOGGLE_SETTING_IFRAME': {
            const vis = !!(payload && payload.visible);
            settingsVisible = vis;
            ensureSettingsInline(vis);
            window.parent.postMessage({ type: 'SETTINGS_VISIBLE', payload: { visible: vis } }, '*');
            requestAnimationFrame(postResize);
            break;
        }
    }
});

function updateState(payload) {
    const status = $('status');
    const actBtn = $('act');
    running = !!(payload && payload.running);
    if (running) {
        status.textContent = '拡張機能：実行中';
        status.className = 'badge dot running';
        actBtn.textContent = '停止';
        status.style.background = '#dcfce7';
        status.style.borderColor = '#86efac';
        status.style.color = '#166534';
        const dot = status.querySelector('span');
        if (dot) dot.style.background = '#22c55e';
    } else {
        status.textContent = '拡張機能：停止中';
        status.className = 'badge dot stopped';
        actBtn.textContent = '実行';
        status.style.background = '#fee2e2';
        status.style.borderColor = '#fecaca';
        status.style.color = '#991b1b';
        const dot = status.querySelector('span');
        if (dot) dot.style.background = '#ef4444';
    }
    requestAnimationFrame(postResize);
}

function showAlert(info) {
    const pills = $('pills');
    if (!pills) return;
    pills.style.display = 'flex';

    try { addToHistory(info); } catch (e) { console.warn('[UI] addToHistory failed', e); }

    const pill = document.createElement('div');
    pill.className = 'pill';
    Object.assign(pill.style, {
        display: 'inline-flex',
        alignItems: 'center',
        gap: '8px',
        marginRight: '8px',
        borderRadius: '999px',
        fontWeight: '700',
        fontSize: '13px',
        whiteSpace: 'nowrap',
        transition: 'transform 0.15s ease',
        paddingRight: '8px'
    });

    const label = document.createElement('div');
    Object.assign(label.style, {
        display: 'inline-flex',
        alignItems: 'center',
        gap: '8px',
        padding: '6px 12px',
        borderRadius: '999px',
        background: '#d90000',
        color: '#ffffff',
        border: '1px solid #b10000',
        fontWeight: '700',
        fontSize: '13px',
        transform: 'scale(1)',
    });

    const dot = document.createElement('span');
    Object.assign(dot.style, {
        width: '10px',
        height: '10px',
        borderRadius: '50%',
        background: '#ffffff',
        display: 'inline-block'
    });

    const txt = document.createElement('span');
    txt.style.lineHeight = '1';
    const rawName = (info && (info.system || info.id)) ? (info.system || info.id) : '不明';
    const timeStr = new Date((info && info.ts) ? info.ts : Date.now())
                      .toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    txt.textContent = `${rawName} (${timeStr})`;

    label.appendChild(dot);
    label.appendChild(txt);
    pill.appendChild(label);

    const mutedNote = document.createElement('span');
    Object.assign(mutedNote.style, {
        marginLeft: '6px',
        fontSize: '12px',
        color: '#fecaca',
        display: 'none',
        alignSelf: 'center'
    });
    mutedNote.textContent = '消音中';
    pill.appendChild(mutedNote);

    pills.appendChild(pill);

const clearBtn = $('clear');
const stopBtn = $('stopAlarm');

const play = shouldPlaySound();

if (clearBtn) clearBtn.style.display = 'inline-block';

if (play) {
    if (stopBtn) stopBtn.style.display = 'inline-block';
    playAlarm();
} else {
    if (stopBtn) stopBtn.style.display = 'none';
    mutedNote.style.display = 'inline-block';
}


    requestAnimationFrame(postResize);
}



function shouldPlaySound() {
    try {
        const sm = runtimeSettings.scheduleMode || { enabled: false };
        if (sm && sm.enabled) {
            return isNowInSchedule(sm);
        } else {
            return !runtimeSettings.muteMode;
        }
    } catch (e) {
        console.warn('[UI] shouldPlaySound error:', e);
        return !runtimeSettings.muteMode;
    }
}

function escapeHtml(s) {
    if (typeof s !== 'string') return s;
    return s.replace(/[&<>"']/g, (m) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[m]);
}

function clearAlerts() {
    const pills = $('pills');
    pills.innerHTML = '';
    pills.style.display = 'none';
    $('clear').style.display = 'none';
    $('stopAlarm').style.display = 'none';
    stopAlarm();
    requestAnimationFrame(postResize);
}
