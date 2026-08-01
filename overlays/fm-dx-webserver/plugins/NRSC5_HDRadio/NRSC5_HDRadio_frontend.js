/*
    HD Radio (NRSC-5) Plugin v1.1.6 — Frontend
    Draggable, resizable dashboard with debug panel.
    Auto-switches audio on sync; Web Audio API playback.
*/

'use strict';

(() => {

const PLUGIN   = 'HD Radio';
const HD_ICON  = 'https://i.typicalmedia.net/HDIcon.jpg';
const HD_ICON_GRAY = 'https://i.typicalmedia.net/HDIconGray.png';

const pluginVersion    = '1.2.2';
const pluginName       = 'HD Radio (NRSC-5)';
const pluginHomepageUrl = 'https://github.com/seehed/NRSC5_HDRadio';
const pluginUpdateUrl  = 'https://raw.githubusercontent.com/seehed/NRSC5_HDRadio/main/NRSC5_HDRadio/NRSC5_HDRadio_frontend.js';

// ─── Console logging ──────────────────────────────────────────────────────────
const _TAG   = `%c[${PLUGIN}]`;
const _STYLE = 'color:#4488ff;font-weight:bold;';
const _WS    = 'color:#44aaff;font-weight:bold;';
const _AUDIO = 'color:#aa44ff;font-weight:bold;';
const _META  = 'color:#44cc88;font-weight:bold;';
const _WARN  = 'color:#ffaa00;font-weight:bold;';
const _ERR   = 'color:#ff4444;font-weight:bold;';

const log  = (...a) => console.log (_TAG, _STYLE,  ...a);
const logWs= (...a) => console.log (_TAG, _WS,     ...a);
const logAu= (...a) => console.log (_TAG, _AUDIO,  ...a);
const logMe= (...a) => console.log (_TAG, _META,   ...a);
const logW = (...a) => console.warn (_TAG, _WARN,  ...a);
const logE = (...a) => console.error(_TAG, _ERR,   ...a);

// ─── Update checker ───────────────────────────────────────────────────────────
async function checkUpdate() {
    try {
        const res = await fetch(pluginUpdateUrl);
        if (!res.ok) return;
        const lines = (await res.text()).split('\n');
        const line  = lines.find(l => l.includes('const pluginVersion'));
        if (!line) return;
        const match = line.match(/const pluginVersion\s*=\s*['"]([^'"]+)['"]/);
        if (!match) return;
        const latest = match[1];
        if (latest === pluginVersion) return;

        log(`Update available: ${pluginVersion} → ${latest}`);

        // Update the panel button tooltip and add a red dot indicator
        const panelBtn = document.getElementById('hd-radio-btn');
        if (panelBtn) {
            panelBtn.setAttribute('data-tooltip', `HD Radio (NRSC-5) · Update available: v${latest}`);
            if (typeof initTooltips === 'function') initTooltips(panelBtn);
            // Red dot overlay on button (same style as other plugins)
            const dot = document.createElement('span');
            dot.id = 'hd-update-dot';
            dot.style.cssText = 'display:block;width:10px;height:10px;border-radius:50%;background:#FE0830;position:absolute;top:4px;right:6px;pointer-events:none;';
            panelBtn.style.position = 'relative';
            panelBtn.appendChild(dot);
        }

        // Badge in HD panel footer (shown on the main page)
        const footerBadge = document.getElementById('hd-footer-update');
        if (footerBadge) {
            footerBadge.style.display = 'flex';
            footerBadge.innerHTML =
                `<a href="${pluginHomepageUrl}" target="_blank" rel="noopener"
                    class="tooltip" data-tooltip="Update available: v${pluginVersion} → v${latest}. Click to go to GitHub."
                    style="display:flex;align-items:center;gap:5px;text-decoration:none;color:#ff9944;font-size:10px;letter-spacing:.3px;">
                    <span style="display:inline-block;width:7px;height:7px;border-radius:50%;background:#FE4010;flex-shrink:0;animation:hd-pulse 1.5s infinite;"></span>
                    Update available · v${latest}
                </a>`;
            if (typeof initTooltips === 'function') initTooltips('#hd-footer-update .tooltip');
        }

        // Show in /setup page
        if (location.pathname.includes('/setup')) {
            const el = document.getElementById('plugin-settings');
            if (el) {
                const msg = `<a href="${pluginHomepageUrl}" target="_blank" style="color:#5daaff;">[${pluginName}] Update available: ${pluginVersion} → ${latest}</a><br>`;
                el.textContent === 'No plugin settings are available.' ? el.innerHTML = msg : el.innerHTML += ' ' + msg;
            }
            const nav = document.querySelector('.wrapper-outer #navigation .sidenav-content .fa-puzzle-piece') || document.querySelector('.sidenav-content');
            if (nav) {
                const dot = document.createElement('span');
                dot.style.cssText = 'display:block;width:12px;height:12px;border-radius:50%;background:#FE0830;margin-left:82px;margin-top:-12px;';
                nav.appendChild(dot);
            }
        }
    } catch (e) { /* silent */ }
}

// ─── Global FM mute — wrap _3LAS.prototype.Volume setter ─────────────────────
// Intercepts every Stream.Volume write from anywhere (createStream, OnConnectivityCallback,
// updateVolume, etc.) so FM is always silent while HD is locked, regardless of timing.
function installGlobalStreamMute() {
    if (typeof _3LAS === 'undefined') return;
    const proto = _3LAS.prototype;
    const desc  = Object.getOwnPropertyDescriptor(proto, 'Volume');
    if (!desc || !desc.set || proto._hdMuteInstalled) return;
    proto._hdMuteInstalled = true;

    const origSet = desc.set;
    const origGet = desc.get;
    Object.defineProperty(proto, 'Volume', {
        get: origGet,
        set(value) {
            // Only block FM volume once HD audio is actually buffered and playing.
            // While hdAudioReady is false, FM keeps playing (seamless transition).
            if (hdEnabled && synchronized && hdAudioReady) {
                const v = parseFloat(value);
                if (v > 0) _savedFmVolume = v;
                origSet.call(this, 0);
            } else {
                origSet.call(this, value);
            }
        },
        configurable: true,
        enumerable:   true,
    });
    logAu('Global FM mute guard installed on _3LAS.prototype.Volume');
}

// ─── LOT store ────────────────────────────────────────────────────────────────
// Keeps all received LOT items for the Data tab. Cleared on retune/disable.
let _lotStore = [];   // [{ mime, name, dataUrl, ts }]

function _lotMimeIsImage(mime) {
    return /^(PNG|JPEG|JPG|PRIMARY_IMAGE|STATION_LOGO|HERE_IMAGE|GIF|BMP|WEBP)$/i.test(mime);
}

const _LOT_LABELS = {
    STATION_LOGO:    'Station Logo',
    PRIMARY_IMAGE:   'Album Art',
    HERE_IMAGE:      'HERE Map Image',
    TTN_STM_TRAFFIC: 'Traffic Map',
    TTN_STM_WEATHER: 'Weather Map',
    TTN_TPEG_1:      'TPEG Traffic',
    TTN_TPEG_2:      'TPEG Traffic',
    TTN_TPEG_3:      'TPEG Traffic',
    HD_TMC:          'TMC Traffic',
    HERE_TPEG:       'HERE TPEG',
    NAVTEQ:          'Navteq Data',
    TEXT:            'Text Data',
    HDC:             'HDC Audio',
};
function _lotMimeLabel(mime) { return _LOT_LABELS[mime] || mime; }

function _clearLotStore() {
    _lotStore = [];
    _renderLotGrid();
}

function _renderLotGrid() {
    const grid  = document.getElementById('hd-lot-grid');
    const badge = document.getElementById('hd-lot-badge');
    if (!grid) return;

    if (badge) {
        badge.textContent = _lotStore.length ? ` (${_lotStore.length})` : '';
        badge.style.display = _lotStore.length ? '' : 'none';
    }

    if (!_lotStore.length) {
        grid.innerHTML = '<div style="font-size:11px;color:#334;padding:8px 0;">No LOT data received on this station yet.</div>';
        return;
    }

    grid.innerHTML = _lotStore.map((item, i) => {
        const label = _lotMimeLabel(item.mime);
        const sub   = item.name || (item.size ? `${Math.round(item.size / 1024)} kB` : '');
        const ts    = new Date(item.ts).toLocaleTimeString();
        const isTraffic = /traffic|weather|tpeg|tmc|navteq|here/i.test(item.mime);
        const icon  = isTraffic ? 'fa-map-location-dot' : 'fa-file';
        if (_lotMimeIsImage(item.mime)) {
            return `<div style="display:flex;flex-direction:column;align-items:center;gap:4px;cursor:pointer;" data-lot-idx="${i}">
                <img src="${item.dataUrl}" style="width:72px;height:72px;object-fit:contain;border-radius:6px;border:1px solid #1e2a50;background:#080818;">
                <div style="font-size:9px;color:#4466aa;text-align:center;max-width:80px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="${label}">${label}</div>
                <div style="font-size:8px;color:#2a3550;">${ts}</div>
            </div>`;
        }
        return `<div style="display:flex;flex-direction:column;align-items:center;gap:4px;">
            <div style="width:72px;height:72px;border-radius:6px;border:1px solid #1e2a50;background:#080818;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:4px;">
                <i class="fa-solid ${icon}" style="font-size:22px;color:#2a3a60;"></i>
                ${sub ? `<div style="font-size:8px;color:#2a4060;text-align:center;padding:0 4px;">${sub}</div>` : ''}
            </div>
            <div style="font-size:9px;color:#4466aa;text-align:center;max-width:80px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="${label}">${label}</div>
            <div style="font-size:8px;color:#2a3550;">${ts}</div>
        </div>`;
    }).join('');

    // Lightbox on image click
    grid.querySelectorAll('[data-lot-idx]').forEach(el => {
        el.addEventListener('click', () => {
            const item = _lotStore[parseInt(el.dataset.lotIdx)];
            if (!item) return;
            let overlay = document.getElementById('hd-lot-overlay');
            if (!overlay) {
                overlay = document.createElement('div');
                overlay.id = 'hd-lot-overlay';
                overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.85);z-index:99999;display:flex;align-items:center;justify-content:center;cursor:pointer;flex-direction:column;gap:10px;';
                overlay.addEventListener('click', () => overlay.remove());
                document.body.appendChild(overlay);
            }
            overlay.innerHTML = `
                <img src="${item.dataUrl}" style="max-width:90vw;max-height:80vh;border-radius:10px;box-shadow:0 0 60px rgba(0,0,0,.8);image-rendering:crisp-edges;">
                <div style="color:#8899cc;font-size:12px;">${item.name || item.mime} · ${new Date(item.ts).toLocaleTimeString()}</div>`;
        });
    });
}

function handleLot({ mime, name, data } = {}) {
    if (!data) return;
    const isImg  = _lotMimeIsImage(mime);
    const dataUrl = isImg
        ? `data:image/${/PNG/i.test(mime) ? 'png' : 'jpeg'};base64,${data}`
        : null;
    logMe(`LOT received — ${mime} "${name}"`);

    // Store everything for the Data tab
    const lotKey = `${mime}:${name}`;
    const oldLotIndex = _lotStore.findIndex(item => `${item.mime}:${item.name}` === lotKey);
    if (oldLotIndex >= 0) _lotStore.splice(oldLotIndex, 1);
    _lotStore.push({ mime, name, dataUrl, ts: Date.now() });
    _renderLotGrid();

    if (mime === 'STATION_LOGO' && dataUrl) {
        const dashIcon = document.getElementById('hd-dash-icon');
        if (dashIcon) {
            const img = document.createElement('img');
            img.src = dataUrl;
            img.style.cssText = 'height:34px;border-radius:4px;image-rendering:crisp-edges;flex-shrink:0;';
            img.alt = 'Station Logo';
            dashIcon.replaceWith(img);
            img.id = 'hd-dash-icon';
        }
        const logoEl = document.getElementById('station-logo')
            || document.querySelector('.station-logo img')
            || document.querySelector('#img-cover img');
        if (logoEl) {
            logoEl.dataset.hdLogoSaved = logoEl.src;
            logoEl.src = dataUrl;
        }
        const inlineImg = document.getElementById('hd-inline-img');
        if (inlineImg) inlineImg.src = dataUrl;
    }

    if (dataUrl && (mime === 'PRIMARY_IMAGE' || mime === 'JPEG' || mime === 'PNG')) {
        _broadcastArtUrl = dataUrl;
        refreshAlbumArt();
        injectAlbumArtIntoRT();
        const inlineArt = document.getElementById('hd-inline-img');
        if (inlineArt) inlineArt.src = dataUrl;
    }
}

function logDevices({ devices = [], active } = {}) {
    if (!devices.length) {
        logW('No RTL-SDR devices detected — check USB connection');
        return;
    }
    console.groupCollapsed(`%c[HD Radio]%c  ${devices.length} RTL-SDR device(s) detected`, _STYLE, 'color:#aaa;font-weight:normal;');
    devices.forEach(d => {
        const isActive = d.index === active;
        const icon  = isActive ? '▶' : '○';
        const style = isActive ? 'color:#44cc88;font-weight:bold;' : 'color:#667;font-weight:normal;';
        console.log(`%c  ${icon} [${d.index}] ${d.name}${d.serial ? '  SN: ' + d.serial : ''}${isActive ? '  ← active' : ''}`, style);
    });
    console.groupEnd();
    log(`Using device [${active}]:`, devices.find(d => d.index === active)?.name ?? 'unknown');
}

// ─── HD Scan UI handlers ──────────────────────────────────────────────────────

// Page-level banner shown to ALL connected clients while any user is scanning.
// Since hd-scan-start/progress/done are broadcast to every client, every browser
// tab on this server will show and dismiss the banner automatically.

function _showScanBanner(freq, i, total) {
    let banner = document.getElementById('hd-scan-page-banner');
    if (!banner) {
        banner = document.createElement('div');
        banner.id = 'hd-scan-page-banner';
        banner.style.cssText = [
            'position:fixed', 'top:0', 'left:0', 'right:0', 'z-index:99999',
            'background:linear-gradient(90deg,#050f30,#0a1a50,#050f30)',
            'border-bottom:2px solid #1e3a7a',
            'display:flex', 'align-items:center', 'gap:12px',
            'padding:8px 18px',
            'font-family:Segoe UI,Arial,sans-serif',
            'box-shadow:0 4px 24px rgba(0,30,120,.7)',
            'pointer-events:none',
        ].join(';');
        banner.innerHTML = `
            <img src="${HD_ICON}" style="height:16px;border-radius:2px;flex-shrink:0;opacity:.7;" alt="HD">
            <span style="font-size:11px;color:#4466aa;white-space:nowrap;">Band scan running</span>
            <div style="flex:1;background:#0a0e20;border-radius:3px;height:3px;overflow:hidden;">
                <div id="hd-scan-banner-bar" style="height:100%;width:0%;background:#4488ff;transition:width .3s;"></div>
            </div>
            <span id="hd-scan-banner-freq" style="font-size:11px;color:#88aaff;white-space:nowrap;min-width:80px;text-align:right;"></span>
            <span id="hd-scan-banner-hits" style="font-size:11px;color:#44cc88;white-space:nowrap;min-width:60px;text-align:right;"></span>`;
        document.body.appendChild(banner);
    }
    const pct = total > 1 ? Math.round((i / (total - 1)) * 100) : 0;
    document.getElementById('hd-scan-banner-bar').style.width = pct + '%';
    if (freq) document.getElementById('hd-scan-banner-freq').textContent = `${freq.toFixed(1)} MHz`;
}

function _updateScanBannerHits(count) {
    const el = document.getElementById('hd-scan-banner-hits');
    if (el) el.textContent = count > 0 ? `✔ ${count} HD found` : '';
}

function _removeScanBanner() {
    document.getElementById('hd-scan-page-banner')?.remove();
}

let _scanHitCount   = 0;
let _scanInProgress = false;  // gates scheduleChunk so stale chunks don't re-arm pre-buffer

function hdScanStarted({ total } = {}) {
    _scanInProgress = true;
    _scanHitCount   = 0;

    // If HD audio is playing, fade it out and hand back to FM for the scan duration.
    // scheduleChunk is gated by _scanInProgress so the bridge's retuning chunks
    // don't accidentally re-trigger the pre-buffer switch back to HD mid-scan.
    if (hdAudioReady && audioCtx && gainNode) {
        gainNode.gain.setTargetAtTime(0, audioCtx.currentTime, 0.1); // ~100 ms decay
        setTimeout(() => { unmuteFM(); hdAudioReady = false; }, 350);
    }

    document.getElementById('hd-scan-results').innerHTML = '';
    document.getElementById('hd-scan-btn').style.display = 'none';
    document.getElementById('hd-scan-stop-btn').style.display = '';
    document.getElementById('hd-scan-progress-wrap').style.display = '';
    document.getElementById('hd-scan-freq-label').style.display = '';
    document.getElementById('hd-scan-freq-label').textContent = `Scanning… 0 / ${total}`;
    document.getElementById('hd-scan-bar').style.width = '0%';
    _showScanBanner(null, 0, total);
}

function hdScanProgress({ i, total, freq } = {}) {
    const pct = total > 1 ? Math.round((i / (total - 1)) * 100) : 0;
    document.getElementById('hd-scan-bar').style.width = pct + '%';
    document.getElementById('hd-scan-freq-label').textContent =
        `${freq.toFixed(1)} MHz — ${i + 1} / ${total}`;
    _showScanBanner(freq, i, total);
}

function hdScanHit({ freq, name, programs } = {}) {
    _scanHitCount++;
    _updateScanBannerHits(_scanHitCount);

    const list = document.getElementById('hd-scan-results');
    const row  = document.createElement('div');
    row.style.cssText = 'display:flex;align-items:center;gap:10px;padding:6px 10px;background:rgba(20,40,100,.35);border:1px solid #1e3a7a;border-radius:7px;';
    const channels = Array.from({ length: programs || 1 }, (_, k) =>
        `<span style="font-size:9px;background:#0d1a40;color:#4488ff;border:1px solid #2244aa;border-radius:3px;padding:1px 5px;font-weight:700;">HD${k + 1}</span>`
    ).join('');
    row.innerHTML = `
        <span style="font-size:14px;font-weight:700;color:#88aaff;min-width:55px;">${freq.toFixed(1)}</span>
        <span style="font-size:10px;color:#3a4a6a;">MHz</span>
        <span style="flex:1;font-size:12px;color:var(--color-main-bright);font-weight:600;">${name || '—'}</span>
        <span style="display:flex;gap:3px;">${channels}</span>`;
    list.appendChild(row);
}

function hdScanDone({ hits = [], aborted = false } = {}) {
    // Lift the chunk gate — existing pre-buffer logic re-arms HD audio
    // automatically once chunks resume from the restored frequency.
    _scanInProgress = false;
    _removeScanBanner();
    document.getElementById('hd-scan-btn').style.display = '';
    document.getElementById('hd-scan-stop-btn').style.display = 'none';
    document.getElementById('hd-scan-progress-wrap').style.display = 'none';
    const label = document.getElementById('hd-scan-freq-label');
    if (aborted) {
        label.textContent = `Scan stopped — ${hits.length} found`;
    } else {
        const now = new Date().toLocaleTimeString();
        label.textContent = `${hits.length} HD station${hits.length !== 1 ? 's' : ''} found · ${now}`;
    }
    label.style.display = '';
    if (hits.length === 0 && !aborted) {
        document.getElementById('hd-scan-results').innerHTML =
            '<div style="font-size:11px;color:#334;padding:6px 0;">No HD Radio stations found in this scan range.</div>';
    }
}

function hdScanLoadCache({ hits = [], scannedAt } = {}) {
    if (!hits.length) return;
    const list = document.getElementById('hd-scan-results');
    if (!list || list.children.length) return; // don't overwrite an active scan
    hits.forEach(h => hdScanHit(h));
    const label = document.getElementById('hd-scan-freq-label');
    if (label) {
        const ts = scannedAt ? new Date(scannedAt).toLocaleTimeString() : 'previous session';
        label.textContent = `${hits.length} HD station${hits.length !== 1 ? 's' : ''} found · ${ts}`;
        label.style.display = '';
    }
}

// ─── WebSocket URLs ───────────────────────────────────────────────────────────

const _loc   = window.location;
const _proto = _loc.protocol === 'https:' ? 'wss:' : 'ws:';
const _root  = `${_proto}//${_loc.host}`;
const _base  = (_loc.pathname.replace(/[^/]*$/, '').replace(/setup\/?$/, '') || '/');
const PLUGINS_WS_URL  = `${_root}${_base}data_plugins`;
const HD_AUDIO_WS_URL = `${_root}/hd_audio`;

// ─── State ────────────────────────────────────────────────────────────────────

let hdEnabled        = false;
let hdSignalDetected = false;  // true once MER arrives — HD carrier on this freq
let hdWasSynced      = false;  // true once we've fully locked; used to distinguish "signal lost" from "no signal"
let synchronized     = false;
let currentProg      = 0;
let meta             = {};
let pluginWs     = null;
let audioWs      = null;
let debugOpen    = false;

let enhancedMeta   = true;   // mirrors server config, controlled by toggle
let forceHdAudio   = false;
let analogBandwidthKhz = 190;
let receiverType = 'airspyhf';  // mirrors server config — global, persisted, all users see same state

// iTunes album art — fetch when we have title+artist and enhanced meta is on
let _lastItunesQuery = '';
let _itunesArtUrl    = '';
let _broadcastArtUrl = '';

async function fetchItunesArt(title, artist) {
    const q = `${artist} ${title}`.trim();
    if (!q || q === _lastItunesQuery) return;
    _lastItunesQuery = q;
    try {
        const url  = `https://itunes.apple.com/search?term=${encodeURIComponent(q)}&media=music&limit=1&country=us`;
        const resp = await fetch(url);
        const data = await resp.json();
        if (data.results && data.results.length > 0) {
            _itunesArtUrl = data.results[0].artworkUrl100.replace('100x100bb', '600x600bb');
            logMe('iTunes album art found:', _itunesArtUrl);
            refreshAlbumArt();
        } else {
            _itunesArtUrl = '';
            refreshAlbumArt();
        }
    } catch (e) {
        logW('iTunes fetch failed:', e.message);
    }
}

function refreshAlbumArt() {
    const row   = document.getElementById('hd-albumart-row');
    const thumb = document.getElementById('hd-albumart-thumb');
    const lbl   = document.getElementById('hd-albumart-label');
    if (!row) return;
    const artUrl = _broadcastArtUrl || _itunesArtUrl;
    if (artUrl && synchronized) {
        row.style.display = 'flex';
        thumb.src = artUrl;
        if (lbl) lbl.textContent = [meta.album, meta.artist].filter(Boolean).join(' · ') || meta.title || '—';
        // Also inject into the main RT area as thumbnail
        injectAlbumArtIntoRT();
    } else {
        row.style.display = 'none';
        removeAlbumArtFromRT();
    }
}

function injectAlbumArtIntoRT() {
    const rtBox = document.getElementById('rt-container');
    const artUrl = _broadcastArtUrl || _itunesArtUrl;
    if (!rtBox || !artUrl) return;

    if (!document.getElementById('hd-rt-artwork-style')) {
        const style = document.createElement('style');
        style.id = 'hd-rt-artwork-style';
        style.textContent = `
            #rt-container.hd-has-artwork {
                height: auto !important;
                min-height: 250px;
                padding-bottom: 14px;
                overflow: visible;
            }
            #rt-container #hd-rt-albumart {
                display: block;
                float: none;
                width: clamp(112px, 13vw, 148px);
                height: clamp(112px, 13vw, 148px);
                margin: 8px auto 10px;
                border: 1px solid rgba(255,255,255,.14);
                border-radius: 10px;
                object-fit: cover;
                cursor: pointer;
                box-shadow: 0 7px 22px rgba(0,0,0,.38);
            }
            @media only screen and (max-width: 768px) {
                #rt-container.hd-has-artwork { min-height: 226px; }
                #rt-container #hd-rt-albumart {
                    width: 112px;
                    height: 112px;
                    margin-top: 6px;
                }
            }
        `;
        document.head.appendChild(style);
    }

    rtBox.classList.add('hd-has-artwork');
    let img = document.getElementById('hd-rt-albumart');
    if (!img) {
        img = document.createElement('img');
        img.id = 'hd-rt-albumart';
        img.alt = 'HD Radio Artwork';
        img.title = 'Click to enlarge';
        img.onclick = () => document.getElementById('hd-albumart-thumb')?.click();
        const heading = rtBox.querySelector('h2');
        if (heading) heading.insertAdjacentElement('afterend', img);
        else rtBox.prepend(img);
    }
    img.src = artUrl;
}

function removeAlbumArtFromRT() {
    document.getElementById('hd-rt-albumart')?.remove();
    document.getElementById('rt-container')?.classList.remove('hd-has-artwork');
}

// ─── Signal panel HD quality overlay ─────────────────────────────────────────

function setupSignalOverlay() {
    const signalPanel = document.querySelector('.panel-33 #data-signal')?.closest('.panel-33');
    if (!signalPanel || document.getElementById('hd-signal-overlay')) return;

    const rf = document.createElement('div');
    rf.id = 'portable-rf-readout';
    rf.style.cssText = 'margin-top:4px;font-size:10px;line-height:1.5;color:#8ca0bd;letter-spacing:.25px;white-space:nowrap;';
    rf.textContent = 'SNR — dB · RF — dBm (est.) · PI —';
    signalPanel.appendChild(rf);

    const ov = document.createElement('div');
    ov.id = 'hd-signal-overlay';
    ov.style.cssText = 'display:none;margin-top:4px;font-size:10px;line-height:1.6;color:#667;letter-spacing:.5px;';
    signalPanel.appendChild(ov);
}

function refreshPortableRfReadout() {
    const el = document.getElementById('portable-rf-readout');
    if (!el) return;
    const state = typeof parsedData !== 'undefined' && parsedData ? parsedData : {};
    const snr = Number(state.rtlSnrDb);
    const dbm = Number(state.rtlPowerDbm);
    const pi = String(state.pi || document.getElementById('data-pi')?.textContent || '—').trim();
    el.textContent = `SNR ${Number.isFinite(snr) ? snr.toFixed(1) : '—'} dB · RF ${Number.isFinite(dbm) ? dbm.toFixed(1) : '—'} dBm (est.) · PI ${pi || '—'}`;
}

function refreshSignalOverlay() {
    const ov = document.getElementById('hd-signal-overlay');
    if (!ov) return;
    if (synchronized && meta.merUpper !== null) {
        ov.style.display = '';
        const q = sigQuality(meta.merUpper);
        ov.innerHTML = `
            <span style="color:${q.color};font-weight:700;letter-spacing:1px;">HD ${q.label}</span>
            <span style="opacity:.5;margin-left:6px;">MER ${meta.merUpper} dB</span>
            <span style="opacity:.5;margin-left:6px;">BER ${meta.berNow ?? '—'}%</span>`;
    } else {
        ov.style.display = 'none';
    }
}

// ─── AudioMetrix bridge ───────────────────────────────────────────────────────
// Route HD audio into AudioMetrix's analyser when HD is active.
// AudioMetrix exposes its audio context via window.AudioMetrixContext (if available).

function tryBridgeAudioMetrix() {
    if (!audioCtx || !gainNode) return;

    // AudioMetrix may expose its context — check common patterns
    const amCtx = window.AudioMetrixContext || window.audioMetrixContext;
    if (!amCtx || amCtx === audioCtx) return;

    try {
        // Create a MediaStream from our HD output and feed it into AudioMetrix's context
        const dest = audioCtx.createMediaStreamDestination();
        gainNode.connect(dest);
        const src  = amCtx.createMediaStreamSource(dest.stream);

        // Try to connect to AudioMetrix's analyser or destination
        const amAnalyser = window.AudioMetrixAnalyser || window.audioMetrixAnalyser;
        if (amAnalyser) {
            src.connect(amAnalyser);
            logAu('Bridged HD audio → AudioMetrix analyser');
        } else {
            src.connect(amCtx.destination);
            logAu('Bridged HD audio → AudioMetrix context destination');
        }
        window._hdAmBridgeNode = src;
    } catch (e) {
        logW('AudioMetrix bridge failed:', e.message);
    }
}

function updateStationInfoSection() {
    const section = document.getElementById('hd-stationinfo-section');
    const content = document.getElementById('hd-stationinfo-content');
    if (!section || !content) return;

    const _hl = /^HD\d+$/i;
    const rows = [];
    const add  = (label, val) => {
        if (val && !_hl.test(val.trim())) rows.push(`<b style="color:#556688;">${label}:</b> ${val}`);
    };

    add('Callsign',   meta.stationName);
    add('Slogan',     meta.slogan);
    add('Message',    meta.message);
    add('Alert',      meta.alert);
    add('Country',    meta.country);
    add('PTY',        meta.programType);
    add('Genre',      meta.genre);
    add('Album',      meta.album);
    add('Bit Rate',   meta.bitRate);

    if (rows.length > 0) {
        section.style.display = '';
        content.innerHTML = rows.join('<br>');
    } else {
        section.style.display = 'none';
    }
}

// No-signal detection: after 20s with no sync, show "No Signal" not "Acquiring"
let noSignal      = false;
let _noSigTimer   = null;
function _startNoSigTimer() {
    clearTimeout(_noSigTimer);
    noSignal = false;
    log('No-signal timer started (20 s)');
    _noSigTimer = setTimeout(() => {
        if (hdEnabled && !synchronized) {
            noSignal = true;
            logW('No HD Radio signal detected after 20 s on', meta.freq, 'MHz');
            refreshDash(); refreshIcon();
        }
    }, 20000);
}
function _clearNoSigTimer() { clearTimeout(_noSigTimer); noSignal = false; }

// Seamless audio switch: don't mute FM until HD audio buffer is ready (~300 ms ahead)
let hdAudioReady = false;


// FM audio muting — save & restore Stream.Volume when HD takes over
let _savedFmVolume = null;

// HD sub-elements injected alongside core RDS elements (never replacing them)
// All have unique IDs so restoreRdsArea() just removes them — no save/restore needed.

// Also save/restore PTY
let _lastPtyText = '';   // track what we last wrote to #hd-pty-label so we don't flicker

// Normalize PTY strings — "None" / blank → "Other"
function normPty(str) {
    if (!str) return '';
    const s = str.trim();
    return (s === '' || /^none$/i.test(s)) ? 'Other' : s;
}

// Helper: get-or-create an HD sub-element inserted after a parent element
function _hdSubEl(id, insertAfterEl, css) {
    let el = document.getElementById(id);
    if (!el) {
        el = document.createElement('div');
        el.id = id;
        el.style.cssText = css;
        insertAfterEl.insertAdjacentElement('afterend', el);
    }
    return el;
}

function injectHdMeta() {
    const rt0    = document.getElementById('data-rt0');
    const rt1    = document.getElementById('data-rt1');
    const rtBox  = document.getElementById('rt-container');
    const ptyEl  = document.querySelector('.data-pty');
    const nameEl = document.getElementById('data-station-name');
    const hdLabel = /^HD\d+$/i;

    // ── HD logo badge next to rt-container heading ────────────────────────────
    if (rtBox) {
        let logo = document.getElementById('hd-rt-logo');
        if (!logo) {
            logo = document.createElement('img');
            logo.id = 'hd-rt-logo';
            logo.src = HD_ICON;
            logo.alt = 'HD';
            logo.style.cssText = 'height:16px;vertical-align:middle;margin-left:8px;border-radius:2px;';
            const h2 = rtBox.querySelector('h2');
            if (h2) h2.appendChild(logo);
        }
    }

    // ── Callsign badge next to station name ───────────────────────────────────
    if (nameEl && meta.stationName) {
        let badge = document.getElementById('hd-callsign-badge');
        if (!badge) {
            badge = document.createElement('span');
            badge.id = 'hd-callsign-badge';
            badge.style.cssText = 'font-size:13px;font-weight:900;margin-left:4px;color:var(--color-main-bright);vertical-align:middle;white-space:nowrap;';
            nameEl.insertAdjacentElement('afterend', badge);
        }
        badge.textContent = `-HD${currentProg + 1}`;
    }

    // ── HD RT0 — always hide the main RDS element when HD is active.
    //    The core fm-dx-webserver continuously writes raw analog RDS radiotext
    //    to data-rt0 (station name + song concatenated). Replace it entirely
    //    with clean HD metadata in the sub-element.
    if (rt0) {
        rt0.style.display = 'none';

        const realTitle = meta.title  && !hdLabel.test(meta.title.trim())  ? meta.title  : '';
        const slogan    = meta.slogan && !hdLabel.test(meta.slogan.trim())  ? meta.slogan : '';
        const type      = normPty(meta.programType) || `HD${currentProg + 1}`;
        const name      = meta.stationName || '';

        let html = '', css = 'font-size:13px;color:var(--color-4);margin-top:3px;padding-left:2px;';
        if (realTitle) {
            html = `<i class="fa-solid fa-music" style="margin-right:6px;opacity:.7;font-size:12px;"></i>${realTitle}`;
            css  = 'font-size:14px;font-weight:600;color:var(--color-main-bright);padding-left:2px;';
        } else if (slogan) {
            html = `<span style="font-style:italic;opacity:.8;">${slogan}</span>`;
        } else if (name || type) {
            html = `<i class="fa-solid fa-tower-broadcast" style="margin-right:6px;opacity:.6;"></i>${name ? name + ' · ' : ''}${type}`;
        }

        const sub = _hdSubEl('hd-rt0-sub', rt0, css);
        sub.innerHTML = html;
    }

    // ── HD RT1 — same: always hide main RT1, fill sub-element with HD data ───
    if (rt1) {
        rt1.style.display = 'none';

        const realArtist = meta.artist && !hdLabel.test(meta.artist.trim()) ? meta.artist : '';
        const realAlbum  = meta.album  && !hdLabel.test(meta.album.trim())  ? meta.album  : '';
        const pty        = normPty(meta.programType);
        const msg        = meta.message && !hdLabel.test(meta.message.trim()) ? meta.message : '';

        let html = '';
        if (realArtist) {
            const albumPart = realAlbum
                ? `<span style="opacity:.45;font-size:11px;margin-left:7px;">· ${realAlbum}</span>` : '';
            html = `<i class="fa-solid fa-microphone-lines" style="margin-right:6px;opacity:.6;"></i>${realArtist}${albumPart}`;
        } else if (pty) {
            html = `<i class="fa-solid fa-tag" style="margin-right:6px;opacity:.6;"></i>${pty}`;
        } else if (msg) {
            html = `<span style="opacity:.6;">${msg}</span>`;
        }

        const sub = _hdSubEl('hd-rt1-sub', rt1,
            'font-size:13px;color:var(--color-4);opacity:.85;margin-top:3px;padding-left:2px;');
        sub.innerHTML = html;
    }

    // ── PTY sub-element (below core .data-pty) ───────────────────────────────
    if (ptyEl) {
        const rawFmt   = (enhancedMeta && meta.hdFormats && meta.hdFormats[currentProg]) || '';
        const cleanFmt = normPty(rawFmt
            ? rawFmt.replace(/"[^"]*"/g, '').replace(/\s+/g, ' ').trim()
            : meta.programType || '');

        if (cleanFmt && cleanFmt !== _lastPtyText) {
            _lastPtyText = cleanFmt;
            const sub = _hdSubEl('hd-pty-label', ptyEl,
                'font-size:11px;opacity:.7;color:var(--color-main-bright);margin-top:2px;letter-spacing:.3px;');
            sub.textContent = cleanFmt;
        }
    }

    // ── Alert/message banner appended to rt-container ────────────────────────
    let alertBanner = document.getElementById('hd-alert-banner');
    const _hd = /^HD\d+$/i;
    const alertText = (meta.alert   && !_hd.test(meta.alert.trim())   ? meta.alert   : '') ||
                      (meta.message && !_hd.test(meta.message.trim()) ? meta.message : '');
    if (alertText) {
        if (!alertBanner) {
            alertBanner = document.createElement('div');
            alertBanner.id = 'hd-alert-banner';
            alertBanner.style.cssText = 'font-size:11px;color:#cc8800;padding:2px 0;opacity:.8;';
            rtBox?.appendChild(alertBanner);
        }
        alertBanner.innerHTML = `<i class="fa-solid fa-circle-info" style="margin-right:5px;"></i>${alertText}`;
    } else if (alertBanner) {
        alertBanner.remove();
    }
}

function restoreRdsArea() {
    // Restore main RDS elements that may have been hidden while HD was active.
    ['data-ps', 'data-rt0', 'data-rt1'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.style.display = '';
    });

    // Remove all injected HD sub-elements.
    ['hd-rt0-sub', 'hd-rt1-sub', 'hd-rt-logo',
     'hd-pty-label', 'hd-callsign-badge', 'hd-alert-banner',
     'hd-ps-label'].forEach(id => document.getElementById(id)?.remove());

    _lastPtyText = '';

    // Restore station logo if we replaced it
    const logoEl = document.querySelector('[data-hd-logo-saved]');
    if (logoEl) { logoEl.src = logoEl.dataset.hdLogoSaved; delete logoEl.dataset.hdLogoSaved; }

    // Hide signal overlay
    const sigOv = document.getElementById('hd-signal-overlay');
    if (sigOv) sigOv.style.display = 'none';

    // Clear LOT store and iTunes artwork
    _clearLotStore();
    _itunesArtUrl = ''; _broadcastArtUrl = ''; _lastItunesQuery = '';
    refreshAlbumArt(); removeAlbumArtFromRT();
}

