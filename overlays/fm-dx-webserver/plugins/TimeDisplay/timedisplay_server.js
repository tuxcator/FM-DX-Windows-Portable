'use strict';

const fs = require('fs');
const path = require('path');
const rootDir = path.dirname(require.main.filename);
const endpoints = require(path.join(rootDir, 'server', 'endpoints'));
const { logInfo, logWarn } = require(path.join(rootDir, 'server', 'console'));

const configDirectory = path.join(rootDir, 'plugins_configs');
const configPath = path.join(configDirectory, 'TimeDisplay.json');
const cacheLifetimeMs = 15 * 60 * 1000;
const providers = new Set(['open-meteo', 'weather-company', 'openweathermap']);
const defaults = {
    provider: 'open-meteo',
    locationName: 'Monterrey, M\u00e9xico',
    latitude: 25.6866,
    longitude: -100.3161,
    units: 'metric',
    apiKeys: { 'weather-company': '', openweathermap: '' }
};

let weatherConfig = loadConfig();
let weatherCache = null;
let pendingWeather = null;

function loadConfig() {
    try {
        if (!fs.existsSync(configPath)) return structuredClone(defaults);
        const saved = JSON.parse(fs.readFileSync(configPath, 'utf8'));
        return {
            ...structuredClone(defaults),
            ...saved,
            apiKeys: { ...defaults.apiKeys, ...(saved.apiKeys || {}) }
        };
    } catch (error) {
        logWarn(`Time Display: invalid weather config (${error.message}); defaults are used.`);
        return structuredClone(defaults);
    }
}

function saveConfig() {
    fs.mkdirSync(configDirectory, { recursive: true });
    const temporaryPath = `${configPath}.tmp`;
    fs.writeFileSync(temporaryPath, `${JSON.stringify(weatherConfig, null, 2)}\n`, 'utf8');
    fs.renameSync(temporaryPath, configPath);
}

function sanitizeConfiguration(input) {
    const provider = providers.has(input.provider) ? input.provider : weatherConfig.provider;
    const latitude = Number(input.latitude);
    const longitude = Number(input.longitude);
    if (!Number.isFinite(latitude) || latitude < -90 || latitude > 90) throw new Error('La latitud debe estar entre -90 y 90.');
    if (!Number.isFinite(longitude) || longitude < -180 || longitude > 180) throw new Error('La longitud debe estar entre -180 y 180.');
    const locationName = String(input.locationName || '').trim().slice(0, 80);
    if (!locationName) throw new Error('Escriba el nombre de la ciudad.');
    return {
        provider,
        locationName,
        latitude,
        longitude,
        units: input.units === 'imperial' ? 'imperial' : 'metric'
    };
}

function publicConfiguration(isAdmin) {
    return {
        isAdmin,
        config: {
            provider: weatherConfig.provider,
            locationName: weatherConfig.locationName,
            latitude: weatherConfig.latitude,
            longitude: weatherConfig.longitude,
            units: weatherConfig.units,
            apiKeyConfigured: {
                'weather-company': !!weatherConfig.apiKeys['weather-company'],
                openweathermap: !!weatherConfig.apiKeys.openweathermap
            }
        }
    };
}

async function fetchJson(url) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);
    try {
        const response = await fetch(url, { signal: controller.signal, headers: { accept: 'application/json' } });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return await response.json();
    } finally {
        clearTimeout(timeout);
    }
}

function openWeatherCodeToWmo(id) {
    const code = Number(id);
    if (code >= 200 && code < 300) return 95;
    if (code >= 300 && code < 400) return 53;
    if (code >= 500 && code < 600) return code >= 502 ? 65 : 61;
    if (code >= 600 && code < 700) return 73;
    if (code >= 700 && code < 800) return 45;
    if (code === 800) return 0;
    if (code === 801) return 1;
    if (code === 802) return 2;
    return 3;
}

function weatherCompanyCodeToWmo(iconCode) {
    const code = Number(iconCode);
    if ([0, 1, 2, 3, 4, 37, 38, 39, 47].includes(code)) return 95;
    if ([5, 6, 7, 8, 9, 10, 11, 12, 35, 40, 45].includes(code)) return 61;
    if ([13, 14, 15, 16, 17, 18, 41, 42, 43, 46].includes(code)) return 73;
    if ([19, 20, 21, 22].includes(code)) return 45;
    if ([26].includes(code)) return 3;
    if ([27, 28, 29, 30, 44].includes(code)) return 2;
    if ([31, 33].includes(code)) return 0;
    if ([32, 34, 36].includes(code)) return 1;
    return 2;
}

async function fetchOpenMeteo() {
    const params = new URLSearchParams({
        latitude: String(weatherConfig.latitude),
        longitude: String(weatherConfig.longitude),
        current: 'temperature_2m,relative_humidity_2m,weather_code,wind_speed_10m',
        temperature_unit: weatherConfig.units === 'imperial' ? 'fahrenheit' : 'celsius',
        wind_speed_unit: weatherConfig.units === 'imperial' ? 'mph' : 'kmh'
    });
    const data = await fetchJson(`https://api.open-meteo.com/v1/forecast?${params}`);
    return {
        temperature: Number(data.current?.temperature_2m),
        humidity: Number(data.current?.relative_humidity_2m),
        windSpeed: Number(data.current?.wind_speed_10m),
        weatherCode: Number(data.current?.weather_code),
        description: '',
        observedAt: data.current?.time || null
    };
}

