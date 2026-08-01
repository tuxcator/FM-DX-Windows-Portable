'use strict';

function createTuningAccess({ getConfig, logInfo = () => {} }) {
    const leases = new Map();

    function settings() {
        const configured = getConfig()?.tuningAccess || {};
        const mode = ['public', 'limited', 'admin'].includes(configured.mode)
            ? configured.mode
            : 'admin';
        return {
            mode,
            maxControllers: Number(configured.maxControllers) === 1 ? 1 : 2,
            sessionMinutes: Number(configured.sessionMinutes) === 30 ? 30 : 60
        };
    }

    function cleanup(now = Date.now()) {
        for (const [key, lease] of leases.entries()) {
            if (!lease || lease.expiresAt <= now) {
                leases.delete(key);
                logInfo('Expired tuning session released.');
            }
        }
    }

    function acquire(key) {
        const now = Date.now();
        cleanup(now);
        const limits = settings();

        if (limits.mode === 'admin') {
            return { allowed: false, reason: 'admin', expiresAt: null, active: leases.size, ...limits };
        }
        if (limits.mode === 'public') {
            return { allowed: true, reason: 'public', expiresAt: null, active: 0, ...limits };
        }

        const current = leases.get(key);
        if (current) {
            return { allowed: true, reason: 'existing', expiresAt: current.expiresAt, active: leases.size, ...limits };
        }
        if (leases.size >= limits.maxControllers) {
            return { allowed: false, reason: 'capacity', expiresAt: null, active: leases.size, ...limits };
        }

        const expiresAt = now + limits.sessionMinutes * 60 * 1000;
        leases.set(key, { expiresAt });
        logInfo('Tuning session granted (' + leases.size + '/' + limits.maxControllers + ') for ' + limits.sessionMinutes + ' minutes.');
        return { allowed: true, reason: 'granted', expiresAt, active: leases.size, ...limits };
    }

    function release(key) {
        const released = leases.delete(key);
        if (released) logInfo('Tuning session released (' + leases.size + ' active).');
        return released;
    }

    function clear() {
        leases.clear();
    }

    function status() {
        cleanup();
        return { ...settings(), active: leases.size };
    }

    const cleanupTimer = setInterval(cleanup, 30 * 1000);
    cleanupTimer.unref?.();

    return { acquire, release, clear, status };
}

module.exports = { createTuningAccess };