function muteFM() {
    if (_savedFmVolume !== null) return;
    if (typeof Stream !== 'undefined' && Stream !== null) {
        _savedFmVolume = Stream.Volume;
        Stream.Volume = 0;
        logAu('FM muted (saved volume:', _savedFmVolume, ')');
    }
}

function unmuteFM() {
    if (_savedFmVolume === null) return;
    if (typeof Stream !== 'undefined' && Stream !== null) {
        Stream.Volume = _savedFmVolume;
        logAu('FM restored to volume:', _savedFmVolume);
    }
    _savedFmVolume = null;
}

let _fmRetuneRestartTimer = null;
function restartFmStreamAfterTune() {
    clearTimeout(_fmRetuneRestartTimer);
    if (typeof Stream === 'undefined' || Stream === null) return;
    const activeStream = Stream;
    const requestedVolume = Number(document.getElementById('volumeSlider')?.value ?? _savedFmVolume ?? activeStream.Volume ?? 1);
    _savedFmVolume = null;
    try { activeStream.Stop(); } catch (e) { logW('FM retune stop failed:', e.message); }
    _fmRetuneRestartTimer = setTimeout(() => {
        if (typeof Stream === 'undefined' || Stream !== activeStream) return;
        try {
            if (typeof shouldReconnect !== 'undefined') shouldReconnect = true;
            activeStream.Start();
            activeStream.Volume = Number.isFinite(requestedVolume) ? requestedVolume : 1;
            logAu('FM stream restarted automatically after tune');
        } catch (e) { logW('FM retune restart failed:', e.message); }
    }, 180);
}

