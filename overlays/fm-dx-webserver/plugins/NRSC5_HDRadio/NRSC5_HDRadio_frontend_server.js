/*
    HD Radio (NRSC-5) Plugin v1.3.1 — Server
    Uses libnrsc5 via Python bridge (hd_bridge.py) instead of the CLI binary.
    Audio arrives as raw PCM s16le, 44100 Hz stereo — no WAV header stripping.
    Gain, frequency, and program can all change live without restarting the bridge.
*/

'use strict';

const pluginName = 'HD Radio (NRSC-5)';

const fs      = require('fs');
const path    = require('path');
const https   = require('https');
const http    = require('http');
const { spawn } = require('child_process');
const WebSocket = require('ws');
const spectrumAnalyzer = require('./spectrum_analyzer');

// ── HD Radio station directory ─────────────────────────────────────────────────
const HD_DIR_URL   = 'https://docs.google.com/spreadsheets/d/e/2PACX-1vSsAfMH7UC0gdFImE4Iz1ZRpDzdMF82_o6J3Jl5BIKyJHFz6ujiFDOW-HUYJDt4xb5tEHPoz4irCqhd/pub?gid=884934860&single=true&output=csv';
const HD_DIR_CACHE = path.join(__dirname, '.hd_directory_cache.json');
let hdDirectory    = [];   // [{freq, callsign, stationName, formats: ['HD1 name','HD2 name',...]}]

function parseCSVLine(line) {
    const fields = [];
    let cur = '', inQ = false;
    for (let i = 0; i < line.length; i++) {
        const c = line[i];
        if (c === '"') {
            if (inQ && line[i + 1] === '"') { cur += '"'; i++; }
            else inQ = !inQ;
        } else if (c === ',' && !inQ) { fields.push(cur); cur = ''; }
        else cur += c;
    }
    fields.push(cur);
    return fields;
}

function fetchWithRedirects(url, remaining = 5) {
    return new Promise((resolve, reject) => {
        if (!remaining) return reject(new Error('Too many redirects'));
        const mod = url.startsWith('https') ? https : http;
        mod.get(url, { headers: { 'User-Agent': 'fmdx-hd-plugin/1.0' } }, res => {
            if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
                resolve(fetchWithRedirects(res.headers.location, remaining - 1));
                res.resume();
                return;
            }
            let data = '';
            res.on('data', d => data += d);
            res.on('end', () => resolve(data));
            res.on('error', reject);
        }).on('error', reject);
    });
}

function buildFormatLabel(rawFormat) {
    if (!rawFormat || rawFormat.trim() === '' || /^silent$/i.test(rawFormat.trim())) return null;
    // Strip outer quotes left by CSV double-quote escaping
    const m = rawFormat.match(/^"(.+)"$/) || rawFormat.match(/^(.+)$/);
    return m ? m[1].trim() : rawFormat.trim();
}

async function loadHdDirectory() {
    // Try cache first (good for 24h)
    try {
        if (fs.existsSync(HD_DIR_CACHE)) {
            const { ts, data } = JSON.parse(fs.readFileSync(HD_DIR_CACHE, 'utf8'));
            if (Date.now() - ts < 86400000) {
                hdDirectory = data;
                logInfo(`HD-Dir: loaded ${hdDirectory.length} stations from cache`);
                return;
            }
        }
    } catch (_) {}

    logInfo('HD-Dir: fetching station directory…');
    try {
        const csv = await fetchWithRedirects(HD_DIR_URL);
        const lines = csv.split('\n').filter(l => l.trim());
        if (!lines.length) throw new Error('empty response');

        const headers = parseCSVLine(lines[0]);
        const col = n => headers.indexOf(n);
        const iFreq = col('freq'), iCall = col('callsign'), iName = col('stationName');
        const iFmts = [col('HD1format'), col('HD2format'), col('HD3format'), col('HD4format'), col('HD5format')];

        hdDirectory = [];
        for (let i = 1; i < lines.length; i++) {
            const f = parseCSVLine(lines[i]);
            const freq = parseFloat(f[iFreq]);
            if (isNaN(freq)) continue;
            hdDirectory.push({
                freq,
                callsign:    (f[iCall]  || '').trim().toUpperCase(),
                stationName: (f[iName]  || '').trim(),
                formats:     iFmts.map(ci => buildFormatLabel(f[ci] || ''))
            });
        }

        fs.writeFileSync(HD_DIR_CACHE, JSON.stringify({ ts: Date.now(), data: hdDirectory }));
        logInfo(`HD-Dir: loaded ${hdDirectory.length} stations`);
    } catch (e) {
        logWarn(`HD-Dir: fetch failed (${e.message}) — directory lookup unavailable`);
    }
}

function lookupStation(freq, callsign) {
    const f = Math.round(freq * 10) / 10;
    // Match by freq first, then prefer callsign match
    const byFreq = hdDirectory.filter(s => Math.abs(s.freq - f) < 0.05);
    if (!byFreq.length) return null;
    if (callsign) {
        const exact = byFreq.find(s => s.callsign === callsign.toUpperCase() ||
                                       callsign.toUpperCase().startsWith(s.callsign));
        if (exact) return exact;
    }
    return byFreq[0];
}

