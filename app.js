"use strict";

const DATA_ROOT = "./data";
const OVERLAY_ROOT = "./overlays";

const priorityOrder = ["Critical", "High", "Moderate", "Low", "Very Low"];
const priorityColors = {
  Critical: "#c83e63",
  High: "#ee8f72",
  Moderate: "#f7d98b",
  Low: "#a8d6e6",
  "Very Low": "#619bc3",
};

const themeOrder = [
  "Community preparedness and local drainage",
  "Floodplain restoration and water retention",
  "Crossing and access resilience",
  "Road drainage and access continuity",
  "Critical-facility resilience",
  "Monitoring and land-use control",
];

const themeColors = {
  "Community preparedness and local drainage": "#f4a261",
  "Floodplain restoration and water retention": "#277da1",
  "Crossing and access resilience": "#8e5ea2",
  "Road drainage and access continuity": "#e76f51",
  "Critical-facility resilience": "#d62828",
  "Monitoring and land-use control": "#90a4ae",
};

const floodColors = {
  2018: "#2b83ba",
  2020: "#31a354",
  2022: "#ff7f00",
  2024: "#7e00a7",
};

const state = {
  view: "priority",
  surface: "classes",
  floodYear: 2024,
  selectedPriorities: new Set(priorityOrder),
  selectedThemes: new Set(themeOrder),
  assets: {
    robust: true,
    facilities: true,
    crossings: true,
    roads: true,
  },
};

let map;
let manifest;
let summary;
let planningData;
let robustData;
let facilitiesData;
let crossingsData;
let roadsData;
let lgaData;

const byId = (id) => document.getElementById(id);
const compactNumber = new Intl.NumberFormat("en", { maximumFractionDigits: 0 });
const decimalNumber = new Intl.NumberFormat("en", { maximumFractionDigits: 2 });

function safeNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function formatInteger(value) {
  return compactNumber.format(Math.round(safeNumber(value)));
}

