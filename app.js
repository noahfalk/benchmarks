"use strict";

const AUTO_CHART_COLORS = [
  "#2563eb",
  "#0f766e",
  "#d97706",
  "#7c3aed",
  "#dc2626",
  "#0891b2",
  "#65a30d",
  "#db2777",
  "#475569",
  "#9333ea",
  "#ea580c",
  "#059669",
];
const COLORBLIND_CHART_COLORS = [
  "#0072b2",
  "#e69f00",
  "#009e73",
  "#cc79a7",
  "#56b4e9",
  "#d55e00",
  "#f0e442",
  "#332288",
  "#882e72",
  "#117733",
  "#88ccaa",
  "#999999",
];
const GLOSSARY_STORAGE_KEY = "legend-banner-expanded";
const COLORBLIND_STORAGE_KEY = "colorblindMode";

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function formatValue(value) {
  return new Intl.NumberFormat(undefined, {
    maximumFractionDigits: 3,
  }).format(value);
}

async function fetchJson(path) {
  const response = await fetch(path);
  if (!response.ok) {
    throw new Error(`${path} returned HTTP ${response.status}`);
  }
  return response.json();
}

function readBoolPreference(key, defaultValue) {
  try {
    const value = localStorage.getItem(key);
    if (value === null) return defaultValue;
    return value === "1" || value === "true";
  } catch {
    return defaultValue;
  }
}

function writeBoolPreference(key, value) {
  try {
    localStorage.setItem(key, String(value));
  } catch {
    // Storage can be unavailable in private browsing modes.
  }
}

let colorblindMode = readBoolPreference(COLORBLIND_STORAGE_KEY, false);

function activeChartColors() {
  return colorblindMode ? COLORBLIND_CHART_COLORS : AUTO_CHART_COLORS;
}

function renderSwitch(id, label, checked) {
  return `
    <label class="switch-control" for="${id}">
      <span class="switch-label">${escapeHtml(label)}</span>
      <button id="${id}" class="switch${checked ? " on" : ""}" type="button"
              role="switch" aria-checked="${checked ? "true" : "false"}">
        <span class="switch-track"><span class="switch-thumb"></span></span>
      </button>
    </label>
  `;
}

function renderOverviewControls(configuration, rerender) {
  const glossary = configuration.glossary || [];
  const glossaryVisible = readBoolPreference(GLOSSARY_STORAGE_KEY, false);
  const controls = document.getElementById("controls-bar");
  const banner = document.getElementById("legend-banner");
  controls.innerHTML = [
    glossary.length
      ? renderSwitch("switch-glossary", "Glossary", glossaryVisible)
      : "",
    renderSwitch("switch-colorblind", "Colorblind mode", colorblindMode),
  ].join("");
  banner.innerHTML = glossary.length
    ? `<dl class="legend-banner-body">${glossary.map((entry) => `
        <div class="legend-item">
          <dt class="legend-term">${escapeHtml(entry.term)}</dt>
          <dd class="legend-definition">${escapeHtml(entry.definition)}</dd>
        </div>
      `).join("")}</dl>`
    : "";
  banner.hidden = !glossary.length;
  banner.classList.toggle("collapsed", !glossaryVisible);

  const glossarySwitch = document.getElementById("switch-glossary");
  if (glossarySwitch) {
    glossarySwitch.addEventListener("click", () => {
      const visible = !glossarySwitch.classList.contains("on");
      glossarySwitch.classList.toggle("on", visible);
      glossarySwitch.setAttribute("aria-checked", String(visible));
      banner.classList.toggle("collapsed", !visible);
      writeBoolPreference(GLOSSARY_STORAGE_KEY, visible);
    });
  }
  document.getElementById("switch-colorblind").addEventListener("click", () => {
    colorblindMode = !colorblindMode;
    writeBoolPreference(COLORBLIND_STORAGE_KEY, colorblindMode);
    rerender();
  });
}

function mapsFor(views) {
  return {
    suites: new Map(views.suites.map((suite) => [suite.id, suite])),
    comparisons: new Map(
      views.comparisons.map((comparison) => [comparison.id, comparison]),
    ),
  };
}

function selectedVariants(comparison, suites) {
  const selected = [];
  for (const source of comparison.sources) {
    const suite = suites.get(source.suite);
    if (!suite) {
      throw new Error(`Comparison references unknown suite ${source.suite}`);
    }
    const included = source.include_variants
      ? new Set(source.include_variants)
      : null;
    for (const variant of suite.variants) {
      if (!included || included.has(variant.id)) {
        selected.push({
          suite,
          variant,
          role: source.role || "comparison",
        });
      }
    }
  }
  return selected;
}

function formatDate(timestamp) {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeZone: "UTC",
  }).format(new Date(timestamp));
}

function renderComparisonLinks(views) {
  return views.comparisons.map((comparison) => {
    return `
      <li>
        <a href="comparisons/${encodeURIComponent(comparison.id)}/">
          ${escapeHtml(comparison.name)}
        </a>
      </li>
    `;
  }).join("");
}