const config     = require('../../config.json');
const { logInfo, logWarn, logError } = require('../../server/console');
const pluginsApi = require('../../server/plugins_api');
const audioServer = require('../../server/stream/3las.server');
const dataHandler = require('../../server/datahandler');
const { startAnalogRds, consumeStereoMetric } = require('./analog_rds');

const rootDir      = path.dirname(require.main.filename);
const pluginDir    = path.join(rootDir, 'plugins', 'NRSC5_HDRadio');
const hybridBridgePath = path.join(pluginDir, 'hybrid_bridge.py');
const rtlCapturePath = path.join(pluginDir, 'rtl_hybrid.exe');
const airspyCapturePath = path.join(pluginDir, 'airspyhf_hybrid.exe');
const configFilePath = path.join(rootDir, 'plugins_configs', 'NRSC5_HDRadio.json');

const DEFAULT_CONFIG = {
    nrsc5PyDir:  pluginDir,   // nrsc5.py is bundled in the plugin directory
    python3:     'python3',
    deviceIndex: 0,
    gain:        13,
    autoGain:    false,
    ppm:         0,
    autoStart:    true,
    enhancedMeta:   false,
    forceHdAudio:   false,
    airspyDbmOffset: -10,
    analogBandwidthKhz: 190
};

let pluginConfig = { ...DEFAULT_CONFIG };

// ── Runtime state ─────────────────────────────────────────────────────────────
let bridge        = null;    // child process
let hdEnabled     = false;
let rtlCapture    = null;
let rdsDecoder    = null;
let rdsRestartTimer = null;
let lostSyncTimer = null;
const HD_SYNC_HOLD_MS = 8000;
let retuneTimer   = null;
let currentFreq   = 87.5;
let currentProgram = 0;
let synchronized  = false;

let metadata = {
    stationName: '', slogan: '', message: '', alert: '', country: '',
    programType: '',
    title: '', artist: '', album: '', genre: '',
    signalDetected: false,   // true once MER arrives (HD carrier on this freq)
    bitRate: '', merLower: null, merUpper: null,
    berNow: null, berAvg: null,
    hdFormats: null
};

const hdAudioClients = new Set();
let lotImageCache = [];

// ── HD Scan state ─────────────────────────────────────────────────────────────
let scanActive    = false;
let scanAbortFlag = false;
let lastScanCache = null; // { hits: [], scannedAt: timestamp } — persists across connections

function _sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function runHdScan(startMHz, endMHz, stepMHz, signalWindowMs, syncWindowMs) {
    if (scanActive) return;
    scanActive    = true;
    scanAbortFlag = false;

    // Build frequency list in 0.1 MHz precision
    const freqs = [];
    for (let f = startMHz; f <= endMHz + 0.001; f = Math.round((f + stepMHz) * 10) / 10)
        freqs.push(Math.round(f * 10) / 10);

    const savedEnabled = hdEnabled;
    const savedFreq    = currentFreq;
    const savedProgram = currentProgram;

    // Ensure bridge is alive for scanning
    if (!bridge) {
        hdEnabled = true;
        startBridge(freqs[0], 0);
        await _sleep(2500);
    }

    broadcastToPlugins('hd-scan-start', { total: freqs.length, start: startMHz, end: endMHz });
    hdLogInfo(`HD Scan — ${freqs.length} freq, signal window ${signalWindowMs}ms, sync window ${syncWindowMs}ms`);

    const hits = [];

    for (let i = 0; i < freqs.length && !scanAbortFlag; i++) {
        const freq = freqs[i];
        broadcastToPlugins('hd-scan-progress', { i, total: freqs.length, freq });

        // Tune bridge to this frequency
        resetMetadata();
        retuneLive(freq, 0);
        await _sleep(180);

        // Phase 1 — wait up to signalWindowMs for any HD carrier energy
        const t1 = Date.now() + signalWindowMs;
        while (Date.now() < t1 && !scanAbortFlag) {
            if (synchronized || metadata.signalDetected) break;
            await _sleep(80);
        }

        let synced = synchronized;

        // Phase 2 — signal detected but not yet synced: wait a bit longer
        if (!synced && metadata.signalDetected && !scanAbortFlag) {
            const t2 = Date.now() + syncWindowMs;
            while (Date.now() < t2 && !scanAbortFlag) {
                if (synchronized) { synced = true; break; }
                await _sleep(80);
            }
        }

        if (synced) {
            const hit = {
                freq,
                name:     metadata.stationName || '',
                programs: metadata.numPrograms  || 1,
                merLower: metadata.merLower,
            };
            hits.push(hit);
            broadcastToPlugins('hd-scan-hit', hit);
            hdLogInfo(`HD: ${freq} MHz — ${hit.name || '(no name)'}, ${hit.programs} channel(s)`);
        }
    }

    // Restore original state
    resetMetadata();
    currentFreq    = savedFreq;
    currentProgram = savedProgram;
    if (!savedEnabled) {
        stopBridge();
        hdEnabled = false;
    } else if (bridge) {
        retuneLive(savedFreq, savedProgram);
    }
    broadcastMeta();

    if (!scanAbortFlag) {
        lastScanCache = { hits, scannedAt: Date.now() };
    }
    broadcastToPlugins('hd-scan-done', { hits, aborted: scanAbortFlag });
    hdLogInfo(`HD Scan done — ${hits.length} HD station(s) found`);
    scanActive = false;
}

