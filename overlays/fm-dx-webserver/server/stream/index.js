const { spawn, execSync } = require('child_process');
const { configName, serverConfig, configUpdate, configSave, configExists } = require('../server_config');
const { logDebug, logError, logInfo, logWarn, logFfmpeg } = require('../console');
const checkFFmpeg = require('./checkFFmpeg');
const audioServer = require('./3las.server');

const consoleLogTitle = '[Audio Stream]';

let startupSuccess;

function connectMessage(message) {
    if (!startupSuccess) {
        logInfo(message);
        startupSuccess = true;
    }
}

function checkAudioUtilities() {
    if (process.platform === 'darwin') {
        try {
            execSync('which sox');
        } catch (error) {
            logError(`${consoleLogTitle} Error: SoX ("sox") not found, Please install sox.`);
            process.exit(1);
        }
    } else if (process.platform === 'linux') {
        try {
            execSync('which arecord');
        } catch (error) {
            logError(`${consoleLogTitle} Error: ALSA ("arecord") not found. Please install ALSA utils.`);
            process.exit(1);
        }
    }
}

function buildCommand(ffmpegPath) {
    const inputDevice = String(serverConfig.audio.audioDevice || '').trim();
    const audioChannels = serverConfig.audio.audioChannels || 2;
    const webPort = Number(serverConfig.webserver.webserverPort);

    // Common audio options for FFmpeg
    const baseOptions = {
        flags: ['-fflags', '+genpts+discardcorrupt', '-flags', 'low_delay', '-rtbufsize', '64M', '-probesize', '32768', '-analyzeduration', '0'],
        codec: ['-acodec', 'pcm_s16le', '-ar', '48000', '-ac', `${audioChannels}`],
        output: ['-f', 's16le', '-fflags', '+flush_packets', '-flush_packets', '1', '-blocksize', '4096', 'pipe:1']
    };

    // Windows
    if (process.platform === 'win32') {
        if ((serverConfig.device === 'sdr' && serverConfig.portableRtlMode === true) || !inputDevice) {
            return {
                command: ffmpegPath,
                args: [
                    '-re', '-f', 'lavfi',
                    '-i', 'anullsrc=r=48000:cl=stereo',
                    ...baseOptions.codec,
                    ...baseOptions.output
                ]
            };
        }

        logInfo(`${consoleLogTitle} Platform: Windows (win32). Using "dshow" input.`);
        return {
            command: ffmpegPath,
            args: [
                ...baseOptions.flags,
                '-thread_queue_size', '1024',
                '-f', 'dshow',
                '-audio_buffer_size', '250',
                '-use_wallclock_as_timestamps', '1',
                '-i', `audio=${inputDevice}`,
                '-af', 'aresample=async=1:min_hard_comp=0.100:first_pts=0',
                ...baseOptions.codec,
                ...baseOptions.output
            ]
        };
    } else if (process.platform === 'darwin') {
        // macOS
        if (!serverConfig.audio.ffmpeg) {
            logInfo(`${consoleLogTitle} Platform: macOS (darwin) using "coreaudio"`);
            return {
                args: [],
                soxArgs: [
                    '-t', 'coreaudio', `${inputDevice}`,
                    '-b', '32',
                    '-r', '48000',
                    '-c', `${audioChannels}`,
                    '-t', 'raw',
                    '-b', '16',
                    '-r', '48000',
                    '-c', `${audioChannels}`
                    , '-'
                ]
            };
        } else {
            const device = serverConfig.audio.audioDevice;
            return {
                command: ffmpegPath,
                args: [
                    ...baseOptions.flags,
                    '-f', 'avfoundation',
                    '-i', `${device || ':0'}`,
                    ...baseOptions.codec,
                    ...baseOptions.output
                ]
            };
        }
    } else {
        // Linux
        if (!serverConfig.audio.ffmpeg) {
            const prefix = serverConfig.audio.softwareMode ? 'plug' : '';
            const device = `${prefix}${serverConfig.audio.audioDevice}`;
            logInfo(`${consoleLogTitle} Platform: Linux. Using "alsa" input.`);
            return {
                // command not used if arecordArgs are used
                command: `while true; do arecord -D "${device}" -f S16_LE -r 48000 -c ${audioChannels} -t raw; done`,
                args: [],
                arecordArgs: [
                    '-D', device,
                    '-f', 'S16_LE',
                    '-r', '48000',
                    '-c', audioChannels,
                    '-t', 'raw'
                ],
                ffmpegArgs: []
            };
        } else {
            const device = serverConfig.audio.audioDevice;
            return {
                command: ffmpegPath,
                args: [
                    ...baseOptions.flags,
                    '-f', 'alsa',
                    '-i', `${device}`,
                    ...baseOptions.codec,
                    ...baseOptions.output
                ],
                arecordArgs: [],
            };
        }
    }
}

