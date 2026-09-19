// The browser does no model work and holds no key. It asks the server for the
// answers once, then for a decision each time a threshold moves. Every number on
// screen after the first load is arithmetic over answers already in hand.

const $ = (id) => document.getElementById(id);
const fmt = (n, d = 2) => Number(n).toFixed(d);
const pct = (n) => `${Math.round(n * 100)}%`;

const state = {
  /** @type {any} */ meta: null,
  /** @type {any} */ decision: null,
  thresholds: null,
  filter: "all",
  open: new Set(),
};

const SLIDERS = [
  {
    key: "autoRoute",
    name: "Auto-route at",
    desc: "Above this, the ticket is routed with nobody looking.",
    min: 0.5,
    max: 1,
  },
  {
    key: "confirmRoute",
    name: "Suggest at",
    desc: "Between the two, route but ask a person to confirm. Below, hand it over.",
    min: 0.2,
    max: 1,
  },
  {
    key: "securitySuspicion",
    name: "Security suspicion at",
    desc: "A suspected incident is never automated, however sure the model is.",
    min: 0.05,
    max: 0.9,
  },
];

init().catch((error) => {
  $("loading-text").textContent = `Could not load: ${error.message}`;
});

async function init() {
  const res = await fetch("/api/state");
  if (!res.ok) throw new Error((await res.json()).error ?? res.statusText);
  state.meta = await res.json();
  state.thresholds = { ...state.meta.defaultThresholds };

  renderMode();
  renderSliders();
  renderFilters();
  await refresh();

  $("loading").hidden = true;
  $("app").hidden = false;
}

async function refresh() {
  const res = await fetch("/api/decide", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(state.thresholds),
  });
  state.decision = await res.json();
  renderStats();
  renderTickets();
  renderCalibration();
  renderFoot();
}

function renderMode() {
  const el = $("mode");
  const { mode, generator, staleCassette, model } = state.meta;
  el.hidden = false;
  if (mode === "live") {
    el.className = "mode live";
    el.innerHTML = `<strong>Live</strong>Answers from ${escape(model)} on api.typesafe.ai.`;
    return;
  }
  if (generator === "synthetic") {
    el.className = "mode warn";
    el.innerHTML =
      `<strong>Synthetic fixtures &mdash; not the real model</strong>` +
      `These answers were generated locally, deliberately overconfident, so the demo runs ` +
      `offline. They show what the machinery does. They tell you nothing about how well Jev ` +
      `performs. Run <code>npm run record</code> with a key to replace them.`;
    return;
  }
  el.className = "mode";
  el.innerHTML = `<strong>Replay</strong>Recorded from ${escape(model)}. No network calls.${
    staleCassette ? " Warning: recorded for a different question set." : ""
  }`;
}

function renderSliders() {
  $("sliders").innerHTML = SLIDERS.map(
    (s) => `
    <div class="slider">
      <div class="slider-head">
        <span class="name">${s.name}</span>
        <span class="val" id="val-${s.key}">${fmt(state.thresholds[s.key])}</span>
      </div>
      <input type="range" id="sl-${s.key}" min="${s.min}" max="${s.max}" step="0.01"
             value="${state.thresholds[s.key]}" aria-label="${s.name}" />
      <p class="slider-desc">${s.desc}</p>
    </div>`,
  ).join("");

  for (const s of SLIDERS) {
    $(`sl-${s.key}`).addEventListener("input", (event) => {
      state.thresholds[s.key] = Number(event.target.value);
      // Keep the two routing thresholds from crossing over.
      if (state.thresholds.confirmRoute > state.thresholds.autoRoute) {
        if (s.key === "autoRoute") state.thresholds.confirmRoute = state.thresholds.autoRoute;
        else state.thresholds.autoRoute = state.thresholds.confirmRoute;
      }
      for (const other of SLIDERS) {
        $(`val-${other.key}`).textContent = fmt(state.thresholds[other.key]);
        $(`sl-${other.key}`).value = String(state.thresholds[other.key]);
      }
      schedule();
    });
  }
}

let pending = null;
function schedule() {
  if (pending) clearTimeout(pending);
  pending = setTimeout(() => refresh(), 60);
}

