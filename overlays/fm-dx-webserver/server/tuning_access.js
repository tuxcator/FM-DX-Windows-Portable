'use strict';

function createTuningAccess({ getConfig, logInfo = () => {} }) {
    const leases = new Map();

    function limits() {
        const configured = getConfig()?.tuningAccess || {};
        return {
            maxControllers: Number(configured.maxControllers) === 1 ? 1 : 2,
            sessionMinutes: Number(configured.sessionMinutes) === 30 ? 30 : 60
        };
    }

    function cleanup(now = Date.now()) {
        for (const [key, lease] of leases.entries()) {
            if (!lease || lease.expiresAt <= now) leases.delete(key);
        }
    }

    function acquire(key) {
        const now = Date.now();
        cleanup(now);
        const { maxControllers, sessionMinutes } = limits();
        const current = leases.get(key);
        if (current) {
            return { allowed: true, expiresAt: current.expiresAt, maxControllers, sessionMinutes, active: leases.size };
        }
        if (leases.size >= maxControllers) {
            return { allowed: false, expiresAt: null, maxControllers, sessionMinutes, active: leases.size };
        }
        const expiresAt = now + sessionMinutes * 60 * 1000;
        leases.set(key, { expiresAt });
        logInfo(`Tuning slot granted (${leases.size}/${maxControllers}) for ${sessionMinutes} minutes.`);
        return { allowed: true, expiresAt, maxControllers, sessionMinutes, active: leases.size };
    }

    function release(key) {
        leases.delete(key);
    }

    function status() {
        cleanup();
        return { ...limits(), active: leases.size };
    }

    const cleanupTimer = setInterval(cleanup, 60 * 1000);
    cleanupTimer.unref?.();

    return { acquire, release, status };
}

module.exports = { createTuningAccess };
