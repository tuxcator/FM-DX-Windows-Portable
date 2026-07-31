'use strict';

const { parseAudioDevice } = require('./server/stream/parser');

parseAudioDevice()
    .then(result => process.stdout.write(JSON.stringify(result.audioDevices || [])))
    .catch(error => {
        process.stderr.write(String(error && error.stack ? error.stack : error));
        process.exitCode = 1;
    });