checkFFmpeg().then((ffmpegPath) => {
    if (!serverConfig.audio.ffmpeg) checkAudioUtilities();
    let audioErrorLogged = false;

    logInfo(`${consoleLogTitle} Using`, ffmpegPath === 'ffmpeg' ? 'system-installed FFmpeg' : 'ffmpeg-static');

    if (process.platform !== 'darwin') {
        if (serverConfig.device === 'sdr' && serverConfig.portableRtlMode === true) {
            logInfo(`${consoleLogTitle} SDR mode: base player uses internal silence; HD audio uses /hd_audio.`);
        } else if (!String(serverConfig.audio.audioDevice || '').trim()) {
            logWarn(`${consoleLogTitle} TEF audio input is not configured; using internal silence until Configurar.cmd selects a DirectShow device.`);
        } else {
            logInfo(`${consoleLogTitle} Starting stable TEF audio stream on device: \x1b[35m${serverConfig.audio.audioDevice}\x1b[0m`);
        }
    } else {
        logInfo(`${consoleLogTitle} Starting audio stream on default input device.`);
    }

    if (process.platform === 'win32') {
        // Windows (FFmpeg DirectShow Capture)
        let ffmpeg;
        let restartTimer = null;
        let lastTimestamp = null;
        let lastCheckTime = Date.now();
        let audioErrorLogged = false;
        let staleCount = 0;

        function launchFFmpeg() {
            const commandDef = buildCommand(ffmpegPath);
            let ffmpegArgs = commandDef.args;

            // Apply audio boost if enabled
            if (serverConfig.audio.audioBoost) {
                ffmpegArgs.splice(ffmpegArgs.indexOf('pipe:1'), 0, '-af', 'volume=1.7');
            }

            logDebug(`${consoleLogTitle} Launching FFmpeg with args: ${ffmpegArgs.join(' ')}`);
            let receivedAudio = false;
            ffmpeg = spawn(ffmpegPath, ffmpegArgs, { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
            ffmpeg.stdout.once('data', () => {
                receivedAudio = true;
                audioErrorLogged = false;
            });

            audioServer.waitUntilReady.then(() => {
                audioServer.Server.StdIn = ffmpeg.stdout;
                audioServer.Server.Run();
                connectMessage(`${consoleLogTitle} Connected FFmpeg (capture) \u2192 FFmpeg (process) \u2192 Server.StdIn${serverConfig.audio.audioBoost ? ' (audio boost)' : ''}`);
            });

            ffmpeg.stderr.on('data', (data) => {
                const msg = data.toString();
                logFfmpeg(`[FFmpeg stderr]: ${msg}`);

                if (/I\/O error|Could not find audio only device|Error opening input|Could not run graph/i.test(msg) && !receivedAudio) {
                    audioErrorLogged = true;
                }

                // Detect frozen timestamp
                const match = msg.match(/time=(\d\d):(\d\d):(\d\d\.\d+)/);
                if (match) {
                    const [_, hh, mm, ss] = match;
                    const totalSec = parseInt(hh) * 3600 + parseInt(mm) * 60 + parseFloat(ss);

                    if (lastTimestamp !== null && totalSec === lastTimestamp) {
                        const now = Date.now();
                        staleCount++;
                        if (staleCount >= 10 && now - lastCheckTime > 10000 && !restartTimer) {
                            restartTimer = setTimeout(() => {
                                restartTimer = null;
                                staleCount = 0;
                                try {
                                    ffmpeg.kill('SIGKILL');
                                } catch (e) {
                                    logWarn(`${consoleLogTitle} Failed to kill FFmpeg process: ${e.message}`);
                                }
                                launchFFmpeg(); // Restart FFmpeg
                            }, 0);
                            setTimeout(() => logWarn(`${consoleLogTitle} FFmpeg appears frozen. Restarting...`), 100);
                        }
                    } else {
                        lastTimestamp = totalSec;
                        lastCheckTime = Date.now();
                        staleCount = 0;
                    }
                }
            });

            ffmpeg.on('exit', (code, signal) => {
                if (signal) {
                    logFfmpeg(`[FFmpeg exited] with signal ${signal}`);
                    logWarn(`${consoleLogTitle} FFmpeg was killed with signal ${signal}`);
                } else {
                    logFfmpeg(`[FFmpeg exited] with code ${code}`);
                    if (code !== 0) {
                        logWarn(`${consoleLogTitle} FFmpeg exited unexpectedly with code ${code}`);
                    }
                }

                // Retry only when a configured TEF input failed before delivering audio.
                if (audioErrorLogged && !receivedAudio && String(serverConfig.audio.audioDevice || '').trim()) {
                    logError(`${consoleLogTitle} DirectShow could not open "${serverConfig.audio.audioDevice}".`);
                    logError(`${consoleLogTitle} Run Configurar.cmd and select the exact audio input reported by Windows.`);
                    logWarn(`${consoleLogTitle} Retrying in 5 seconds without interrupting the independent HD audio path.`);
                    setTimeout(() => {
                        audioErrorLogged = false;
                        launchFFmpeg();
                    }, 5000);
                }
            });
        }
        launchFFmpeg(); // Initial launch
    } else if (process.platform === 'darwin') {
        // macOS (sox --> 3las.server.js --> FFmpeg)
        const commandDef = buildCommand(ffmpegPath);

        // Apply audio boost if enabled and FFmpeg is used
        if (serverConfig.audio.audioBoost && serverConfig.audio.ffmpeg) {
            commandDef.args.splice(commandDef.soxArgs.indexOf('pipe:1'), 0, '-af', 'volume=1.7');
        }

        let currentSox = null;

        process.on('exit', () => {
            if (currentSox) currentSox.kill('SIGINT');
        });

        process.on('SIGINT', () => {
            if (currentSox) currentSox.kill('SIGINT');
            process.exit();
        });

        function startSox() {
            if (!serverConfig.audio.ffmpeg) {
                // Spawn sox
                logDebug(`${consoleLogTitle} Launching sox with args: ${commandDef.soxArgs.join(' ')}`);

                const sox = spawn('sox', commandDef.soxArgs, { stdio: ['ignore', 'pipe', 'pipe'] });
                currentSox = sox;

                audioServer.waitUntilReady.then(() => {
                    audioServer.Server.StdIn = sox.stdout;
                    audioServer.Server.Run();
                    connectMessage(`${consoleLogTitle} Connected SoX \u2192 FFmpeg \u2192 Server.StdIn${serverConfig.audio.audioBoost && serverConfig.audio.ffmpeg ? ' (audio boost)' : ''}`);
                });

                sox.stderr.on('data', (data) => {
                    logFfmpeg(`[sox stderr]: ${data}`);
                });

                sox.on('exit', (code) => {
                    logFfmpeg(`[sox exited] with code ${code}`);
                    if (code !== 0) {
                        setTimeout(startSox, 2000);
                    }
                });
            }
        }

        startSox();

        if (serverConfig.audio.ffmpeg) {
            logDebug(`${consoleLogTitle} Launching FFmpeg with args: ${commandDef.args.join(' ')}`);
            const ffmpeg = spawn(ffmpegPath, commandDef.args, { stdio: ['ignore', 'pipe', 'pipe'] });

            // Pipe FFmpeg output to 3las.server.js
            audioServer.waitUntilReady.then(() => {
                audioServer.Server.StdIn = ffmpeg.stdout;
                audioServer.Server.Run();
                connectMessage(`${consoleLogTitle} Connected FFmpeg stdout \u2192 Server.StdIn${serverConfig.audio.audioBoost ? ' (audio boost)' : ''}`);
            });

            process.on('SIGINT', () => {
                ffmpeg.kill('SIGINT');
                process.exit();
            });

            process.on('exit', () => {
                ffmpeg.kill('SIGINT');
            });

            // FFmpeg stderr handling
            ffmpeg.stderr.on('data', (data) => {
                logFfmpeg(`[FFmpeg stderr]: ${data}`);
            });

            // FFmpeg exit handling
            ffmpeg.on('exit', (code) => {
                logFfmpeg(`[FFmpeg exited] with code ${code}`);
                if (code !== 0) {
                    logWarn(`${consoleLogTitle} FFmpeg exited unexpectedly with code ${code}`);
                }
            });
        }
    } else {
        // Linux (arecord --> 3las.server.js --> FFmpeg)
        const commandDef = buildCommand(ffmpegPath);

        // Apply audio boost if enabled and FFmpeg is used
        if (serverConfig.audio.audioBoost && serverConfig.audio.ffmpeg) {
            commandDef.args.splice(commandDef.args.indexOf('pipe:1'), 0, '-af', 'volume=1.7');
        }

        let currentArecord = null;

        process.on('exit', () => {
            if (currentArecord) currentArecord.kill('SIGINT');
        });

        process.on('SIGINT', () => {
            if (currentArecord) currentArecord.kill('SIGINT');
            process.exit();
        });

        function startArecord() {
            if (!serverConfig.audio.ffmpeg) {
                // Spawn the arecord loop
                logDebug(`${consoleLogTitle} Launching arecord with args: ${commandDef.arecordArgs.join(' ')}`);

                //const arecord = spawn(commandDef.command, { shell: true, stdio: ['ignore', 'pipe', 'pipe'] });
                const arecord = spawn('arecord', commandDef.arecordArgs, { stdio: ['ignore', 'pipe', 'pipe'] });
                currentArecord = arecord;

                audioServer.waitUntilReady.then(() => {
                    audioServer.Server.StdIn = arecord.stdout;
                    audioServer.Server.Run();
                    connectMessage(`${consoleLogTitle} Connected arecord \u2192 FFmpeg \u2192 Server.StdIn${serverConfig.audio.audioBoost && serverConfig.audio.ffmpeg ? ' (audio boost)' : ''}`);
                });

                arecord.stderr.on('data', (data) => {
                    logFfmpeg(`[arecord stderr]: ${data}`);
                });

                arecord.on('exit', (code) => {
                    logFfmpeg(`[arecord exited] with code ${code}`);
                    if (code !== 0) {
                        setTimeout(startArecord, 2000);
                    }
                });
            }
        }

        startArecord();

        if (serverConfig.audio.ffmpeg) {
            logDebug(`${consoleLogTitle} Launching FFmpeg with args: ${commandDef.args.join(' ')}`);
            const ffmpeg = spawn(ffmpegPath, commandDef.args, { stdio: ['ignore', 'pipe', 'pipe'] });

            // Pipe FFmpeg output to 3las.server.js
            audioServer.waitUntilReady.then(() => {
                audioServer.Server.StdIn = ffmpeg.stdout;
                audioServer.Server.Run();
                connectMessage(`${consoleLogTitle} Connected FFmpeg stdout \u2192 Server.StdIn${serverConfig.audio.audioBoost ? ' (audio boost)' : ''}`);
            });

            process.on('SIGINT', () => {
                ffmpeg.kill('SIGINT');
                process.exit();
            });

            process.on('exit', () => {
                ffmpeg.kill('SIGINT');
            });

            // FFmpeg stderr handling
            ffmpeg.stderr.on('data', (data) => {
                logFfmpeg(`[FFmpeg stderr]: ${data}`);
            });

            // FFmpeg exit handling
            ffmpeg.on('exit', (code) => {
                logFfmpeg(`[FFmpeg exited] with code ${code}`);
                if (code !== 0) {
                    logWarn(`${consoleLogTitle} FFmpeg exited unexpectedly with code ${code}`);
                }
            });
        }
    }
}).catch((err) => {
    logError(`${consoleLogTitle} Error: ${err.message}`);
});