// ── Config ────────────────────────────────────────────────────────────────────

function loadConfig() {
    try {
        if (!fs.existsSync(configFilePath)) {
            fs.writeFileSync(configFilePath, JSON.stringify(DEFAULT_CONFIG, null, 4));
            hdLogInfo(`Created default config`);
        }
        pluginConfig = { ...DEFAULT_CONFIG, ...JSON.parse(fs.readFileSync(configFilePath, 'utf8')) };
        if (![140, 160, 190].includes(Number(pluginConfig.analogBandwidthKhz))) pluginConfig.analogBandwidthKhz = 190;
        hdLogInfo(`Config loaded — device:${pluginConfig.deviceIndex} gain:${pluginConfig.autoGain ? 'auto' : pluginConfig.gain}dB`);
    } catch (e) {
        hdLogError(`Config error: ${e.message}`);
    }
}

function saveConfigField(key, value) {
    try {
        const saved = JSON.parse(fs.readFileSync(configFilePath, 'utf8'));
        saved[key] = value;
        fs.writeFileSync(configFilePath, JSON.stringify(saved, null, 4));
    } catch (_) {}
}

// ── Broadcast helpers ─────────────────────────────────────────────────────────

function broadcastToPlugins(type, value) {
    const msg = JSON.stringify({ type, value });
    const pWss = pluginsApi.getPluginsWss();
    if (!pWss) return;
    pWss.clients.forEach(c => {
        if (c.readyState === WebSocket.OPEN) { try { c.send(msg); } catch (_) {} }
    });
}

// Log to server console AND broadcast to the browser debug panel
function hdLogInfo(msg)  { logInfo(`${pluginName}: ${msg}`);  broadcastToPlugins('hd-radio-log', `[server] ${msg}`); }
function hdLogWarn(msg)  { logWarn(`${pluginName}: ${msg}`);  broadcastToPlugins('hd-radio-log', `[WARN]   ${msg}`); }
function hdLogError(msg) { logError(`${pluginName}: ${msg}`); broadcastToPlugins('hd-radio-log', `[ERROR]  ${msg}`); }

function broadcastMeta() {
    broadcastToPlugins('hd-radio-meta', {
        enabled:         hdEnabled,
        signalDetected:  metadata.signalDetected,
        synchronized,
        freq: currentFreq,
        program: currentProgram,
        gain:         pluginConfig.gain,
        autoGain:     pluginConfig.autoGain,
        enhancedMeta:  pluginConfig.enhancedMeta,
        forceHdAudio:  pluginConfig.forceHdAudio,
        receiver:       pluginConfig.receiver || 'rtl',
        analogBandwidthKhz: pluginConfig.analogBandwidthKhz,
        stationName:  metadata.stationName,
        slogan:       metadata.slogan,
        message:      metadata.message,
        alert:        metadata.alert,
        country:      metadata.country,
        programType:  metadata.programType,
        title:       metadata.title,
        artist:      metadata.artist,
        album:       metadata.album,
        genre:       metadata.genre,
        bitRate:     metadata.bitRate,
        merLower:    metadata.merLower,
        merUpper:    metadata.merUpper,
        berNow:      metadata.berNow,
        berAvg:      metadata.berAvg,
        hdFormats:    metadata.hdFormats,
        numPrograms:  metadata.numPrograms,
        availablePrograms: metadata.availablePrograms
    });
}

// ── Bridge event handler ──────────────────────────────────────────────────────