async function fetchWeatherCompany() {
    const apiKey = weatherConfig.apiKeys['weather-company'];
    if (!apiKey) throw new Error('Falta la clave API de The Weather Company.');
    const params = new URLSearchParams({
        geocode: `${weatherConfig.latitude},${weatherConfig.longitude}`,
        units: weatherConfig.units === 'imperial' ? 'e' : 'm',
        language: 'es-MX',
        format: 'json',
        apiKey
    });
    const data = await fetchJson(`https://api.weather.com/v3/wx/observations/current?${params}`);
    return {
        temperature: Number(data.temperature),
        humidity: Number(data.relativeHumidity),
        windSpeed: Number(data.windSpeed),
        weatherCode: weatherCompanyCodeToWmo(data.iconCode),
        description: String(data.wxPhraseLong || ''),
        observedAt: data.validTimeLocal || null
    };
}

async function fetchOpenWeatherMap() {
    const apiKey = weatherConfig.apiKeys.openweathermap;
    if (!apiKey) throw new Error('Falta la clave API de OpenWeatherMap.');
    const params = new URLSearchParams({
        lat: String(weatherConfig.latitude),
        lon: String(weatherConfig.longitude),
        appid: apiKey,
        units: weatherConfig.units,
        lang: 'es'
    });
    const data = await fetchJson(`https://api.openweathermap.org/data/2.5/weather?${params}`);
    const rawWind = Number(data.wind?.speed);
    return {
        temperature: Number(data.main?.temp),
        humidity: Number(data.main?.humidity),
        windSpeed: weatherConfig.units === 'imperial' ? rawWind : rawWind * 3.6,
        weatherCode: openWeatherCodeToWmo(data.weather?.[0]?.id),
        description: String(data.weather?.[0]?.description || ''),
        observedAt: Number.isFinite(Number(data.dt)) ? new Date(Number(data.dt) * 1000).toISOString() : null
    };
}

async function requestProviderWeather() {
    if (weatherConfig.provider === 'weather-company') return fetchWeatherCompany();
    if (weatherConfig.provider === 'openweathermap') return fetchOpenWeatherMap();
    return fetchOpenMeteo();
}

async function getWeather(force = false) {
    const signature = JSON.stringify({
        provider: weatherConfig.provider,
        locationName: weatherConfig.locationName,
        latitude: weatherConfig.latitude,
        longitude: weatherConfig.longitude,
        units: weatherConfig.units
    });
    if (!force && weatherCache?.signature === signature && Date.now() - weatherCache.savedAt < cacheLifetimeMs) return weatherCache.data;
    if (pendingWeather) return pendingWeather;

    pendingWeather = (async () => {
        try {
            const providerData = await requestProviderWeather();
            const data = {
                ...providerData,
                provider: weatherConfig.provider,
                locationName: weatherConfig.locationName,
                temperatureUnit: weatherConfig.units === 'imperial' ? '\u00B0F' : '\u00B0C',
                windUnit: weatherConfig.units === 'imperial' ? 'mph' : 'km/h',
                updatedAt: Date.now()
            };
            if (!Number.isFinite(data.temperature)) throw new Error('El proveedor no devolvio una temperatura valida.');
            weatherCache = { signature, savedAt: Date.now(), data };
            return data;
        } catch (error) {
            if (weatherCache?.signature === signature) return { ...weatherCache.data, stale: true, warning: error.message };
            throw error;
        } finally {
            pendingWeather = null;
        }
    })();
    return pendingWeather;
}

endpoints.get('/time-display/weather', async (req, res) => {
    try {
        const force = req.query.refresh === '1' && !!req.session?.isAdminAuthenticated;
        res.json(await getWeather(force));
    } catch (error) {
        logWarn(`Time Display weather request failed: ${error.message}`);
        res.status(502).json({ error: error.message });
    }
});

endpoints.get('/time-display/weather/config', (req, res) => {
    res.json(publicConfiguration(!!req.session?.isAdminAuthenticated));
});

endpoints.post('/time-display/weather/config', async (req, res) => {
    if (!req.session?.isAdminAuthenticated) return res.status(401).json({ error: 'Se requiere iniciar sesion como administrador.' });
    try {
        const sanitized = sanitizeConfiguration(req.body || {});
        weatherConfig = { ...weatherConfig, ...sanitized };
        if (sanitized.provider !== 'open-meteo') {
            if (req.body?.clearApiKey === true) weatherConfig.apiKeys[sanitized.provider] = '';
            const suppliedKey = String(req.body?.apiKey || '').trim();
            if (suppliedKey) weatherConfig.apiKeys[sanitized.provider] = suppliedKey.slice(0, 512);
        }
        saveConfig();
        weatherCache = null;
        res.json({ ok: true, ...publicConfiguration(true) });
    } catch (error) {
        res.status(400).json({ error: error.message });
    }
});

logInfo(`Time Display weather service enabled (${weatherConfig.provider}, ${weatherConfig.locationName}).`);
module.exports = { getWeather, loadConfig };