// Debug counters
let chunksTotal   = 0;
let chunksWindow  = 0;       // chunks in last 1s window
let chunkRate     = 0;       // chunks/sec (smoothed)
let bytesTotal    = 0;       // total bytes received from audio WS
let dropsTotal    = 0;       // chunks dropped (buffer too far ahead)
let lastChunkMs   = null;    // Date.now() of last received chunk
const MAX_LOG     = 60;
const debugLog    = [];      // nrsc5 stderr lines

// Web Audio
let audioCtx    = null;
let gainNode    = null;
let bgAudioEl   = null;
let nextTime    = 0;
let _preBuf     = [];   // chunks buffered before first play
let _preBufDur  = 0;    // seconds accumulated in _preBuf
const _scheduledSources = new Set();
const SAMPLE_RATE = 44100;
const CHANNELS    = 2;

// ─── Audio engine ─────────────────────────────────────────────────────────────

function initAudio() {
    if (audioCtx) return;
    logAu('Initialising AudioContext at', SAMPLE_RATE, 'Hz');
    try {
        audioCtx = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: SAMPLE_RATE });
        logAu('AudioContext created — actual sampleRate:', audioCtx.sampleRate, 'Hz state:', audioCtx.state);
        gainNode = audioCtx.createGain();
        gainNode.gain.value = 0.8;

        // AnalyserNode — exposes HD audio to visualizer plugins (AudioMetrix etc.)
        const analyser = audioCtx.createAnalyser();
        analyser.fftSize = 2048;
        gainNode.connect(analyser);
        window.hdRadioAnalyserNode = analyser;   // visualizer plugins can connect to this

        // Route through MediaStreamDestination → <audio> so background tabs keep playing
        const dest = audioCtx.createMediaStreamDestination();
        analyser.connect(dest);

        bgAudioEl = document.createElement('audio');
        bgAudioEl.srcObject = dest.stream;
        bgAudioEl.setAttribute('playsinline', '');
        bgAudioEl.autoplay = true;
        document.body.appendChild(bgAudioEl);
        bgAudioEl.play().catch(() => {});

        if ('audioSession' in navigator) navigator.audioSession.type = 'playback';

        nextTime = 0;   // will be set when pre-buffer flushes
    } catch (e) {
        logE('AudioContext init failed:', e);
    }
}

// Resume AudioContext if browser suspended it (extra safety net)
document.addEventListener('visibilitychange', () => {
    if (!document.hidden && audioCtx && audioCtx.state === 'suspended') {
        logAu('Tab visible again — resuming suspended AudioContext');
        audioCtx.resume();
    }
});

function _makeAudioBuffer(i16, frames) {
    const buf = audioCtx.createBuffer(CHANNELS, frames, SAMPLE_RATE);
    for (let ch = 0; ch < CHANNELS; ch++) {
        const out = buf.getChannelData(ch);
        for (let f = 0; f < frames; f++) out[f] = i16[f * CHANNELS + ch] / 32768;
    }
    return buf;
}

function _scheduleBuffer(buf) {
    const now = audioCtx.currentTime;
    if (nextTime > now + 2.0) { dropsTotal++; return; }  // drop if too far ahead
    if (nextTime < now + 0.05) nextTime = now + 0.15;
    const src = audioCtx.createBufferSource();
    src.buffer = buf;
    src.connect(gainNode);
    _scheduledSources.add(src);
    src.onended = () => _scheduledSources.delete(src);
    src.start(nextTime);
    nextTime += buf.duration;
}

function scheduleChunk(arrayBuffer) {
    if (_scanInProgress) return;   // ignore bridge chunks while scan is retuning
    if (!audioCtx || !gainNode) return;
    if (audioCtx.state === 'suspended') audioCtx.resume();

    chunksTotal++;
    chunksWindow++;
    bytesTotal  += arrayBuffer.byteLength;
    lastChunkMs  = Date.now();

    const i16    = new Int16Array(arrayBuffer);
    const frames = Math.floor(i16.length / CHANNELS);
    if (frames < 1) return;

    if (!hdAudioReady) {
        // Phase 1 — pre-buffer until we have ~500 ms of audio
        _preBuf.push({ i16: i16.slice(), frames });
        _preBufDur += frames / SAMPLE_RATE;

        if (_preBufDur >= 1.0) {
            // Check MER — don't switch to HD audio if signal is too weak to decode cleanly.
            // Keep FM playing and trim the rolling buffer until MER improves.
            const mer = (meta && meta.merLower !== undefined) ? meta.merLower : null;
            const merTooWeak = !forceHdAudio && mer !== null && mer < 5;
            if (merTooWeak) {
                logAu(`Pre-buffer full but MER ${mer.toFixed(1)} dB < 5 dB — holding FM, waiting for signal`);
                // Trim oldest chunk so buffer doesn't grow unbounded
                while (_preBuf.length > 1) {
                    const dropped = _preBuf.shift();
                    _preBufDur -= dropped.frames / SAMPLE_RATE;
                }
                return;
            }

            hdAudioReady = true;
            refreshInlineHD();
            logAu(`Pre-buffer ready — ${(_preBufDur * 1000).toFixed(0)} ms buffered, flushing ${_preBuf.length} chunks`);

            // Lead time: AudioContext hardware path takes time to stabilize, especially
            // on Chrome (48 kHz resampler warm-up). 1.5 s reduces pitch drift on first play.
            nextTime = audioCtx.currentTime + 1.5;
            for (const { i16: ci16, frames: cf } of _preBuf) {
                _scheduleBuffer(_makeAudioBuffer(ci16, cf));
            }
            _preBuf = [];
            _preBufDur = 0;

            logAu('HD audio scheduled to start at t =', nextTime.toFixed(3), 's — cutting FM now');
            // Sync HD gain to whatever the main volume slider is currently at
            const mainSlider = document.getElementById('volumeSlider');
            if (mainSlider && gainNode) {
                const raw = parseFloat(mainSlider.value);
                gainNode.gain.value = raw > 1 ? raw / 100 : raw;
            }
            muteFM();
        }
        return;
    }

    // Phase 2 — normal realtime scheduling
    _scheduleBuffer(_makeAudioBuffer(i16, frames));
}

// Chunk rate sampler + audio watchdog — runs every second
let _silentSeconds = 0;
const WATCHDOG_TIMEOUT = 4;  // seconds of no chunks before falling back to FM

setInterval(() => {
    chunkRate    = chunksWindow;
    chunksWindow = 0;
    if (debugOpen) refreshDebug();

    // Watchdog: if we've muted FM but chunks stopped arriving, fall back to analog
    if (hdAudioReady && _savedFmVolume !== null) {
        if (chunkRate === 0) {
            _silentSeconds++;
            if (_silentSeconds >= WATCHDOG_TIMEOUT) {
                logW(`No HD audio chunks for ${WATCHDOG_TIMEOUT}s — falling back to FM analog`);
                unmuteFM();
                hdAudioReady = false;  // re-arm so HD can take over again when chunks resume
                _silentSeconds = 0;
            }
        } else {
            _silentSeconds = 0;
        }
    } else {
        _silentSeconds = 0;
    }

    // If chunks start arriving again after watchdog fired, re-mute FM (only if MER is good)
    if (!hdAudioReady && synchronized && chunkRate > 0 && _savedFmVolume === null) {
        const mer = (meta && meta.merLower !== undefined) ? meta.merLower : null;
        if (forceHdAudio || mer === null || mer >= 5) {
            logAu('HD audio chunks resumed — switching back from FM');
            muteFM();
            hdAudioReady = true;
            refreshInlineHD();
        }
    }
}, 1000);

// ─── Audio WebSocket ──────────────────────────────────────────────────────────

function connectAudio() {
    if (audioWs && audioWs.readyState < 2) return;
    logWs('Connecting HD audio WebSocket →', HD_AUDIO_WS_URL);
    audioWs = new WebSocket(HD_AUDIO_WS_URL);
    audioWs.binaryType = 'arraybuffer';
    audioWs.onmessage  = e => { if (e.data instanceof ArrayBuffer && e.data.byteLength > 0) scheduleChunk(e.data); };
    audioWs.onopen     = () => { logWs('HD audio WebSocket connected'); if (debugOpen) refreshDebug(); };
    audioWs.onclose    = e => { logWs('HD audio WebSocket closed (code:', e.code, ')'); if (hdEnabled && synchronized) setTimeout(connectAudio, 3000); if (debugOpen) refreshDebug(); };
    audioWs.onerror    = e => logE('HD audio WebSocket error:', e);
}

function resetProgramAudio() {
    _scheduledSources.forEach(src => { try { src.stop(); } catch (_) {} });
    _scheduledSources.clear();
    _preBuf = [];
    _preBufDur = 0;
    hdAudioReady = false;
    nextTime = audioCtx ? audioCtx.currentTime + 0.05 : 0;
    unmuteFM();
    logAu(`Audio queue cleared for HD${currentProg + 1}; RF and WebSockets remain connected`);
}
function disconnectAudio() {
    logAu('Disconnecting HD audio (chunks total:', chunksTotal, ')');
    if (audioWs) { audioWs.close(); audioWs = null; }
    if (bgAudioEl) { bgAudioEl.srcObject = null; bgAudioEl.remove(); bgAudioEl = null; }
    if (audioCtx) { audioCtx.close().catch(() => {}); }
    audioCtx = null; gainNode = null;
    hdAudioReady = false;
    _preBuf = []; _preBufDur = 0;
    if ('audioSession' in navigator) navigator.audioSession.type = 'none';
}

// ─── Plugin WebSocket ─────────────────────────────────────────────────────────

