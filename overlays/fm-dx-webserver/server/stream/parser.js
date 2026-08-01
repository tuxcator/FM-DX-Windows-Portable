'use strict';

const { execFile } = require('child_process');
const fs = require('fs').promises;
const ffmpeg = require('ffmpeg-static');

function uniqueDevices(devices) {
    const seen = new Set();
    return devices.filter(device => {
        const key = String(device.name || '').toLocaleLowerCase();
        if (!key || seen.has(key)) return false;
        seen.add(key);
        return true;
    });
}

function parseAudioDevice(options, callback) {
    if (typeof options === 'function') {
        callback = options;
        options = {};
    }
    options = options || {};

    const operation = (async () => {
        if (process.platform === 'linux') {
            try {
                const data = await fs.readFile('/proc/asound/cards', 'utf8');
                const matches = (data.match(/\[([^\]]+)\]/g) || [])
                    .map(match => ({ name: 'hw:' + match.replace(/\s+/g, '').slice(1, -1) }));
                return { videoDevices: [], audioDevices: uniqueDevices(matches) };
            } catch {
                return { videoDevices: [], audioDevices: [] };
            }
        }

        return new Promise(resolve => {
            const input = process.platform === 'win32' ? 'dshow' : 'avfoundation';
            const args = process.platform === 'win32'
                ? ['-hide_banner', '-list_devices', 'true', '-f', input, '-i', 'dummy']
                : ['-hide_banner', '-f', input, '-list_devices', 'true', '-i', ''];

            execFile(ffmpeg, args, { windowsHide: true }, (_error, stdout, stderr) => {
                const output = String(stderr || stdout || '');
                const videoDevices = [];
                const audioDevices = [];

                if (process.platform === 'win32') {
                    let lastDevice = null;
                    for (const line of output.split(/\r?\n/)) {
                        const device = line.match(/"([^"]+)"\s+\((audio|video)\)\s*$/i);
                        if (device) {
                            lastDevice = { name: device[1] };
                            (device[2].toLowerCase() === 'audio' ? audioDevices : videoDevices).push(lastDevice);
                            continue;
                        }
                        const alternative = line.match(/Alternative\s+name\s+"([^"]+)"/i);
                        if (alternative && lastDevice) lastDevice.alternativeName = alternative[1];
                    }
                } else {
                    let audioSection = false;
                    for (const line of output.split(/\r?\n/)) {
                        if (/AVFoundation audio devices/i.test(line)) {
                            audioSection = true;
                            continue;
                        }
                        const device = line.match(/\[AVFoundation.*?\]\s+\[(\d+)\]\s+(.+)$/);
                        if (!device) continue;
                        const item = { id: Number(device[1]), name: device[2].trim() };
                        (audioSection ? audioDevices : videoDevices).push(item);
                    }
                }

                resolve({
                    videoDevices: uniqueDevices(videoDevices),
                    audioDevices: uniqueDevices(audioDevices)
                });
            });
        });
    })();

    if (typeof callback === 'function') {
        operation.then(callback).catch(() => callback({ videoDevices: [], audioDevices: [] }));
        return;
    }
    return operation;
}

module.exports = { parseAudioDevice };
