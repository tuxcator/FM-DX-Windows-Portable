'use strict';

function createRtlVirtualOutput({ dataHandler, wss, logInfo }) {
    function broadcast() {
        const payload = JSON.stringify(dataHandler.dataToSend);
        wss.clients.forEach(client => {
            if (client.readyState === client.OPEN) client.send(payload);
        });
    }

    return {
        write(rawCommand) {
            const commands = String(rawCommand).split(/\r?\n/).map(value => value.trim()).filter(Boolean);
            for (const command of commands) {
                if (!command.startsWith('T')) continue;
                const frequencyKhz = Number(command.slice(1).split(',')[0]);
                if (!Number.isFinite(frequencyKhz) || frequencyKhz < 1000) continue;
                const frequencyMhz = (frequencyKhz / 1000).toFixed(3);
                dataHandler.initialData.freq = frequencyMhz;
                dataHandler.dataToSend.freq = frequencyMhz;
                dataHandler.dataToSend.pi = '?';
                dataHandler.dataToSend.txInfo.reg = false;
                logInfo(`[RTL-SDR] Frequency -> ${frequencyMhz} MHz`);
                broadcast();
            }
            return true;
        },
        sync() {
            broadcast();
        }
    };
}

module.exports = { createRtlVirtualOutput };
