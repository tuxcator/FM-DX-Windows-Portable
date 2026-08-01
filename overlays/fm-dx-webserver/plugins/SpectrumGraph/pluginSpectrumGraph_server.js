/*
 * Airspy HF+ adapter for AAD Spectrum Graph.
 *
 * The original server plugin asks TEF firmware to sweep the whole FM band.
 * This adapter deliberately does not retune the receiver. It visualizes the
 * 744.1875 kS/s CF32 stream already shared with NRSC-5, keeping FM/HD audio
 * continuous and avoiding a second USB open of the Airspy.
 */
'use strict';

const path = require('path');
const rootDir = path.dirname(require.main.filename);
const endpoints = require(path.join(rootDir, 'server', 'endpoints'));
const pluginsApi = require(path.join(rootDir, 'server', 'plugins_api'));
const { logInfo, logWarn } = require(path.join(rootDir, 'server', 'console'));
const spectrum = require(path.join(rootDir, 'plugins', 'NRSC5_HDRadio', 'spectrum_analyzer'));

const pluginName = 'Spectrum Graph (Airspy HF+)';
let state = {
    sd: null,
    scanStatus: 'waiting',
    isScanComplete: true,
    fmLowerLimit: 87.5,
    fmRangeName: 'Airspy HF+ en vivo',
    fmRangeFreq: 'Ancho instantaneo alrededor de la frecuencia actual',
    customRangeNames: [],
    customRangeFreqs: [],
    receiver: 'airspyhf',
    mode: 'live-local'
};

function toState(result) {
    const first = result.points[0];
    const last = result.points[result.points.length - 1];
    return {
        sd: result.points.map(point => `${(Number(point.freq) * 1000).toFixed(3)}=${point.sig}`).join(','),
        scanStatus: 'normal',
        isScanComplete: true,
        lastUpdate: result.updatedAt,
        serverTime: Math.floor(Date.now() / 1000),
        fmLowerLimit: Number(first.freq),
        fmRangeName: 'Airspy HF+ en vivo',
        fmRangeFreq: `${Number(first.freq).toFixed(3)}-${Number(last.freq).toFixed(3)} MHz`,
        centerFrequency: result.centerMHz,
        spanKHz: result.spanKHz,
        receiver: 'airspyhf',
        mode: 'live-local'
    };
}

function send(ws, payload) {
    if (ws && ws.readyState === 1) {
        try { ws.send(JSON.stringify(payload)); } catch (_) {}
    }
}

function broadcast(payload) {
    const wss = pluginsApi.getPluginsWss();
    if (!wss) return;
    wss.clients.forEach(client => send(client, payload));
}

function publish(result) {
    state = { ...state, ...toState(result) };
    broadcast({ type: 'sigArray', value: result.points, isScanning: false });
}

function sendSnapshot(ws) {
    const latest = spectrum.getLatest();
    send(ws, { type: 'spectrum-graph-scan-success', scanSuccess: !!latest });
    if (latest) send(ws, { type: 'sigArray', value: latest.points, isScanning: false });
}

endpoints.get('/spectrum-graph-plugin', (req, res) => {
    const latest = spectrum.getLatest();
    if (latest) state = { ...state, ...toState(latest) };
    res.json({ ...state, serverTime: Math.floor(Date.now() / 1000) });
});

endpoints.get('/spectrum-graph-plugin/api/config', (req, res) => {
    res.json({
        isAdmin: !!req.session?.isAdminAuthenticated,
        config: {
            fmLowerLimit: state.fmLowerLimit,
            receiver: 'airspyhf',
            mode: 'live-local',
            spanKHz: state.spanKHz || 744.1875
        }
    });
});

endpoints.get('/spectrum-graph-plugin/settings', (req, res) => {
    if (!req.session?.isAdminAuthenticated) return res.status(401).send('No autorizado.');
    res.type('html').send(`<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Spectrum Graph - Airspy HF+</title><style>body{font:16px system-ui;background:#15191d;color:#e8eeee;max-width:760px;margin:3rem auto;padding:0 1.2rem}section{background:#20262b;border-radius:12px;padding:1.5rem}code{color:#65d6b3}</style></head><body><section><h1>Spectrum Graph - Airspy HF+</h1><p>Modo: <code>espectro local en vivo</code>.</p><p>El grafico usa el flujo IQ compartido con NRSC-5 y muestra aproximadamente 744 kHz alrededor de la emisora actual. No abre otro dispositivo, no resintoniza y no interrumpe el audio FM o HD.</p><p>Para ver otra parte de la banda, sintonice normalmente la frecuencia deseada.</p></section></body></html>`);
});

const pluginsWss = pluginsApi.getPluginsWss();
if (pluginsWss) {
    const attachedClients = new WeakSet();
    const attachClient = ws => {
        if (!ws || attachedClients.has(ws)) return;
        attachedClients.add(ws);
        ws.on('message', raw => {
            try {
                const message = JSON.parse(raw.toString());
                if (message.type === 'spectrum-graph' && /^scan(?:-[0-9]+)?$/.test(message.value?.status || '')) {
                    sendSnapshot(ws);
                }
            } catch (_) {}
        });
        setTimeout(() => sendSnapshot(ws), 250);
    };
    pluginsWss.clients.forEach(attachClient);
    pluginsWss.on('connection', attachClient);
} else {
    logWarn(`${pluginName}: WebSocket de plugins no disponible`);
}

spectrum.onSpectrum(publish);
const initial = spectrum.getLatest();
if (initial) publish(initial);
logInfo(`${pluginName}: analizador IQ compartido habilitado (sin resintonia)`);

module.exports = { getSpectrumData: () => Object.freeze({ ...state }) };