function renderOverview(overview, views) {
  const target = document.getElementById("app");
  if (typeof Chart !== "undefined") {
    for (const canvas of target.querySelectorAll("canvas")) {
      const chart = Chart.getChart(canvas);
      if (chart) chart.destroy();
    }
  }
  renderOverviewControls(
    views.overview,
    () => renderOverview(overview, views),
  );
  const suites = [...views.suites].sort((left, right) =>
    left.name.localeCompare(right.name));
  target.innerHTML = '<div id="suite-previews" class="suite-previews"></div>';
  const previews = document.getElementById("suite-previews");
  for (const suite of suites) {
    const section = document.createElement("section");
    section.className = "card suite-preview";
    section.dataset.suiteId = suite.id;
    previews.appendChild(section);
    renderSuiteExplorer(section, suite, {
      observations: overview.observations.filter((item) => item.suite === suite.id),
      series: overview.series.filter((item) => item.suite === suite.id),
    }, null, ".", true);
  }
  target.insertAdjacentHTML("beforeend", `
    <section class="comparison-section">
      <h2>Curated comparisons</h2>
      <ul class="comparison-links">${renderComparisonLinks(views)}</ul>
    </section>
  `);
}

function environmentKey(environment) {
  return JSON.stringify(environment, Object.keys(environment).sort());
}

function environmentCapacityLabel(environment) {
  const cores = environment.logical_cores ?? environment.physical_cores;
  const memory = environment.memory_gb ?? environment.memory_gib;
  if (cores == null && memory == null) {
    return environment.os ? `Unknown capacity (${environment.os})` : "Unknown environment";
  }
  const coreLabel = cores == null ? "Cores unknown" : `${cores} cores`;
  const memoryLabel = memory == null
    ? "RAM unknown"
    : `${memory}${environment.memory_gb == null ? "GiB" : "GB"}`;
  return `${coreLabel}, ${memoryLabel}`;
}

function environmentDescription(environment) {
  return Object.entries(environment).map(([key, value]) => `${key}=${value}`).join(" / ")
    || "Unknown environment";
}

function historyFacets(series) {
  const facets = {};
  for (const [namespace, values] of [
    ["identity", series.identity],
    ["dimension", series.dimensions],
    ["environment", series.environment],
    ["source", { repository: series.repository, branch: series.branch }],
  ]) {
    for (const [key, value] of Object.entries(values)) {
      if (value !== null && value !== undefined) facets[`${namespace}.${key}`] = String(value);
    }
  }
  return facets;
}

function historySeriesLabel(series) {
  return series.identity_keys.map((key) => series.identity[key]).join(", ");
}

function comparisonSeriesLabel(series, variants) {
  const identity = Object.entries(series.identity).map(([key, value]) =>
    key === "variant" ? (variants.get(value) || value) : `${key}=${value}`);
  const context = [
    ...Object.entries(series.dimensions),
    ...Object.entries(series.environment),
  ].map(([key, value]) => `${key}=${value}`);
  if (series.branch) context.push(`branch=${series.branch}`);
  return [...identity, ...context].join(" / ");
}

function historySeriesColor(series) {
  const key = JSON.stringify([
    series.identity, series.dimensions, series.environment,
  ]);
  let hash = 0;
  for (let index = 0; index < key.length; index += 1) {
    hash = ((hash << 5) - hash + key.charCodeAt(index)) | 0;
  }
  if (colorblindMode) {
    const colors = activeChartColors();
    return colors[Math.abs(hash) % colors.length];
  }
  return `hsl(${Math.abs(hash) % 360}, 65%, 48%)`;
}

function suiteAxes(records) {
  const axes = [{ id: "identity.variant", label: "Variant" }];
  const categories = collectDimensionCategories(records.map((item) => ({
    dimensions: historyFacets(item),
  })));
  for (const key of ["identity.case", ...[...categories.keys()]
    .filter((key) => key.startsWith("dimension."))]) {
    if ((categories.get(key) || []).length > 1) {
      axes.push({
        id: key,
        label: key === "identity.case" ? "Case" : titleCase(key.slice(10)),
      });
    }
  }
  return axes;
}

function defaultSuiteAxis(axes) {
  for (const id of [
    "identity.case", "dimension.load_rate", "dimension.batch_size",
    "dimension.engine_cores", "dimension.allocated_cores",
  ]) {
    if (axes.some((axis) => axis.id === id)) return id;
  }
  return "identity.variant";
}

