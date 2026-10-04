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

function dimensionLabel(observation) {
  const dimensions = Object.entries(observation.dimensions)
    .map(([key, value]) => `${key}=${value}`);
  const environment = [
    observation.environment.os,
    observation.environment.architecture,
  ].filter(Boolean);
  return [...environment, ...dimensions].join(" / ");
}

function groupBy(items, keyFunction) {
  const groups = new Map();
  for (const item of items) {
    const key = keyFunction(item);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(item);
  }
  return groups;
}

function renderComparison(latest) {
  const target = document.getElementById("comparison-view");
  const groups = groupBy(
    latest.observations,
    (item) => `${item.metric}\u0000${item.unit}`,
  );
  if (!groups.size) {
    target.innerHTML = '<div class="empty">No comparison observations.</div>';
    return;
  }

  const cards = [];
  for (const [key, observations] of groups) {
    const [metric, unit] = key.split("\u0000");
    const maximum = Math.max(...observations.map((item) => item.value), 1);
    const rows = observations.map((item) => `
      <div class="bar-row">
        <div>
          <strong>${escapeHtml(item.suite)} / ${escapeHtml(item.case)}</strong>
          <div class="meta">${escapeHtml(dimensionLabel(item))}</div>
        </div>
        <div class="bar-track"><div class="bar" style="width:${(item.value / maximum) * 100}%"></div></div>
        <div>${formatValue(item.value)} ${escapeHtml(unit)}</div>
      </div>
    `).join("");
    cards.push(`
      <article class="card">
        <div class="card-heading">
          <h2>${escapeHtml(metric)}</h2>
          <span class="unit">${escapeHtml(unit)}</span>
        </div>
        ${rows}
      </article>
    `);
  }
  target.innerHTML = `
    <p>Latest collection: <strong>${escapeHtml(latest.collection_id)}</strong></p>
    <div class="grid">${cards.join("")}</div>
  `;
}

function seriesLabel(series) {
  const dimensions = Object.entries(series.dimensions)
    .map(([key, value]) => `${key}=${value}`);
  const environment = [
    series.environment.os,
    series.environment.architecture,
  ].filter(Boolean);
  return [...environment, ...dimensions].join(" / ");
}

function renderSparkline(points) {
  const width = 500;
  const height = 140;
  const padding = 12;
  const values = points.map((point) => point.value);
  const minimum = Math.min(...values);
  const maximum = Math.max(...values);
  const span = maximum - minimum || 1;
  const coordinates = points.map((point, index) => {
    const x = points.length === 1
      ? width / 2
      : padding + index * ((width - padding * 2) / (points.length - 1));
    const y = height - padding - ((point.value - minimum) / span) * (height - padding * 2);
    return { x, y, point };
  });
  const polyline = coordinates.map(({ x, y }) => `${x},${y}`).join(" ");
  const circles = coordinates.map(({ x, y, point }) => `
    <circle cx="${x}" cy="${y}" r="4">
      <title>${escapeHtml(point.commit.slice(0, 8))}: ${formatValue(point.value)}</title>
    </circle>
  `).join("");
  return `
    <svg viewBox="0 0 ${width} ${height}" role="img">
      <line class="axis" x1="${padding}" y1="${height - padding}" x2="${width - padding}" y2="${height - padding}"></line>
      <polyline points="${polyline}"></polyline>
      ${circles}
    </svg>
    <div class="range">
      <span>${escapeHtml(points[0].commit.slice(0, 8))}</span>
      <span>${formatValue(minimum)} - ${formatValue(maximum)}</span>
      <span>${escapeHtml(points.at(-1).commit.slice(0, 8))}</span>
    </div>
  `;
}

function renderHistory(history) {
  const target = document.getElementById("history-view");
  if (!history.series.length) {
    target.innerHTML = '<div class="empty">No historical series.</div>';
    return;
  }
  target.innerHTML = `
    <p>Every point below comes from the same immutable observations used by the latest comparison.</p>
    <div class="grid">
      ${history.series.map((series) => `
        <article class="card history-card">
          <div class="card-heading">
            <div>
              <h2>${escapeHtml(series.metric)}</h2>
              <div class="meta">${escapeHtml(series.suite)} / ${escapeHtml(series.case)}</div>
            </div>
            <span class="unit">${escapeHtml(series.unit)}</span>
          </div>
          <div class="meta">${escapeHtml(seriesLabel(series))}</div>
          ${renderSparkline(series.points)}
        </article>
      `).join("")}
    </div>
  `;
}

function wireNavigation() {
  for (const button of document.querySelectorAll("nav button")) {
    button.addEventListener("click", () => {
      for (const candidate of document.querySelectorAll("nav button")) {
        candidate.classList.toggle("active", candidate === button);
      }
      const comparison = button.dataset.view === "comparison";
      document.getElementById("comparison-view").hidden = !comparison;
      document.getElementById("history-view").hidden = comparison;
    });
  }
}

async function load() {
  wireNavigation();
  try {
    const [catalog, latest, history] = await Promise.all([
      fetch("data/catalog.json").then((response) => response.json()),
      fetch("data/latest.json").then((response) => response.json()),
      fetch("data/history.json").then((response) => response.json()),
    ]);
    document.getElementById("summary").textContent =
      `${catalog.run_count} runs, ${catalog.collection_count} collections, ` +
      `${catalog.measurement_count} measurements`;
    renderComparison(latest);
    renderHistory(history);
  } catch (error) {
    document.querySelector("main").innerHTML =
      `<div class="error">Could not load dashboard data: ${escapeHtml(error.message)}</div>`;
  }
}

load();