function renderFilters() {
  const options = [
    ["all", "All"],
    ["auto", "Automated"],
    ["confirm", "Confirm"],
    ["human", "To a human"],
    ["wrong", "Got it wrong"],
  ];
  $("filters").innerHTML = options
    .map(
      ([key, label]) =>
        `<button data-filter="${key}" aria-pressed="${state.filter === key}">${label}</button>`,
    )
    .join("");
  $("filters").addEventListener("click", (event) => {
    const button = event.target.closest("button");
    if (!button) return;
    state.filter = button.dataset.filter;
    for (const b of $("filters").querySelectorAll("button")) {
      b.setAttribute("aria-pressed", String(b.dataset.filter === state.filter));
    }
    renderTickets();
  });
}

function renderStats() {
  const s = state.decision.summary;
  $("stats").innerHTML = `
    <div class="stat auto"><div class="big">${s.auto}</div><div class="lbl">automated</div></div>
    <div class="stat confirm"><div class="big">${s.confirm}</div><div class="lbl">confirm</div></div>
    <div class="stat human"><div class="big">${s.human}</div><div class="lbl">to a human</div></div>
    <div class="stat wide">
      <div class="big">$${fmt(s.costPerThousand, 3)}</div>
      <div class="lbl">per 1000 tickets, ${s.inputTokens.toLocaleString()} input tokens for these ${s.total}</div>
    </div>`;

  const escapes = s.escapes;
  $("tradeoff").innerHTML =
    `${pct(s.auto / s.total)} of the queue handled unattended, ` +
    (escapes === 0
      ? `<span class="ok">none of them misrouted</span>.`
      : `<span class="esc">${escapes} misrouted</span> (${s.escapedTickets.join(", ")}) &mdash; ` +
        `those reach a customer.`);
}

function ticketById(id) {
  return state.meta.tickets.find((t) => t.id === id);
}
function sheetById(id) {
  return state.meta.sheets.find((s) => s.ticketId === id);
}

function renderTickets() {
  const rows = state.decision.routings.filter((r) => {
    if (state.filter === "all") return true;
    if (state.filter === "wrong") return r.department !== ticketById(r.ticketId).label.department;
    return r.disposition === state.filter;
  });

  $("tickets").innerHTML = rows.map(renderTicket).join("");

  for (const button of $("tickets").querySelectorAll(".ticket-head")) {
    button.addEventListener("click", () => {
      const id = button.dataset.id;
      if (state.open.has(id)) state.open.delete(id);
      else state.open.add(id);
      renderTickets();
    });
  }
}

function renderTicket(routing) {
  const ticket = ticketById(routing.ticketId);
  const sheet = sheetById(routing.ticketId);
  const wrong = routing.department !== ticket.label.department;
  const open = state.open.has(ticket.id);

  return `
  <li class="ticket ${routing.disposition}${wrong ? " wrong" : ""}">
    <button class="ticket-head" data-id="${ticket.id}" aria-expanded="${open}">
      <span class="ticket-subject"><span class="ticket-id">${ticket.id}</span>${escape(ticket.subject)}</span>
      <span class="ticket-meta">
        <span class="conf">
          <span class="conf-bar"><span class="conf-fill" style="width:${routing.confidence * 100}%"></span></span>
          ${fmt(routing.confidence)}
        </span>
        <span>${escape(routing.department)}</span>
        <span class="tag pri">${routing.priority}</span>
        <span class="tag ${routing.disposition}">${routing.disposition}</span>
      </span>
    </button>
    ${open ? renderBody(ticket, sheet, routing, wrong) : ""}
  </li>`;
}

function renderBody(ticket, sheet, routing, wrong) {
  const a = sheet.answers;
  const q = state.meta.questions;

  return `
  <div class="ticket-body">
    <p class="quote">${escape(ticket.body)}</p>
    <div class="sheet">
      ${renderChoice("department", a.department)}
      ${renderScore("severity", a.severity, q.severity.criteria)}
      ${renderScore("frustration", a.frustration, q.frustration.criteria)}
      ${renderNoul("refund_requested", a.refund_requested)}
      ${renderNoul("contains_pii", a.contains_pii)}
      ${renderNoul("security_incident", a.security_incident)}
    </div>
    <div class="actions">${routing.actions.map((x) => `<span class="action">${escape(x)}</span>`).join("")}</div>
    <ul class="reasons">${routing.reasons.map((r) => `<li>${escape(r)}</li>`).join("")}</ul>
    <p class="truth">
      human label: ${escape(ticket.label.department)}
      ${wrong ? `<span class="bad">&mdash; model disagreed</span>` : `<span class="good">&mdash; matched</span>`}
      ${ticket.ambiguous ? " (lead marked this one arguable)" : ""}
    </p>
  </div>`;
}