function explorerChart(records, axis, variants) {
  const history = axis === "history";
  const groups = new Map();
  const labels = new Map();
  const axisValue = (record) => {
    const [namespace, key] = axis.split(".");
    return String((namespace === "identity" ? record.identity : record.dimensions)[key]
      ?? FILTER_MISSING);
  };
  const identityKeys = new Set(records.flatMap((item) => Object.keys(item.identity)));
  const variantBars = !history && axis === "identity.variant"
    && [...identityKeys].every((key) => key === "variant"
      || records.every((item) => (item.identity[key] ?? FILTER_MISSING)
        === (records[0].identity[key] ?? FILTER_MISSING)))
    && new Set(records.map(axisValue)).size === records.length;
  const dependentDimensions = new Set();
  if (!history) {
    const keys = new Set(records.flatMap((item) => Object.keys(item.dimensions)));
    for (const key of keys) {
      const byAxis = new Map();
      for (const record of records) {
        const x = axisValue(record);
        if (!byAxis.has(x)) byAxis.set(x, new Set());
        byAxis.get(x).add(record.dimensions[key] ?? FILTER_MISSING);
      }
      if ([...byAxis.values()].every((values) => values.size === 1)) {
        dependentDimensions.add(key);
      }
    }
  }
  for (const record of records) {
    const identity = { ...record.identity };
    const dimensions = { ...record.dimensions };
    let x = record.run_id;
    if (!history) {
      const [namespace, key] = axis.split(".");
      const fields = namespace === "identity" ? identity : dimensions;
      x = axisValue(record);
      if (!variantBars) delete fields[key];
      for (const dimension of dependentDimensions) delete dimensions[dimension];
    }
    labels.set(x, record);
    const series = {
      identity, identity_keys: record.identity_keys,
      dimensions, environment: record.environment,
      repository: record.repository, branch: record.branch,
    };
    const key = JSON.stringify(series);
    if (!groups.has(key)) groups.set(key, { series, records: new Map() });
    const group = groups.get(key);
    if (group.records.has(x)) {
      throw new Error("Multiple results occupy the same comparison slot");
    }
    group.records.set(x, record);
  }
  const ordered = [...labels.keys()].sort((left, right) => {
    if (history) {
      const a = labels.get(left);
      const b = labels.get(right);
      return Date.parse(a.ordering_timestamp) - Date.parse(b.ordering_timestamp)
        || left.localeCompare(right);
    }
    return left.localeCompare(right, undefined, { numeric: true });
  });
  const displayLabel = (x) => {
    if (history) {
      return new Date(labels.get(x).ordering_timestamp)
        .toISOString().slice(0, 10);
    }
    if (x === FILTER_MISSING) return "Not set";
    if (axis === "identity.variant") return variants.get(x) || x;
    return x;
  };
  return {
    labels: ordered.map(displayLabel),
    datasets: [...groups.values()].map(({ series, records }) => ({
      label: history ? historySeriesLabel(series) : variantBars
        ? variants.get(series.identity.variant) || series.identity.variant
        : comparisonSeriesLabel(series, variants) || "Results",
      grouped: !variantBars,
      borderColor: historySeriesColor(series),
      backgroundColor: historySeriesColor(series),
      borderWidth: history ? 2 : 1,
      pointRadius: 3,
      pointHitRadius: 6,
      fill: false,
      spanGaps: true,
      data: ordered.map((x, index) => {
        const record = records.get(x);
        return { x: index, y: record ? record.value : null, record: record || null };
      }),
    })),
  };
}

async function loadResultDetails(record, suite, catalog, root, target, isCurrent) {
  target.innerHTML = '<p>Loading selected result...</p>';
  try {
    const run = catalog.runs.find((item) => item.id === record.run_id);
    if (!run) throw new Error(`Run ${record.run_id} is absent from the catalog`);
    const bundle = await fetchJson(`${root}/${run.path}`);
    if (!isCurrent()) return;
    const table = bundle.results.find((item) => item.suite === suite.id);
    const measurement = table && table.measurements.find((item) => {
      const identity = Object.fromEntries(table.identity_keys.map(
        (key, index) => [key, item.identity[index]],
      ));
      const dimensions = Object.fromEntries(table.dimension_keys.map(
        (key, index) => [key, item.dimensions[index]],
      ).filter(([_key, value]) => value !== null));
      return environmentKey(identity) === environmentKey(record.identity)
        && environmentKey(dimensions) === environmentKey(record.dimensions);
    });
    if (!measurement) throw new Error("Selected measurement is absent from its run");
    const rows = table.metrics.map((metric, index) => {
      const value = measurement.values[index];
      return value === null ? "" : `
        <tr><th>${escapeHtml(titleCase(metric.name))}</th>
            <td>${escapeHtml(formatValue(value))} ${escapeHtml(metric.unit)}</td></tr>
      `;
    }).join("");
    target.innerHTML = `
      <h2>Selected result</h2>
      <p>${escapeHtml(historySeriesLabel(record, new Map(
        suite.variants.map((item) => [item.id, item.name]),
      )))}</p>
      <p class="meta">
        Commit: ${escapeHtml(record.commit)}<br>
        Run: <a href="${escapeHtml(`${root}/${run.path}`)}">${escapeHtml(record.run_id)}</a><br>
        Collection: ${escapeHtml(bundle.run.collection_id)}<br>
        Ordering date: ${escapeHtml(formatDate(record.ordering_timestamp))}
      </p>
      <table class="result-metrics">${rows}</table>
    `;
  } catch (error) {
    if (isCurrent()) target.innerHTML =
      `<div class="error">Could not load result: ${escapeHtml(error.message)}</div>`;
  }
}