function connectPlugin() {
    logWs('Connecting plugin WebSocket →', PLUGINS_WS_URL);
    pluginWs = new WebSocket(PLUGINS_WS_URL);
    pluginWs.onopen    = () => {
        logWs('Plugin WebSocket connected');
        pluginWs.send(JSON.stringify({ type: 'hd-radio-request' }));
        if (debugOpen) refreshDebug();
    };
    pluginWs.onmessage = e => {
        try {
            const msg = JSON.parse(e.data);
            if (msg.type === 'hd-radio-meta')    applyMeta(msg.value);
            if (msg.type === 'hd-radio-log')     appendLog(msg.value);
            if (msg.type === 'hd-radio-devices') logDevices(msg.value);
            if (msg.type === 'hd-radio-lot')     handleLot(msg.value);
            if (msg.type === 'hd-scan-start')    hdScanStarted(msg.value);
            if (msg.type === 'hd-scan-progress') hdScanProgress(msg.value);
            if (msg.type === 'hd-scan-hit')      hdScanHit(msg.value);
            if (msg.type === 'hd-scan-done')     hdScanDone(msg.value);
            if (msg.type === 'hd-scan-cache')    hdScanLoadCache(msg.value);
        } catch (err) { logE('Plugin WS parse error:', err); }
    };
    pluginWs.onclose = e => { logWs('Plugin WebSocket closed (code:', e.code, ') — reconnecting in 5 s'); setTimeout(connectPlugin, 5000); if (debugOpen) refreshDebug(); };
    pluginWs.onerror = e => logE('Plugin WebSocket error:', e);
}

function send(type, value) {
    if (pluginWs && pluginWs.readyState === WebSocket.OPEN)
        pluginWs.send(JSON.stringify({ type, value }));
}

// ─── State ────────────────────────────────────────────────────────────────────

function applyMeta(v) {
    // While waiting for the server to confirm a user-initiated disable,
    // silently drop stale messages that still say enabled:true / synchronized:true.
    // These are in-flight messages queued before the server processed the disable.
    if (_pendingDisable) {
        if (v.enabled === false) {
            _pendingDisable = false; // server confirmed — allow through
        } else {
            return; // stale — discard
        }
    }

    const prevSync = synchronized;
    const prevFreq = meta.freq;
    const prevProg = currentProg;
    const prevSig = hdSignalDetected;
    hdEnabled        = v.enabled;
    hdSignalDetected = v.signalDetected ?? hdSignalDetected;
    synchronized     = v.synchronized;
    if (v.program !== undefined) {
        currentProg = v.program;
        if (currentProg !== prevProg) resetProgramAudio();
    }

    if (hdSignalDetected && !prevSig) {
        log('HD Radio carrier detected — showing acquiring state');
    }
    if (v.deviceLost) {
        logW('RTL-SDR device lost — check USB connection');
    }
    if (v.gain !== undefined) {
        const s = document.getElementById('hd-gain-slider');
        const n = document.getElementById('hd-gain-num');
        if (s) s.value = v.gain;
        if (n) n.value = v.gain;
    }
    if (v.enhancedMeta  !== undefined) enhancedMeta  = v.enhancedMeta;
    if (v.forceHdAudio  !== undefined) forceHdAudio  = v.forceHdAudio;
    if ([140, 160, 190].includes(Number(v.analogBandwidthKhz))) analogBandwidthKhz = Number(v.analogBandwidthKhz);
    if (v.receiver) receiverType = v.receiver;

    // Inject HD signal quality into the global `data` object so signal monitor
    // plugins can display it. Uses `hdBer`/`hdMer` keys to avoid conflicts.
    if (typeof data !== 'undefined' && data !== null) {
        data.hdLocked  = v.synchronized;
        data.hdBerNow  = v.berNow  ?? null;
        data.hdBerAvg  = v.berAvg  ?? null;
        data.hdMerLow  = v.merLower ?? null;
        data.hdMerHigh = v.merUpper ?? null;
        data.hdProg    = v.program  ?? 0;
        data.hdBitRate = v.bitRate  || '';
    }
    meta = v;

    // A user-requested HD standby must immediately reveal the live analog
    // stereo/RDS fields, even if the receiver still reports its last HD lock.
    if (!hdEnabled) {
        synchronized = false;
        hdAudioReady = false;
        disconnectAudio();
        unmuteFM();
        restoreRdsArea();
        refreshInlineHD();
        refreshIcon();
        refreshDash();
        return;
    }

    // Frequency changed → clear HD UI immediately, reset signal state
    if (v.freq !== undefined && v.freq !== prevFreq && hdEnabled) {
        log('Frequency changed to', v.freq, 'MHz — resetting signal detection');
        hdSignalDetected = false;
        hdWasSynced      = false;
        if (prevSync) {
            // Was locked on old freq — clear before unmute so prototype setter allows restore
            synchronized = false;
            hdAudioReady = false;
            _preBuf = [];
            _preBufDur = 0;
            unmuteFM();
            restoreRdsArea();
        }
        _startNoSigTimer();
    }

    // Log meaningful metadata changes
    if (v.stationName && v.stationName !== meta.stationName) logMe('Station name:', v.stationName);
    if (v.slogan      && v.slogan      !== meta.slogan)      logMe('Slogan:', v.slogan);
    if (v.title       && v.title       !== meta.title)       logMe('Title:', v.title);
    if (v.artist      && v.artist      !== meta.artist)      logMe('Artist:', v.artist);
    if (v.programType && v.programType !== meta.programType) logMe('Program type:', v.programType);
    if (v.hdFormats   && !meta.hdFormats)                    logMe('HD formats from directory:', v.hdFormats);
    if (v.message     && v.message     !== meta.message)     logMe('Station message:', v.message);
    if (v.alert       && v.alert       !== meta.alert)       logMe('Station alert:', v.alert);

    if (synchronized && !prevSync) {
        log(`HD locked on ${v.freq} MHz HD${currentProg + 1} (${v.stationName || 'unknown'})`);
        hdWasSynced = true;
        _clearNoSigTimer();
        hdAudioReady = false;

        // Only start HD audio if THIS CLIENT is already listening.
        // Stream === null means the user hasn't clicked play yet — don't auto-start
        // for them since it would create an AudioContext without a user gesture
        // (causes pitch artifacts and violates browser autoplay policy).
        // The createStream patch (below in DOMContentLoaded) handles the case where
        // they click play AFTER HD has already locked.
        const clientIsListening = typeof Stream !== 'undefined' && Stream !== null;
        if (clientIsListening) {
            initAudio();
            connectAudio();
            // Don't mute FM yet — keep playing until pre-buffer is ready (seamless transition)
            setTimeout(tryBridgeAudioMetrix, 500);
        } else {
            log('Client not yet listening — HD audio will start when play is clicked');
        }

        injectHdMeta();
        refreshInlineHD();
    } else if (!synchronized && prevSync) {
        logW('HD signal lost — falling back to FM analog');
        hdAudioReady = false;
        _preBuf = [];
        _preBufDur = 0;
        unmuteFM();
        restoreRdsArea();
        refreshInlineHD();
        // Don't start noSig timer here — this is a signal DROP, not "no HD on freq"
        // hdWasSynced stays true so UI shows "Signal Lost", not "Acquiring"
    } else if (synchronized) {
        injectHdMeta();
        refreshInlineHD();
        const _hl = /^HD\d+$/i;
        const _t  = meta.title  && !_hl.test(meta.title.trim())  ? meta.title  : '';
        const _a  = meta.artist && !_hl.test(meta.artist.trim()) ? meta.artist : '';
        if (enhancedMeta && _t && _a) fetchItunesArt(_t, _a);
        else if (!_t || !_a) { _lastItunesQuery = ''; _itunesArtUrl = ''; refreshAlbumArt(); }
        updateStationInfoSection();
    }

    // If enabled but never synced and timer not running, start it
    if (hdEnabled && !synchronized && _noSigTimer === null) _startNoSigTimer();

    refreshIcon();
    refreshDash();
    if (debugOpen) refreshDebug();
}

function enableHD() {
    log('HD Radio enabled — waiting for sync on', meta.freq || '?', 'MHz');
    _pendingDisable = false; // clear any pending disable if user re-enables
    _manualHdOff = false;
    hdEnabled = true;
    hdAudioReady = false;
    _startNoSigTimer();
    send('hd-radio-enable', { program: currentProg });
    refreshIcon(); refreshDash(); refreshInlineHD();
}
let _pendingDisable = false; // true after user disables — ignore stale enabled:true messages
let _manualHdOff = false;

function disableHD() {
    log('HD Radio disabled by user');
    _pendingDisable = true;
    _manualHdOff = true;
    hdEnabled = false; synchronized = false; hdSignalDetected = false; hdWasSynced = false;
    _clearNoSigTimer();
    send('hd-radio-disable', {});
    disconnectAudio(); unmuteFM(); restoreRdsArea();
    refreshIcon(); refreshDash(); refreshInlineHD();
}
function setProgram(p) {
    p = Math.max(0, Math.min(7, Number(p) || 0));
    if (p === currentProg) return;
    log(`Switching program â†’ HD${p + 1} (receiver stays tuned)`);
    currentProg = p;
    resetProgramAudio();
    send('hd-radio-program', { program: p });
    refreshDash(); refreshInlineHD();
}

// ─── Debug log ────────────────────────────────────────────────────────────────

function appendLog(line) {
    const ts = new Date().toLocaleTimeString('en-US', { hour12: false });
    debugLog.push(`${ts}  ${line}`);
    if (debugLog.length > MAX_LOG) debugLog.shift();
    if (debugOpen) {
        const box = document.getElementById('hd-debug-log');
        if (box) {
            box.textContent = debugLog.join('\n');
            box.scrollTop = box.scrollHeight;
        }
    }
}

function wsStateLabel(ws) {
    if (!ws) return '✗ null';
    return ['✓ CONNECTING', '✓ OPEN', '✗ CLOSING', '✗ CLOSED'][ws.readyState] ?? '?';
}

function wsStateColor(ws) {
    if (!ws) return '#664444';
    return ws.readyState === 1 ? '#226644' : '#664444';
}

// Signal quality from MER (Modulation Error Ratio, dB)
// HD Radio typical: MER upper > 15 = Excellent, 10-15 = Good, 5-10 = Fair, <5 = Poor
function sigQuality(mer) {
    if (mer === null || !synchronized) return { level: 0, label: 'NO SIGNAL', color: '#443', audioOk: false };
    if (mer >= 15) return { level: 4, label: 'EXCELLENT', color: '#00cc66', audioOk: true };
    if (mer >= 10) return { level: 3, label: 'GOOD',      color: '#44cc44', audioOk: true };
    if (mer >= 5)  return { level: 2, label: 'FAIR',      color: '#ddaa00', audioOk: true };
    if (mer >= 0)  return { level: 1, label: 'POOR',      color: '#cc4422', audioOk: false };
    return             { level: 0, label: 'TOO WEAK',  color: '#882211', audioOk: false };
}

function refreshSignalQuality() {
    const q    = sigQuality(meta.merUpper ?? null);
    const lbl  = document.getElementById('hd-sig-label');
    const det  = document.getElementById('hd-sig-detail');
    const bars = document.querySelectorAll('#hd-sig-bars .hd-sig-bar');

    if (lbl)  { lbl.textContent = q.label; lbl.style.color = q.color; }
    if (det) {
        const audioWarn = (meta.merUpper !== null && !q.audioOk && synchronized)
            ? '  ⚠ too weak for audio decode' : '';
        det.textContent = meta.merUpper !== null
            ? `MER ${meta.merUpper} dB   BER ${meta.berNow !== null ? meta.berNow + '%' : '—'}${audioWarn}`
            : 'Waiting for signal data…';
        det.style.color = audioWarn ? '#cc6622' : '';
    }

    bars.forEach((bar, i) => {
        bar.style.background = i < q.level ? q.color : '#1a2030';
    });
}

function refreshDebug() {
    refreshSignalQuality();

    const s = document.getElementById('hd-debug-stats');
    if (!s) return;

    const bufferAhead = audioCtx
        ? Math.max(0, (nextTime - audioCtx.currentTime) * 1000).toFixed(0)
        : '—';
    const lastChunkAgo = lastChunkMs
        ? ((Date.now() - lastChunkMs) / 1000).toFixed(1) + 's ago'
        : 'never';
    const kbTotal = (bytesTotal / 1024).toFixed(1);
    const fmState = _savedFmVolume !== null ? `muted (saved vol: ${_savedFmVolume})` : 'active';
    const gainVal = gainNode ? gainNode.gain.value.toFixed(2) : '—';
    const bgElState = bgAudioEl
        ? (bgAudioEl.paused ? 'PAUSED' : 'playing') + (bgAudioEl.muted ? ' (muted)' : '')
        : 'none';

    s.innerHTML = `
<span style="color:#4466aa">── WebSockets ──</span>
<span style="color:${wsStateColor(pluginWs)}">Plugin  ${wsStateLabel(pluginWs)}</span>  <span style="color:#334">${PLUGINS_WS_URL}</span>
<span style="color:${wsStateColor(audioWs)}">Audio   ${wsStateLabel(audioWs)}</span>  <span style="color:#334">${HD_AUDIO_WS_URL}</span>

<span style="color:#4466aa">── Audio Engine ──</span>
Context    <span style="color:#99aacc">${audioCtx ? audioCtx.state : 'not init'}</span>   ${SAMPLE_RATE} Hz
Chunks/s   <span style="color:#99aacc">${chunkRate}</span>   Total  <span style="color:#99aacc">${chunksTotal}</span>   Dropped  <span style="color:#99aacc">${dropsTotal}</span>
Bytes rx   <span style="color:#99aacc">${kbTotal} kB</span>   Last chunk  <span style="color:#99aacc">${lastChunkAgo}</span>
Pre-buf    <span style="color:#99aacc">${(_preBufDur * 1000).toFixed(0)} ms</span>   Ready  <span style="color:#99aacc">${hdAudioReady}</span>   Buffer ahead  <span style="color:#99aacc">${bufferAhead} ms</span>
Gain       <span style="color:#99aacc">${gainVal}</span>   FM  <span style="color:#99aacc">${fmState}</span>
<audio>el  <span style="color:#99aacc">${bgElState}</span>   Silent watchdog  <span style="color:#99aacc">${_silentSeconds}s</span>

<span style="color:#4466aa">── State ──</span>
enabled  <span style="color:#99aacc">${hdEnabled}</span>   sync  <span style="color:#99aacc">${synchronized}</span>   prog  <span style="color:#99aacc">HD${currentProg + 1}</span>   freq  <span style="color:#99aacc">${meta.freq ?? '—'} MHz</span>

<span style="color:#4466aa">── Meta ──</span>
<span style="color:#99aacc">${JSON.stringify(meta, null, 2)}</span>`.trimStart();

    const box = document.getElementById('hd-debug-log');
    if (box && box.textContent !== debugLog.join('\n')) {
        box.textContent = debugLog.join('\n');
        box.scrollTop = box.scrollHeight;
    }
}

// ─── Plugin panel icon ────────────────────────────────────────────────────────

function refreshIcon() {
    const svg = document.getElementById('hd-radio-btn-img');
    const btn = document.getElementById('hd-radio-btn');
    if (!svg || !btn) return;

    if (hdEnabled && synchronized) {
        // Locked — solid white
        svg.classList.remove('hd-capturing');
        svg.style.opacity = '1';
        btn.title = 'HD Radio — Locked';
    } else if (hdEnabled && hdSignalDetected) {
        // HD carrier detected, acquiring sync — flash
        svg.classList.add('hd-capturing');
        svg.style.opacity = '1';
        btn.title = 'HD Radio — Acquiring…';
    } else {
        // Off, no signal, or running silently — very dim, no flash
        svg.classList.remove('hd-capturing');
        svg.style.opacity = hdEnabled ? '0.2' : '0.35';
        btn.title = hdEnabled ? 'HD Radio — Scanning…' : 'HD Radio';
    }
}

// Inline SVG of the HD Radio badge mark — scales with theme color
const HD_SVG = `<svg id="hd-radio-btn-img" xmlns="http://www.w3.org/2000/svg"
    viewBox="0 0 52 26" width="40" height="20"
    style="display:block;margin:0 auto 3px;overflow:visible;">
  <rect x="1.5" y="1.5" width="49" height="23" rx="5.5"
        fill="none" stroke="currentColor" stroke-width="2.5"/>
  <text x="26" y="18.5" text-anchor="middle"
        font-family="Arial Black,Arial,sans-serif"
        font-weight="900" font-size="15.5" letter-spacing="1.5"
        fill="currentColor">HD</text>
</svg>`;