function handleBridgeEvent(evt) {
    switch (evt.type) {
        case 'devices': {
            const list = (evt.devices || []);
            if (list.length === 0) {
                hdLogWarn(`No RTL-SDR devices detected`);
            } else {
                hdLogInfo(`${list.length} RTL-SDR device(s) detected:`);
                list.forEach(d => logInfo(`  [${d.index}] ${d.name}${d.serial ? ' SN:' + d.serial : ''}${d.index === evt.active ? ' ← active' : ''}`));
            }
            broadcastToPlugins('hd-radio-devices', { devices: list, active: evt.active });
            break;
        }

        case 'bridge_version':
            hdLogInfo(`Bridge v${evt.version} running in ${evt.mode} mode`);
            break;

        case 'audio_program': {
            const p = Number(evt.program);
            if (Number.isInteger(p) && p >= 0 && p <= 7) {
                const programs = new Set(metadata.availablePrograms || []);
                programs.add(p);
                metadata.availablePrograms = [...programs].sort((a, b) => a - b);
                metadata.numPrograms = Math.max(metadata.numPrograms || 1, p + 1);
                hdLogInfo(`Audio service detected: HD${p + 1}`);
                broadcastMeta();
            }
            break;
        }
        case 'audio_first':
            hdLogInfo(`First AUDIO event — event_program=${evt.event_program} want=${evt.want_program} data=${evt.data_len}B match=${evt.event_program === evt.want_program}`);
            break;

        case 'started':
            hdLogInfo(`Bridge started — ${evt.freq} MHz HD${evt.program + 1} gain=${evt.gain}`);
            broadcastMeta();
            break;

        case 'sync':
            clearTimeout(lostSyncTimer);
            lostSyncTimer = null;
            metadata.signalDetected = true;
            if (!synchronized) {
                synchronized = true;
                hdLogInfo(`HD signal locked on ${currentFreq} MHz HD${currentProgram + 1}`);
                broadcastMeta();
            }
            break;

        case 'lost_sync':
            if (synchronized && !lostSyncTimer) {
                hdLogWarn(`Brief HD sync loss; holding state for ${HD_SYNC_HOLD_MS / 1000}s`);
                lostSyncTimer = setTimeout(() => {
                    lostSyncTimer = null;
                    if (synchronized) {
                        synchronized = false;
                        metadata.signalDetected = false;
                        hdLogWarn(`HD signal loss sustained; using FM analog`);
                        broadcastMeta();
                    }
                }, HD_SYNC_HOLD_MS);
            }
            break;

        case 'lost_device':
            hdLogError(`RTL-SDR device lost — check USB connection`);
            synchronized = false;
            metadata.signalDetected = false;
            broadcastToPlugins('hd-radio-meta', { ...metadata,
                enabled: hdEnabled, synchronized, signalDetected: false,
                deviceLost: true, freq: currentFreq, program: currentProgram,
                gain: pluginConfig.gain, autoGain: pluginConfig.autoGain
            });
            break;

        case 'sis':
            if (evt.name    !== undefined) metadata.stationName = evt.name;
            if (evt.slogan  !== undefined) metadata.slogan      = evt.slogan;
            if (evt.message !== undefined) metadata.message     = evt.message;
            if (evt.alert   !== undefined) metadata.alert       = evt.alert;
            if (evt.country !== undefined) metadata.country     = evt.country;
            if (Array.isArray(evt.audioServices) && evt.audioServices.length > 0) {
                const programs = evt.audioServices.map(s => Number(s.program)).filter(Number.isInteger);
                const svc = evt.audioServices.find(s => Number(s.program) === currentProgram);
                if (svc) metadata.programType = svc.type.replace(/_/g, ' ');
                if (programs.length) {
                    metadata.availablePrograms = [...new Set(programs)].sort((a, b) => a - b);
                    metadata.numPrograms = Math.max(...programs) + 1;
                }
            }
            // Directory lookup — add HD format names for all programs
            if (evt.name) {
                const entry = lookupStation(currentFreq, evt.name);
                if (entry) metadata.hdFormats = entry.formats;
            }
            broadcastMeta();
            break;

        case 'id3':
            if (evt.title  !== undefined) metadata.title  = evt.title;
            if (evt.artist !== undefined) metadata.artist = evt.artist;
            if (evt.album  !== undefined) metadata.album  = evt.album;
            if (evt.genre  !== undefined) metadata.genre  = evt.genre;
            broadcastMeta();
            break;

        case 'bitrate':
            metadata.bitRate = `${evt.kbps} kbps`;
            broadcastMeta();
            break;

        case 'mer':
            // MER is also reported for analog-only RF/noise. It is diagnostic,
            // not proof of an HD carrier; only a real NRSC-5 sync changes mode.
            metadata.merLower = evt.lower;
            metadata.merUpper = evt.upper;
            broadcastMeta();
            break;

        case 'ber':
            metadata.berNow = evt.now;
            metadata.berAvg = evt.avg;
            broadcastMeta();
            break;

        case 'freq_set':
            hdLogInfo(`Frequency → ${evt.value} MHz`);
            break;

        case 'program_set':
            hdLogInfo(`Program → HD${evt.value + 1}`);
            break;

        case 'gain_set':
            hdLogInfo(`Gain → ${evt.value} dB`);
            break;

        case 'error':
            hdLogError(`Bridge error: ${evt.msg}`);
            break;

        case 'lot': {
            hdLogInfo(`LOT received â€” ${evt.mime} "${evt.name}" (${Math.round(evt.data?.length * 0.75 / 1024)} kB)`);
            const lot = { mime: evt.mime, name: evt.name, data: evt.data };
            const key = `${lot.mime}:${lot.name}`;
            lotImageCache = lotImageCache.filter(item => `${item.mime}:${item.name}` !== key);
            lotImageCache.push(lot);
            lotImageCache = lotImageCache.slice(-8);
            broadcastToPlugins('hd-radio-lot', lot);
            break;
        }

        case 'sig':
            broadcastToPlugins('hd-radio-log', `[SIG] ${JSON.stringify(evt.services)}`);
            if (Array.isArray(evt.services)) {
                const audioProgs = evt.services
                    .filter(s => s.type === 'audio')
                    .map(s => Number(s.program))
                    .filter(Number.isInteger);
                if (audioProgs.length > 0) {
                    metadata.availablePrograms = [...new Set(audioProgs)].sort((a, b) => a - b);
                    metadata.numPrograms = Math.max(...audioProgs) + 1;
                    broadcastMeta();
                }
            }
            break;
    }
}

// ── Send command to bridge ────────────────────────────────────────────────────

