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

function dimensionChips(dimensions) {
  return Object.entries(dimensions)
    .map(([key, value]) => `
      <span class="dimension">${escapeHtml(key)}=${escapeHtml(value)}</span>
    `)
    .join("");
}

function renderMetricTable(comparison, metric, selected, observations) {
  const selectedKeys = new Set(
    selected.map(
      ({ suite, variant }) => `${suite.id}\u0000${variant.id}`,
    ),
  );
  const metricObservations = observations.filter(
    (observation) =>
      observation.metric === metric.id &&
      selectedKeys.has(`${observation.suite}\u0000${observation.variant}`),
  );
  const units = new Set(metricObservations.map((item) => item.unit));
  if (units.size !== 1) {
    throw new Error(
      `Metric ${metric.id} has ${units.size} units in the latest collection`,
    );
  }
  const unit = [...units][0];
  const cases = comparison.cases;
  const byValue = new Map();
  const environments = new Map();
  for (const observation of metricObservations) {
    const envKey = environmentKey(observation.environment);
    environments.set(envKey, observation.environment);
    const key = [
      observation.suite,
      observation.variant,
      envKey,
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
  const environmentEntries = [...environments.entries()].sort(
    ([left], [right]) => left.localeCompare(right),
  );
  const values = [...byValue.values()];
  const maximum = Math.max(...values, 1);
  const rows = [];
  for (const item of selected) {
    for (const [envKey, environment] of environmentEntries) {
      const caseValues = cases.map((testCase) => {
        const key = [
          item.suite.id,
          item.variant.id,
          envKey,
          testCase.id,
        ].join("\u0000");
        return byValue.get(key);
      });
      if (caseValues.every((value) => value === undefined)) {
        continue;
      }
      const cells = caseValues.map((value) => {
        if (value === undefined) {
          return '<td class="missing">Missing</td>';
        }
        return `
          <td class="value-cell">
            <div class="cell-bar" style="width:${(value / maximum) * 100}%"></div>
            <span>${formatValue(value)}</span>
          </td>
        `;
      }).join("");
      rows.push(`
        <tr class="variant-row"
            data-suite="${escapeHtml(item.suite.id)}"
            data-variant="${escapeHtml(item.variant.id)}">
          <th scope="row">
            <div class="variant-title">
              ${escapeHtml(item.variant.name)}
              <span class="role">${escapeHtml(item.role)}</span>
            </div>
            <div class="meta">${escapeHtml(environmentLabel(environment))}</div>
            <div class="dimensions">${dimensionChips(item.variant.dimensions)}</div>
          </th>
          ${cells}
        </tr>
      `);
    }
  }
  const caseHeaders = cases
    .map((testCase) => `<th scope="col">${escapeHtml(testCase.label)}</th>`)
    .join("");
  return `
    <article class="card metric-card" data-metric="${escapeHtml(metric.id)}">
      <div class="card-heading">
        <div>
          <h2>${escapeHtml(metric.label)}</h2>
          <div class="meta">${escapeHtml(metric.id)}</div>
        </div>
        <span class="unit">${escapeHtml(unit)}</span>
      </div>
      <div class="table-scroll">
        <table>
          <thead>
            <tr>
              <th scope="col">Variant and environment</th>
              ${caseHeaders}
            </tr>
          </thead>
          <tbody>${rows.join("")}</tbody>
        </table>
      </div>
    </article>
  `;
}

function renderComparisonPage(catalog, latest, views, suites, comparisons) {
  const comparisonId = document.body.dataset.comparisonId;
  const comparison = comparisons.get(comparisonId);
  if (!comparison) {
    throw new Error(`Unknown comparison ${comparisonId}`);
  }
  const selected = selectedVariants(comparison, suites);
  const selectedIdentities = new Set(
    selected.map(
      ({ suite, variant }) => `${suite.id}\u0000${variant.id}`,
    ),
  );
  const selectedCases = new Set(comparison.cases.map((item) => item.id));
  const selectedMetrics = new Set(comparison.metrics.map((item) => item.id));
  const selectedObservationCount = latest.observations.filter(
    (observation) =>
      selectedIdentities.has(
        `${observation.suite}\u0000${observation.variant}`,
      ) &&
      selectedCases.has(observation.case) &&
      selectedMetrics.has(observation.metric),
  ).length;
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
  const metricCards = comparison.metrics
    .map((metric) =>
      renderMetricTable(
        comparison,
        metric,
        selected,
        latest.observations,
      ),
    )
    .join("");

  document.getElementById("app").innerHTML = `
    <section class="comparison-intro">
      <p>${escapeHtml(comparison.description)}</p>
      <div class="source-grid">${sourceSections}</div>
    </section>
    <section class="metric-grid">${metricCards}</section>
    <p class="provenance">
      Showing ${selectedObservationCount} selected observations from
      ${escapeHtml(latest.collection_id)}
      (${latest.observations.length} observations available).
    </p>
  `;
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