// ─── Inline HD indicator (near frequency display) ─────────────────────────────

function addInlineHdIndicator() {
    if (document.getElementById('hd-inline')) return;

    const style = document.createElement('style');
    style.textContent = `
        #hd-inline { display:none; align-items:center; gap:6px;
                     padding:4px 0 2px; flex-wrap:wrap;
                     width:100%; margin-top:4px;
                     transition: opacity .3s; }
        #hd-inline-icon { cursor:pointer; opacity:.4; transition:opacity .3s; flex-shrink:0; }
        #hd-inline-icon.active { opacity:1; }
        #hd-inline-icon.capturing { animation:hd-flash .35s ease-in-out infinite; opacity:1; }
        @keyframes hd-pulse { 0%,100%{opacity:1} 50%{opacity:0.35} }
        .hd-buffering { animation: hd-pulse 0.7s ease-in-out infinite; }
        .hd-iprog { background:transparent; border:1px solid #334; border-radius:5px;
                    color:#556; font-size:11px; font-weight:700; padding:2px 8px;
                    cursor:pointer; transition:all .15s; letter-spacing:.5px; }
        .hd-iprog:hover:not(:disabled) { border-color:#4466cc; color:#aac0ff; }
        .hd-iprog.active { background:#162060; color:#88bbff; border-color:#3366ee;
                           box-shadow:0 0 6px rgba(60,100,255,.3); }
        .hd-iprog:disabled { opacity:.25; cursor:not-allowed; border-color:#222; color:#334; }
        .hd-iprog.weak:not(:disabled) { opacity:.45; border-color:#2a3; color:#3a5; }
        #hd-inline-off { background:#581818; border:1px solid #a33; border-radius:6px;
                         color:#ffaaaa; font-size:10px; font-weight:800; padding:4px 8px;
                         cursor:pointer; letter-spacing:.4px; white-space:nowrap; }
        #hd-inline-off:hover { background:#7a2020; color:#fff; }
        #hd-inline-on { background:#123f2a; border:1px solid #278858; border-radius:6px;
                        color:#91efbd; font-size:10px; font-weight:800; padding:4px 8px;
                        cursor:pointer; letter-spacing:.4px; white-space:nowrap; }
        #hd-inline-on:hover { background:#19603e; color:#fff; }
    `;
    document.head.appendChild(style);

    const el = document.createElement('div');
    el.id = 'hd-inline';
    el.innerHTML = `
        <div style="display:flex;flex-direction:column;align-items:center;gap:2px;cursor:pointer;" id="hd-inline-icon" title="Open HD Radio panel">
            <img src="${HD_ICON_GRAY}" id="hd-inline-img" style="height:20px;border-radius:2px;transition:opacity .3s;" alt="HD">
            <span id="hd-inline-callsign" style="font-size:9px;letter-spacing:1px;color:#445;font-weight:700;"></span>
        </div>
        <div style="display:flex;gap:4px;" id="hd-iprog-row">
            <button class="hd-iprog" data-p="0">HD1</button>
            <button class="hd-iprog" data-p="1">HD2</button>
            <button class="hd-iprog" data-p="2">HD3</button>
            <button class="hd-iprog" data-p="3">HD4</button>
        </div>
        <button id="hd-inline-off" title="Use FM analog when HD reception is weak">HD RADIO OFF</button>
        <button id="hd-inline-on" title="Enable automatic HD Radio detection">HD RADIO ON</button>
    `;

    // Insert inside #freq-container, below the frequency value
    const freqContainer = document.getElementById('freq-container');
    if (freqContainer) {
        freqContainer.style.position = 'relative';
        freqContainer.appendChild(el);
    } else {
        document.body.appendChild(el);
    }

    document.getElementById('hd-inline-icon').addEventListener('click', toggleDash);
    document.getElementById('hd-inline-off').addEventListener('click', event => {
        event.stopPropagation();
        disableHD();
    });
    document.getElementById('hd-inline-on').addEventListener('click', event => {
        event.stopPropagation();
        enableHD();
    });
    el.querySelectorAll('.hd-iprog').forEach(btn => {
        btn.addEventListener('click', () => setProgram(parseInt(btn.dataset.p)));
    });
}

function refreshInlineHD() {
    const el       = document.getElementById('hd-inline');
    const img      = document.getElementById('hd-inline-img');
    const callsign = document.getElementById('hd-inline-callsign');
    const offButton = document.getElementById('hd-inline-off');
    const onButton = document.getElementById('hd-inline-on');
    const icon = document.getElementById('hd-inline-icon');
    const programRow = document.getElementById('hd-iprog-row');
    if (!el) return;

    // Keep the same control area visible after manual OFF so HD can be enabled again.
    el.style.display = (_manualHdOff || (hdEnabled && (hdSignalDetected || synchronized))) ? 'flex' : 'none';
    if (offButton) offButton.style.display = (hdEnabled && synchronized && !_manualHdOff) ? '' : 'none';
    if (onButton) onButton.style.display = _manualHdOff ? '' : 'none';
    if (icon) icon.style.display = _manualHdOff ? 'none' : 'flex';
    if (programRow) programRow.style.display = _manualHdOff ? 'none' : 'flex';

    // ── Icon state ───────────────────────────────────────────────────────────
    if (img) {
        img.classList.remove('hd-capturing', 'hd-buffering');
        if (synchronized && hdAudioReady) {
            // HD audio playing — solid icon
            img.src = HD_ICON; img.style.opacity = '1';
        } else if (synchronized && !hdAudioReady) {
            // Locked but buffering or waiting for signal to improve — slow pulse
            img.src = HD_ICON; img.style.opacity = '1';
            img.classList.add('hd-buffering');
        } else if (hdSignalDetected) {
            // Carrier detected, trying to acquire sync — fast flash
            img.src = HD_ICON; img.style.opacity = '1';
            img.classList.add('hd-capturing');
        } else {
            // No HD signal
            img.src = HD_ICON_GRAY; img.style.opacity = '0.4';
        }
    }

    // ── Callsign ─────────────────────────────────────────────────────────────
    // When locked, PS container already shows the full callsign — just show HDn here.
    if (callsign) {
        if (synchronized && meta.stationName) {
            callsign.textContent = `HD${currentProg + 1}`;
            callsign.style.color = 'var(--color-main-bright)';
        } else if (hdSignalDetected && meta.stationName) {
            callsign.textContent = `${meta.stationName}-HD`;
            callsign.style.color = '#445';
        } else {
            callsign.textContent = '';
        }
    }

    // ── Program buttons ───────────────────────────────────────────────────────
    const _fmtCount = meta.hdFormats ? meta.hdFormats.filter(Boolean).length : 0;
    const numProgs  = Math.max(
        meta.numPrograms || 1,
        (enhancedMeta || forceHdAudio) ? _fmtCount : 0
    );
    const merWeak  = synchronized && meta.merLower !== null && meta.merLower !== undefined
                     && meta.merLower < 5;

    el.querySelectorAll('.hd-iprog').forEach(btn => {
        const p = parseInt(btn.dataset.p);
        const exists = p < numProgs;              // channel present on this station
        const locked = synchronized || !exists;   // can't select if not synced or no channel

        btn.classList.toggle('active', p === currentProg && synchronized);
        btn.classList.toggle('weak',   exists && merWeak);
        btn.disabled = !exists || !synchronized;  // gray out missing channels or when unsynced
    });

    el.style.opacity = (hdSignalDetected || synchronized) ? '1' : '0.45';

    // ── PS display — replace RDS PS with HD callsign when locked ────────────
    const psEl        = document.getElementById('data-ps');
    const psContainer = document.getElementById('ps-container');
    const hdCallsign  = meta.stationName || '';

    if (psContainer && hdEnabled && synchronized && hdCallsign) {
        // Locked: hide the RDS PS and show HD callsign at the same visual weight
        if (psEl) psEl.style.display = 'none';
        let psLabel = document.getElementById('hd-ps-label');
        if (!psLabel) {
            psLabel = document.createElement('div');
            psLabel.id = 'hd-ps-label';
            psLabel.className = 'text-big';
            psLabel.style.cssText = 'color:var(--color-main-bright);text-align:center;';
            if (psEl) psContainer.insertBefore(psLabel, psEl);
            else psContainer.appendChild(psLabel);
        }
        psLabel.textContent = `${hdCallsign}-HD${currentProg + 1}`;
    } else if (psContainer && hdEnabled && hdSignalDetected && hdCallsign) {
        // Signal detected but not yet locked: keep PS, show small indicator below
        if (psEl) psEl.style.display = '';
        let psLabel = document.getElementById('hd-ps-label');
        if (!psLabel) {
            psLabel = document.createElement('div');
            psLabel.id = 'hd-ps-label';
            psLabel.style.cssText = 'font-size:10px;font-weight:700;letter-spacing:2px;color:#4466aa;margin-top:2px;text-align:center;';
            psContainer.appendChild(psLabel);
        }
        psLabel.textContent = `${hdCallsign} · HD`;
    } else {
        if (psEl) psEl.style.display = '';
        document.getElementById('hd-ps-label')?.remove();
    }
}

function addPanelButton() {
    const container = document.querySelector('.scrollable-container');
    if (!container) return;
    const btn = document.createElement('button');
    btn.id        = 'hd-radio-btn';
    btn.className = 'no-bg color-4 hover-brighten tooltip';
    btn.setAttribute('data-tooltip', 'HD Radio (NRSC-5) decoder · Click to open');
    btn.setAttribute('data-tooltip-placement', 'bottom');
    btn.style.cssText = 'padding:6px;width:64px;min-width:64px;';
    btn.innerHTML = `${HD_SVG}
        <span style="font-size:10px;color:var(--color-main-bright);">HD Radio</span>`;
    btn.addEventListener('click', toggleDash);
    container.appendChild(btn);
    if (typeof initTooltips === 'function') initTooltips(btn);
    if (typeof checkScroll === 'function') setTimeout(checkScroll, 100);
}

// ─── Drag & Resize ────────────────────────────────────────────────────────────

function makeDraggable(dash, handle) {
    let dragging = false, ox = 0, oy = 0;
    let _converted = false;  // track whether we've moved from transform→absolute

    handle.style.cursor = 'grab';

    function convertToAbsolute() {
        if (_converted) return;
        // Must measure BEFORE removing transform, while element is visible
        const r = dash.getBoundingClientRect();
        dash.style.left      = r.left + 'px';
        dash.style.top       = r.top  + 'px';
        dash.style.transform = 'none';
        _converted = true;
    }

    handle.addEventListener('mousedown', e => {
        if (window.innerWidth <= 540) return;
        if (e.target.tagName === 'BUTTON' || e.target.tagName === 'IMG') return;
        convertToAbsolute();
        dragging = true;
        ox = e.clientX - dash.getBoundingClientRect().left;
        oy = e.clientY - dash.getBoundingClientRect().top;
        handle.style.cursor = 'grabbing';
        e.preventDefault();
        e.stopPropagation();   // stop click-outside handler from immediately closing
    });

    document.addEventListener('mousemove', e => {
        if (!dragging) return;
        let x = e.clientX - ox;
        let y = e.clientY - oy;

        // Clamp X: at least 48 px of titlebar reachable
        const GRAB = 48;
        x = Math.max(GRAB - dash.offsetWidth, Math.min(window.innerWidth - GRAB, x));

        // Clamp Y: hard stop at bottom of .wrapper-outer (the fmdx top bar)
        // — panel can never overlap the header
        const wrapperOuter = document.querySelector('.wrapper-outer');
        const minY = wrapperOuter
            ? wrapperOuter.getBoundingClientRect().bottom
            : 0;
        y = Math.max(minY, Math.min(window.innerHeight - GRAB, y));

        dash.style.left = x + 'px';
        dash.style.top  = y + 'px';
    });

    document.addEventListener('mouseup', () => {
        dragging = false;
        handle.style.cursor = 'grab';
    });
}

function makeResizable(dash, grip) {
    let resizing = false, startX = 0, startY = 0, startW = 0, startH = 0;

    grip.style.cursor = 'nwse-resize';

    grip.addEventListener('mousedown', e => {
        resizing = true;
        startX = e.clientX;
        startY = e.clientY;
        startW = dash.offsetWidth;
        startH = dash.offsetHeight;
        e.preventDefault();
        e.stopPropagation();
    });

    document.addEventListener('mousemove', e => {
        if (!resizing) return;
        const w = Math.max(360, startW + (e.clientX - startX));
        const h = Math.max(300, startH + (e.clientY - startY));
        dash.style.width  = w + 'px';
        dash.style.height = h + 'px';
    });

    document.addEventListener('mouseup', () => { resizing = false; });
}

// ─── Dashboard build ──────────────────────────────────────────────────────────

