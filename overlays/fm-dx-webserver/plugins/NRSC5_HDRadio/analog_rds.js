'use strict';

const fs = require('fs');
const { spawn } = require('child_process');

function startAnalogRds({ capture, pluginDir, dataHandler, wss, logInfo, logWarn }) {
    const redseaPath = require('path').join(pluginDir, 'redsea.exe');
    if (!capture || !capture.stdio || !capture.stdio[4] || !fs.existsSync(redseaPath)) {
        logWarn('redsea.exe is missing; analog RDS is unavailable');
        return null;
    }
    const decoder = spawn(redseaPath,
        ['--input', 'mpx', '--samplerate', '192000', '--output', 'hex'],
        { stdio: ['pipe', 'pipe', 'pipe'] });
    capture.stdio[4].pipe(decoder.stdin);
    let lineBuffer = '';
    decoder.stdout.on('data', chunk => {
        lineBuffer += chunk.toString();
        let end;
        while ((end = lineBuffer.indexOf('\n')) !== -1) {
            const line = lineBuffer.slice(0, end).trim();
            lineBuffer = lineBuffer.slice(end + 1);
            const blocks = line.split(/\s+/).slice(0, 4);
            if (blocks.length !== 4) continue;
            let errors = 0;
            let packed = '';
            const masks = [0xC0, 0x30, 0x0C, 0x03];
            blocks.forEach((block, index) => {
                if (/^[0-9a-f]{4}$/i.test(block)) packed += block;
                else { packed += '0000'; errors |= masks[index]; }
            });
            dataHandler.handleData(
                wss || { clients: new Set() },
                'R' + packed + errors.toString(16).padStart(2, '0') + '\n',
                { clients: new Set() }
            );
        }
    });
    decoder.stderr.on('data', data => {
        const line = data.toString().trim();
        if (line) logWarn('[RDS] ' + line);
    });
    decoder.on('error', error => logWarn('Analog RDS decoder error: ' + error.message));
    logInfo('Analog RDS decoder started from shared 192 kHz FM multiplex');
    return decoder;
}

function consumeStereoMetric(line, dataHandler) {
    const match = String(line).match(/^STEREO detected=([01]) pilot_db=([-0-9.]+)/);
    if (!match) return false;
    const detected = match[1] === '1';
    dataHandler.dataToSend.st = detected;
    dataHandler.initialData.st = detected;
    return true;
}

module.exports = { startAnalogRds, consumeStereoMetric };