function renderSuiteExplorer(target, suite, data, catalog, root, overview = false) {
  const records = [...data.observations, ...data.series];
  const heading = overview
    ? `<div class="explorer-heading">
         <h2><a class="suite-link" href="suites/${encodeURIComponent(suite.id)}/">${escapeHtml(suite.name)}</a></h2>
         <p>${escapeHtml(suite.description)}</p>
       </div>`
    : "";
  if (!records.length) {
    target.innerHTML = `${heading}<p>No results recorded.</p>`;
    return;
  }
  const variants = new Map(suite.variants.map((item) => [item.id, item.name]));
  const metrics = [...new Set(records.map((item) =>
    JSON.stringify([item.metric, item.unit])))].sort();
  const environments = [...new Map(records.map((item) =>
    [environmentKey(item.environment), item.environment])).entries()];
  environments.sort(([left], [right]) => left.localeCompare(right));
  const axes = suiteAxes(records);
  axes.push({ id: "history", label: "Commit history" });
  const categories = collectDimensionCategories(records.map((item) => ({
    dimensions: historyFacets(item),
  })));
  for (const [key, values] of categories) {
    if (key.startsWith("environment.") || values.length < 2) categories.delete(key);
  }
  const filterState = initialFilterState(categories);
  if (!overview) {
    const savedFilters = new URLSearchParams(location.search).get("filters");
    if (savedFilters) {
      const parsed = JSON.parse(savedFilters);
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        throw new Error("Saved filters must be an object");
      }
      for (const [key, values] of Object.entries(parsed)) {
        if (!categories.has(key) || !Array.isArray(values)
            || !values.every((value) => categories.get(key).includes(value))) {
          throw new Error(`Invalid saved filter ${key}`);
        }
        filterState.set(key, new Set(values));
      }
    }
  }
  const prefix = `suite-${suite.id}`;
  target.innerHTML = `
    <div class="explorer-header">
      ${heading}
      <div class="explorer-controls">
      <label class="explorer-axis-control">X-axis <select class="explorer-axis">
        ${axes.map((axis) => `<option value="${escapeHtml(axis.id)}">${escapeHtml(axis.label)}</option>`).join("")}
      </select></label>
      <label>Metric <select class="explorer-metric">
        ${metrics.map((key) => {
          const [metric, unit] = JSON.parse(key);
          return `<option value="${escapeHtml(key)}">${escapeHtml(titleCase(metric))} (${escapeHtml(unit)})</option>`;
        }).join("")}
      </select></label>
      <label class="explorer-environment-control">Hardware <select class="explorer-environment">
        ${environments.map(([key, environment]) =>
          `<option value="${escapeHtml(key)}" title="${escapeHtml(environmentDescription(environment))}">${escapeHtml(environmentCapacityLabel(environment))}</option>`).join("")}
      </select></label>
      </div>
    </div>
    <div class="explorer-filters" role="group" aria-label="Filters">
      ${renderFilterGroups(categories, filterState, prefix)}
      <button type="button" class="filter-reset">Reset</button>
    </div>
    <p class="explorer-context meta" hidden></p>
    <div class="explorer-chart chart-wrapper"><canvas role="img" aria-label="${escapeHtml(suite.name)} results"></canvas></div>
    <p class="explorer-empty" hidden>No measurements match these selections.</p>
    ${overview ? "" : '<section class="card result-details"></section>'}
  `;
  const metricSelect = target.querySelector(".explorer-metric");
  const axisSelect = target.querySelector(".explorer-axis");
  const environmentSelect = target.querySelector(".explorer-environment");
  axisSelect.value = data.observations.length ? defaultSuiteAxis(axes) : "history";
  metricSelect.value = metrics.find((key) =>
    JSON.parse(key)[0] === "cpu_percentage_normalized_avg")
    || metrics.find((key) => JSON.parse(key)[0] === "logs_received_rate")
    || metrics[0];
  const newest = [...data.observations].sort((left, right) =>
    Date.parse(right.ordering_timestamp) - Date.parse(left.ordering_timestamp)
    || right.run_id.localeCompare(left.run_id))[0];
  if (newest) environmentSelect.value = environmentKey(newest.environment);
  if (!overview) {
    const params = new URLSearchParams(location.search);
    if (metrics.includes(params.get("metric"))) metricSelect.value = params.get("metric");
    if (axes.some((axis) => axis.id === params.get("axis"))) axisSelect.value = params.get("axis");
    if (environments.some(([key]) => key === params.get("environment"))) {
      environmentSelect.value = params.get("environment");
    }
  }
  let chart = null;
  let selection = 0;
  let renderSequence = 0;
  let historyLoaded = !overview;
  let historyRequest = null;
  const showDetails = (record) => {
    if (overview) return;
    const currentSelection = ++selection;
    loadResultDetails(
      record, suite, catalog, root, target.querySelector(".result-details"),
      () => currentSelection === selection,
    );
  };
  const render = async () => {
    const currentRender = ++renderSequence;
    selection += 1;
    if (chart) chart.destroy();
    chart = null;
    const axis = axisSelect.value;
    const history = axis === "history";
    if (history && !historyLoaded) {
      target.querySelector(".explorer-chart").hidden = true;
      target.querySelector(".explorer-empty").hidden = true;
      target.querySelector(".explorer-context").hidden = false;
      target.querySelector(".explorer-context").textContent = "Loading history...";
      if (!historyRequest) {
        const version = document.body.dataset.siteVersion;
        historyRequest = fetchJson(
          `${root}/data/suites/${encodeURIComponent(suite.id)}.json?v=${encodeURIComponent(version)}`,
        );
      }
      let loaded;
      try {
        loaded = await historyRequest;
      } catch (error) {
        historyRequest = null;
        throw error;
      }
      if (!Array.isArray(loaded.series)) throw new Error("Invalid suite history");
      data.series = loaded.series;
      historyLoaded = true;
      if (currentRender !== renderSequence) return;
    }
    const [metric, unit] = JSON.parse(metricSelect.value);
    const matches = (item) => item.metric === metric && item.unit === unit
      && environmentKey(item.environment) === environmentSelect.value
      && observationMatchesFilters({ dimensions: historyFacets(item) }, filterState);
    const visible = history
      ? data.series.filter(matches).flatMap((item) =>
        item.points.map((point) => ({
          ...item, ...point, ordering_timestamp: point.timestamp,
        })))
      : data.observations.filter(matches);
    target.querySelector(".explorer-chart").hidden = !visible.length;
    target.querySelector(".explorer-empty").hidden = Boolean(visible.length);
    const context = target.querySelector(".explorer-context");
    context.classList.remove("error");
    environmentSelect.title = environmentDescription(
      JSON.parse(environmentSelect.value),
    );
    const unknown = environmentSelect.value === "{}"
      ? "Hardware unknown; comparability cannot be verified." : "";
    context.textContent = unknown;
    context.hidden = !context.textContent;
    if (overview) {
      const params = new URLSearchParams({
        metric: metricSelect.value, axis, environment: environmentSelect.value,
      });
      const changedFilters = Object.fromEntries([...filterState]
        .filter(([key, values]) => values.size !== categories.get(key).length)
        .map(([key, values]) => [key, [...values]]));
      if (Object.keys(changedFilters).length) {
        params.set("filters", JSON.stringify(changedFilters));
      }
      target.querySelector(".suite-link").href =
        `suites/${encodeURIComponent(suite.id)}/?${params}`;
    }
    if (!visible.length) {
      selection += 1;
      if (!overview) target.querySelector(".result-details").innerHTML = "";
      return;
    }
    if (typeof Chart === "undefined") throw new Error("Chart.js did not load");
    const chartData = explorerChart(visible, axis, variants);
    const options = chartOptions(unit);
    if (history) {
      Object.assign(options.scales.x.ticks, {
        autoSkip: true,
        maxTicksLimit: 8,
        maxRotation: 0,
      });
    }
    options.scales.x.title = {
      display: true,
      text: history ? "Source date (UTC)" : axes.find((item) => item.id === axis).label,
    };
    options.plugins.tooltip.callbacks.title = (items) => {
      const record = items[0].raw.record;
      return `${record.commit.slice(0, 8)} / ${formatDate(record.ordering_timestamp)}`;
    };
    options.plugins.tooltip.callbacks.afterLabel = (context) =>
      `Run: ${context.raw.record.run_id}`;
    options.onClick = (_event, elements) => {
      if (elements.length) {
        const { datasetIndex, index } = elements[0];
        const record = chartData.datasets[datasetIndex].data[index].record;
        if (record) showDetails(record);
      }
    };
    chart = new Chart(target.querySelector("canvas"), {
      type: history ? "line" : "bar", data: chartData, options,
    });
    showDetails(visible[0]);
  };
  const renderSafely = async () => {
    const expectedRender = renderSequence + 1;
    try {
      await render();
    } catch (error) {
      if (expectedRender !== renderSequence) return;
      selection += 1;
      target.querySelector(".explorer-chart").hidden = true;
      target.querySelector(".explorer-empty").hidden = true;
      if (!overview) target.querySelector(".result-details").innerHTML = "";
      const context = target.querySelector(".explorer-context");
      context.hidden = false;
      context.classList.add("error");
      context.textContent = `Could not render results: ${error.message}`;
    }
  };
  for (const control of [metricSelect, axisSelect, environmentSelect]) {
    control.addEventListener("change", renderSafely);
  }
  for (const checkbox of target.querySelectorAll("input[data-dimension]")) {
    checkbox.addEventListener("change", () => {
      const values = filterState.get(checkbox.dataset.dimension);
      if (checkbox.checked) values.add(checkbox.value);
      else values.delete(checkbox.value);
      renderSafely();
    });
  }
  target.querySelector(".filter-reset").addEventListener("click", () => {
    for (const [key, values] of categories) filterState.set(key, new Set(values));
    for (const checkbox of target.querySelectorAll("input[data-dimension]")) {
      checkbox.checked = true;
    }
    renderSafely();
  });
  renderSafely();
}