function buildDashboard() {
    if (document.getElementById('hd-dash')) return;

    const style = document.createElement('style');
    style.textContent = `
        #hd-dash {
            display: none;
            position: fixed;
            top: 50%; left: 50%;
            transform: translate(-50%, -50%);
            z-index: 9999;
            width: min(540px, 98vw);
            min-width: 0;
            max-height: 92vh;
            min-height: 300px;
            flex-direction: column;
            background: linear-gradient(160deg,#080818 0%,#0d0d26 60%,#080818 100%);
            border: 1px solid #1e3a7a;
            border-radius: 16px;
            box-shadow: 0 0 60px rgba(30,80,255,.25), 0 4px 32px rgba(0,0,0,.8);
            font-family: 'Segoe UI', Arial, sans-serif;
            color: #c8cce8;
            overflow-y: auto;
            overflow-x: hidden;
            user-select: none;
            scrollbar-width: thin;
            scrollbar-color: #2a3a70 transparent;
        }
        #hd-dash::-webkit-scrollbar { width: 4px; }
        #hd-dash::-webkit-scrollbar-track { background: transparent; }
        #hd-dash::-webkit-scrollbar-thumb { background: #2a3a70; border-radius: 4px; }
        #hd-dash .hd-titlebar {
            display: flex; align-items: center; gap: 10px;
            padding: 11px 14px 10px;
            background: rgba(8,8,30,.97);
            border-bottom: 1px solid #1a2d6a;
            position: sticky; top: 0; z-index: 10;
        }
        #hd-dash .hd-footer {
            position: sticky; bottom: 0; z-index: 10;
            background: rgba(0,0,10,.97);
        }
        #hd-dash .hd-body {
            padding: 12px 14px 14px;
            display: flex; flex-direction: column; gap: 10px;
        }
        @media (max-width: 540px) {
            #hd-dash { border-radius: 12px; border-left: none; border-right: none; width: 100vw !important; left: 0 !important; transform: none !important; top: auto !important; bottom: 0 !important; max-height: 85vh; border-bottom-left-radius: 0; border-bottom-right-radius: 0; }
            #hd-dash .hd-titlebar { padding: 9px 12px 8px; gap: 7px; cursor: default !important; }
            #hd-dash .hd-body { padding: 10px 12px 12px; gap: 8px; }
            #hd-dash .hd-footer { padding: 8px 12px; }
            #hd-dash .hd-station-name { font-size: 22px; letter-spacing: 2px; }
            #hd-dash .hd-title  { font-size: 14px; }
            #hd-dash .hd-artist { font-size: 12px; }
            #hd-dash .hd-info-label { font-size: 8px; }
            #hd-dash .hd-info-value { font-size: 12px; }
            #hd-dash .hd-prog-btn { font-size: 11px; padding: 5px 2px; }
            #hd-grip { display: none !important; }
            /* Debug panel on mobile: smaller fonts, wrap stats */
            #hd-debug-stats { font-size: 9px; white-space: pre-wrap; word-break: break-all; }
            #hd-debug-log   { font-size: 9px; height: 100px; }
            #hd-sig-quality { flex-wrap: wrap; }
            .hd-debug-header { font-size: 9px; }
            /* Hide drag cursor on mobile — sheet doesn't drag */
            #hd-titlebar { cursor: default !important; }
        }
        #hd-dash .hd-status-dot {
            width:8px;height:8px;border-radius:50%;background:#555;flex-shrink:0;
            box-shadow:0 0 6px currentColor;transition:background .4s,box-shadow .4s;
        }
        #hd-dash .hd-prog-row { display:flex; gap:6px; }
        #hd-dash .hd-prog-btn {
            flex:1;background:#111130;color:#8899bb;border:1px solid #2a3460;
            border-radius:7px;padding:6px 4px;font-size:12px;font-weight:700;
            letter-spacing:.5px;cursor:pointer;transition:all .15s;
        }
        #hd-dash .hd-prog-btn:hover { border-color:#4466cc;color:#aac0ff; }
        #hd-dash .hd-prog-btn.active {
            background:#162060;color:#88bbff;border-color:#3366ee;
            box-shadow:0 0 10px rgba(60,100,255,.3);
        }
        #hd-dash .hd-station-box {
            background:rgba(10,30,80,.4);border:1px solid #1a3060;
            border-radius:12px;padding:14px 16px;text-align:center;
        }
        #hd-dash .hd-station-name {
            font-size:28px;font-weight:800;letter-spacing:4px;color:#fff;
            text-shadow:0 0 30px rgba(100,160,255,.6);min-height:34px;
        }
        #hd-dash .hd-slogan { font-size:11px;color:#8899bb;font-style:italic;margin-top:4px;min-height:16px; }
        #hd-dash .hd-nowplaying { background:rgba(5,10,40,.5);border:1px solid #161e44;border-radius:12px;padding:12px 16px; }
        #hd-dash .hd-np-label { font-size:9px;letter-spacing:3px;color:#4a5580;margin-bottom:8px;text-transform:uppercase; }
        #hd-dash .hd-title  { font-size:16px;font-weight:700;color:#ccdeff;min-height:20px; }
        #hd-dash .hd-artist { font-size:13px;color:#8899cc;margin-top:4px;min-height:17px; }
        #hd-dash .hd-album  { font-size:11px;color:#5566aa;margin-top:3px;min-height:15px; }
        #hd-dash .hd-info-row { display:flex;gap:8px; }
        #hd-dash .hd-info-cell {
            flex:1;background:rgba(5,10,35,.5);border:1px solid #161e40;
            border-radius:9px;padding:9px 8px;text-align:center;
        }
        #hd-dash .hd-info-label { font-size:9px;letter-spacing:2px;color:#3d4a70;margin-bottom:4px;text-transform:uppercase; }
        #hd-dash .hd-info-value { font-size:13px;color:#99aacc;font-weight:600; }
        #hd-dash input[type=range] { width:100%;accent-color:#3366ee; }
        #hd-dash .hd-bw-btn {
            flex:1;min-width:0;background:#0a0e20;color:#667799;border:1px solid #242d50;
            border-radius:6px;padding:5px 4px;font-size:10px;font-weight:700;letter-spacing:.4px;
            cursor:pointer;transition:all .15s;white-space:nowrap;
        }
        #hd-dash .hd-bw-btn:hover { color:#aac0ff;border-color:#4466aa; }
        #hd-dash .hd-bw-btn.active { background:#163060;color:#8fd0ff;border-color:#3475cc;box-shadow:0 0 8px rgba(50,120,220,.22); }
        #hd-dash .hd-debug-section {
            background:rgba(0,0,0,.5);border:1px solid #1a2040;
            border-radius:10px;overflow:hidden;
        }
        #hd-dash .hd-debug-header {
            display:flex;align-items:center;justify-content:space-between;
            padding:7px 12px;cursor:pointer;
            font-size:10px;letter-spacing:2px;color:#445588;text-transform:uppercase;
            border-bottom:1px solid transparent;transition:border-color .2s;
        }
        #hd-dash .hd-debug-header:hover { color:#6688bb; }
        #hd-dash .hd-debug-header.open { border-bottom-color:#1a2040; color:#6688bb; }
        #hd-dash .hd-debug-body { display:none; padding:10px 12px; }
        #hd-dash .hd-debug-body.open { display:block; }
        #hd-debug-stats {
            font-size:11px;font-family:'Courier New',monospace;color:#667799;
            white-space:pre;line-height:1.6;margin-bottom:8px;
            user-select:text;-webkit-user-select:text;
        }
        #hd-debug-log {
            font-size:10px;font-family:'Courier New',monospace;color:#44665a;
            white-space:pre;height:160px;overflow-y:scroll;
            background:rgba(0,10,5,.4);border-radius:6px;padding:6px 8px;
            border:1px solid #0a1a10;
            user-select:text;-webkit-user-select:text;
            cursor:text;
        }
        #hd-sig-quality {
            display:flex;align-items:center;gap:8px;
            padding:8px 12px;border-radius:8px;
            border:1px solid #1a2040;background:rgba(0,0,20,.4);
            margin-bottom:6px;
        }
        #hd-sig-quality .hd-sig-bars { display:flex;gap:3px;align-items:flex-end; }
        #hd-sig-quality .hd-sig-bar  { width:5px;border-radius:2px;transition:background .4s; }
        #hd-sig-quality .hd-sig-label { font-size:11px;font-weight:700;letter-spacing:1px; }
        #hd-grip:hover { color:#4466aa; }
        .hd-toggle-on  { background:#6a1515!important;color:#ff8888!important;border-color:#8a2222!important; }
        .hd-toggle-off { background:#122060!important;color:#88aaff!important;border-color:#2244aa!important; }
        @keyframes hd-flash { 0%,100%{opacity:1} 50%{opacity:0.2} }
        .hd-capturing { animation: hd-flash 0.35s ease-in-out infinite; }
        @keyframes hd-spin { to { transform: rotate(360deg); } }
        #hd-acquiring {
            display: none;
            flex-direction: column;
            align-items: center;
            justify-content: center;
            gap: 14px;
            background: rgba(5,8,28,0.92);
            border: 1px solid #1e3060;
            border-radius: 12px;
            padding: 28px 20px;
            text-align: center;
        }
        #hd-acquiring .hd-spinner {
            width: 36px; height: 36px;
            border: 3px solid rgba(60,100,255,0.15);
            border-top-color: #4488ff;
            border-radius: 50%;
            animation: hd-spin 0.9s linear infinite;
            flex-shrink: 0;
        }
        #hd-acquiring .hd-acq-label {
            font-size: 13px; font-weight: 700;
            letter-spacing: 2px; color: #6688cc;
            text-transform: uppercase;
        }
        #hd-acquiring .hd-acq-sub {
            font-size: 11px; color: #334466;
            margin-top: -6px;
        }
    `;
    document.head.appendChild(style);

    const dash = document.createElement('div');
    dash.id = 'hd-dash';
    dash.innerHTML = `
        <div class="hd-titlebar" id="hd-titlebar">
            <div style="flex:1;">
                <div style="font-size:9px;letter-spacing:3px;color:#4466aa;text-transform:uppercase;">HD Radio · NRSC-5</div>
                <div style="display:flex;align-items:center;gap:7px;margin-top:3px;">
                    <div class="hd-status-dot" id="hd-dot"></div>
                    <span id="hd-status-text" style="font-size:13px;font-weight:700;letter-spacing:2px;color:#555;">STANDBY</span>
                </div>
            </div>
            <button id="hd-toggle" class="hd-toggle-off tooltip" data-tooltip="Start or stop the HD Radio decoder"
                    style="border-radius:8px;border:1px solid #2244aa;padding:6px 13px;font-size:11px;font-weight:700;letter-spacing:1px;cursor:pointer;transition:all .2s;">ENABLE HD</button>
            <button id="hd-close-btn" style="background:transparent;border:none;color:#556;font-size:18px;cursor:pointer;padding:4px 6px;line-height:1;margin-left:2px;">✕</button>
        </div>

        <div class="hd-body">
            <div class="hd-prog-row">
                <span style="font-size:10px;letter-spacing:1px;color:#4466aa;align-self:center;margin-right:2px;white-space:nowrap;">PROGRAM</span>
                <button class="hd-prog-btn tooltip" data-p="0" data-tooltip="HD channel 1 (main program)">HD1</button>
                <button class="hd-prog-btn tooltip" data-p="1" data-tooltip="HD channel 2 (secondary program)">HD2</button>
                <button class="hd-prog-btn tooltip" data-p="2" data-tooltip="HD channel 3">HD3</button>
                <button class="hd-prog-btn tooltip" data-p="3" data-tooltip="HD channel 4">HD4</button>
            </div>

            <!-- Acquiring signal overlay (shown when enabled but not synced) -->
            <div id="hd-acquiring">
                <div class="hd-spinner" id="hd-acq-spinner"></div>
                <div class="hd-acq-label" id="hd-acq-label">Acquiring Signal</div>
                <div class="hd-acq-sub" id="hd-acq-sub">Searching for HD Radio…</div>
                <button id="hd-stay-fm" style="
                    display:none;margin-top:4px;
                    background:#0d1a10;color:#44aa66;
                    border:1px solid #1a5530;border-radius:8px;
                    padding:7px 18px;font-size:11px;font-weight:700;
                    letter-spacing:1px;cursor:pointer;
                ">▶ Stay on FM Analog</button>
            </div>

            <div class="hd-station-box">
                <div class="hd-station-name" id="hd-station-name">—</div>
                <div class="hd-slogan" id="hd-slogan"></div>
            </div>

            <div class="hd-nowplaying">
                <div class="hd-np-label">Now Playing</div>
                <div class="hd-title"  id="hd-title">—</div>
                <div class="hd-artist" id="hd-artist"></div>
                <div class="hd-album"  id="hd-album"></div>
            </div>

            <div class="hd-info-row">
                <div class="hd-info-cell">
                    <div class="hd-info-label">Genre</div>
                    <div class="hd-info-value" id="hd-genre">—</div>
                </div>
                <div class="hd-info-cell">
                    <div class="hd-info-label">Bit Rate</div>
                    <div class="hd-info-value" id="hd-bitrate">—</div>
                </div>
                <div class="hd-info-cell tooltip" data-tooltip="Adjust HD Radio audio output volume" style="flex:1.5;">
                    <div class="hd-info-label">HD Volume</div>
                    <input type="range" id="hd-volume" min="0" max="100" value="80">
                </div>
            </div>

            <!-- Airspy analog bandwidth: compact, live and independent from the HD IQ path -->
            <div id="hd-bandwidth-row" style="display:flex;align-items:center;gap:8px;background:rgba(5,10,35,.5);border:1px solid #161e40;border-radius:9px;padding:8px 10px;">
                <div style="font-size:9px;letter-spacing:1.5px;color:#3d4a70;text-transform:uppercase;white-space:nowrap;">FM Filter</div>
                <div style="display:flex;gap:5px;flex:1;min-width:0;">
                    <button class="hd-bw-btn tooltip" data-bw="190" data-tooltip="Normal 190 kHz: maximum stereo and RDS fidelity">NORMAL 190</button>
                    <button class="hd-bw-btn tooltip" data-bw="160" data-tooltip="DX 160 kHz: improved rejection of a strong station 200 kHz away">DX 160</button>
                    <button class="hd-bw-btn tooltip" data-bw="140" data-tooltip="DX 140 kHz: strongest adjacent-channel rejection; may reduce stereo fidelity">DX 140</button>
                </div>
                <span id="hd-bandwidth-status" style="font-size:9px;color:#557799;white-space:nowrap;">ANALOG</span>
            </div>
            <!-- SDR Gain row -->
            <div style="background:rgba(5,10,35,.5);border:1px solid #161e40;border-radius:9px;padding:10px 14px;">
                <div style="display:flex;align-items:center;gap:10px;">
                    <div style="font-size:9px;letter-spacing:2px;color:#3d4a70;text-transform:uppercase;white-space:nowrap;">SDR Gain</div>
                    <input type="range" id="hd-gain-slider" min="0" max="60" step="1" value="13"
                           style="flex:1;accent-color:#3366ee;">
                    <input type="number" id="hd-gain-num" min="0" max="60" value="13"
                           style="width:46px;background:#0a0e20;border:1px solid #2a3460;border-radius:5px;
                                  color:#88aaff;font-size:13px;font-weight:700;text-align:center;padding:3px 4px;">
                    <span style="font-size:11px;color:#556;white-space:nowrap;">dB</span>
                    <button id="hd-gain-apply" class="tooltip" data-tooltip="Apply this gain to the RTL-SDR — takes effect immediately"
                            style="background:#122060;color:#88aaff;border:1px solid #2244aa;
                            border-radius:6px;padding:4px 10px;font-size:11px;font-weight:700;cursor:pointer;
                            letter-spacing:1px;white-space:nowrap;">APPLY</button>
                    <button id="hd-auto-gain" class="tooltip" data-tooltip="Enable automatic gain control (AGC) — RTL-SDR sets gain automatically"
                            style="background:#0d1830;color:#6688aa;border:1px solid #223;
                            border-radius:6px;padding:4px 10px;font-size:11px;font-weight:700;cursor:pointer;
                            letter-spacing:1px;white-space:nowrap;transition:all .2s;">AUTO</button>
                </div>
                <div id="hd-gain-hint" style="font-size:10px;color:#33445a;margin-top:5px;">
                    RTL-SDR: 0–60 dB. HD Radio typically needs 35–50. No restart needed — changes live.
                </div>
            </div>

            <!-- Signal quality row -->
            <div class="hd-info-row" id="hd-signal-row" style="display:none;">
                <div class="hd-info-cell tooltip" data-tooltip="Modulation Error Ratio — lower sidebands. ≥ 5 dB needed for reliable HD audio.">
                    <div class="hd-info-label">MER Lower</div>
                    <div class="hd-info-value" id="hd-mer-lower">—</div>
                </div>
                <div class="hd-info-cell tooltip" data-tooltip="Modulation Error Ratio — upper sidebands. Higher = stronger HD signal.">
                    <div class="hd-info-label">MER Upper</div>
                    <div class="hd-info-value" id="hd-mer-upper">—</div>
                </div>
                <div class="hd-info-cell tooltip" data-tooltip="Bit Error Rate — current reading. Lower is better; 0.0000 = error-free.">
                    <div class="hd-info-label">BER (Now)</div>
                    <div class="hd-info-value" id="hd-ber-now">—</div>
                </div>
                <div class="hd-info-cell tooltip" data-tooltip="Bit Error Rate — rolling average. Used to detect gradual signal degradation.">
                    <div class="hd-info-label">BER (Avg)</div>
                    <div class="hd-info-value" id="hd-ber-avg">—</div>
                </div>
            </div>

            <!-- Station info (slogan, message, alert) — collapsible -->
            <div class="hd-debug-section" id="hd-stationinfo-section" style="display:none;">
                <div class="hd-debug-header" id="hd-stationinfo-toggle">
                    <span>📡 Station Info</span>
                    <span id="hd-stationinfo-arrow">▶</span>
                </div>
                <div class="hd-debug-body" id="hd-stationinfo-body">
                    <div style="font-size:11px;line-height:1.8;color:#7788aa;" id="hd-stationinfo-content">—</div>
                </div>
            </div>

            <!-- Enhanced metadata toggle + album art -->
            <div style="display:flex;align-items:center;gap:10px;padding:8px 12px;background:rgba(5,10,35,.4);border:1px solid #161e40;border-radius:9px;">
                <div style="flex:1;">
                    <div style="font-size:9px;letter-spacing:2px;color:#3d4a70;text-transform:uppercase;margin-bottom:2px;">Enhanced Metadata</div>
                    <div style="font-size:10px;color:#334;" id="hd-enhanced-desc">Disabled — using only data broadcast by the station</div>
                    <div style="font-size:9px;color:#2a3555;margin-top:3px;">Data: <a href="https://hddirectory.neocities.org/#" target="_blank" style="color:#3a5a8a;text-decoration:none;">HD Directory</a> · <a href="https://discord.com/invite/xfenDQp" target="_blank" style="color:#3a5a8a;text-decoration:none;">HD Radio Discord</a></div>
                </div>
                <button id="hd-enhanced-toggle" class="tooltip" data-tooltip="Fetch additional metadata from HD Directory: album art, program format, and more"
                        style="background:#122060;color:#88aaff;border:1px solid #2244aa;border-radius:6px;padding:5px 12px;font-size:11px;font-weight:700;cursor:pointer;letter-spacing:1px;transition:all .2s;">ON</button>
            </div>

            <!-- Force HD audio toggle -->
            <div style="display:flex;align-items:center;gap:10px;padding:8px 12px;background:rgba(5,10,35,.4);border:1px solid #161e40;border-radius:9px;">
                <div style="flex:1;">
                    <div style="font-size:9px;letter-spacing:2px;color:#3d4a70;text-transform:uppercase;margin-bottom:2px;">Force HD Audio</div>
                    <div style="font-size:10px;color:#334;" id="hd-force-audio-desc">Only switches to HD audio when MER ≥ 5 dB</div>
                </div>
                <button id="hd-force-audio-toggle" class="tooltip" data-tooltip="When ON: always switches to HD audio regardless of signal quality. When OFF: only switches at MER ≥ 5 dB."
                        style="background:#1a1a1a;color:#556;border:1px solid #333;border-radius:6px;padding:5px 12px;font-size:11px;font-weight:700;cursor:pointer;letter-spacing:1px;transition:all .2s;">OFF</button>
            </div>

            <!-- Album art (shown when enhanced meta finds iTunes artwork) -->
            <div id="hd-albumart-row" style="display:none;align-items:center;gap:12px;padding:10px 12px;background:rgba(5,10,35,.4);border:1px solid #161e40;border-radius:9px;">
                <img id="hd-albumart-thumb" src="" alt="Album Art"
                     class="tooltip" data-tooltip="Click to view full-size album art"
                     style="width:56px;height:56px;border-radius:6px;object-fit:cover;cursor:pointer;flex-shrink:0;">
                <div style="flex:1;min-width:0;">
                    <div style="font-size:9px;letter-spacing:2px;color:#3d4a70;text-transform:uppercase;margin-bottom:3px;">Album Art · Internet (iTunes)</div>
                    <div id="hd-albumart-label" style="font-size:11px;color:#8899cc;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">—</div>
                </div>
            </div>

            <!-- LOT Data viewer -->
            <div class="hd-debug-section" id="hd-lot-section">
                <div class="hd-debug-header" id="hd-lot-toggle">
                    <span>🗂 LOT Data<span id="hd-lot-badge" style="color:#4488ff;display:none;"></span></span>
                    <span id="hd-lot-arrow">▶</span>
                </div>
                <div class="hd-debug-body" id="hd-lot-body">
                    <div style="font-size:9px;color:#334;letter-spacing:1px;margin-bottom:8px;">Images and data files broadcast by the station via HD Radio LOT service.</div>
                    <div id="hd-lot-grid" style="display:flex;flex-wrap:wrap;gap:10px;align-items:flex-start;">
                        <div style="font-size:11px;color:#334;padding:8px 0;">No LOT data received on this station yet.</div>
                    </div>
                </div>
            </div>

            <!-- HD Scan -->
            <div class="hd-debug-section" id="hd-scan-section">
                <div class="hd-debug-header" id="hd-scan-toggle">
                    <span>Band Scan</span>
                    <span id="hd-scan-arrow">▶</span>
                </div>
                <div class="hd-debug-body" id="hd-scan-body">
                    <div style="font-size:10px;color:#3a4a6a;margin-bottom:10px;line-height:1.6;">
                        Steps through the FM band and logs stations with active HD Radio signals. Takes 1–2 minutes. HD audio pauses during scan.
                    </div>
                    <div style="display:flex;align-items:center;gap:8px;margin-bottom:10px;">
                        <button id="hd-scan-btn" class="tooltip" data-tooltip="Scan the FM band for HD Radio stations"
                                style="background:#0d1a30;color:#4488ff;border:1px solid #1e3a7a;border-radius:7px;
                                       padding:6px 16px;font-size:11px;font-weight:700;cursor:pointer;">
                            Scan Band
                        </button>
                        <button id="hd-scan-stop-btn" class="tooltip" data-tooltip="Stop the current scan"
                                style="display:none;background:#1a0d0d;color:#ff4444;border:1px solid #5a1a1a;
                                       border-radius:7px;padding:6px 14px;font-size:11px;font-weight:700;cursor:pointer;">
                            Stop
                        </button>
                        <span id="hd-scan-freq-label" style="font-size:11px;color:#3a4a6a;display:none;"></span>
                    </div>
                    <div id="hd-scan-progress-wrap" style="display:none;margin-bottom:10px;">
                        <div style="background:#0a0e20;border-radius:4px;height:5px;overflow:hidden;">
                            <div id="hd-scan-bar" style="height:100%;width:0%;background:linear-gradient(90deg,#1e3a7a,#4488ff);transition:width .25s;"></div>
                        </div>
                    </div>
                    <div id="hd-scan-results" style="display:flex;flex-direction:column;gap:5px;"></div>
                </div>
            </div>

            <!-- Debug panel -->
            <div class="hd-debug-section">
                <div class="hd-debug-header" id="hd-debug-toggle">
                    <span>⚙ Debug</span>
                    <span id="hd-debug-arrow">▶</span>
                </div>
                <div class="hd-debug-body" id="hd-debug-body">
                    <!-- Signal quality widget -->
                    <div id="hd-sig-quality">
                        <div class="hd-sig-bars" id="hd-sig-bars">
                            <div class="hd-sig-bar" style="height:6px;"></div>
                            <div class="hd-sig-bar" style="height:10px;"></div>
                            <div class="hd-sig-bar" style="height:14px;"></div>
                            <div class="hd-sig-bar" style="height:18px;"></div>
                        </div>
                        <div>
                            <div class="hd-sig-label" id="hd-sig-label" style="color:#444;">NO SIGNAL</div>
                            <div style="font-size:9px;color:#333;letter-spacing:1px;" id="hd-sig-detail">MER — BER —</div>
                        </div>
                    </div>
                    <pre id="hd-debug-stats"></pre>
                    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:4px;">
                        <span style="font-size:9px;letter-spacing:2px;color:#334;text-transform:uppercase;">nrsc5 log</span>
                        <div style="display:flex;gap:4px;">
                            <button id="hd-debug-copy" style="background:#0a1020;color:#445;border:1px solid #1a2040;border-radius:5px;padding:2px 8px;font-size:9px;cursor:pointer;letter-spacing:1px;">COPY</button>
                            <button id="hd-debug-clear" style="background:#0a1020;color:#445;border:1px solid #1a2040;border-radius:5px;padding:2px 8px;font-size:9px;cursor:pointer;letter-spacing:1px;">CLEAR</button>
                        </div>
                    </div>
                    <pre id="hd-debug-log">(no output yet)</pre>
                </div>
            </div>
        </div>

        <!-- Footer credit -->
        <div class="hd-footer" style="display:flex;flex-direction:column;gap:5px;padding:9px 14px;border-top:1px solid #111830;">
            <div style="display:flex;align-items:center;gap:10px;">
                <a href="https://discord.com/invite/ZT6YXQaw5F" target="_blank" rel="noopener"
                   class="tooltip" data-tooltip="Join the HD Radio Discord server"
                   style="display:flex;align-items:center;gap:6px;flex-shrink:0;text-decoration:none;">
                    <i class="fa-brands fa-discord" style="font-size:18px;color:#5865F2;opacity:.9;"></i>
                    <span style="font-size:10px;color:#5865F2;opacity:.85;letter-spacing:.4px;">Created by seehed on Discord</span>
                </a>
                <span style="font-size:10px;color:#2a3550;letter-spacing:.3px;flex:1;">·
                    <a href="https://discord.gg/Ra3zeQW26d" target="_blank" rel="noopener" style="text-decoration:none;display:inline-flex;align-items:center;gap:4px;vertical-align:middle;">
                        <img src="https://i.typicalmedia.net/_astera/_logo.png" style="height:20px;border-radius:2px;opacity:.85;vertical-align:middle;" alt="Astera">
                        <span style="color:#7a8faa;font-size:10px;">High Rank Support</span>
                    </a>
                </span>
                <div id="hd-grip" class="tooltip" data-tooltip="Drag to resize panel"
                     style="color:#2a3a60;font-size:14px;line-height:1;cursor:nwse-resize;flex-shrink:0;">⌟</div>
            </div>
            <div id="hd-footer-update" style="display:none;align-items:center;"></div>
        </div>
    `;

    document.body.appendChild(dash);

    // Register tooltips on all .tooltip elements inside the panel
    if (typeof initTooltips === 'function') initTooltips('#hd-dash .tooltip');

    // ── Drag & Resize ──
    makeDraggable(dash, document.getElementById('hd-titlebar'));
    makeResizable(dash, document.getElementById('hd-grip'));

    // ── Events ──
    document.getElementById('hd-close-btn').addEventListener('click', () => { dash.style.display = 'none'; });

    document.getElementById('hd-toggle').addEventListener('click', () => { if (hdEnabled) disableHD(); else enableHD(); });

    document.getElementById('hd-stay-fm').addEventListener('click', () => {
        log('User chose to stay on FM analog — disabling HD decoder');
        disableHD();
    });

    // LOT data collapsible
    document.getElementById('hd-lot-toggle').addEventListener('click', () => {
        const body  = document.getElementById('hd-lot-body');
        const arrow = document.getElementById('hd-lot-arrow');
        const hdr   = document.getElementById('hd-lot-toggle');
        const open  = body.classList.toggle('open');
        arrow.textContent = open ? '▼' : '▶';
        hdr.classList.toggle('open', open);
    });

    // HD Scan collapsible
    document.getElementById('hd-scan-toggle').addEventListener('click', () => {
        const body  = document.getElementById('hd-scan-body');
        const arrow = document.getElementById('hd-scan-arrow');
        const hdr   = document.getElementById('hd-scan-toggle');
        const open  = body.classList.toggle('open');
        arrow.textContent = open ? '▼' : '▶';
        hdr.classList.toggle('open', open);
    });

    // HD Scan start/stop buttons
    document.getElementById('hd-scan-btn').addEventListener('click', () => {
        send('hd-scan-start', { start: 87.9, end: 107.9, step: 0.2, sigWin: 500, synWin: 1500 });
    });
    document.getElementById('hd-scan-stop-btn').addEventListener('click', () => {
        send('hd-scan-stop', {});
    });

    // Station info collapsible
    document.getElementById('hd-stationinfo-toggle').addEventListener('click', () => {
        const body  = document.getElementById('hd-stationinfo-body');
        const arrow = document.getElementById('hd-stationinfo-arrow');
        const hdr   = document.getElementById('hd-stationinfo-toggle');
        const open  = body.classList.toggle('open');
        arrow.textContent = open ? '▼' : '▶';
        hdr.classList.toggle('open', open);
    });

    // Force HD audio toggle — sends to server so all users share the same state
    document.getElementById('hd-force-audio-toggle').addEventListener('click', () => {
        send('hd-radio-force-audio', { enabled: !forceHdAudio });
    });

    // Enhanced metadata toggle
    document.getElementById('hd-enhanced-toggle').addEventListener('click', () => {
        const enabled = document.getElementById('hd-enhanced-toggle').textContent !== 'ON';
        send('hd-radio-enhanced-meta', { enabled });
        log('Enhanced metadata:', enabled ? 'enabled' : 'disabled');
    });

    // Album art enlarge on click
    document.getElementById('hd-albumart-thumb').addEventListener('click', () => {
        const src = document.getElementById('hd-albumart-thumb').src;
        if (!src) return;
        const overlay = document.createElement('div');
        overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.85);z-index:99999;display:flex;align-items:center;justify-content:center;cursor:pointer;';
        overlay.innerHTML = `<img src="${src}" style="max-width:90vw;max-height:90vh;border-radius:12px;box-shadow:0 0 60px rgba(0,0,0,.8);">`;
        overlay.onclick = () => overlay.remove();
        document.body.appendChild(overlay);
    });

    dash.querySelectorAll('.hd-prog-btn').forEach(btn => {
        btn.addEventListener('click', () => setProgram(parseInt(btn.dataset.p)));
    });

    document.getElementById('hd-volume').addEventListener('input', e => {
        if (gainNode) gainNode.gain.value = e.target.value / 100;
    });

    // Gain slider ↔ number input sync
    // Airspy analog filter modes. The native capture changes coefficients live;
    // raw IQ for NRSC-5 remains untouched, so HD audio and metadata are unaffected.
    dash.querySelectorAll('.hd-bw-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const bandwidthKhz = Number(btn.dataset.bw);
            if (![140, 160, 190].includes(bandwidthKhz)) return;
            analogBandwidthKhz = bandwidthKhz;
            send('hd-radio-bandwidth', { bandwidthKhz });
            refreshDash();
        });
    });
    const gainSlider = document.getElementById('hd-gain-slider');
    const gainNum    = document.getElementById('hd-gain-num');
    gainSlider.addEventListener('input', () => { gainNum.value = gainSlider.value; });
    gainNum.addEventListener('input',   () => {
        const v = Math.max(0, Math.min(50, parseInt(gainNum.value) || 0));
        gainSlider.value = v;
        gainNum.value    = v;
    });

    document.getElementById('hd-gain-apply').addEventListener('click', () => {
        const gain = parseInt(gainSlider.value);
        const hint = document.getElementById('hd-gain-hint');
        const autoBtn = document.getElementById('hd-auto-gain');
        log('Setting gain to', gain, 'dB');
        send('hd-radio-gain', { gain });
        if (autoBtn) { autoBtn.style.background = '#0d1830'; autoBtn.style.color = '#6688aa'; }
        hint.textContent = `Gain set to ${gain} dB — applying live.`;
        hint.style.color = '#557755';
        setTimeout(() => {
            hint.textContent = 'RTL-SDR: 0–60 dB. HD Radio typically needs 35–50. No restart needed — changes live.';
            hint.style.color = '';
        }, 3000);
    });

    document.getElementById('hd-auto-gain').addEventListener('click', () => {
        const hint    = document.getElementById('hd-gain-hint');
        const autoBtn = document.getElementById('hd-auto-gain');
        log('Auto gain enabled');
        send('hd-radio-auto-gain', {});
        autoBtn.style.background = '#163060';
        autoBtn.style.color      = '#88ccff';
        autoBtn.style.borderColor = '#3366cc';
        hint.textContent = 'Auto gain enabled — RTL-SDR will adjust automatically.';
        hint.style.color = '#557799';
        setTimeout(() => {
            hint.textContent = 'RTL-SDR: 0–60 dB. HD Radio typically needs 35–50. No restart needed — changes live.';
            hint.style.color = '';
        }, 4000);
    });

    document.getElementById('hd-debug-toggle').addEventListener('click', () => {
        debugOpen = !debugOpen;
        const body  = document.getElementById('hd-debug-body');
        const arrow = document.getElementById('hd-debug-arrow');
        const hdr   = document.getElementById('hd-debug-toggle');
        body.classList.toggle('open', debugOpen);
        hdr.classList.toggle('open', debugOpen);
        arrow.textContent = debugOpen ? '▼' : '▶';
        if (debugOpen) refreshDebug();
    });

    document.getElementById('hd-debug-clear').addEventListener('click', () => {
        debugLog.length = 0;
        const box = document.getElementById('hd-debug-log');
        if (box) box.textContent = '(cleared)';
    });

    document.getElementById('hd-debug-copy').addEventListener('click', async () => {
        const btn = document.getElementById('hd-debug-copy');
        const text = debugLog.join('\n');
        try {
            await navigator.clipboard.writeText(text);
            if (btn) { btn.textContent = 'COPIED!'; setTimeout(() => { btn.textContent = 'COPY'; }, 1500); }
        } catch (_) {
            // Fallback: select the pre element
            const box = document.getElementById('hd-debug-log');
            if (box) { const sel = window.getSelection(); const range = document.createRange(); range.selectNode(box); sel.removeAllRanges(); sel.addRange(range); }
        }
    });

    // Close on outside click — bubble phase only so drag's stopPropagation works
    document.addEventListener('click', e => {
        const d = document.getElementById('hd-dash');
        const b = document.getElementById('hd-radio-btn');
        const inline = document.getElementById('hd-inline-icon');
        if (!d || d.style.display === 'none') return;
        if (!d.contains(e.target) && !b?.contains(e.target) && !inline?.contains(e.target)) d.style.display = 'none';
    }, false);  // false = bubble, not capture — drag mousedown stopPropagation won't interfere
}