function sendCmd(cmd) {
    if (bridge && bridge.stdio[3] && !bridge.stdio[3].destroyed) {
        try { bridge.stdio[3].write(JSON.stringify(cmd) + '\n'); } catch (_) {}
    }
}

function broadcastAnalogState() {
    const wss = pluginsApi.getWss();
    if (!wss) return;
    const payload = JSON.stringify(dataHandler.dataToSend);
    wss.clients.forEach(client => {
        if (client.readyState === WebSocket.OPEN) {
            try { client.send(payload); } catch (_) {}
        }
    });
}

function restartAnalogRds(captureProcess) {
    clearTimeout(rdsRestartTimer);
    const oldDecoder = rdsDecoder;
    rdsDecoder = null;
    if (oldDecoder) {
        try { captureProcess.stdio[4].unpipe(oldDecoder.stdin); } catch (_) {}
        try { oldDecoder.stdin.destroy(); } catch (_) {}
        if (!oldDecoder.killed) oldDecoder.kill('SIGTERM');
    }
    if (typeof dataHandler.resetRds === 'function') dataHandler.resetRds();
    broadcastAnalogState();
    rdsRestartTimer = setTimeout(() => {
        rdsRestartTimer = null;
        if (rtlCapture !== captureProcess || !captureProcess.stdio[4]) return;
        rdsDecoder = startAnalogRds({
            capture: captureProcess,
            pluginDir,
            dataHandler,
            wss: pluginsApi.getWss(),
            logInfo: hdLogInfo,
            logWarn: hdLogWarn
        });
    }, 250);
}

function retuneLive(freq, program = currentProgram) {
    currentFreq = freq;
    currentProgram = program;
    resetMetadata();
    broadcastMeta();
    if (!bridge || !rtlCapture || !rtlCapture.stdin || rtlCapture.stdin.destroyed) {
        startBridge(freq, program);
        return;
    }
    try {
        rtlCapture.stdin.write(`F${Math.round(freq * 1000000)}\n`);
        sendCmd({ cmd: 'freq', value: freq });
        sendCmd({ cmd: 'program', value: program });
        if (pluginConfig.receiver !== 'rtl') restartAnalogRds(rtlCapture);
        hdLogInfo(`Live retune -> ${freq.toFixed(3)} MHz (capture and streams kept open)`);
    } catch (e) {
        hdLogWarn(`Live retune failed (${e.message}); restarting receiver`);
        startBridge(freq, program);
    }
}

function publishRtlMetric(levelDbfs, snrDb) {
    const dbfs = Number(levelDbfs);
    const snr = Math.max(0, Math.min(60, Number(snrDb)));
    if (!Number.isFinite(dbfs) || !Number.isFinite(snr)) return;
    // Airspy HF+ reports relative full-scale power. The offset is user-calibratable;
    // dBm is therefore explicitly exposed as an estimate, while SNR remains independent.
    const dbm = dbfs + Number(pluginConfig.airspyDbmOffset ?? -10);
    const dbf = dbm + 120;
    dataHandler.dataToSend.sig = dbf;
    dataHandler.initialData.sig = dbf;
    dataHandler.dataToSend.sigRaw = `${dbf.toFixed(1)} dBf`;
    dataHandler.initialData.sigRaw = dataHandler.dataToSend.sigRaw;
    dataHandler.dataToSend.rtlLevelDbfs = dbfs;
    dataHandler.initialData.rtlLevelDbfs = dbfs;
    dataHandler.dataToSend.rtlSnrDb = snr;
    dataHandler.initialData.rtlSnrDb = snr;
    dataHandler.dataToSend.rtlPowerDbm = dbm;
    dataHandler.initialData.rtlPowerDbm = dbm;
    const highest = Number(dataHandler.dataToSend.sigTop);
    if (!Number.isFinite(highest) || dbf > highest) {
        dataHandler.dataToSend.sigTop = dbf.toFixed(1);
        dataHandler.initialData.sigTop = dataHandler.dataToSend.sigTop;
    }
}

// ── Bridge process lifecycle ──────────────────────────────────────────────────

function resetMetadata() {
    clearTimeout(lostSyncTimer);
    lostSyncTimer = null;
    metadata = {
        signalDetected: false,
        stationName: '', slogan: '', message: '', alert: '', country: '', programType: '',
        title: '', artist: '', album: '', genre: '',
        bitRate: '', merLower: null, merUpper: null,
        berNow: null, berAvg: null,
        hdFormats: null, numPrograms: 1, availablePrograms: [0]
    };
    synchronized = false;
    lotImageCache = [];
}