function environmentLabel(environment) {
  return [
    environment.os,
    environment.architecture,
    environment.testbed,
  ].filter(Boolean).join(" / ");
}

const FILTER_MISSING = "__benchmark_dimension_not_set__";

let activeCharts = [];

function titleCase(value) {
  return value
    .replaceAll("_", " ")
    .replaceAll(".", " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function filterLabel(key) {
  return titleCase(key.slice(key.indexOf(".") + 1));
}

function selectedObservationKeys(selected) {
  return new Set(
    selected.map(
      ({ suite, variant }) => `${suite.id}\u0000${variant.id}`,
    ),
  );
}

function comparisonObservations(comparison, selected, observations) {
  const identities = selectedObservationKeys(selected);
  const cases = new Set(comparison.cases.map((item) => item.id));
  const metrics = new Set(comparison.metrics.map((item) => item.id));
  return observations.filter(
    (observation) =>
      identities.has(`${observation.suite}\u0000${observation.variant}`) &&
      cases.has(observation.case) &&
      metrics.has(observation.metric),
  );
}

function collectDimensionCategories(observations) {
  const keys = new Set();
  for (const observation of observations) {
    for (const key of Object.keys(observation.dimensions)) {
      keys.add(key);
    }
  }
  const categories = new Map();
  for (const key of [...keys].sort()) {
    const values = new Set();
    for (const observation of observations) {
      values.add(observation.dimensions[key] ?? FILTER_MISSING);
    }
    categories.set(
      key,
      [...values].sort((left, right) => {
        if (left === FILTER_MISSING) return 1;
        if (right === FILTER_MISSING) return -1;
        return left.localeCompare(right, undefined, { numeric: true });
      }),
    );
  }
  return categories;
}

function initialFilterState(categories) {
  return new Map(
    [...categories].map(([key, values]) => [key, new Set(values)]),
  );
}

function displayFilterValue(value) {
  return value === FILTER_MISSING ? "Not set" : value;
}

function observationMatchesFilters(observation, filterState) {
  for (const [key, selectedValues] of filterState) {
    const value = observation.dimensions[key] ?? FILTER_MISSING;
    if (!selectedValues.has(value)) {
      return false;
    }
  }
  return true;
}

function renderFilterGroups(categories, filterState, prefix = "filter") {
  return [...categories].map(([key, values], groupIndex) => {
    const options = values.map((value, index) => {
      const id = `${prefix}-${groupIndex}-${index}`;
      return `
        <label class="filter-option" for="${escapeHtml(id)}">
          <input id="${escapeHtml(id)}"
                 type="checkbox"
                 data-dimension="${escapeHtml(key)}"
                 value="${escapeHtml(value)}"
                 ${filterState.get(key).has(value) ? "checked" : ""}>
          <span>${escapeHtml(displayFilterValue(value))}</span>
        </label>
      `;
    }).join("");
    return `
      <fieldset class="filter-group">
        <legend title="${escapeHtml(key)}">${escapeHtml(filterLabel(key))}</legend>
        ${options}
      </fieldset>
    `;
  }).join("");
}

function renderFilters(categories, filterState) {
  return `
    <div class="filter-heading">
      <h2>Filters</h2>
      <button class="filter-reset" type="button">Reset</button>
    </div>
    ${renderFilterGroups(categories, filterState)}
    <div id="filter-summary" class="filter-summary"></div>
  `;
}

function chartValueLabelsPlugin() {
  return {
    id: "benchmarkValueLabels",
    afterDatasetsDraw(chart) {
      if (chart.data.datasets.length > 8) {
        return;
      }
      const { ctx } = chart;
      const styles = getComputedStyle(document.documentElement);
      ctx.save();
      ctx.fillStyle = styles.getPropertyValue("--muted").trim();
      ctx.font = '10px "Segoe UI", sans-serif';
      ctx.textAlign = "center";
      ctx.textBaseline = "bottom";
      for (let datasetIndex = 0;
        datasetIndex < chart.data.datasets.length;
        datasetIndex += 1) {
        const dataset = chart.data.datasets[datasetIndex];
        const metadata = chart.getDatasetMeta(datasetIndex);
        if (metadata.hidden) {
          continue;
        }
        for (let index = 0; index < metadata.data.length; index += 1) {
          const value = dataset.data[index];
          if (value === null || value === undefined) {
            continue;
          }
          const bar = metadata.data[index];
          ctx.fillText(formatValue(value), bar.x, bar.y - 4);
        }
      }
      ctx.restore();
    },
  };
}

function buildMetricChart(
  comparison,
  metric,
  selected,
  observations,
) {
  const metricObservations = observations.filter(
    (observation) => observation.metric === metric.id,
  );
  const units = new Set(metricObservations.map((item) => item.unit));
  if (units.size !== 1) {
    throw new Error(
      `Metric ${metric.id} has ${units.size} units in the latest collection`,
    );
  }
  const unit = [...units][0];
  const environments = new Map();
  for (const observation of metricObservations) {
    environments.set(
      environmentKey(observation.environment),
      observation.environment,
    );
  }
  const environmentEntries = [...environments.entries()].sort(
    ([left], [right]) => left.localeCompare(right),
  );
  const groups = [];
  for (const testCase of comparison.cases) {
    for (const [key, environment] of environmentEntries) {
      if (metricObservations.some(
        (observation) =>
          observation.case === testCase.id &&
          environmentKey(observation.environment) === key,
      )) {
        groups.push({
          caseId: testCase.id,
          label: [testCase.label, environmentLabel(environment)],
          environmentKey: key,
        });
      }
    }
  }

  const byValue = new Map();
  for (const observation of metricObservations) {
    const key = [
      observation.suite,
      observation.variant,
      environmentKey(observation.environment),
      observation.case,
    ].join("\u0000");
    if (byValue.has(key)) {
      throw new Error(
        `Duplicate latest observation for ${observation.suite}/` +
        `${observation.variant}, ${observation.case}, ${metric.id}`,
      );
    }
    byValue.set(key, observation.value);
  }

  const datasets = [];
  const colors = activeChartColors();
  for (const [index, item] of selected.entries()) {
    const data = groups.map((group) => byValue.get([
      item.suite.id,
      item.variant.id,
      group.environmentKey,
      group.caseId,
    ].join("\u0000")) ?? null);
    if (data.every((value) => value === null)) {
      continue;
    }
    const color = colors[index % colors.length];
    datasets.push({
      label: item.variant.name,
      data,
      backgroundColor: color,
      borderColor: color,
      borderWidth: 1,
      borderRadius: 4,
      borderSkipped: "bottom",
    });
  }
  return { unit, labels: groups.map((group) => group.label), datasets };
}

function chartOptions(unit) {
  const styles = getComputedStyle(document.documentElement);
  const text = styles.getPropertyValue("--text").trim();
  const muted = styles.getPropertyValue("--muted").trim();
  const line = styles.getPropertyValue("--line").trim();
  return {
    responsive: true,
    maintainAspectRatio: false,
    animation: false,
    layout: { padding: { top: 24 } },
    datasets: {
      bar: { categoryPercentage: 0.84, barPercentage: 0.9 },
    },
    scales: {
      x: {
        grid: { display: false },
        border: { display: false },
        ticks: { color: muted, font: { size: 11, weight: "600" } },
      },
      y: {
        beginAtZero: true,
        border: { color: line },
        grid: { color: line },
        ticks: {
          color: muted,
          maxTicksLimit: 6,
          callback: (value) => formatValue(value),
        },
        title: {
          display: true,
          text: unit,
          color: muted,
          font: { size: 12, weight: "600" },
        },
      },
    },
    plugins: {
      legend: {
        position: "bottom",
        labels: {
          boxWidth: 11,
          boxHeight: 11,
          padding: 16,
          color: text,
          font: { size: 12 },
        },
      },
      tooltip: {
        callbacks: {
          label: (context) =>
            `${context.dataset.label}: ${formatValue(context.parsed.y)} ${unit}`,
        },
      },
    },
  };
}

function renderMetricCharts(
  comparison,
  selected,
  observations,
  target,
) {
  for (const chart of activeCharts) {
    chart.destroy();
  }
  activeCharts = [];
  if (!observations.length) {
    target.innerHTML = `
      <div class="empty-state">No measurements match the selected filters.</div>
    `;
    return;
  }
  target.innerHTML = comparison.metrics.map((metric) => `
    <article class="card chart-card" data-metric="${escapeHtml(metric.id)}">
      <div class="chart-heading">
        <div>
          <h2>${escapeHtml(metric.label)}</h2>
          <div class="meta">${escapeHtml(metric.id)}</div>
        </div>
      </div>
      <div class="chart-wrapper">
        <canvas aria-label="${escapeHtml(metric.label)} grouped column chart"
                role="img"></canvas>
      </div>
    </article>
  `).join("");

  if (typeof Chart === "undefined") {
    throw new Error("Chart.js did not load");
  }
  for (const metric of comparison.metrics) {
    const card = target.querySelector(
      `[data-metric="${CSS.escape(metric.id)}"]`,
    );
    const chartData = buildMetricChart(
      comparison,
      metric,
      selected,
      observations,
    );
    card.querySelector(".chart-heading").insertAdjacentHTML(
      "beforeend",
      `<span class="unit">${escapeHtml(chartData.unit)}</span>`,
    );
    activeCharts.push(new Chart(card.querySelector("canvas"), {
      type: "bar",
      data: {
        labels: chartData.labels,
        datasets: chartData.datasets,
      },
      options: chartOptions(chartData.unit),
      plugins: [chartValueLabelsPlugin()],
    }));
  }
}

function renderComparisonPage(catalog, latest, views, suites, comparisons) {
  const comparisonId = document.body.dataset.comparisonId;
  const comparison = comparisons.get(comparisonId);
  if (!comparison) {
    throw new Error(`Unknown comparison ${comparisonId}`);
  }
  const selected = selectedVariants(comparison, suites);
  const observations = comparisonObservations(
    comparison,
    selected,
    latest.observations,
  );
  const categories = collectDimensionCategories(observations);
  const filterState = initialFilterState(categories);
  document.title = `${comparison.name} - OTel Arrow Benchmarks`;
  document.getElementById("page-title").textContent = comparison.name;
  document.getElementById("summary").textContent =
    `${selected.length} variants from ${comparison.sources.length} ` +
    `suite ${comparison.sources.length === 1 ? "family" : "families"}; ` +
    `latest collection ${latest.collection_id}`;

  const sourceSections = comparison.sources.map((source) => {
    const suite = suites.get(source.suite);
    const allowed = source.include_variants
      ? new Set(source.include_variants)
      : null;
    const variants = suite.variants.filter(
      (variant) => !allowed || allowed.has(variant.id),
    );
    return `
      <div class="source-card">
        <div>
          <strong>${escapeHtml(suite.name)}</strong>
          <span class="role">${escapeHtml(source.role || "comparison")}</span>
        </div>
        <div class="meta">${escapeHtml(suite.description)}</div>
        <div class="variant-list">
          ${variants.map(
            (variant) => `<span>${escapeHtml(variant.name)}</span>`,
          ).join("")}
        </div>
      </div>
    `;
  }).join("");

  document.getElementById("app").innerHTML = `
    <section class="comparison-intro">
      <p>${escapeHtml(comparison.description)}</p>
      <div class="source-grid">${sourceSections}</div>
    </section>
    <div class="comparison-workspace">
      <aside id="filters" class="filter-panel" aria-label="Measurement filters">
        ${renderFilters(categories, filterState)}
      </aside>
      <section>
        <div id="charts" class="chart-grid"></div>
        <p id="provenance" class="provenance"></p>
      </section>
    </div>
  `;

  const charts = document.getElementById("charts");
  const filterSummary = document.getElementById("filter-summary");
  const provenance = document.getElementById("provenance");
  const render = () => {
    const filtered = observations.filter(
      (observation) => observationMatchesFilters(observation, filterState),
    );
    renderMetricCharts(comparison, selected, filtered, charts);
    filterSummary.textContent =
      `${filtered.length.toLocaleString()} of ` +
      `${observations.length.toLocaleString()} measurements`;
    provenance.textContent =
      `Showing ${filtered.length} selected observations from ` +
      `${latest.collection_id} ` +
      `(${latest.observations.length} observations available).`;
  };
  for (const checkbox of document.querySelectorAll(
    "#filters input[data-dimension]",
  )) {
    checkbox.addEventListener("change", () => {
      const values = filterState.get(checkbox.dataset.dimension);
      if (checkbox.checked) {
        values.add(checkbox.value);
      } else {
        values.delete(checkbox.value);
      }
      render();
    });
  }
  document.querySelector(".filter-reset").addEventListener("click", () => {
    for (const [key, values] of categories) {
      filterState.set(key, new Set(values));
    }
    for (const checkbox of document.querySelectorAll(
      "#filters input[data-dimension]",
    )) {
      checkbox.checked = true;
    }
    render();
  });
  render();
}

async function load() {
  const root = document.body.dataset.root || ".";
  const siteVersion = document.body.dataset.siteVersion;
  const versionQuery = siteVersion
    ? `?v=${encodeURIComponent(siteVersion)}`
    : "";
  try {
    if (document.body.dataset.page === "suite") {
      const suiteId = document.body.dataset.suiteId;
      const [views, history, catalog] = await Promise.all([
        fetchJson(`${root}/data/views.json${versionQuery}`),
        fetchJson(`${root}/data/suites/${encodeURIComponent(suiteId)}.json${versionQuery}`),
        fetchJson(`${root}/data/catalog.json${versionQuery}`),
      ]);
      const suite = views.suites.find((item) => item.id === suiteId);
      if (!suite) {
        throw new Error(`Unknown suite ${suiteId}`);
      }
      document.getElementById("page-title").textContent = suite.name;
      document.getElementById("summary").textContent = suite.description;
      renderSuiteExplorer(
        document.getElementById("app"), suite, history, catalog, root,
      );
      return;
    }
    if (document.body.dataset.page === "overview") {
      const [overview, views] = await Promise.all([
        fetchJson(`${root}/data/overview.json${versionQuery}`),
        fetchJson(`${root}/data/views.json${versionQuery}`),
      ]);
      renderOverview(overview, views);
      return;
    }
    const [catalog, latest, views] = await Promise.all([
      fetchJson(`${root}/data/catalog.json${versionQuery}`),
      fetchJson(`${root}/data/latest.json${versionQuery}`),
      fetchJson(`${root}/data/views.json${versionQuery}`),
    ]);
    const { suites, comparisons } = mapsFor(views);
    if (document.body.dataset.page === "comparison") {
      renderComparisonPage(
        catalog,
        latest,
        views,
        suites,
        comparisons,
      );
    }
  } catch (error) {
    document.getElementById("app").innerHTML =
      `<div class="error">Could not load dashboard: ${escapeHtml(error.message)}</div>`;
  }
}

load();