function toggleDash() {
    const dash = document.getElementById('hd-dash');
    if (!dash) return;
    const opening = dash.style.display === 'none' || !dash.style.display;
    dash.style.display = opening ? 'flex' : 'none';
    if (opening) { refreshDash(); if (debugOpen) refreshDebug(); }
}

// ─── Dashboard refresh ────────────────────────────────────────────────────────

function g(id) { return document.getElementById(id); }
function setText(id, val) { const el = g(id); if (el) el.textContent = val || ''; }

function refreshDash() {
    const dash = g('hd-dash');
    if (!dash || dash.style.display === 'none') return;

    refreshSignalQuality();
    refreshSignalOverlay();
    const dot = g('hd-dot'), txt = g('hd-status-text'), tog = g('hd-toggle');

    if (dot && txt) {
        if (!hdEnabled) {
            dot.style.background = '#444';    txt.textContent = 'STANDBY';   txt.style.color = '#556';
        } else if (!hdSignalDetected) {
            dot.style.background = '#2a7a4a'; txt.textContent = 'FM ANALOG'; txt.style.color = '#55bb77';
        } else if (!synchronized && hdWasSynced) {
            dot.style.background = '#cc7722'; txt.textContent = 'SIGNAL LOST';   txt.style.color = '#cc7722';
        } else if (!synchronized) {
            dot.style.background = noSignal ? '#443322'   : '#3366ff';
            txt.textContent      = noSignal ? 'NO SIGNAL' : 'ACQUIRING…';
            txt.style.color      = noSignal ? '#665544'   : '#4488ff';
        } else {
            dot.style.background = '#00dd66'; txt.textContent = 'HD LOCKED'; txt.style.color = '#00dd66';
        }
    }

    if (tog)  { tog.textContent = hdEnabled ? 'HD RADIO OFF' : 'HD AUTO'; tog.className = hdEnabled ? 'hd-toggle-on' : 'hd-toggle-off'; }

    const bandwidthRow = g('hd-bandwidth-row');
    if (bandwidthRow) bandwidthRow.style.display = receiverType === 'airspyhf' ? 'flex' : 'none';
    document.querySelectorAll('#hd-dash .hd-bw-btn').forEach(btn => {
        const active = Number(btn.dataset.bw) === analogBandwidthKhz;
        btn.classList.toggle('active', active);
        btn.setAttribute('aria-pressed', active ? 'true' : 'false');
    });
    const bandwidthStatus = g('hd-bandwidth-status');
    if (bandwidthStatus) bandwidthStatus.textContent = analogBandwidthKhz === 190 ? 'FIDELITY' : 'ANALOG DX';
    const enhBtn  = g('hd-enhanced-toggle');
    const enhDesc = g('hd-enhanced-desc');
    if (enhBtn) {
        enhBtn.textContent  = enhancedMeta ? 'ON' : 'OFF';
        enhBtn.style.background   = enhancedMeta ? '#163060' : '#1a1a1a';
        enhBtn.style.color        = enhancedMeta ? '#88ccff' : '#556';
        enhBtn.style.borderColor  = enhancedMeta ? '#3366cc' : '#333';
    }
    if (enhDesc) enhDesc.textContent = enhancedMeta
        ? 'HD Directory genre lookup + internet album art (iTunes, only if station sends none)'
        : 'Disabled — using only data broadcast by the station';

    const forceBtn  = g('hd-force-audio-toggle');
    const forceDesc = g('hd-force-audio-desc');
    if (forceBtn) {
        forceBtn.textContent        = forceHdAudio ? 'ON'      : 'OFF';
        forceBtn.style.background   = forceHdAudio ? '#2a0a0a' : '#1a1a1a';
        forceBtn.style.color        = forceHdAudio ? '#ff6644' : '#556';
        forceBtn.style.borderColor  = forceHdAudio ? '#aa3322' : '#333';
    }
    if (forceDesc) forceDesc.textContent = forceHdAudio
        ? 'Always switches to HD audio regardless of MER'
        : 'Only switches to HD audio when MER ≥ 5 dB';

    const _fmtCount2 = meta.hdFormats ? meta.hdFormats.filter(Boolean).length : 0;
    const _numProgs  = Math.max(
        meta.numPrograms || 1,
        (enhancedMeta || forceHdAudio) ? _fmtCount2 : 0
    );
    const _merWeak  = synchronized && meta.merLower !== null && meta.merLower !== undefined
                      && meta.merLower < 5;
    dash.querySelectorAll('.hd-prog-btn').forEach(b => {
        const p = parseInt(b.dataset.p);
        const unlocked = synchronized || forceHdAudio;
        const knownPrograms = Array.isArray(meta.availablePrograms) ? meta.availablePrograms : [];
        const known = knownPrograms.includes(p) || p < _numProgs;
        b.classList.toggle('active', p === currentProg && unlocked);
        // Some stations announce SIS/SIG late; keep HD1-HD4 selectable while RF is locked.
        b.disabled = !unlocked;
        b.style.opacity = !unlocked ? '0.2' : (known ? '' : '0.65');
    });

    // Acquiring overlay — three distinct states
    const acqEl      = g('hd-acquiring');
    const acqLbl     = g('hd-acq-label');
    const acqSub     = g('hd-acq-sub');
    const acqSpinner = g('hd-acq-spinner');
    const stayFmBtn  = g('hd-stay-fm');

    const showAcq = hdEnabled && !synchronized && hdSignalDetected;
    if (acqEl) acqEl.style.display = showAcq ? 'flex' : 'none';

    if (showAcq && acqLbl && acqSub) {
        if (hdWasSynced) {
            // ── Signal dropped mid-listen ─────────────────────────────────
            acqLbl.textContent  = 'Signal Lost';
            acqLbl.style.color  = '#cc7722';
            acqSub.textContent  = `FM analog playing — HD${currentProg + 1} signal dropped`;
            acqSub.style.color  = '#557755';
            if (acqSpinner) { acqSpinner.style.borderTopColor = '#cc7722'; }
            if (stayFmBtn)    stayFmBtn.style.display = 'block';
        } else if (noSignal) {
            // ── No HD Radio on this frequency at all ──────────────────────
            acqLbl.textContent  = 'No HD Signal';
            acqLbl.style.color  = '#665544';
            acqSub.textContent  = `${meta.freq ? meta.freq + ' MHz' : 'This station'} does not carry HD Radio`;
            acqSub.style.color  = '';
            if (acqSpinner) acqSpinner.style.display = 'none';
            if (stayFmBtn)  stayFmBtn.style.display  = 'none';
        } else {
            // ── Initial acquisition (first lock attempt) ──────────────────
            acqLbl.textContent  = `Acquiring HD${currentProg + 1} Signal`;
            acqLbl.style.color  = '#6688cc';
            acqSub.textContent  = meta.stationName
                ? `Found ${meta.stationName} — locking on audio…`
                : `Scanning ${meta.freq ? meta.freq + ' MHz' : ''}…`;
            acqSub.style.color  = '';
            if (acqSpinner) { acqSpinner.style.display = ''; acqSpinner.style.borderTopColor = '#4488ff'; }
            if (stayFmBtn)  stayFmBtn.style.display = 'none';
        }
    }

    // Hide metadata sections while acquiring, show when locked
    const stationBox  = dash.querySelector('.hd-station-box');
    const nowPlaying  = dash.querySelector('.hd-nowplaying');
    const infoRow     = dash.querySelector('.hd-info-row');
    if (stationBox) stationBox.style.display = synchronized ? '' : 'none';
    if (nowPlaying)  nowPlaying.style.display  = synchronized ? '' : 'none';
    if (infoRow)     infoRow.style.display     = synchronized ? 'flex' : 'none';

    setText('hd-station-name', meta.stationName || '—');
    setText('hd-slogan',       meta.slogan  || '');
    setText('hd-title',        meta.title   || '—');
    setText('hd-artist',       meta.artist  || '');
    setText('hd-album',        meta.album   || '');
    const _rawFmt  = (enhancedMeta && meta.hdFormats && meta.hdFormats[currentProg]) || '';
    const _cleanFmt = normPty(_rawFmt ? _rawFmt.replace(/"[^"]*"/g, '').replace(/\s+/g, ' ').trim() : '');
    setText('hd-genre', _cleanFmt || normPty(meta.genre) || '—');
    setText('hd-bitrate',      meta.bitRate || '—');

    // Signal quality row — show only when we have data
    const sigRow = g('hd-signal-row');
    if (sigRow) sigRow.style.display = (meta.merLower !== null) ? 'flex' : 'none';
    setText('hd-mer-lower', meta.merLower !== null ? `${meta.merLower} dB` : '—');
    setText('hd-mer-upper', meta.merUpper !== null ? `${meta.merUpper} dB` : '—');
    setText('hd-ber-now',   meta.berNow   !== null ? `${meta.berNow}%`    : '—');
    setText('hd-ber-avg',   meta.berAvg   !== null ? `${meta.berAvg}%`    : '—');

    // Sync gain slider with server's reported value (auto gain may have changed it)
    if (meta.gain !== undefined) {
        const s = g('hd-gain-slider'), n = g('hd-gain-num');
        if (s) s.value = meta.gain;
        if (n) n.value = meta.gain;
    }
    const autoBtn = g('hd-auto-gain');
    if (autoBtn && meta.autoGain !== undefined) {
        autoBtn.style.background  = meta.autoGain ? '#163060' : '#0d1830';
        autoBtn.style.color       = meta.autoGain ? '#88ccff' : '#6688aa';
        autoBtn.style.borderColor = meta.autoGain ? '#3366cc' : '#223';
    }
}

// ─── Boot ─────────────────────────────────────────────────────────────────────

function playBlockBeep() {
    try {
        const ctx = new AudioContext();
        const osc = ctx.createOscillator();
        const g   = ctx.createGain();
        osc.type = 'sine';
        osc.frequency.value = 960;
        g.gain.setValueAtTime(0.18, ctx.currentTime);
        g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.14);
        osc.connect(g);
        g.connect(ctx.destination);
        osc.start();
        osc.stop(ctx.currentTime + 0.14);
        setTimeout(() => ctx.close(), 500);
    } catch (_) {}
}

