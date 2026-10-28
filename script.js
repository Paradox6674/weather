(() => {
  "use strict";

  const GEO_URL = "https://geocoding-api.open-meteo.com/v1/search";
  const FORECAST_URL = "https://api.open-meteo.com/v1/forecast";
  const DEFAULT_PLACE = { name: "Lucknow", region: "Uttar Pradesh", country: "India", lat: 26.8467, lon: 80.9462 };

  // WMO weather code -> [description, day icon, night icon]
  const CODES = {
    0: ["Clear sky", "☀️", "🌙"], 1: ["Mostly clear", "🌤️", "🌙"], 2: ["Partly cloudy", "⛅", "☁️"], 3: ["Overcast", "☁️", "☁️"],
    45: ["Fog", "🌫️", "🌫️"], 48: ["Freezing fog", "🌫️", "🌫️"],
    51: ["Light drizzle", "🌦️", "🌧️"], 53: ["Drizzle", "🌦️", "🌧️"], 55: ["Heavy drizzle", "🌧️", "🌧️"],
    56: ["Freezing drizzle", "🌧️", "🌧️"], 57: ["Freezing drizzle", "🌧️", "🌧️"],
    61: ["Light rain", "🌦️", "🌧️"], 63: ["Rain", "🌧️", "🌧️"], 65: ["Heavy rain", "🌧️", "🌧️"],
    66: ["Freezing rain", "🌧️", "🌧️"], 67: ["Freezing rain", "🌧️", "🌧️"],
    71: ["Light snow", "🌨️", "🌨️"], 73: ["Snow", "🌨️", "🌨️"], 75: ["Heavy snow", "❄️", "❄️"], 77: ["Snow grains", "🌨️", "🌨️"],
    80: ["Light showers", "🌦️", "🌧️"], 81: ["Showers", "🌧️", "🌧️"], 82: ["Heavy showers", "🌧️", "🌧️"],
    85: ["Snow showers", "🌨️", "🌨️"], 86: ["Heavy snow showers", "❄️", "❄️"],
    95: ["Thunderstorm", "⛈️", "⛈️"], 96: ["Thunderstorm with hail", "⛈️", "⛈️"], 99: ["Thunderstorm with hail", "⛈️", "⛈️"]
  };
  const SKY_COLORS = { day: "#2f7fd1", night: "#16223f", cloudy: "#5b6b7a", overcast: "#2d3643", rain: "#3b5068", storm: "#2c2745", snow: "#55728a", fog: "#66727c" };

  const $ = (sel) => document.querySelector(sel);
  const els = {
    form: $("#search"), q: $("#q"), list: $("#suggestions"), status: $("#status"), app: $("#app"),
    place: $("#place"), condition: $("#condition"), temp: $("#temp"), details: $("#details"),
    hourly: $("#hourly"), daily: $("#daily"), unit: $("#unit"), locate: $("#locate"), theme: $("#theme-color")
  };

  const state = { units: read("wpu.units", "c"), place: null, data: null, req: 0, suggestions: [], active: -1 };

  function read(key, fallback) {
    try { const v = localStorage.getItem(key); return v ? JSON.parse(v) : fallback; } catch { return fallback; }
  }
  function write(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* storage may be unavailable */ }
  }
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  // ---------- Formatting ----------
  const temp = (c) => Math.round(state.units === "f" ? (c * 9) / 5 + 32 : c);
  const wind = (kmh) => (state.units === "f" ? Math.round(kmh * 0.621371) + " mph" : Math.round(kmh) + " km/h");
  function hour12(iso) { // "2026-10-28T14:00" -> "2 PM"
    const h = parseInt(iso.slice(11, 13), 10);
    return (h % 12 || 12) + " " + (h < 12 ? "AM" : "PM");
  }
  function clock12(iso) { // "2026-10-28T06:12" -> "6:12 AM"
    const h = parseInt(iso.slice(11, 13), 10);
    return (h % 12 || 12) + ":" + iso.slice(14, 16) + " " + (h < 12 ? "AM" : "PM");
  }
  function weekday(dateStr) {
    return new Date(dateStr + "T12:00:00").toLocaleDateString(undefined, { weekday: "short" });
  }
  function info(code, isDay) {
    const c = CODES[code] || ["Unknown", "🌡️", "🌡️"];
    return { label: c[0], icon: isDay ? c[1] : c[2] };
  }
  function skyFor(code, isDay) {
    if (code >= 95) return "storm";
    if ((code >= 71 && code <= 77) || code === 85 || code === 86) return "snow";
    if ((code >= 51 && code <= 67) || (code >= 80 && code <= 82)) return "rain";
    if (code === 45 || code === 48) return "fog";
    if (code <= 1) return isDay ? "day" : "night";
    return isDay ? "cloudy" : "overcast";
  }

  // ---------- Status ----------
  function setStatus(msg, isError) {
    els.status.textContent = msg || "";
    els.status.classList.toggle("error", !!isError);
  }
  const placeLabel = (p) => [p.name, p.region, p.country].filter(Boolean).filter((v, i, a) => a.indexOf(v) === i).join(", ");

  // ---------- Data ----------
  async function getJSON(url) {
    const res = await fetch(url);
    if (!res.ok) throw new Error("Request failed (" + res.status + ")");
    return res.json();
  }

  async function loadWeather(place) {
    const id = ++state.req;
    setStatus("Loading the weather…");
    const params = new URLSearchParams({
      latitude: place.lat, longitude: place.lon, timezone: "auto", forecast_days: 7,
      current: "temperature_2m,relative_humidity_2m,apparent_temperature,is_day,weather_code,wind_speed_10m",
      hourly: "temperature_2m,weather_code,is_day",
      daily: "weather_code,temperature_2m_max,temperature_2m_min,sunrise,sunset,precipitation_probability_max"
    });
    try {
      const data = await getJSON(FORECAST_URL + "?" + params);
      if (id !== state.req) return; // a newer search replaced this one
      state.place = place;
      state.data = data;
      write("wpu.place", place);
      setStatus("");
      render();
    } catch (err) {
      if (id !== state.req) return;
      setStatus("Could not load the weather. Check your internet connection and try again.", true);
    }
  }

  async function searchCities(query, count) {
    const params = new URLSearchParams({ name: query, count, language: "en", format: "json" });
    const data = await getJSON(GEO_URL + "?" + params);
    return (data.results || []).map((r) => ({ name: r.name, region: r.admin1 || "", country: r.country || "", lat: r.latitude, lon: r.longitude }));
  }

  // ---------- Render ----------
  function render() {
    const d = state.data;
    if (!d || !d.current) return;
    const cur = d.current, isDay = cur.is_day === 1;
    const now = info(cur.weather_code, isDay);

    document.body.dataset.sky = skyFor(cur.weather_code, isDay);
    els.theme.setAttribute("content", SKY_COLORS[document.body.dataset.sky]);
    document.title = Math.round(temp(cur.temperature_2m)) + "° " + state.place.name + " | Weather Pro Ultra";

    els.place.textContent = placeLabel(state.place);
    els.condition.textContent = now.icon + "  " + now.label;
    els.temp.innerHTML = temp(cur.temperature_2m) + '<span class="sym">°' + state.units.toUpperCase() + "</span>";
    els.unit.textContent = "°" + (state.units === "c" ? "C" : "F");
    els.unit.setAttribute("aria-label", "Showing " + (state.units === "c" ? "Celsius" : "Fahrenheit") + ". Switch unit.");

    const day = d.daily;
    els.details.innerHTML = [
      ["Feels like", temp(cur.apparent_temperature) + "°"],
      ["Humidity", Math.round(cur.relative_humidity_2m) + "%"],
      ["Wind", wind(cur.wind_speed_10m)],
      ["Rain chance", (day.precipitation_probability_max[0] ?? 0) + "%"],
      ["Sunrise", clock12(day.sunrise[0])],
      ["Sunset", clock12(day.sunset[0])]
    ].map(([k, v]) => "<div><dt>" + k + "</dt><dd>" + esc(v) + "</dd></div>").join("");

    // Hourly: next 24 hours starting at the current hour
    const h = d.hourly;
    const nowHour = cur.time.slice(0, 13) + ":00";
    let start = h.time.findIndex((t) => t >= nowHour);
    if (start < 0) start = 0;
    els.hourly.innerHTML = h.time.slice(start, start + 24).map((t, i) => {
      const idx = start + i;
      const inf = i === 0 ? now : info(h.weather_code[idx], h.is_day[idx] === 1);
      const tc = i === 0 ? cur.temperature_2m : h.temperature_2m[idx];
      return '<li><span class="h-time">' + (i === 0 ? "Now" : hour12(t)) + '</span><span class="h-icon" aria-hidden="true">' + inf.icon +
        '</span><span class="h-temp">' + temp(tc) + "°</span><span class=\"sr\">" + inf.label + "</span></li>";
    }).join("");

    // Daily: with a bar showing each day's range against the whole week
    const lo = Math.min(...day.temperature_2m_min), hi = Math.max(...day.temperature_2m_max);
    const span = hi - lo || 1;
    els.daily.innerHTML = day.time.map((t, i) => {
      const inf = info(day.weather_code[i], true);
      const left = ((day.temperature_2m_min[i] - lo) / span) * 100;
      const width = Math.max(((day.temperature_2m_max[i] - day.temperature_2m_min[i]) / span) * 100, 6);
      return "<li><span class=\"d-name\">" + (i === 0 ? "Today" : weekday(t)) + '</span><span class="d-icon" title="' + esc(inf.label) + '">' + inf.icon +
        '</span><span class="d-rain">' + (day.precipitation_probability_max[i] ?? 0) + '%</span><span class="d-lo">' + temp(day.temperature_2m_min[i]) +
        '°</span><span class="range" aria-hidden="true"><i style="left:' + left.toFixed(1) + "%;width:" + width.toFixed(1) + '%"></i></span><span class="d-hi">' +
        temp(day.temperature_2m_max[i]) + "°</span></li>";
    }).join("");

    els.app.hidden = false;
  }

  // ---------- Suggestions ----------
  function showSuggestions(items) {
    state.suggestions = items; state.active = -1;
    if (!items.length) { hideSuggestions(); return; }
    els.list.innerHTML = items.map((p, i) =>
      '<li role="option" id="opt-' + i + '" data-i="' + i + '">' + esc(p.name) + " <small>" + esc([p.region, p.country].filter(Boolean).join(", ")) + "</small></li>").join("");
    els.list.hidden = false;
    els.q.setAttribute("aria-expanded", "true");
  }
  function hideSuggestions() {
    els.list.hidden = true; els.list.innerHTML = ""; state.suggestions = []; state.active = -1;
    els.q.setAttribute("aria-expanded", "false"); els.q.removeAttribute("aria-activedescendant");
  }
  function highlight(i) {
    state.active = i;
    [...els.list.children].forEach((li, n) => li.setAttribute("aria-selected", n === i ? "true" : "false"));
    if (i >= 0) els.q.setAttribute("aria-activedescendant", "opt-" + i); else els.q.removeAttribute("aria-activedescendant");
  }
  function choose(place) {
    els.q.value = place.name;
    hideSuggestions();
    loadWeather(place);
  }

  let timer;
  els.q.addEventListener("input", () => {
    clearTimeout(timer);
    const v = els.q.value.trim();
    if (v.length < 2) { hideSuggestions(); return; }
    timer = setTimeout(async () => {
      try { const r = await searchCities(v, 5); if (els.q.value.trim() === v) showSuggestions(r); } catch { hideSuggestions(); }
    }, 250);
  });
  els.q.addEventListener("keydown", (e) => {
    if (els.list.hidden) return;
    const n = state.suggestions.length;
    if (e.key === "ArrowDown") { e.preventDefault(); highlight((state.active + 1) % n); }
    else if (e.key === "ArrowUp") { e.preventDefault(); highlight((state.active - 1 + n) % n); }
    else if (e.key === "Escape") hideSuggestions();
  });
  els.list.addEventListener("mousedown", (e) => {
    const li = e.target.closest("li");
    if (li) { e.preventDefault(); choose(state.suggestions[+li.dataset.i]); }
  });
  document.addEventListener("click", (e) => { if (!els.form.contains(e.target)) hideSuggestions(); });

  els.form.addEventListener("submit", async (e) => {
    e.preventDefault();
    clearTimeout(timer);
    if (state.active >= 0) { choose(state.suggestions[state.active]); return; }
    const v = els.q.value.trim();
    if (!v) { setStatus("Type a city name to search.", true); return; }
    hideSuggestions();
    setStatus("Searching…");
    try {
      const [first] = await searchCities(v, 1);
      if (!first) { setStatus("No city found for “" + v + "”. Check the spelling or try a nearby city.", true); return; }
      choose(first);
    } catch {
      setStatus("Could not search right now. Check your internet connection and try again.", true);
    }
  });

  // ---------- Buttons ----------
  els.unit.addEventListener("click", () => {
    state.units = state.units === "c" ? "f" : "c";
    write("wpu.units", state.units);
    render();
  });
  els.locate.addEventListener("click", () => {
    if (!navigator.geolocation) { setStatus("Your browser can't share your location. Search for a city instead.", true); return; }
    setStatus("Finding your location…");
    navigator.geolocation.getCurrentPosition(
      (pos) => loadWeather({ name: "Your location", region: "", country: "", lat: pos.coords.latitude, lon: pos.coords.longitude }),
      () => setStatus("Location is blocked. Allow location access in your browser, or search for a city.", true),
      { timeout: 10000 }
    );
  });

  // ---------- Start ----------
  els.unit.textContent = "°" + state.units.toUpperCase();
  loadWeather(read("wpu.place", DEFAULT_PLACE));

  if ("serviceWorker" in navigator && (location.protocol === "https:" || location.hostname === "localhost")) {
    navigator.serviceWorker.register("sw.js").catch(() => {});
  }
})();