function startBridge(freq, program) {
    stopBridge();
    resetMetadata();
    currentFreq    = freq;
    currentProgram = program;

    const gainArg = pluginConfig.autoGain ? 'auto' : String(pluginConfig.gain);

    const receiver = pluginConfig.receiver === 'rtl' ? 'rtl' : 'airspyhf';
    const iqFormat = receiver === 'airspyhf' ? 'cf32' : 'cu8';
    const capturePath = receiver === 'airspyhf' ? airspyCapturePath : rtlCapturePath;
    const args = ['-u', hybridBridgePath, pluginConfig.nrsc5PyDir,
        String(freq), String(program), gainArg, iqFormat];
    const captureArgs = receiver === 'airspyhf'
        ? [String(Math.round(freq * 1000000)), String(pluginConfig.airspySerial || 'auto'), String(pluginConfig.airspyAttenuation || 0), String(pluginConfig.analogBandwidthKhz || 190)]
        : [String(Math.round(freq * 1000000)), String(pluginConfig.deviceIndex), gainArg, String(pluginConfig.ppm)];

    hdLogInfo(`Spawning bridge: ${pluginConfig.python3} ${args.join(' ')}`);

    try {
        bridge = spawn(pluginConfig.python3, args, { stdio: ['pipe', 'pipe', 'pipe', 'pipe'] });
    } catch (e) {
        hdLogError(`Failed to spawn bridge: ${e.message}`);
        return;
    }
    try {
        rtlCapture = spawn(capturePath, captureArgs, { stdio: ['pipe', 'pipe', 'pipe', 'pipe', 'pipe'] });
        spectrumAnalyzer.attach(rtlCapture.stdio[3], {
            format: iqFormat,
            sampleRate: 744187.5,
            getCenterMHz: () => currentFreq
        });
        rtlCapture.stdio[3].pipe(bridge.stdin);
        if (receiver === 'airspyhf') rdsDecoder = startAnalogRds({
            capture: rtlCapture,
            pluginDir,
            dataHandler,
            wss: pluginsApi.getWss(),
            logInfo: hdLogInfo,
            logWarn: hdLogWarn
        });
        audioServer.waitUntilReady.then(() => {
            if (audioServer.Server && rtlCapture) audioServer.Server.SetInput(rtlCapture.stdout);
        });
        const captureProcess = rtlCapture;
        let captureLineBuf = '';
        captureProcess.stderr.on('data', data => {
            captureLineBuf += data.toString();
            let nl;
            while ((nl = captureLineBuf.indexOf('\n')) !== -1) {
                const line = captureLineBuf.slice(0, nl).trim();
                captureLineBuf = captureLineBuf.slice(nl + 1);
                if (!line) continue;
                const metric = line.match(/^METRIC level_dbfs=([-0-9.]+) snr_db=([-0-9.]+)/);
                if (metric) publishRtlMetric(metric[1], metric[2]);
                else if (!consumeStereoMetric(line, dataHandler)) hdLogInfo(`[${receiver} analog] ${line}`);
            }
        });
        captureProcess.on('exit', (code, signal) => {
            if (rtlCapture !== captureProcess) return;
            rtlCapture = null;
            hdLogWarn(`${receiver} capture exited (code=${code}, signal=${signal})`);
            if (config.portableRtlMode || hdEnabled) setTimeout(() => {
                if ((config.portableRtlMode || hdEnabled) && !rtlCapture) startBridge(currentFreq, currentProgram);
            }, 500);
        });
    } catch (e) {
        hdLogError(`Failed to start shared RTL capture: ${e.message}`);
        stopBridge();
        return;
    }

    // stdout → raw PCM → audio clients
    let _firstChunk = true;
    let _audioBytesSent = 0;
    let _audioBytesWindow = 0;
    bridge.stdout.on('data', chunk => {
        if (_firstChunk) {
            _firstChunk = false;
            hdLogInfo(`First audio chunk from bridge — ${chunk.length} bytes, ${hdAudioClients.size} client(s) connected`);
        }
        _audioBytesSent   += chunk.length;
        _audioBytesWindow += chunk.length;
        const dead = [];
        hdAudioClients.forEach(ws => {
            if (ws.readyState === WebSocket.OPEN) {
                try { ws.send(chunk, { binary: true }); }
                catch (_) { dead.push(ws); }
            } else { dead.push(ws); }
        });
        dead.forEach(ws => hdAudioClients.delete(ws));
    });

    // Log audio throughput every 15 seconds
    const _audioStatsInterval = setInterval(() => {
        if (!bridge) { clearInterval(_audioStatsInterval); return; }
        const kbps = ((_audioBytesWindow * 8) / 15 / 1000).toFixed(1);
        _audioBytesWindow = 0;
        hdLogInfo(`Audio — ${kbps} kbps to ${hdAudioClients.size} client(s), total sent: ${(_audioBytesSent / 1024).toFixed(0)} kB`);
    }, 15000);

    // stderr → JSON event lines
    let lineBuf = '';
    bridge.stderr.on('data', data => {
        lineBuf += data.toString();
        let nl;
        while ((nl = lineBuf.indexOf('\n')) !== -1) {
            const raw = lineBuf.slice(0, nl).trim();
            lineBuf = lineBuf.slice(nl + 1);
            if (!raw) continue;
            broadcastToPlugins('hd-radio-log', raw);
            try { handleBridgeEvent(JSON.parse(raw)); }
            catch (_) {
                // Non-JSON: Python traceback or print statement — log to server console
                hdLogWarn(`[bridge] ${raw}`);
            }
        }
    });

    const bridgeProcess = bridge;
    bridgeProcess.on('exit', (code, signal) => {
        hdLogInfo(`Bridge exited (code=${code}, signal=${signal})`);
        if (bridge !== bridgeProcess) return;
        bridge = null;
        synchronized = false;
        if (rtlCapture) { const capture = rtlCapture; rtlCapture = null; capture.kill('SIGTERM'); }
        if (hdEnabled) broadcastMeta();
    });

    bridge.on('error', err => hdLogError(`Bridge process error: ${err.message}`));
}