function formatDecimal(value, digits = 2) {
  return new Intl.NumberFormat("en", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(safeNumber(value));
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function colorExpression(property, colors, fallback = "#9aa8ac") {
  const expression = ["match", ["get", property]];
  Object.entries(colors).forEach(([label, color]) => {
    expression.push(label, color);
  });
  expression.push(fallback);
  return expression;
}

function selectedFilter() {
  const priorities = [...state.selectedPriorities];
  const themes = [...state.selectedThemes];
  const priorityFilter = priorities.length
    ? ["in", ["get", "prio_class"], ["literal", priorities]]
    : ["==", ["get", "prio_class"], "__none__"];
  const themeFilter = themes.length
    ? ["in", ["get", "theme"], ["literal", themes]]
    : ["==", ["get", "theme"], "__none__"];
  return ["all", priorityFilter, themeFilter];
}

function setLayerVisibility(layerId, visible) {
  if (map?.getLayer(layerId)) {
    map.setLayoutProperty(layerId, "visibility", visible ? "visible" : "none");
  }
}

function planningIsVisible() {
  return state.view === "priority" || state.view === "themes";
}

function renderControlOptions() {
  const priorityCounts = Object.fromEntries(priorityOrder.map((item) => [item, 0]));
  const themeCounts = Object.fromEntries(themeOrder.map((item) => [item, 0]));

  planningData.features.forEach(({ properties }) => {
    if (priorityCounts[properties.prio_class] !== undefined) {
      priorityCounts[properties.prio_class] += 1;
    }
    if (themeCounts[properties.theme] !== undefined) {
      themeCounts[properties.theme] += 1;
    }
  });

  byId("priority-options").innerHTML = priorityOrder
    .map(
      (label) => `
        <label>
          <input type="checkbox" data-priority="${escapeHtml(label)}" checked />
          <span class="colour-swatch" style="background:${priorityColors[label]}"></span>
          <span>${escapeHtml(label)}</span>
          <span class="option-count">${formatInteger(priorityCounts[label])}</span>
        </label>`
    )
    .join("");

  byId("theme-options").innerHTML = themeOrder
    .map(
      (label) => `
        <label>
          <input type="checkbox" data-theme="${escapeHtml(label)}" checked />
          <span class="colour-swatch" style="background:${themeColors[label]}"></span>
          <span>${escapeHtml(label)}</span>
          <span class="option-count">${formatInteger(themeCounts[label])}</span>
        </label>`
    )
    .join("");

  byId("year-options").innerHTML = [2018, 2020, 2022, 2024]
    .map(
      (year) => `<button class="year-button ${year === state.floodYear ? "active" : ""}" data-year="${year}" type="button">${year}</button>`
    )
    .join("");
}

function bindControls() {
  document.querySelectorAll(".view-tab").forEach((button) => {
    button.addEventListener("click", () => setView(button.dataset.view));
  });

  byId("priority-options").addEventListener("change", (event) => {
    const value = event.target.dataset.priority;
    if (!value) return;
    event.target.checked ? state.selectedPriorities.add(value) : state.selectedPriorities.delete(value);
    applyFilters();
  });

  byId("theme-options").addEventListener("change", (event) => {
    const value = event.target.dataset.theme;
    if (!value) return;
    event.target.checked ? state.selectedThemes.add(value) : state.selectedThemes.delete(value);
    applyFilters();
  });

  byId("priority-all").addEventListener("click", () => {
    const selectAll = state.selectedPriorities.size !== priorityOrder.length;
    state.selectedPriorities = new Set(selectAll ? priorityOrder : []);
    document.querySelectorAll("[data-priority]").forEach((input) => {
      input.checked = selectAll;
    });
    byId("priority-all").textContent = selectAll ? "Clear all" : "Select all";
    applyFilters();
  });

  byId("theme-all").addEventListener("click", () => {
    const selectAll = state.selectedThemes.size !== themeOrder.length;
    state.selectedThemes = new Set(selectAll ? themeOrder : []);
    document.querySelectorAll("[data-theme]").forEach((input) => {
      input.checked = selectAll;
    });
    byId("theme-all").textContent = selectAll ? "Clear all" : "Select all";
    applyFilters();
  });

  document.querySelectorAll("[data-surface]").forEach((button) => {
    button.addEventListener("click", () => {
      state.surface = button.dataset.surface;
      document.querySelectorAll("[data-surface]").forEach((item) => item.classList.toggle("active", item === button));
      updateMapMode();
    });
  });

  byId("year-options").addEventListener("click", (event) => {
    const year = Number(event.target.dataset.year);
    if (!year) return;
    state.floodYear = year;
    document.querySelectorAll("[data-year]").forEach((button) => {
      button.classList.toggle("active", Number(button.dataset.year) === year);
    });
    updateMapMode();
  });

  ["robust", "facilities", "crossings", "roads"].forEach((key) => {
    byId(`toggle-${key}`).addEventListener("change", (event) => {
      state.assets[key] = event.target.checked;
      updateMapMode();
    });
  });

  byId("reset-view").addEventListener("click", fitProjectBounds);
  byId("about-button").addEventListener("click", () => byId("about-dialog").showModal());
  byId("panel-open").addEventListener("click", () => byId("control-panel").classList.add("open"));
  byId("panel-close").addEventListener("click", () => byId("control-panel").classList.remove("open"));
}

function setView(view) {
  if (!["priority", "themes", "susceptibility", "floods"].includes(view)) return;
  state.view = view;
  document.querySelectorAll(".view-tab").forEach((button) => {
    button.classList.toggle("active", button.dataset.view === view);
  });
  byId("priority-controls").classList.toggle("hidden", view !== "priority");
  byId("theme-controls").classList.toggle("hidden", view !== "themes");
  byId("susceptibility-controls").classList.toggle("hidden", view !== "susceptibility");
  byId("flood-controls").classList.toggle("hidden", view !== "floods");
  updateMapMode();
}

function filteredFeatures() {
  return planningData.features.filter(({ properties }) =>
    state.selectedPriorities.has(properties.prio_class) &&
    state.selectedThemes.has(properties.theme)
  );
}

function updateSelectionSummary() {
  const features = filteredFeatures();
  const totals = features.reduce(
    (accumulator, { properties }) => {
      accumulator.area += safeNumber(properties.model_km2);
      accumulator.population += safeNumber(properties.pop2020);
      accumulator.buildings += safeNumber(properties.bldg_count);
      return accumulator;
    },
    { area: 0, population: 0, buildings: 0 }
  );

  byId("selected-units").textContent = formatInteger(features.length);
  byId("selected-area").textContent = decimalNumber.format(totals.area);
  byId("selected-population").textContent = formatInteger(totals.population);
  byId("selected-buildings").textContent = formatInteger(totals.buildings);

  const counts = Object.fromEntries(priorityOrder.map((item) => [item, 0]));
  features.forEach(({ properties }) => {
    if (counts[properties.prio_class] !== undefined) counts[properties.prio_class] += 1;
  });
  const maximum = Math.max(...Object.values(counts), 1);
  byId("priority-chart").innerHTML = priorityOrder
    .map(
      (label) => `
        <div class="chart-row">
          <span title="${escapeHtml(label)}">${escapeHtml(label)}</span>
          <div class="chart-track"><div class="chart-bar" style="width:${(counts[label] / maximum) * 100}%;background:${priorityColors[label]}"></div></div>
          <span class="chart-value">${formatInteger(counts[label])}</span>
        </div>`
    )
    .join("");

  byId("selection-note").textContent = features.length === planningData.features.length
    ? "All units"
    : `${formatInteger(features.length)} selected`;
}

function applyFilters() {
  if (map?.loaded()) {
    const filter = selectedFilter();
    ["planning-fill", "planning-line", "robust-casing", "robust-line"].forEach((layer) => {
      if (map.getLayer(layer)) map.setFilter(layer, filter);
    });
  }
  byId("priority-all").textContent = state.selectedPriorities.size === priorityOrder.length ? "Clear all" : "Select all";
  byId("theme-all").textContent = state.selectedThemes.size === themeOrder.length ? "Clear all" : "Select all";
  updateSelectionSummary();
}

function updateLegend() {
  let title;
  let items;
  if (state.view === "priority") {
    title = "Intervention priority";
    items = priorityOrder.map((label) => ({ label, color: priorityColors[label] }));
  } else if (state.view === "themes") {
    title = "Recommended intervention";
    items = themeOrder.map((label) => ({ label, color: themeColors[label] }));
  } else if (state.view === "susceptibility" && state.surface === "classes") {
    title = "Flood susceptibility";
    items = manifest.overlays.susceptibility_classes.legend.map((item) => ({ label: item.label, color: item.colour }));
  } else if (state.view === "susceptibility") {
    byId("legend").innerHTML = `
      <div class="legend-title">Flood probability</div>
      <div class="legend-gradient"></div>
      <div class="legend-scale"><span>0</span><span>0.5</span><span>1.0</span></div>`;
    return;
  } else {
    title = `${state.floodYear} observed flood`;
    items = [{ label: "Mapped flood extent", color: floodColors[state.floodYear] }];
  }

  byId("legend").innerHTML = `
    <div class="legend-title">${escapeHtml(title)}</div>
    ${items.map((item) => `<div class="legend-item"><span class="legend-swatch" style="background:${item.color}"></span><span>${escapeHtml(item.label)}</span></div>`).join("")}`;
}

function updateMapMode() {
  if (!map?.loaded()) return;
  const showPlanning = planningIsVisible();
  setLayerVisibility("planning-fill", showPlanning);
  setLayerVisibility("planning-line", showPlanning);

  if (showPlanning) {
    map.setPaintProperty(
      "planning-fill",
      "fill-color",
      state.view === "priority"
        ? colorExpression("prio_class", priorityColors)
        : colorExpression("theme", themeColors)
    );
  }

  const showRobust = showPlanning && state.assets.robust;
  setLayerVisibility("robust-casing", showRobust);
  setLayerVisibility("robust-line", showRobust);

  setLayerVisibility("susceptibility-classes", state.view === "susceptibility" && state.surface === "classes");
  setLayerVisibility("susceptibility-probability", state.view === "susceptibility" && state.surface === "probability");

  [2018, 2020, 2022, 2024].forEach((year) => {
    setLayerVisibility(`flood-${year}`, state.view === "floods" && state.floodYear === year);
  });

  setLayerVisibility("facilities", state.assets.facilities);
  setLayerVisibility("crossings", state.assets.crossings);
  setLayerVisibility("road-points", state.assets.roads);

  const labels = {
    priority: "Intervention priority",
    themes: "Recommended intervention themes",
    susceptibility: state.surface === "classes" ? "Flood susceptibility classes" : "Flood susceptibility probability",
    floods: `${state.floodYear} observed flood extent`,
  };
  byId("map-mode-label").textContent = labels[state.view];
  updateLegend();
}

function fitProjectBounds() {
  map.fitBounds(
    [
      [manifest.bounds[0], manifest.bounds[1]],
      [manifest.bounds[2], manifest.bounds[3]],
    ],
    { padding: { top: 36, right: 40, bottom: 36, left: 40 }, duration: 700 }
  );
}

function addImageLayer(id, imagePath, coordinates) {
  map.addSource(id, {
    type: "image",
    url: imagePath,
    coordinates,
  });
  map.addLayer({
    id,
    type: "raster",
    source: id,
    paint: { "raster-opacity": 0.88, "raster-fade-duration": 0 },
    layout: { visibility: "none" },
  });
}

function priorityPointColor() {
  return [
    "match",
    ["get", "priority"],
    "Critical", "#c83e63",
    "High", "#ee8f72",
    "Moderate", "#f7c85f",
    "Low", "#72a9c9",
    "#667a80",
  ];
}

function addMapLayers() {
  const coordinates = manifest.image_coordinates;
  addImageLayer("susceptibility-classes", `${OVERLAY_ROOT}/lokoja_susceptibility_classes.png`, coordinates);
  addImageLayer("susceptibility-probability", `${OVERLAY_ROOT}/lokoja_susceptibility_probability.png`, coordinates);
  [2018, 2020, 2022, 2024].forEach((year) => {
    addImageLayer(`flood-${year}`, `${OVERLAY_ROOT}/lokoja_flood_${year}.png`, coordinates);
  });

  map.addSource("planning", { type: "geojson", data: planningData, generateId: true });
  map.addLayer({
    id: "planning-fill",
    type: "fill",
    source: "planning",
    paint: {
      "fill-color": colorExpression("prio_class", priorityColors),
      "fill-opacity": ["interpolate", ["linear"], ["zoom"], 7, 0.72, 11, 0.84],
    },
  });
  map.addLayer({
    id: "planning-line",
    type: "line",
    source: "planning",
    paint: {
      "line-color": "rgba(20,42,49,0.42)",
      "line-width": ["interpolate", ["linear"], ["zoom"], 7, 0.12, 12, 0.75],
    },
  });

  map.addSource("robust", { type: "geojson", data: robustData, generateId: true });
  map.addLayer({ id: "robust-casing", type: "line", source: "robust", paint: { "line-color": "#ffffff", "line-width": 3.2, "line-opacity": 0.92 } });
  map.addLayer({ id: "robust-line", type: "line", source: "robust", paint: { "line-color": "#111820", "line-width": 1.25, "line-opacity": 0.95 } });

  map.addSource("road-points-source", { type: "geojson", data: roadsData, generateId: true });
  map.addLayer({
    id: "road-points",
    type: "circle",
    source: "road-points-source",
    paint: {
      "circle-radius": ["interpolate", ["linear"], ["zoom"], 7, 1.5, 12, 4],
      "circle-color": "#253845",
      "circle-opacity": 0.72,
      "circle-stroke-color": "#ffffff",
      "circle-stroke-width": 0.7,
    },
  });

  map.addSource("crossings-source", { type: "geojson", data: crossingsData, generateId: true });
  map.addLayer({
    id: "crossings",
    type: "circle",
    source: "crossings-source",
    paint: {
      "circle-radius": ["interpolate", ["linear"], ["zoom"], 7, 2, 12, 6],
      "circle-color": priorityPointColor(),
      "circle-stroke-color": "#362748",
      "circle-stroke-width": 1.3,
    },
  });

  map.addSource("facilities-source", { type: "geojson", data: facilitiesData, generateId: true });
  map.addLayer({
    id: "facilities",
    type: "circle",
    source: "facilities-source",
    paint: {
      "circle-radius": ["interpolate", ["linear"], ["zoom"], 7, 3, 12, 7],
      "circle-color": priorityPointColor(),
      "circle-stroke-color": "#ffffff",
      "circle-stroke-width": 1.8,
    },
  });

  map.addSource("lga", { type: "geojson", data: lgaData });
  map.addLayer({
    id: "lga-outline",
    type: "line",
    source: "lga",
    paint: { "line-color": "#0b1f2a", "line-width": 2.1, "line-opacity": 0.95 },
  });
}

function planningPopup(properties) {
  return `
    <article class="popup-card">
      <header><small>Planning unit ${escapeHtml(properties.unit_id)}</small><strong>${escapeHtml(properties.prio_class)} priority</strong></header>
      <div class="popup-body">
        <div class="popup-stat"><span>Theme</span><strong>${escapeHtml(properties.theme)}</strong></div>
        <div class="popup-stat"><span>Priority score</span><strong>${formatDecimal(properties.base_score, 1)}</strong></div>
        <div class="popup-stat"><span>Population</span><strong>${formatInteger(properties.pop2020)}</strong></div>
        <div class="popup-stat"><span>Buildings</span><strong>${formatInteger(properties.bldg_count)}</strong></div>
        <div class="popup-stat"><span>Mean probability</span><strong>${formatDecimal(safeNumber(properties.mean_prob) * 100, 1)}%</strong></div>
        <div class="popup-stat"><span>2024 flooded</span><strong>${formatDecimal(properties.flood24_km2, 3)} km²</strong></div>
      </div>
      <div class="popup-action"><strong>Recommended action:</strong> ${escapeHtml(properties.action)}</div>
    </article>`;
}

function assetPopup(layerId, properties) {
  const type = layerId === "facilities"
    ? properties.facility_type || "Critical facility"
    : layerId === "crossings"
      ? properties.crossing_type || "Crossing"
      : "High-risk road location";
  const name = properties.name && properties.name !== "None" ? properties.name : type;
  return `
    <article class="popup-card">
      <header><small>${escapeHtml(type)}</small><strong>${escapeHtml(name)}</strong></header>
      <div class="popup-body">
        <div class="popup-stat"><span>Screening priority</span><strong>${escapeHtml(properties.priority || "High")}</strong></div>
        <div class="popup-stat"><span>OSM reference</span><strong>${escapeHtml(properties.F_id || "—")}</strong></div>
      </div>
    </article>`;
}

function bindMapInteractions() {
  const interactiveLayers = ["facilities", "crossings", "road-points", "robust-line", "planning-fill"];
  map.on("mousemove", (event) => {
    const features = map.queryRenderedFeatures(event.point, { layers: interactiveLayers.filter((id) => map.getLayer(id)) });
    map.getCanvas().style.cursor = features.length ? "pointer" : "";
  });

  map.on("click", (event) => {
    const features = map.queryRenderedFeatures(event.point, { layers: interactiveLayers.filter((id) => map.getLayer(id)) });
    if (!features.length) return;
    const feature = features[0];
    const html = ["planning-fill", "robust-line"].includes(feature.layer.id)
      ? planningPopup(feature.properties)
      : assetPopup(feature.layer.id, feature.properties);
    new maplibregl.Popup({ closeButton: true, maxWidth: "340px" })
      .setLngLat(event.lngLat)
      .setHTML(html)
      .addTo(map);
  });
}

function registerWebMcpTools() {
  const context = document.modelContext;
  if (!context?.registerTool) return;

  const reportRegistrationError = (error) => console.warn("WebMCP registration unavailable", error);
  const register = (tool) => {
    try {
      void Promise.resolve(context.registerTool(tool)).catch(reportRegistrationError);
    } catch (error) {
      reportRegistrationError(error);
    }
  };

  register({
    name: "set_dashboard_view",
    title: "Set dashboard view",
    description: "Switch the visible Lokoja map to priority, intervention themes, susceptibility or flood history.",
    inputSchema: {
      type: "object",
      properties: {
        view: { type: "string", enum: ["priority", "themes", "susceptibility", "floods"] },
        floodYear: { type: "integer", enum: [2018, 2020, 2022, 2024] },
      },
      required: ["view"],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false, untrustedContentHint: false },
    execute(input) {
      if (!input || !["priority", "themes", "susceptibility", "floods"].includes(input.view)) {
        throw new Error("A valid dashboard view is required.");
      }
      if (input.floodYear !== undefined && ![2018, 2020, 2022, 2024].includes(input.floodYear)) {
        throw new Error("Flood year must be 2018, 2020, 2022 or 2024.");
      }
      if (input.floodYear) state.floodYear = input.floodYear;
      setView(input.view);
      return { view: state.view, floodYear: state.floodYear };
    },
  });

  register({
    name: "get_dashboard_summary",
    title: "Read dashboard summary",
    description: "Return the current filtered planning-unit totals shown in the dashboard.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    annotations: { readOnlyHint: true, untrustedContentHint: false },
    execute() {
      const features = filteredFeatures();
      const totals = features.reduce(
        (accumulator, { properties }) => {
          accumulator.areaKm2 += safeNumber(properties.model_km2);
          accumulator.population += safeNumber(properties.pop2020);
          accumulator.buildings += safeNumber(properties.bldg_count);
          return accumulator;
        },
        { units: features.length, areaKm2: 0, population: 0, buildings: 0 }
      );
      return {
        ...totals,
        view: state.view,
        priorities: [...state.selectedPriorities],
        themes: [...state.selectedThemes],
      };
    },
  });
}

async function loadDashboard() {
  try {
    [manifest, summary, planningData, robustData, facilitiesData, crossingsData, roadsData, lgaData] = await Promise.all([
      fetch("./webgis_manifest.json").then((response) => response.json()),
      fetch("./project_summary.json").then((response) => response.json()),
      fetch(`${DATA_ROOT}/lokoja_intervention_planning_units.geojson`).then((response) => response.json()),
      fetch(`${DATA_ROOT}/lokoja_robust_priority_units.geojson`).then((response) => response.json()),
      fetch(`${DATA_ROOT}/lokoja_critical_facilities.geojson`).then((response) => response.json()),
      fetch(`${DATA_ROOT}/lokoja_bridges_fords.geojson`).then((response) => response.json()),
      fetch(`${DATA_ROOT}/lokoja_high_risk_road_points.geojson`).then((response) => response.json()),
      fetch(`${DATA_ROOT}/lokoja_lga_boundary.geojson`).then((response) => response.json()),
    ]);

    const requiredPlanningFields = ["prio_class", "theme", "base_score", "pop2020", "bldg_count", "action"];
    const sampleProperties = planningData.features[0]?.properties || {};
    const missing = requiredPlanningFields.filter((field) => !(field in sampleProperties));
    if (missing.length) throw new Error(`Planning-unit attributes missing: ${missing.join(", ")}`);

    byId("metric-units").textContent = formatInteger(summary.robust_priority_units);
    byId("metric-area").textContent = `${formatDecimal(summary.robust_priority_area_km2)} km²`;
    byId("metric-population").textContent = formatInteger(summary.robust_priority_population);
    byId("metric-buildings").textContent = formatInteger(summary.robust_priority_buildings);

    renderControlOptions();
    bindControls();
    updateSelectionSummary();

    map = new maplibregl.Map({
      container: "map",
      style: {
        version: 8,
        sources: {
          osm: {
            type: "raster",
            tiles: ["https://tile.openstreetmap.org/{z}/{x}/{y}.png"],
            tileSize: 256,
            attribution: "© OpenStreetMap contributors",
          },
        },
        layers: [{ id: "osm", type: "raster", source: "osm", paint: { "raster-saturation": -0.55, "raster-opacity": 0.78 } }],
      },
      center: [(manifest.bounds[0] + manifest.bounds[2]) / 2, (manifest.bounds[1] + manifest.bounds[3]) / 2],
      zoom: 8.4,
      minZoom: 7,
      maxZoom: 16,
      attributionControl: false,
    });

    map.addControl(new maplibregl.NavigationControl({ visualizePitch: false }), "top-right");
    map.addControl(new maplibregl.ScaleControl({ maxWidth: 110, unit: "metric" }), "bottom-left");
    map.addControl(new maplibregl.AttributionControl({ compact: true }), "bottom-right");

    map.on("load", () => {
      addMapLayers();
      bindMapInteractions();
      applyFilters();
      updateMapMode();
      fitProjectBounds();
      byId("loading").classList.add("hidden");
      registerWebMcpTools();
    });
  } catch (error) {
    console.error(error);
    byId("loading").classList.add("hidden");
    byId("map-error").classList.remove("hidden");
  }
}

loadDashboard();
