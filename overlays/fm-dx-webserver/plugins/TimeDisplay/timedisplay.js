(() => {
    ////////////////////////////////////////////////////////////
    ///                                                      ///
    ///  TIME DISPLAY SCRIPT FOR FM-DX-WEBSERVER (V2.5g)     ///
    ///                                                      ///
    ///  by Highpoint                last update: 24.09.25   ///
    ///                                                      ///
    ///  https://github.com/Highpoint2000/webserver-time     ///
	///                                                      ///
    ////////////////////////////////////////////////////////////

    // Configurable options
    let showTimeOnPhone = true;		// Set to true to enable display on mobile, false to hide it
    let showDate = true;			// true to show the date, false to hide it
	let updateInfo = false; 			// Disabled for the portable weather integration

    ////////////////////////////////////////////////////////////

    const plugin_version = '2.6-portable';
	const corsAnywhereUrl = 'https://cors-proxy.de:13128/';

    let initialDisplayState = '7';
    let timeDisplayInline = JSON.parse(localStorage.getItem("timeDisplayInline")) ?? true;
	const weatherRefreshInterval = 15 * 60 * 1000;
 const weatherCacheKey = 'portableWeatherClockServerV2';
	const compactDisplayMigrationKey = 'portableWeatherClockDisplayV1';

	let isTuneAuthenticated;
	let IPadress;

	async function fetchIp() {
		try {
			const ipApiUrl = 'https://icanhazip.com'; // API to fetch own IP address
			const response = await fetch(ipApiUrl);
			const IPadress = await response.text(); // IP is returned as plain text
			console.log('Your IP address is:', IPadress.trim()); // Log the IP address (trimmed)
		} catch (error) {
			console.error('Error fetching your IP address:', error);
		}
	}

	fetchIp();

	// Define local version and Github settings
	const plugin_path = 'https://raw.githubusercontent.com/highpoint2000/webserver-time/';
	const plugin_JSfile = 'main/TimeDisplay/timedisplay.js'
	const plugin_name = 'Time Display';

	if (window.innerWidth >= 920) {

		// Check if required localStorage items are present
		const timedisplaytoastinfo = localStorage.getItem("timedisplaytoastinfo");
		setTimeout(() => {
			if (timedisplaytoastinfo === null && IPadress !== '89.58.28.164') {
				sendToast('info important', 'Time Display', `Use drag & drop to move the time display to the desired position, change the time selection (UTC, LOCAL and/or WORLD TIME) by briefly clicking on it, hold down the display to change the design (horizontal or vertical) and use the mouse wheel to change the time display to adjust the correct size..`, true, false);
				localStorage.setItem("timedisplaytoastinfo", true);
			}
		}, 1000);
	}

    // Fetch coordinates and declare variable for storing server time offset
    const LAT = localStorage.getItem('qthLatitude');
    const LON = localStorage.getItem('qthLongitude');
    let serverTimeOffset = 0; // Offset in hours from UTC

    // Function to load the offset from localStorage or fetch via API
    function loadServerTimeOffset() {
        const savedOffsetKey = `serverTimeOffset_${LAT}_${LON}`;
        const savedOffset = localStorage.getItem(savedOffsetKey);

        if (savedOffset !== null) {
            serverTimeOffset = parseFloat(savedOffset);
            console.log("UTC Offset loaded from localStorage (hours):", serverTimeOffset);

        } else {
            fetchUtcOffset(savedOffsetKey);
        }
    }

    // Fetch UTC offset from GeoNames API and save to localStorage
    function fetchUtcOffset(savedOffsetKey) {
        if (LAT && LON) {
            fetch(`${corsAnywhereUrl}http://api.geonames.org/timezoneJSON?lat=${LAT}&lng=${LON}&username=highpoint`)
                .then(response => response.json())
                .then(data => {
                    if (data) {
                        serverTimeOffset = data.rawOffset;
                        localStorage.setItem(savedOffsetKey, serverTimeOffset);
                        console.log("UTC Offset fetched and saved (hours):", serverTimeOffset);
                    }
                })
                .catch(error => console.error("Error fetching the UTC Offset:", error));
        }
    }

    function initializeTimeDisplay() {
        const phoneDisplayClass = showTimeOnPhone ? 'show-phone' : 'hide-phone';
        let displayState = localStorage.getItem('displayState');

        if (displayState === null) {
            displayState = parseInt(initialDisplayState, 10);
            localStorage.setItem('displayState', displayState);
        } else {
            displayState = parseInt(displayState, 10);
        }

        // Select the combined weather/date/time view once after this portable update.
        // Users can still click the display to cycle through the original clock views.
        if (localStorage.getItem(compactDisplayMigrationKey) !== '1') {
            displayState = 7;
            localStorage.setItem('displayState', displayState);
            localStorage.setItem(compactDisplayMigrationKey, '1');
        }


        const getCurrentTime = () => new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
        const getCurrentUTCTime = () => new Date().toUTCString().split(' ')[4];
        const getCurrentLocalDate = () => new Date().toLocaleDateString('en-GB', { weekday: 'short', day: '2-digit', month: 'short', year: 'numeric' });

        const getCompactLocalTime = () => new Date().toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit', hour12: false });
        const getCompactLocalDate = () => {
            const now = new Date();
            return `${String(now.getDate()).padStart(2, '0')}/${String(now.getMonth() + 1).padStart(2, '0')}/${now.getFullYear()}`;
        };
        const getCurrentWorldDate = () => {
            const now = new Date();
            const utcDay = now.getUTCDate().toString().padStart(2, '0');
            const utcMonth = now.toLocaleString('en-GB', { month: 'short', timeZone: 'UTC' });
            const utcYear = now.getUTCFullYear();
            const utcWeekday = now.toLocaleString('en-GB', { weekday: 'short', timeZone: 'UTC' });
            return `${utcWeekday}, ${utcDay} ${utcMonth} ${utcYear}`;
        };

		const getServerTime = () => {
			const now = new Date(); // Aktuelles Datum und Uhrzeit
			const utcNow = new Date(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), now.getUTCHours(), now.getUTCMinutes(), now.getUTCSeconds()); // Konvertiert das lokale Datum in UTC
			const serverTime = new Date(utcNow.getTime() + serverTimeOffset * 60 * 60 * 1000); // Wendet den Offset in Millisekunden an
			return serverTime.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
		};

        const getCurrentServerDate = () => {
            const nowUTC = new Date(); // Current UTC time
            const serverDate = new Date(nowUTC.getTime() - serverTimeOffset * 60 * 60 * 1000); // Apply offset in milliseconds

            return serverDate.toLocaleDateString('en-GB', { weekday: 'short', day: '2-digit', month: 'short', year: 'numeric' });
        };

        const container = document.createElement("div");
        container.id = "time-toggle-container";
        container.style.position = "relative";
        container.style.cursor = "pointer";
        container.title = `Plugin Version: ${plugin_version}`;

        if (!document.getElementById('portable-weather-clock-styles')) {
            const weatherClockStyles = document.createElement('style');
            weatherClockStyles.id = 'portable-weather-clock-styles';
            weatherClockStyles.textContent = `
                #time-toggle-container.portable-weather-clock-active {
                    position: fixed !important;
                    left: 50% !important;
                    top: 92px !important;
                    transform: translateX(-50%) !important;
                    z-index: 30 !important;
                    width: max-content !important;
                    max-width: calc(100vw - 24px);
                    padding: 8px 14px;
                    border: 1px solid rgba(255,255,255,.14);
                    border-radius: 14px;
                    background: rgba(12,18,22,.82);
                    box-shadow: 0 5px 18px rgba(0,0,0,.24);
                    backdrop-filter: blur(8px);
                    -webkit-backdrop-filter: blur(8px);
                    color: #dce9ed;
                    user-select: none;
                }
                #weather-date-time-content {
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    gap: 9px;
                    white-space: nowrap;
                    font-size: 20px;
                    line-height: 1.15;
                    font-variant-numeric: tabular-nums;
                }
                #weather-symbol { font-size: 25px; line-height: 1; }
                #weather-temperature { color: #9ee7dd; font-weight: 600; }
                #weather-divider { color: rgba(220,233,237,.48); margin: 0 2px; }
                #weather-current-date { color: #dce9ed; }
                #weather-current-time { color: #ffffff; font-weight: 600; }
                #weather-settings-panel {
                    margin: 22px auto;
                    padding: 18px;
                    max-width: 760px;
                    border: 1px solid rgba(255,255,255,.12);
                    border-radius: 15px;
                    background: rgba(15,22,27,.72);
                    text-align: left;
                }
                #weather-settings-panel h2 { margin-top: 0; }
                .weather-settings-grid { display: grid; grid-template-columns: repeat(2,minmax(0,1fr)); gap: 12px; }
                .weather-settings-grid label, #weather-api-row > label { display: flex; flex-direction: column; gap: 5px; }
                .weather-config-control {
                    box-sizing: border-box;
                    width: 100%;
                    min-height: 40px;
                    padding: 8px 10px;
                    border: 1px solid rgba(255,255,255,.16);
                    border-radius: 10px;
                    background: #171d21;
                    color: #e8eeee;
                }
                #weather-api-row { margin-top: 14px; }
                .weather-settings-check { display: inline-flex !important; flex-direction: row !important; align-items: center; margin: 10px 14px 0 0; }
                .weather-settings-actions { display: flex; align-items: center; gap: 12px; margin-top: 15px; }
                #weather-save { padding: 9px 16px; border: 0; border-radius: 10px; background: #54bea1; color: #102019; font-weight: 700; cursor: pointer; }
                #weather-save:disabled { opacity: .55; cursor: wait; }
                #weather-settings-status { color: #9ee7dd; }
                @media (max-width: 650px) { .weather-settings-grid { grid-template-columns: 1fr; } }
                @media (max-width: 520px) {
                    #time-toggle-container.portable-weather-clock-active { top: 72px !important; padding: 7px 10px; }
                    #weather-date-time-content { gap: 6px; font-size: 15px; }
                    #weather-symbol { font-size: 20px; }
                    #weather-divider { margin: 0; }
                }
            `;
            document.head.appendChild(weatherClockStyles);
        }

        if (!window.location.href.includes("setup")) {
            container.style.zIndex = "1";
        }

        const wrapperElement = document.getElementById("wrapper");
        if (wrapperElement) {
            wrapperElement.prepend(container);
        } else {
            console.error("Element with id #wrapper not found.");
        }

        const savedPosition = JSON.parse(localStorage.getItem('timeDisplayPosition'));

        if (window.innerWidth >= 930) {
            if (!savedPosition) {
				let tunerInfoPanel = document.querySelector('.panel-100.no-bg.tuner-info');
				if (tunerInfoPanel) {
					if (window.innerHeight <= 860) {
						container.style.left = "0px";
					} else {
						container.style.left = "-450px";
					}
				} else {
					if (window.innerHeight <= 860) {
						container.style.left = "-450px";
					} else {
						container.style.left = "0px";
					}
				}
				container.style.top = "115px";
                container.style.width = "auto";
            } else {
                container.style.left = `${savedPosition.x}px`;
                container.style.top = `${savedPosition.y}px`;
            }
        } else {
            container.style.left = "50%";
            container.style.transform = "translateX(-47.5%)";
            container.style.top = "20px";
            container.style.width = "340px";
        }

        let fontSizeTime = JSON.parse(localStorage.getItem("fontSizeTime")) ?? 28;

        function updateFontSizes() {
            let adjustedFontSizeTime = window.innerWidth <= 768 && displayState === 3 ? fontSizeTime * 0.75 : fontSizeTime;

            let adjustedFontLabelSize = adjustedFontSizeTime / 2;
            let adjustedFontDateSize = (adjustedFontSizeTime / 1.5) - 3;

            const timeElements = container.querySelectorAll(".text");
            timeElements.forEach(el => el.style.fontSize = `${adjustedFontSizeTime}px`);

            const labelElements = container.querySelectorAll("h2");
            labelElements.forEach(el => el.style.fontSize = `${adjustedFontLabelSize}px`);

            const dateElements = container.querySelectorAll(".date-display");
            dateElements.forEach(el => el.style.fontSize = `${adjustedFontDateSize}px`);
        }

container.addEventListener("wheel", (event) => {
    event.preventDefault();

    // Adjust font size based on wheel direction
    if (event.deltaY < 0) {
        // Increase font size, but not above 20
        fontSizeTime = Math.min(fontSizeTime + 2, 35);
    } else {
        // Decrease font size, but not below 5
        fontSizeTime = Math.max(fontSizeTime - 2, 20);
    }

    // Update font sizes based on the new fontSizeTime
    updateFontSizes();

    // Store the current font size in localStorage
    localStorage.setItem("fontSizeTime", JSON.stringify(fontSizeTime));
});


        let isDragging = false;
        let wasDragged = false;
        let startX, startY, initialX, initialY;

		// Beim Laden der Seite die Position aus localStorage setzen
		window.addEventListener('load', () => {
			const savedPosition = JSON.parse(localStorage.getItem("timeDisplayPosition"));
			if (savedPosition) {
				container.style.left = `${savedPosition.x}px`;
				container.style.top = `${savedPosition.y}px`;
			}
		});

		container.addEventListener("mousedown", (event) => {
			isDragging = true;
			wasDragged = false;

			// Berechne den Startpunkt der Maus
			startX = event.clientX;
			startY = event.clientY;

			// Berechne die aktuelle Position des Containers
			initialX = parseInt(container.style.left || 0, 10); // Default 0, falls keine Position gesetzt wurde
			initialY = parseInt(container.style.top || 0, 10);  // Default 0, falls keine Position gesetzt wurde
		});

		document.addEventListener("mousemove", (event) => {
			if (isDragging) {
				const dx = event.clientX - startX;
				const dy = event.clientY - startY;

				// Setze die neue Position des Containers
				container.style.left = `${initialX + dx}px`;
				container.style.top = `${initialY + dy}px`;

				wasDragged = true;
			}
		});

		document.addEventListener("mouseup", () => {
			if (isDragging) {
				// Speichere die Position nach dem Loslassen der Maus
				const newPosition = {
					x: parseInt(container.style.left, 10),
					y: parseInt(container.style.top, 10)
				};
				localStorage.setItem("timeDisplayPosition", JSON.stringify(newPosition));
				isDragging = false;
			}
		});


        let isLongPress = false;
        let longPressTimeout;

        container.addEventListener("mousedown", () => {
            longPressTimeout = setTimeout(() => {
                isLongPress = true;
                timeDisplayInline = !timeDisplayInline;
                localStorage.setItem("timeDisplayInline", JSON.stringify(timeDisplayInline));
                setDisplay();
                console.log("timeDisplayInline toggled:", timeDisplayInline);
            }, 2500);
        });

        container.addEventListener("mouseup", () => {
            clearTimeout(longPressTimeout);
            isLongPress = false;
        });

        container.addEventListener("click", () => {
            if (!isLongPress && !wasDragged) {
                displayState = (displayState + 1) % 8;
                localStorage.setItem("displayState", displayState);
                setDisplay();
            }
        });

        let weatherSnapshot = {
            temperature: null,
            weatherCode: 2,
            humidity: null,
            windSpeed: null,
            locationName: 'Monterrey, M\u00e9xico',
            temperatureUnit: '\u00B0C',
            windUnit: 'km/h',
            description: '',
            provider: 'open-meteo',
            stale: false
        };

        const getWeatherPresentation = (weatherCode) => {
            const code = Number(weatherCode);
            if (code === 0) return { symbol: '\u2600\uFE0F', description: 'Despejado' };
            if (code === 1) return { symbol: '\uD83C\uDF24\uFE0F', description: 'Mayormente despejado' };
            if (code === 2) return { symbol: '\u26C5', description: 'Parcialmente nublado' };
            if (code === 3) return { symbol: '\u2601\uFE0F', description: 'Nublado' };
            if (code === 45 || code === 48) return { symbol: '\uD83C\uDF2B\uFE0F', description: 'Niebla' };
            if ([51, 53, 55, 56, 57].includes(code)) return { symbol: '\uD83C\uDF26\uFE0F', description: 'Llovizna' };
            if ([61, 63, 65, 66, 67, 80, 81, 82].includes(code)) return { symbol: '\uD83C\uDF27\uFE0F', description: 'Lluvia' };
            if ([71, 73, 75, 77, 85, 86].includes(code)) return { symbol: '\uD83C\uDF28\uFE0F', description: 'Nieve' };
            if ([95, 96, 99].includes(code)) return { symbol: '\u26C8\uFE0F', description: 'Tormenta' };
            return { symbol: '\uD83C\uDF24\uFE0F', description: 'Estado del tiempo' };
        };

        const updateWeatherDisplay = () => {
            const presentation = getWeatherPresentation(weatherSnapshot.weatherCode);
            const symbolElement = document.getElementById('weather-symbol');
            const temperatureElement = document.getElementById('weather-temperature');
            const contentElement = document.getElementById('weather-date-time-content');
            const temperature = Number.isFinite(weatherSnapshot.temperature) ? `${Math.round(weatherSnapshot.temperature)} ${weatherSnapshot.temperatureUnit}` : `-- ${weatherSnapshot.temperatureUnit}`;

            if (symbolElement) symbolElement.textContent = presentation.symbol;
            if (temperatureElement) temperatureElement.textContent = temperature;
            if (contentElement) {
                const description = weatherSnapshot.description || presentation.description;
                const details = [weatherSnapshot.locationName, description, temperature];
                if (Number.isFinite(weatherSnapshot.humidity)) details.push(`Humedad: ${Math.round(weatherSnapshot.humidity)}%`);
                if (Number.isFinite(weatherSnapshot.windSpeed)) details.push(`Viento: ${Math.round(weatherSnapshot.windSpeed)} ${weatherSnapshot.windUnit}`);
                if (weatherSnapshot.stale) details.push('Dato en cache');
                contentElement.title = details.join(' \u00B7 ');
                contentElement.setAttribute('aria-label', details.join(', '));
            }
        };

        const loadCachedWeather = () => {
            try {
                const cached = JSON.parse(localStorage.getItem(weatherCacheKey));
                if (cached && Number.isFinite(cached.temperature)) weatherSnapshot = cached;
            } catch (error) {
                localStorage.removeItem(weatherCacheKey);
            }
        };

        const refreshWeather = async (force = false) => {
            const controller = new AbortController();
            const timeout = setTimeout(() => controller.abort(), 10000);
            try {
                const endpoint = force ? './time-display/weather?refresh=1' : './time-display/weather';
                const response = await fetch(endpoint, { signal: controller.signal, cache: 'no-store', credentials: 'same-origin' });
                const data = await response.json();
                if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
                weatherSnapshot = {
                    temperature: Number(data.temperature),
                    weatherCode: Number(data.weatherCode),
                    humidity: Number(data.humidity),
                    windSpeed: Number(data.windSpeed),
                    locationName: String(data.locationName || 'Monterrey'),
                    temperatureUnit: String(data.temperatureUnit || '\u00B0C'),
                    windUnit: String(data.windUnit || 'km/h'),
                    description: String(data.description || ''),
                    provider: String(data.provider || 'open-meteo'),
                    stale: data.stale === true,
                    timestamp: Number(data.updatedAt) || Date.now()
                };
                localStorage.setItem(weatherCacheKey, JSON.stringify(weatherSnapshot));
                updateWeatherDisplay();
                return true;
            } catch (error) {
                console.warn('Time Display: no se pudo actualizar el clima; se conserva el ultimo valor.', error);
                return false;
            } finally {
                clearTimeout(timeout);
            }
        };

        const initializeWeatherSettings = async () => {
            try {
                const response = await fetch('./time-display/weather/config', { cache: 'no-store', credentials: 'same-origin' });
                if (!response.ok) return;
                const payload = await response.json();
                const host = document.querySelector('#myModal .modal-panel-content');
                if (!host || document.getElementById('weather-settings-panel')) return;

                const panel = document.createElement('section');
                panel.id = 'weather-settings-panel';
                panel.innerHTML = `
                    <h2>Clima, fecha y hora</h2>
                    <p class="text-gray">Configuracion global del indicador del dashboard. Las claves API permanecen en el servidor.</p>
                    <div class="weather-settings-grid">
                        <label>Proveedor<select id="weather-provider" class="weather-config-control">
                            <option value="open-meteo">Open-Meteo (sin clave)</option>
                            <option value="weather-company">The Weather Company / Weather Channel</option>
                            <option value="openweathermap">OpenWeatherMap</option>
                        </select></label>
                        <label>Ciudad<input id="weather-location-name" class="weather-config-control" maxlength="80"></label>
                        <label>Latitud<input id="weather-latitude" class="weather-config-control" type="number" min="-90" max="90" step="0.0001"></label>
                        <label>Longitud<input id="weather-longitude" class="weather-config-control" type="number" min="-180" max="180" step="0.0001"></label>
                        <label>Unidades<select id="weather-units" class="weather-config-control"><option value="metric">Celsius / km/h</option><option value="imperial">Fahrenheit / mph</option></select></label>
                    </div>
                    <div id="weather-api-row" hidden>
                        <label>Clave API<input id="weather-api-key" class="weather-config-control" type="password" autocomplete="new-password"></label>
                        <label class="weather-settings-check"><input id="weather-show-key" type="checkbox"> Mostrar clave</label>
                        <label class="weather-settings-check"><input id="weather-clear-key" type="checkbox"> Eliminar clave guardada</label>
                        <p id="weather-provider-help" class="text-gray"></p>
                    </div>
                    <div class="weather-settings-actions"><button id="weather-save" type="button">Guardar clima</button><span id="weather-settings-status" role="status"></span></div>`;
                host.appendChild(panel);

                const config = payload.config;
                const provider = panel.querySelector('#weather-provider');
                const apiRow = panel.querySelector('#weather-api-row');
                const apiKey = panel.querySelector('#weather-api-key');
                const clearKey = panel.querySelector('#weather-clear-key');
                const status = panel.querySelector('#weather-settings-status');
                const saveButton = panel.querySelector('#weather-save');
                let configuredKeys = { ...config.apiKeyConfigured };
                provider.value = config.provider;
                panel.querySelector('#weather-location-name').value = config.locationName;
                panel.querySelector('#weather-latitude').value = config.latitude;
                panel.querySelector('#weather-longitude').value = config.longitude;
                panel.querySelector('#weather-units').value = config.units;

                const updateProviderFields = () => {
                    const selected = provider.value;
                    apiRow.hidden = selected === 'open-meteo';
                    apiKey.value = '';
                    apiKey.placeholder = configuredKeys[selected] ? 'Clave configurada (dejar vacio para conservar)' : 'Pegue aqui la clave API';
                    clearKey.checked = false;
                    clearKey.disabled = !configuredKeys[selected];
                    panel.querySelector('#weather-provider-help').innerHTML = selected === 'weather-company'
                        ? 'Requiere acceso y clave de <a href="https://developer.weather.com/" target="_blank" rel="noopener">The Weather Company</a>.'
                        : 'Obtenga una clave en <a href="https://openweathermap.org/api" target="_blank" rel="noopener">OpenWeatherMap</a>.';
                };
                provider.addEventListener('change', updateProviderFields);
                panel.querySelector('#weather-show-key').addEventListener('change', event => { apiKey.type = event.target.checked ? 'text' : 'password'; });
                updateProviderFields();
                if (!payload.isAdmin) {
                    panel.querySelectorAll('input, select, button').forEach(element => { element.disabled = true; });
                    status.textContent = 'Inicie sesion como administrador para cambiar el clima.';
                    return;
                }


                saveButton.addEventListener('click', async () => {
                    saveButton.disabled = true;
                    status.textContent = 'Guardando...';
                    try {
                        const body = {
                            provider: provider.value,
                            locationName: panel.querySelector('#weather-location-name').value,
                            latitude: Number(panel.querySelector('#weather-latitude').value),
                            longitude: Number(panel.querySelector('#weather-longitude').value),
                            units: panel.querySelector('#weather-units').value,
                            apiKey: apiKey.value,
                            clearApiKey: clearKey.checked
                        };
                        const saveResponse = await fetch('./time-display/weather/config', {
                            method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body)
                        });
                        const result = await saveResponse.json();
                        if (!saveResponse.ok) throw new Error(result.error || `HTTP ${saveResponse.status}`);
                        configuredKeys = { ...result.config.apiKeyConfigured };
                        const refreshed = await refreshWeather(true);
                        status.textContent = refreshed ? 'Configuracion guardada.' : 'Guardado; revise la clave o conexion del proveedor.';
                        updateProviderFields();
                    } catch (error) {
                        status.textContent = error.message;
                    } finally {
                        saveButton.disabled = false;
                    }
                });
            } catch (error) {
                console.warn('Time Display: no se pudo cargar el menu meteorologico.', error);
            }
        };

        const WeatherDateTimeContainerHtml = () => `
            <div id="weather-date-time-content" role="group">
                <span id="weather-symbol" aria-hidden="true">&#x1F324;&#xFE0F;</span>
                <span id="weather-temperature">-- &deg;C</span>
                <span id="weather-divider" aria-hidden="true">|</span>
                <span id="weather-current-date">${getCompactLocalDate()}</span>
                <span id="weather-current-time">${getCompactLocalTime()}</span>
            </div>`;
        const setDisplay = () => {
            container.classList.toggle('portable-weather-clock-active', displayState === 7);
            if (displayState === 7) {
                container.innerHTML = WeatherDateTimeContainerHtml();
                updateWeatherDisplay();
            } else if (displayState === 0) {
                container.innerHTML = WorldLocalContainerHtml();
            } else if (displayState === 1) {
                container.innerHTML = WorldServerContainerHtml();
            } else if (displayState === 2) {
                container.innerHTML = LocalServerContainerHtml();
            } else if (displayState === 3) {
                container.innerHTML = LocalServerWorldContainerHtml();
            } else if (displayState === 4) {
                container.innerHTML = LocalTimeContainerHtml();
            } else if (displayState === 5) {
                container.innerHTML = WorldTimeContainerHtml();
            } else if (displayState === 6) {
                container.innerHTML = ServerTimeContainerHtml();
            }
            updateFontSizes();
        };

        const localDateHtml = showDate ? `<div class="${phoneDisplayClass} date-display" style="margin-top: -10px; font-size: ${fontSizeTime / 6}px;" id="local-date">${getCurrentLocalDate()}</div>` : '<div style="min-width: 100px; display:inline-block;"></div>';
		const WorldDateHtml = showDate ? `<div class="${phoneDisplayClass} date-display" style="margin-top: -10px; font-size: ${fontSizeTime / 6}px;" id="world-date">${getCurrentWorldDate()}</div>` : '<div style="min-width: 100px; display:inline-block;"></div>';
        const serverDateHtml = showDate ? `<div class="${phoneDisplayClass} date-display" style="margin-top: -10px; font-size: ${fontSizeTime / 6}px;" id="server-date">${getCurrentServerDate()}</div>` : '<div style="min-width: 100px; display:inline-block;"></div>';

        const WorldLocalContainerHtml = () => {

            if (timeDisplayInline) {
                return `
                    <div id="time-content" style="display: flex; align-items: center; justify-content: center;">
                        <div id="utc-container" style="text-align: center; margin-right: 20px;">
                            <h2 class="${phoneDisplayClass}" style="margin: -10px; font-size: ${fontSizeTime / 2}px;" id="utc-label">WORLD TIME</h2>
                            <div class="${phoneDisplayClass} text" style="margin: -10px; font-size: ${fontSizeTime}px;" id="current-world-time">${getCurrentUTCTime()}</div>
                            ${WorldDateHtml}
                        </div>
                        <div id="local-container" style="text-align: center; margin-right: 20px;">
                            <h2 class="${phoneDisplayClass}" style="margin: -10px; font-size: ${fontSizeTime / 2}px;" id="local-label">LOCAL TIME</h2>
                            <div class="${phoneDisplayClass} text" style="margin: -10px; font-size: ${fontSizeTime}px;" id="current-local-time">${getCurrentTime()}</div>
                            ${localDateHtml}
                        </div>
                    </div>`;
            } else {
                return `
                    <div id="time-content" style="text-align: center;">
                        <div id="utc-container">
                            <h2 class="${phoneDisplayClass}" style="margin: -10px; font-size: ${fontSizeTime / 2}px;" id="utc-label">WORLD TIME</h2>
                            <div class="${phoneDisplayClass} text" style="margin: -10px; font-size: ${fontSizeTime}px;" id="current-world-time">${getCurrentUTCTime()}</div>
                            ${WorldDateHtml}
                        </div>
                        <div id="local-container" style="margin-top: 30px;">
                            <h2 class="${phoneDisplayClass}" style="margin: -10px; font-size: ${fontSizeTime / 2}px;" id="local-label">LOCAL TIME</h2>
                            <div class="${phoneDisplayClass} text" style="margin: -10px; font-size: ${fontSizeTime}px;" id="current-local-time">${getCurrentTime()}</div>
                            ${localDateHtml}
                        </div>
                    </div>`;
            }

		};

		const WorldServerContainerHtml = () => {

			if (timeDisplayInline) {
                return `
                    <div id="time-content" style="display: flex; align-items: center; justify-content: center;">
                        <div id="utc-container" style="text-align: center; margin-right: 20px;">
                            <h2 class="${phoneDisplayClass}" style="margin: -10px; font-size: ${fontSizeTime / 2}px;" id="utc-label">WORLD TIME</h2>
                            <div class="${phoneDisplayClass} text" style="margin: -10px; font-size: ${fontSizeTime}px;" id="current-world-time">${getCurrentUTCTime()}</div>
                            ${WorldDateHtml}
                        </div>
                        <div id="server-container" style="text-align: center; margin-right: 20px;">
                            <h2 class="${phoneDisplayClass}" style="margin: -10px; font-size: ${fontSizeTime / 2}px;" id="server-label">SERVER TIME</h2>
                            <div class="${phoneDisplayClass} text" style="margin: -10px; font-size: ${fontSizeTime}px;" id="current-server-time">${getServerTime()}</div>
                            ${serverDateHtml}
                        </div>
                    </div>`;
            } else {
                return `
                    <div id="time-content" style="text-align: center;">
                        <div id="utc-container">
                            <h2 class="${phoneDisplayClass}" style="margin: -10px; font-size: ${fontSizeTime / 2}px;" id="utc-label">WORLD TIME</h2>
                            <div class="${phoneDisplayClass} text" style="margin: -10px; font-size: ${fontSizeTime}px;" id="current-world-time">${getCurrentUTCTime()}</div>
                            ${WorldDateHtml}
                        </div>
                        <div id="server-container" style="margin-top: 30px;">
                            <h2 class="${phoneDisplayClass}" style="margin: -10px; font-size: ${fontSizeTime / 2}px;" id="server-label">SERVER TIME</h2>
                            <div class="${phoneDisplayClass} text" style="margin: -10px; font-size: ${fontSizeTime}px;" id="current-server-time">${getServerTime()}</div>
                            ${serverDateHtml}
                        </div>
                    </div>`;
            }

		};

		const LocalServerContainerHtml = () => {

		if (timeDisplayInline) {
            return `
                    <div id="time-content" style="display: flex; align-items: center; justify-content: center;">
                        <div id="local-container" style="text-align: center; margin-right: 20px;">
                            <h2 class="${phoneDisplayClass}" style="margin: -10px; font-size: ${fontSizeTime / 2}px;" id="local-label">LOCAL TIME</h2>
                            <div class="${phoneDisplayClass} text" style="margin: -10px; font-size: ${fontSizeTime}px;" id="current-local-time">${getCurrentTime()}</div>
                            ${localDateHtml}
                        </div>
                        <div id="server-container" style="text-align: center; margin-right: 20px;">
                            <h2 class="${phoneDisplayClass}" style="margin: -10px; font-size: ${fontSizeTime / 2}px;" id="server-label">SERVER TIME</h2>
                            <div class="${phoneDisplayClass} text" style="margin: -10px; font-size: ${fontSizeTime}px;" id="current-server-time">${getServerTime()}</div>
                            ${serverDateHtml}
                        </div>
                    </div>`;
            } else {
                return `
                    <div id="time-content" style="text-align: center;">
                        <div id="local-container">
                            <h2 class="${phoneDisplayClass}" style="margin: -10px; font-size: ${fontSizeTime / 2}px;" id="local-label">LOCAL TIME</h2>
                            <div class="${phoneDisplayClass} text" style="margin: -10px; font-size: ${fontSizeTime}px;" id="current-local-time">${getCurrentTime()}</div>
                            ${localDateHtml}
                        </div>
                        <div id="server-container" style="margin-top: 30px;">
                            <h2 class="${phoneDisplayClass}" style="margin: -10px; font-size: ${fontSizeTime / 2}px;" id="server-label">SERVER TIME</h2>
                            <div class="${phoneDisplayClass} text" style="margin: -10px; font-size: ${fontSizeTime}px;" id="current-server-time">${getServerTime()}</div>
                            ${serverDateHtml}
                        </div>
                    </div>`;
            }

		};

		const LocalServerWorldContainerHtml = () => {

			if (timeDisplayInline) {
                return `
                    <div id="time-content" style="display: flex; align-items: center; justify-content: center;">
                        <div id="local-container" style="text-align: center; margin-right: 20px;">
                            <h2 class="${phoneDisplayClass}" style="margin: -10px; font-size: ${fontSizeTime / 2}px;" id="local-label">LOCAL TIME</h2>
                            <div class="${phoneDisplayClass} text" style="margin: -10px; font-size: ${fontSizeTime}px;" id="current-local-time">${getCurrentTime()}</div>
                            ${localDateHtml}
                        </div>
                        <div id="server-container" style="text-align: center; margin-right: 20px;">
                            <h2 class="${phoneDisplayClass}" style="margin: -10px; font-size: ${fontSizeTime / 2}px;" id="server-label">SERVER TIME</h2>
                            <div class="${phoneDisplayClass} text" style="margin: -10px; font-size: ${fontSizeTime}px;" id="current-server-time">${getServerTime()}</div>
                            ${serverDateHtml}
                        </div>
						    <div id="utc-container" style="text-align: center; margin-right: 20px;">
                            <h2 class="${phoneDisplayClass}" style="margin: -10px; font-size: ${fontSizeTime / 2}px;" id="utc-label">WORLD TIME</h2>
                            <div class="${phoneDisplayClass} text" style="margin: -10px; font-size: ${fontSizeTime}px;" id="current-world-time">${getCurrentUTCTime()}</div>
                            ${WorldDateHtml}
                        </div>
                    </div>`;
            } else {
                return `
                    <div id="time-content" style="text-align: center;">
                        <div id="local-container">
                            <h2 class="${phoneDisplayClass}" style="margin: -10px; font-size: ${fontSizeTime / 2}px;" id="local-label">LOCAL TIME</h2>
                            <div class="${phoneDisplayClass} text" style="margin: -10px; font-size: ${fontSizeTime}px;" id="current-local-time">${getCurrentTime()}</div>
                            ${localDateHtml}
                        </div>
                        <div id="server-container" style="margin-top: 30px;">
                            <h2 class="${phoneDisplayClass}" style="margin: -10px; font-size: ${fontSizeTime / 2}px;" id="server-label">SERVER TIME</h2>
                            <div class="${phoneDisplayClass} text" style="margin: -10px; font-size: ${fontSizeTime}px;" id="current-server-time">${getServerTime()}</div>
                            ${serverDateHtml}
                        </div>
						<div id="utc-container" style="margin-top: 30px;">
                            <h2 class="${phoneDisplayClass}" style="margin: -10px; font-size: ${fontSizeTime / 2}px;" id="utc-label">WORLD TIME</h2>
                            <div class="${phoneDisplayClass} text" style="margin: -10px; font-size: ${fontSizeTime}px;" id="current-world-time">${getCurrentUTCTime()}</div>
                            ${WorldDateHtml}
                        </div>
                    </div>`;
            }

		};

	    const LocalTimeContainerHtml = () => {
            return `
                <div id="time-content" style="text-align: center;">
                    <h2 class="${phoneDisplayClass}" style="margin: -10px; font-size: ${fontSizeTime / 2}px; text-align: center;" id="single-label" class="mb-0">LOCAL TIME</h2>
                    <div class="${phoneDisplayClass} text" style="margin: -10px; font-size: ${fontSizeTime}px;" id="current-local-time">${getCurrentTime()}</div>
                    ${localDateHtml}
                </div>`;
        };

        const WorldTimeContainerHtml = () => {
            return `
                <div id="time-content" style="text-align: center;">
                    <h2 class="${phoneDisplayClass}" style="margin: -10px; font-size: ${fontSizeTime / 2}px; text-align: center;" id="single-label" class="mb-0">WORLD TIME</h2>
                    <div class="${phoneDisplayClass} text" style="margin: -10px; font-size: ${fontSizeTime}px;" id="current-world-time">${getCurrentUTCTime()}</div>
                    ${WorldDateHtml}
                </div>`;
        };

        const ServerTimeContainerHtml = () => {
            return `
                <div id="time-content" style="text-align: center;">
                    <h2 class="${phoneDisplayClass}" style="margin: -10px; font-size: ${fontSizeTime / 2}px; text-align: center;" id="single-label" class="mb-0">SERVER TIME</h2>
                    <div class="${phoneDisplayClass} text" style="margin: -10px; font-size: ${fontSizeTime}px;" id="current-server-time">${getServerTime()}</div>
                    ${serverDateHtml}
                </div>`;
        };

        setDisplay();
        loadCachedWeather();
        updateWeatherDisplay();
        refreshWeather();
        setInterval(refreshWeather, weatherRefreshInterval);
        initializeWeatherSettings();

        const updateTime = () => {

            const currentTimeElement = document.getElementById("current-local-time");
            const currentUtcTimeElement = document.getElementById("current-world-time");
			const currentServerTimeElement = document.getElementById("current-server-time");

			if (currentTimeElement) currentTimeElement.textContent = getCurrentTime();
            if (currentUtcTimeElement) currentUtcTimeElement.textContent = getCurrentUTCTime();
			if (currentServerTimeElement) currentServerTimeElement.textContent = getServerTime();

            const localDateElement = document.getElementById("local-date");
            if (localDateElement) localDateElement.textContent = getCurrentLocalDate();

            const WorldDateElement = document.getElementById("world-date");
            if (WorldDateElement) WorldDateElement.textContent = getCurrentWorldDate();

            const serverDateElement = document.getElementById("server-date");
            if (serverDateElement) serverDateElement.textContent = getCurrentServerDate();

            const compactDateElement = document.getElementById('weather-current-date');
            const compactTimeElement = document.getElementById('weather-current-time');
            if (compactDateElement) compactDateElement.textContent = getCompactLocalDate();
            if (compactTimeElement) compactTimeElement.textContent = getCompactLocalTime();
        };

        setInterval(updateTime, 1000);

        const tunerInfoPanel = document.querySelector(".tuner-info");

        function updateTunerInfoSpacing() {
            while (tunerInfoPanel && tunerInfoPanel.previousSibling && tunerInfoPanel.previousSibling.nodeName === "BR") {
                tunerInfoPanel.parentNode.removeChild(tunerInfoPanel.previousSibling);
            }

            if (window.innerWidth < 930 && tunerInfoPanel && showTimeOnPhone) {
                const brCount = (window.innerWidth <= 768 && !timeDisplayInline) ? 7 : 2;
                const brTags = "<br>".repeat(brCount);
                tunerInfoPanel.insertAdjacentHTML("beforebegin", brTags);
            }
        }

        updateTunerInfoSpacing();
        window.addEventListener("resize", updateTunerInfoSpacing);
    }

  const PluginUpdateKey = `${plugin_name}_lastUpdateNotification`; // Unique key for localStorage

 // Function to check if the notification was shown today
  function shouldShowNotification() {
    const lastNotificationDate = localStorage.getItem(PluginUpdateKey);
    const today = new Date().toISOString().split('T')[0]; // Get current date in YYYY-MM-DD format

    if (lastNotificationDate === today) {
      return false; // Notification already shown today
    }
    // Update the date in localStorage to today
    localStorage.setItem(PluginUpdateKey, today);
    return true;
  }

  // Function to check plugin version
  function checkPluginVersion() {
    // Fetch and evaluate the plugin script
    fetch(`${plugin_path}${plugin_JSfile}`)
      .then(response => response.text())
      .then(script => {
        // Search for plugin_version in the external script
        const pluginVersionMatch = script.match(/const plugin_version = '([\d.]+[a-z]*)?';/);
        if (!pluginVersionMatch) {
          console.error(`${plugin_name}: Plugin version could not be found`);
          return;
        }

        const externalPluginVersion = pluginVersionMatch[1];

        // Function to compare versions
		function compareVersions(local, remote) {
			const parseVersion = (version) =>
				version.split(/(\d+|[a-z]+)/i).filter(Boolean).map((part) => (isNaN(part) ? part : parseInt(part, 10)));

			const localParts = parseVersion(local);
			const remoteParts = parseVersion(remote);

			for (let i = 0; i < Math.max(localParts.length, remoteParts.length); i++) {
				const localPart = localParts[i] || 0; // Default to 0 if part is missing
				const remotePart = remoteParts[i] || 0;

				if (typeof localPart === 'number' && typeof remotePart === 'number') {
					if (localPart > remotePart) return 1;
					if (localPart < remotePart) return -1;
				} else if (typeof localPart === 'string' && typeof remotePart === 'string') {
					// Lexicographical comparison for strings
					if (localPart > remotePart) return 1;
					if (localPart < remotePart) return -1;
				} else {
					// Numeric parts are "less than" string parts (e.g., `3.5` < `3.5a`)
					return typeof localPart === 'number' ? -1 : 1;
				}
			}

			return 0; // Versions are equal
		}


        // Check version and show notification if needed
        const comparisonResult = compareVersions(plugin_version, externalPluginVersion);
        if (comparisonResult === 1) {
          // Local version is newer than the external version
          console.log(`${plugin_name}: The local version is newer than the plugin version.`);
        } else if (comparisonResult === -1) {
          // External version is newer and notification should be shown
          if (shouldShowNotification()) {
            console.log(`${plugin_name}: Plugin update available: ${plugin_version} -> ${externalPluginVersion}`);
			sendToast('warning important', `${plugin_name}`, `Update available:<br>${plugin_version} -> ${externalPluginVersion}`, false, false);
            }
        } else {
          // Versions are the same
          console.log(`${plugin_name}: The local version matches the plugin version.`);
        }
      })
      .catch(error => {
        console.error(`${plugin_name}: Error fetching the plugin script:`, error);
      });
	}

  // Function to check if the user is logged in as an administrator
    function checkAdminMode() {
        const bodyText = document.body.textContent || document.body.innerText;
        let isAdminLoggedIn = bodyText.includes("You are logged in as an administrator.") || bodyText.includes("You are logged in as an adminstrator.");

        if (isAdminLoggedIn) {
            console.log(`Admin mode found`);
            isTuneAuthenticated = true;
        }
    }

	checkAdminMode(); // Check admin mode
    loadServerTimeOffset();

	setTimeout(() => {
		initializeTimeDisplay();
		// Execute the plugin version check if updateInfo is true
		if (updateInfo && isTuneAuthenticated) {
			checkPluginVersion();
			}
		}, 200);

})();