'use strict';

const { EventEmitter } = require('events');

const FFT_SIZE = 2048;
const OUTPUT_BINS = 256;
// 8 FPS keeps the graph responsive while leaving the audio/NRSC-5 path ample CPU.
const UPDATE_INTERVAL_MS = 125;
const SMOOTHING_ALPHA = 0.42;
const emitter = new EventEmitter();
emitter.setMaxListeners(20);

let activeStream = null;
let activeHandler = null;
let latest = null;
let nextAnalysisAt = 0;
let smoothedLevels = null;
let smoothedCenterMHz = null;

function fft(real, imag) {
    const n = real.length;
    for (let i = 1, j = 0; i < n; i++) {
        let bit = n >> 1;
        for (; j & bit; bit >>= 1) j ^= bit;
        j ^= bit;
        if (i < j) {
            [real[i], real[j]] = [real[j], real[i]];
            [imag[i], imag[j]] = [imag[j], imag[i]];
        }
    }
    for (let len = 2; len <= n; len <<= 1) {
        const angle = -2 * Math.PI / len;
        const wLenR = Math.cos(angle);
        const wLenI = Math.sin(angle);
        for (let i = 0; i < n; i += len) {
            let wr = 1;
            let wi = 0;
            for (let j = 0; j < len / 2; j++) {
                const uR = real[i + j];
                const uI = imag[i + j];
                const k = i + j + len / 2;
                const vR = real[k] * wr - imag[k] * wi;
                const vI = real[k] * wi + imag[k] * wr;
                real[i + j] = uR + vR;
                imag[i + j] = uI + vI;
                real[k] = uR - vR;
                imag[k] = uI - vI;
                const nextWr = wr * wLenR - wi * wLenI;
                wi = wr * wLenI + wi * wLenR;
                wr = nextWr;
            }
        }
    }
}

function analyzeCf32(chunk, centerMHz, sampleRate) {
    if (!Buffer.isBuffer(chunk) || chunk.length < FFT_SIZE * 8) return null;
    const real = new Float64Array(FFT_SIZE);
    const imag = new Float64Array(FFT_SIZE);
    for (let i = 0; i < FFT_SIZE; i++) {
        const window = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (FFT_SIZE - 1));
        real[i] = chunk.readFloatLE(i * 8) * window;
        imag[i] = chunk.readFloatLE(i * 8 + 4) * window;
    }
    fft(real, imag);
    const points = [];
    const previousLevels = smoothedLevels;
    const nextLevels = new Float64Array(OUTPUT_BINS);
    const binsPerPoint = FFT_SIZE / OUTPUT_BINS;
    for (let out = 0; out < OUTPUT_BINS; out++) {
        let power = 0;
        for (let j = 0; j < binsPerPoint; j++) {
            const shifted = out * binsPerPoint + j;
            const raw = (shifted + FFT_SIZE / 2) % FFT_SIZE;
            power += real[raw] * real[raw] + imag[raw] * imag[raw];
        }
        power /= binsPerPoint;
        const dbfs = 10 * Math.log10(Math.max(power, 1e-20)) - 20 * Math.log10(FFT_SIZE / 2);
        const rawDbf = Math.max(-30, Math.min(100, dbfs + 105));
        const previous = previousLevels?.[out];
        const dbf = Number.isFinite(previous)
            ? previous + SMOOTHING_ALPHA * (rawDbf - previous)
            : rawDbf;
        nextLevels[out] = dbf;
        const offsetHz = (out + 0.5 - OUTPUT_BINS / 2) * sampleRate / OUTPUT_BINS;
        points.push({ freq: (centerMHz + offsetHz / 1e6).toFixed(6), sig: dbf.toFixed(1) });
    }
    smoothedLevels = nextLevels;
    return {
        points,
        centerMHz,
        sampleRate,
        spanKHz: sampleRate / 1000,
        updatedAt: Math.floor(Date.now() / 1000)
    };
}

function detach() {
    if (activeStream && activeHandler) activeStream.off('data', activeHandler);
    activeStream = null;
    activeHandler = null;
    smoothedLevels = null;
    smoothedCenterMHz = null;
}

function attach(stream, options = {}) {
    detach();
    if (!stream || options.format !== 'cf32') return;
    const sampleRate = Number(options.sampleRate) || 744187.5;
    const getCenterMHz = typeof options.getCenterMHz === 'function' ? options.getCenterMHz : () => 0;
    activeStream = stream;
    activeHandler = chunk => {
        const now = Date.now();
        if (now < nextAnalysisAt) return;
        nextAnalysisAt = now + UPDATE_INTERVAL_MS;
        const centerMHz = Number(getCenterMHz());
        if (!Number.isFinite(centerMHz) || centerMHz <= 0) return;
        if (smoothedCenterMHz === null || Math.abs(centerMHz - smoothedCenterMHz) > 0.001) {
            smoothedLevels = null;
            smoothedCenterMHz = centerMHz;
        }
        try {
            const result = analyzeCf32(chunk, centerMHz, sampleRate);
            if (result) {
                latest = result;
                emitter.emit('spectrum', result);
            }
        } catch (_) {}
    };
    stream.on('data', activeHandler);
    stream.once('close', () => {
        if (activeStream === stream) detach();
    });
}

module.exports = {
    attach,
    detach,
    getLatest: () => latest,
    onSpectrum: handler => emitter.on('spectrum', handler),
    offSpectrum: handler => emitter.off('spectrum', handler)
};