function renderChoice(name, answer) {
  const rows = Object.entries(answer.probabilities)
    .sort((a, b) => b[1] - a[1])
    .map(([label, p]) => ({ key: label, label, p, win: label === answer.choice }));
  return `
  <div class="q">
    <span class="q-name">${name}</span> &middot;
    <span class="q-answer">${escape(answer.choice)} at ${fmt(answer.confidence)}</span>
    ${distRows(rows)}
  </div>`;
}

function renderScore(name, answer, criteria) {
  const nearest = Math.round(answer.score);
  const rows = Object.entries(answer.probabilities)
    .sort((a, b) => Number(a[0]) - Number(b[0]))
    .map(([level, p]) => ({
      key: level,
      label: `${level} \u00b7 ${describe(criteria[Number(level)])}`,
      p,
      win: Number(level) === nearest,
    }));
  return `
  <div class="q">
    <span class="q-name">${name}</span> &middot;
    <span class="q-answer">${fmt(answer.score, 1)} of ${rows.length - 1}</span>
    ${distRows(rows, 200)}
  </div>`;
}

/** Probabilities as labelled rows. Readable at a glance, unlike a row of thin columns. */
function distRows(rows, labelWidth) {
  const style = labelWidth ? ` style="grid-template-columns:${labelWidth}px 1fr 38px"` : "";
  return `<div class="dist">${rows
    .map(
      (r) => `
      <div class="dist-row${r.win ? " win" : ""}"${style}>
        <span class="dist-label" title="${escape(r.label)}">${escape(r.label)}</span>
        <span class="dist-track"><span class="dist-fill" style="width:${Math.max(1, r.p * 100)}%"></span></span>
        <span class="dist-val">${fmt(r.p, 2)}</span>
      </div>`,
    )
    .join("")}</div>`;
}

function renderNoul(name, answer) {
  return `
  <div class="q">
    <span class="q-name">${name}</span> &middot;
    <span class="q-answer">p = ${fmt(answer.noul)}</span>
    <div class="gauge"><span class="gauge-fill${answer.noul > 0.5 ? " hot" : ""}" style="width:${answer.noul * 100}%"></span></div>
  </div>`;
}

function describe(criterion) {
  if (typeof criterion === "string") return criterion;
  if (criterion && typeof criterion === "object" && "what" in criterion) return String(criterion.what);
  return "";
}

function renderCalibration() {
  const c = state.decision.calibration;
  const gap = c.meanConfidence - c.accuracy;
  const verdict =
    Math.abs(gap) < 0.05
      ? `<span class="ok">well matched</span>`
      : gap > 0
        ? `<span class="esc">overconfident by ${fmt(gap)}</span>`
        : `underconfident by ${fmt(-gap)}`;

  $("cal-summary").innerHTML = `
    <div class="stat"><div class="big">${fmt(c.accuracy)}</div><div class="lbl">accuracy</div></div>
    <div class="stat"><div class="big">${fmt(c.meanConfidence)}</div><div class="lbl">mean confidence</div></div>
    <div class="stat"><div class="big">${fmt(c.ece)}</div><div class="lbl">ECE, 0 is perfect</div></div>
    <div class="stat"><div class="big">${fmt(c.brier)}</div><div class="lbl">Brier score</div></div>`;

  $("reliability").innerHTML = `
    ${reliabilitySvg(c.bins)}
    <div class="legend">
      <p>Each dot is a bucket of answers, sized by how many. The dashed line is perfect
         calibration. A dot's height is how often that bucket was actually right; its
         distance from the line is how far the claim was off.</p>
      <p>
        <span class="swatch" style="background:var(--auto)"></span>within 0.05
        <span class="swatch" style="background:var(--confirm);margin-left:12px"></span>within 0.15
        <span class="swatch" style="background:var(--human);margin-left:12px"></span>further out
      </p>
      <p>Overall: ${verdict}, across ${c.n} decisions.</p>
    </div>`;

  const current = state.thresholds.autoRoute;
  const closest = c.operatingPoints.reduce((best, p) =>
    Math.abs(p.threshold - current) < Math.abs(best.threshold - current) ? p : best,
  );
  $("operating").innerHTML = `
    <table>
      <thead><tr><th>Automate above</th><th>Coverage</th><th>Precision</th><th>Misrouted</th></tr></thead>
      <tbody>
        ${c.operatingPoints
          .map(
            (p) => `
          <tr class="${p === closest ? "current" : ""}">
            <td>${fmt(p.threshold)}</td>
            <td>${pct(p.coverage)}</td>
            <td>${fmt(p.precision)}</td>
            <td>${p.escapes === 0 ? `<span class="ok">0</span>` : `<span class="esc">${p.escapes}</span>`}</td>
          </tr>`,
          )
          .join("")}
      </tbody>
    </table>`;
}