// ─── Tune button HD subchannel intercept ──────────────────────────────────────
// When HD is locked and there are multiple subchannels, the tune up/down buttons
// step through subchannels first (like a car radio) instead of changing frequency.
// When already on the last/first subchannel the event passes through normally.
function interceptTuneButtons() {
    const up   = document.getElementById('freq-up');
    const down = document.getElementById('freq-down');
    if (!up || !down) return;

    const _hdStep = (e, dir) => {
        if (!synchronized) return false;
        const fmtCount = meta.hdFormats ? meta.hdFormats.filter(Boolean).length : 0;
        const numProgs = Math.max(meta.numPrograms || 1, (enhancedMeta || forceHdAudio) ? fmtCount : 0);
        if (dir > 0 && currentProg < numProgs - 1) {
            e.stopImmediatePropagation();
            setProgram(currentProg + 1);
            return true;
        }
        if (dir < 0 && currentProg > 0) {
            e.stopImmediatePropagation();
            setProgram(currentProg - 1);
            return true;
        }
        return false; // pass through
    };

    up.addEventListener('click',   e => _hdStep(e,  1), true);
    down.addEventListener('click', e => _hdStep(e, -1), true);

    // Arrow keys — same logic (main server binds ArrowLeft/ArrowRight to tune)
    document.addEventListener('keydown', e => {
        if (e.target.matches('input, textarea, select')) return;
        if (e.key === 'ArrowRight') _hdStep(e,  1);
        if (e.key === 'ArrowLeft')  _hdStep(e, -1);
    }, true);
}

document.addEventListener('DOMContentLoaded', () => {
    installGlobalStreamMute();
    buildDashboard();
    addPanelButton();
    addInlineHdIndicator();
    setupSignalOverlay();
    refreshPortableRfReadout();
    setInterval(refreshPortableRfReadout, 500);
    connectPlugin();
    refreshIcon();
    checkUpdate();

    // ── Panel scroll fix ──────────────────────────────────────────────────────
    // #hd-dash is now the scroll container (overflow-y: auto, sticky header/footer).
    // We still need to intercept wheel in capture phase so other page handlers
    // (SpectrumGraph, main page) don't consume it first.
    // Inner scrollables (e.g. debug log <pre>) are detected and scrolled directly.
    const dash = document.getElementById('hd-dash');
    if (dash) {
        dash.addEventListener('wheel', (e) => {
            // Walk up from target to find an inner scrollable (not dash itself)
            let inner = null;
            let el = e.target;
            while (el && el !== dash) {
                const oy = getComputedStyle(el).overflowY;
                if ((oy === 'auto' || oy === 'scroll') && el.scrollHeight > el.clientHeight) {
                    inner = el;
                    break;
                }
                el = el.parentElement;
            }

            e.preventDefault();
            e.stopPropagation();
            if (inner) {
                inner.scrollTop += e.deltaY;
            } else {
                dash.scrollTop += e.deltaY;
            }
        }, { passive: false, capture: true });
    }

    // Watch #data-frequency — when the main webserver tunes away, clear HD UI immediately
    // without waiting for the next hd-radio-meta from the plugin socket.
    const freqEl = document.getElementById('data-frequency');
    if (freqEl) {
        let _lastSeenFreq = freqEl.textContent.trim();
        new MutationObserver(() => {
            const nowFreq = freqEl.textContent.trim();
            if (nowFreq !== _lastSeenFreq) {
                _lastSeenFreq = nowFreq;
                log('Frequency changed in DOM — resetting receiver state and resuming FM');
                // Run for every tune, including analog-to-analog changes. This mirrors the
                // manual Stop/Play recovery without requiring user interaction.
                synchronized = false;
                hdAudioReady = false;
                hdSignalDetected = false;
                noSignal = false;
                _clearNoSigTimer();
                disconnectAudio();
                unmuteFM();
                restoreRdsArea();
                restartFmStreamAfterTune();
                refreshInlineHD();
                refreshDash();
            }
        }).observe(freqEl, { childList: true, characterData: true, subtree: true });
    }

    // Patch createStream so new users who join while HD is locked get muted immediately.
    // Without this, createStream() sets Stream.Volume to the slider value, overriding any mute.
    if (typeof createStream === 'function' && !window._hdPatchedCreateStream) {
        window._hdPatchedCreateStream = true;
        const _origCreate = window.createStream;
        window.createStream = function() {
            _origCreate.apply(this, arguments);
            if (!hdEnabled || !synchronized) return;

            // Stream just started. If HD audio hasn't been initialized yet
            // (client joined after lock, or autoplay was deferred), start it now.
            if (!audioCtx) {
                logAu('createStream intercepted — initialising HD audio for new listener');
                initAudio();
                connectAudio();
                // FM stays playing until pre-buffer is ready
                setTimeout(tryBridgeAudioMetrix, 500);
                return;
            }

            // Audio already running — global mute guard handles FM blocking via prototype setter
            logAu('createStream intercepted — HD active, global mute guard will handle volume');
        };
    }

    // Hook play/pause button to also control HD audio
    const playBtn = document.querySelector('.playbutton');
    if (playBtn) {
        playBtn.addEventListener('click', () => {
            // Run after main.js OnPlayButtonClick has modified Stream
            setTimeout(() => {
                const fmNowPlaying = typeof Stream !== 'undefined' && Stream !== null;
                if (!fmNowPlaying) {
                    log('FM stopped via play button — pausing HD audio output');
                    if (bgAudioEl) bgAudioEl.pause();
                    unmuteFM();
                } else {
                    log('FM started via play button — resuming HD audio');
                    if (hdEnabled && synchronized && hdAudioReady && bgAudioEl) {
                        bgAudioEl.play().catch(() => {});
                        muteFM();
                    }
                }
            }, 200);
        });
    }

    // Block FM volume slider only when HD audio is actually playing (hdAudioReady).
    // While HD audio is playing, route the main volume slider to the HD gain node
    // instead of blocking it. FM stays muted; slider controls HD audio level.
    // When HD is not active the slider works normally for FM.
    const volSlider = document.getElementById('volumeSlider');
    if (volSlider) {
        volSlider.addEventListener('input', e => {
            if (hdEnabled && synchronized && hdAudioReady) {
                // Keep FM muted
                if (typeof Stream !== 'undefined' && Stream) Stream.Volume = 0;
                // Map slider (0–1 or 0–100) to HD gain (0–1)
                const raw = parseFloat(e.target.value);
                const gain = raw > 1 ? raw / 100 : raw;
                if (gainNode) gainNode.gain.value = gain;
                // Sync the in-panel HD volume slider so they stay in agreement
                const hdVol = document.getElementById('hd-volume');
                if (hdVol) hdVol.value = Math.round(gain * 100);
            }
        }, true /* capture */);
    }
});

})();
