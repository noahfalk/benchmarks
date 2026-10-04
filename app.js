"use strict";

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

function renderOverview(catalog, views, suites) {
  document.getElementById("summary").textContent =
    `${views.comparisons.length} comparisons from ${views.suites.length} ` +
    `suite families; ${catalog.run_count} immutable runs`;

  const cards = views.comparisons.map((comparison) => {
    const selected = selectedVariants(comparison, suites);
    const sourceRows = comparison.sources.map((source) => {
      const suite = suites.get(source.suite);
      const count = source.include_variants
        ? source.include_variants.length
        : suite.variants.length;
      return `
        <li>
          <span>${escapeHtml(suite.name)}</span>
          <span class="source-summary">
            ${count} ${count === 1 ? "variant" : "variants"}
            <span class="role">${escapeHtml(source.role || "comparison")}</span>
          </span>
        </li>
      `;
    }).join("");
    return `
      <article class="card comparison-card" data-comparison-id="${escapeHtml(comparison.id)}">
        <div class="card-heading">
          <div>
            <h2>${escapeHtml(comparison.name)}</h2>
            <p>${escapeHtml(comparison.description)}</p>
          </div>
          <span class="count">${selected.length} variants</span>
        </div>
        <ul class="source-list">${sourceRows}</ul>
        <div class="comparison-facts">
          <span>${comparison.cases.length} cases</span>
          <span>${comparison.metrics.length} metrics</span>
        </div>
        <a class="button-link primary" href="comparisons/${encodeURIComponent(comparison.id)}/">
          View comparison
        </a>
      </article>
    `;
  }).join("");

  document.getElementById("app").innerHTML = `
    <section class="intro">
      <h2>Configured comparisons</h2>
      <p>
        Each page selects reusable variants from one or more suite families.
        Results come from the latest immutable run collection.
      </p>
    </section>
    <section class="grid">${cards}</section>
  `;
}

function environmentKey(environment) {
  return JSON.stringify(environment, Object.keys(environment).sort());
}

function environmentLabel(environment) {
  return [
    environment.os,
    environment.architecture,
    environment.testbed,
  ].filter(Boolean).join(" / ");
}

const FILTER_MISSING = "__benchmark_dimension_not_set__";
const CHART_COLORS = [
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

let activeCharts = [];

function titleCase(value) {
  return value
    .replaceAll("_", " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
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

function renderFilters(categories, filterState) {
  const groups = [...categories].map(([key, values]) => {
    const options = values.map((value, index) => {
      const id = `filter-${key}-${index}`;
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
        <legend>${escapeHtml(titleCase(key))}</legend>
        ${options}
      </fieldset>
    `;
  }).join("");
  return `
    <div class="filter-heading">
      <h2>Filters</h2>
      <button class="filter-reset" type="button">Reset</button>
    </div>
    ${groups}
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
    const color = CHART_COLORS[index % CHART_COLORS.length];
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
  try {
    const [catalog, latest, views] = await Promise.all([
      fetchJson(`${root}/data/catalog.json`),
      fetchJson(`${root}/data/latest.json`),
      fetchJson(`${root}/data/views.json`),
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
    } else {
      renderOverview(catalog, views, suites);
    }
  } catch (error) {
    document.getElementById("app").innerHTML =
      `<div class="error">Could not load dashboard: ${escapeHtml(error.message)}</div>`;
  }
}

load();