function reliabilitySvg(bins) {
  const size = 320;
  const pad = 40;
  const plot = size - pad * 2;
  const x = (v) => pad + v * plot;
  const y = (v) => size - pad - v * plot;
  const filled = bins.filter((b) => b.count > 0);
  const maxCount = Math.max(1, ...filled.map((b) => b.count));

  return `
  <svg viewBox="0 0 ${size} ${size}" role="img"
       aria-label="Reliability diagram: claimed confidence against measured accuracy">
    <rect x="${pad}" y="${pad}" width="${plot}" height="${plot}" fill="var(--bg-sunken)" stroke="var(--line)" />
    ${[0.25, 0.5, 0.75]
      .map(
        (g) =>
          `<line x1="${x(g)}" y1="${pad}" x2="${x(g)}" y2="${size - pad}" stroke="var(--line)" />` +
          `<line x1="${pad}" y1="${y(g)}" x2="${size - pad}" y2="${y(g)}" stroke="var(--line)" />`,
      )
      .join("")}
    <line x1="${x(0)}" y1="${y(0)}" x2="${x(1)}" y2="${y(1)}"
          stroke="var(--text-faint)" stroke-dasharray="4 4" />
    ${filled
      .map((b) => {
        const r = 3 + (b.count / maxCount) * 6;
        const off = Math.abs(b.meanConfidence - b.accuracy);
        const colour = off < 0.05 ? "var(--auto)" : off < 0.15 ? "var(--confirm)" : "var(--human)";
        return (
          `<line x1="${x(b.meanConfidence)}" y1="${y(b.meanConfidence)}" ` +
          `x2="${x(b.meanConfidence)}" y2="${y(b.accuracy)}" stroke="${colour}" stroke-width="1.5" opacity="0.5" />` +
          `<circle cx="${x(b.meanConfidence)}" cy="${y(b.accuracy)}" r="${r}" fill="${colour}">` +
          `<title>claimed ${fmt(b.meanConfidence)}, right ${fmt(b.accuracy)} of the time, ${b.count} decisions</title>` +
          `</circle>`
        );
      })
      .join("")}
    <text x="${size / 2}" y="${size - 6}" text-anchor="middle"
          fill="var(--text-faint)" font-size="11" font-family="var(--mono)">claimed confidence</text>
    <text x="12" y="${size / 2}" text-anchor="middle" transform="rotate(-90 12 ${size / 2})"
          fill="var(--text-faint)" font-size="11" font-family="var(--mono)">actually right</text>
    <text x="${pad}" y="${size - pad + 14}" fill="var(--text-faint)" font-size="10" font-family="var(--mono)">0</text>
    <text x="${size - pad}" y="${size - pad + 14}" text-anchor="end"
          fill="var(--text-faint)" font-size="10" font-family="var(--mono)">1</text>
  </svg>`;
}

function renderFoot() {
  const s = state.decision.summary;
  $("foot-note").textContent =
    state.meta.mode === "live"
      ? `median ${s.medianMs.toFixed(0)}ms per ticket for ${Object.keys(state.meta.questions).length} questions in one call`
      : `replay mode: no I/O, so latency is not shown. ${Object.keys(state.meta.questions).length} questions per ticket, one call each.`;
}

function escape(text) {
  return String(text).replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c],
  );
}