function stopBridge() {
    clearTimeout(retuneTimer);
    clearTimeout(rdsRestartTimer);
    rdsRestartTimer = null;
    const oldBridge = bridge;
    const oldCapture = rtlCapture;
    const oldRdsDecoder = rdsDecoder;
    bridge = null;
    rtlCapture = null;
    rdsDecoder = null;
    spectrumAnalyzer.detach();
    if (oldBridge) {
        try {
            if (oldBridge.stdio[3] && !oldBridge.stdio[3].destroyed)
                oldBridge.stdio[3].write(JSON.stringify({ cmd: 'quit' }) + '\n');
            oldBridge.stdin.destroy();
        } catch (_) {}
        setTimeout(() => { if (!oldBridge.killed) oldBridge.kill('SIGTERM'); }, 500);
    }
    if (oldCapture && !oldCapture.killed) oldCapture.kill('SIGTERM');
    if (oldRdsDecoder && !oldRdsDecoder.killed) oldRdsDecoder.kill('SIGTERM');
    hdLogInfo(`Bridge stopping`);
}

// ── /hd_audio WebSocket endpoint ──────────────────────────────────────────────

function setupHdAudioEndpoint() {
    const httpServer = pluginsApi.getHttpServer();
    if (!httpServer) { hdLogError(`httpServer unavailable`); return; }

    const hdAudioWss = new WebSocket.Server({ noServer: true });

    hdAudioWss.on('connection', (ws, req) => {
        hdLogInfo(`Audio client connected: ${req.socket.remoteAddress} (total: ${hdAudioClients.size + 1})`);
        hdAudioClients.add(ws);
        ws.on('close', (code) => { hdAudioClients.delete(ws); hdLogInfo(`Audio client disconnected (code ${code}), ${hdAudioClients.size} remaining`); });
        ws.on('error', (err) => { hdAudioClients.delete(ws); hdLogWarn(`Audio client error: ${err.message}`); });
    });

    const existing = httpServer.rawListeners('upgrade');
    httpServer.removeAllListeners('upgrade');

    httpServer.on('upgrade', (req, socket, head) => {
        if (req.url === '/hd_audio') {
            hdAudioWss.handleUpgrade(req, socket, head, ws => hdAudioWss.emit('connection', ws, req));
        } else {
            existing.forEach(fn => fn.call(httpServer, req, socket, head));
        }
    });

    hdLogInfo(`/hd_audio WebSocket registered`);
}

// ── Frontend command handler ───────────────────────────────────────────────────

function connectToPlugins() {
    const port = config.webserver.webserverPort || 8080;
    const ws   = new WebSocket(`ws://127.0.0.1:${port}/data_plugins`);

    ws.on('open', () => hdLogInfo(`Connected to /data_plugins`));

    ws.on('message', raw => {
        try {
            const msg = JSON.parse(raw.toString());
            switch (msg.type) {
                case 'hd-radio-request':
                    broadcastMeta();
                    lotImageCache.forEach(lot => broadcastToPlugins('hd-radio-lot', lot));
                    // Send cached scan results to this client so new connections
                    // see the last scan without having to rescan.
                    if (lastScanCache) {
                        const pWss = pluginsApi.getPluginsWss();
                        if (pWss) {
                            const cacheMsg = JSON.stringify({ type: 'hd-scan-cache', value: lastScanCache });
                            pWss.clients.forEach(c => {
                                if (c.readyState === WebSocket.OPEN) {
                                    try { c.send(cacheMsg); } catch (_) {}
                                }
                            });
                        }
                    }
                    break;

                case 'hd-radio-enable': {
                    hdEnabled = true;
                    if (msg.value?.program !== undefined) currentProgram = msg.value.program;
                    const receiverAlive = bridge && rtlCapture &&
                        bridge.exitCode === null && rtlCapture.exitCode === null &&
                        !bridge.killed && !rtlCapture.killed;
                    if (receiverAlive) {
                        // HD OFF intentionally leaves the shared Airspy/RTL capture alive
                        // for continuous analog FM. Re-enable decoding in place so audio,
                        // RDS and the main WebSocket never lose their source.
                        sendCmd({ cmd: 'program', value: currentProgram });
                        hdLogInfo(`HD re-enabled on existing receiver capture (HD${currentProgram + 1})`);
                        broadcastMeta();
                    } else {
                        startBridge(currentFreq, currentProgram);
                    }
                    break;
                }

                case 'hd-radio-disable':
                    hdEnabled = false;
                    broadcastMeta();
                    break;

                case 'hd-radio-program': {
                    const requested = Number(msg.value?.program);
                    const p = Number.isInteger(requested) ? Math.max(0, Math.min(7, requested)) : 0;
                    if (p !== currentProgram) {
                        currentProgram = p;
                        metadata.title = metadata.artist = metadata.album = metadata.genre = '';
                        metadata.bitRate = '';
                        metadata.programType = '';
                        if (bridge) sendCmd({ cmd: 'program', value: p });
                        else if (hdEnabled) startBridge(currentFreq, p);
                        hdLogInfo(`Selecting HD${p + 1} without retuning receiver`);
                    }
                    broadcastMeta();
                    break;
                }

                case 'hd-radio-bandwidth': {
                    const bandwidth = Number(msg.value?.bandwidthKhz);
                    if (pluginConfig.receiver !== 'airspyhf' || ![140, 160, 190].includes(bandwidth)) {
                        hdLogWarn(`Ignored invalid analog bandwidth request: ${bandwidth}`);
                        broadcastMeta();
                        break;
                    }
                    pluginConfig.analogBandwidthKhz = bandwidth;
                    saveConfigField('analogBandwidthKhz', bandwidth);
                    if (rtlCapture?.stdin && !rtlCapture.stdin.destroyed) {
                        rtlCapture.stdin.write(`B${bandwidth}\n`);
                    }
                    hdLogInfo(`Analog FM filter -> ${bandwidth} kHz (live, HD IQ unchanged)`);
                    broadcastMeta();
                    break;
                }
                case 'hd-radio-gain': {
                    const g = Math.max(0, Math.min(60, parseFloat(msg.value?.gain) || 0));
                    pluginConfig.gain = g;
                    pluginConfig.autoGain = false;
                    saveConfigField('gain', g);
                    saveConfigField('autoGain', false);
                    if (hdEnabled) startBridge(currentFreq, currentProgram);
                    hdLogInfo(`Gain → ${g} dB`);
                    broadcastMeta();
                    break;
                }

                case 'hd-radio-enhanced-meta': {
                    pluginConfig.enhancedMeta = !!msg.value?.enabled;
                    saveConfigField('enhancedMeta', pluginConfig.enhancedMeta);
                    hdLogInfo(`Enhanced metadata ${pluginConfig.enhancedMeta ? 'enabled' : 'disabled'}`);
                    broadcastMeta();
                    break;
                }

                case 'hd-radio-force-audio': {
                    pluginConfig.forceHdAudio = !!msg.value?.enabled;
                    saveConfigField('forceHdAudio', pluginConfig.forceHdAudio);
                    hdLogInfo(`Force HD audio ${pluginConfig.forceHdAudio ? 'enabled' : 'disabled'}`);
                    broadcastMeta();
                    break;
                }

                case 'hd-radio-auto-gain': {
                    pluginConfig.autoGain = true;
                    saveConfigField('autoGain', true);
                    if (hdEnabled) startBridge(currentFreq, currentProgram);
                    broadcastMeta();
                    break;
                }

                case 'hd-scan-start': {
                    const v = msg.value || {};
                    const start  = parseFloat(v.start)  || 87.9;
                    const end    = parseFloat(v.end)    || 107.9;
                    const step   = parseFloat(v.step)   || 0.2;
                    const sigWin = parseInt(v.sigWin)   || 500;
                    const synWin = parseInt(v.synWin)   || 1500;
                    runHdScan(start, end, step, sigWin, synWin)
                        .catch(e => hdLogError(`Scan error: ${e.message}`));
                    break;
                }

                case 'hd-scan-stop':
                    if (scanActive) {
                        scanAbortFlag = true;
                        hdLogInfo('Scan aborted by user');
                    }
                    break;
            }
        } catch (_) {}
    });

    ws.on('close', () => setTimeout(connectToPlugins, 5000));
    ws.on('error', () => {});
}

// ── Main frequency tracker ─────────────────────────────────────────────────────

function connectToMain() {
    const port = config.webserver.webserverPort || 8080;
    const ws   = new WebSocket(`ws://127.0.0.1:${port}/text`);
    let freqKnown = false;

    ws.on('open', () => hdLogInfo(`Connected to /text`));

    ws.on('message', raw => {
        try {
            const msg = JSON.parse(raw.toString());
            if (!msg.freq) return;
            const newFreq = parseFloat(msg.freq);

            if (!freqKnown) {
                freqKnown = true;
                currentFreq = newFreq;
                if (config.portableRtlMode || pluginConfig.autoStart) {
                    hdLogInfo(`autoStart — ${newFreq} MHz`);
                    hdEnabled = true;
                    startBridge(newFreq, currentProgram);
                }
                return;
            }

            if (newFreq === currentFreq) return;
            currentFreq = newFreq;

            if (scanActive) return; // scan controls frequency — ignore main tracker

            if (config.portableRtlMode || hdEnabled) {
                hdLogInfo(`Retuning analog + HD to ${newFreq} MHz`);
                clearTimeout(retuneTimer);
                retuneTimer = setTimeout(() => retuneLive(newFreq, currentProgram), 35);
            }
        } catch (_) {}
    });

    ws.on('close', () => setTimeout(connectToMain, 5000));
    ws.on('error', () => {});
}

// ── Init ──────────────────────────────────────────────────────────────────────

loadConfig();
loadHdDirectory();  // async — populates hdDirectory in background

setTimeout(() => {
    setupHdAudioEndpoint();
    connectToPlugins();
    connectToMain();
}, 2000);
