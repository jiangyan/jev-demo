// The browser holds no key. It posts the draft to the server on every word and renders
// whatever comes back, including which source the answer came from.

const $ = (id) => document.getElementById(id);
const f2 = (n) => Number(n).toFixed(2);

const state = { drafts: [], current: null, playing: false, timer: null, lastSource: null };

const METERS = [
  {
    key: "tone",
    name: "How it will land",
    kind: "score",
    labels: ["warm", "plain", "clipped", "hostile"],
    captions: [
      "Reads like someone who wants to help.",
      "Businesslike. Nothing wrong with it.",
      "Terse enough that they may feel brushed off.",
      "This one is going to cost you.",
    ],
  },
  { key: "answers_them", name: "Answers what they asked", kind: "noul", invert: true },
  { key: "contains_secret", name: "Credential in the message", kind: "noul" },
  { key: "makes_promise", name: "Promises something specific", kind: "noul" },
  { key: "blames_reader", name: "Blames the reader", kind: "noul" },
];

init().catch((e) => { $("summary").textContent = `Could not load: ${e.message}`; });

async function init() {
  const res = await fetch("/api/drafts");
  const data = await res.json();
  state.drafts = data.drafts;

  renderMode(data);
  renderScenarios();
  select(state.drafts[0].id);

  $("draft").addEventListener("input", () => { stop(); schedule(); });
  $("play").addEventListener("click", () => (state.playing ? stop() : play()));
  $("clear").addEventListener("click", () => { stop(); $("draft").value = ""; evaluate(); });
  $("send").addEventListener("click", send);
}

function renderMode(data) {
  const el = $("mode");
  el.hidden = false;
  if (data.source === "live") {
    el.className = "mode live";
    el.innerHTML = "<strong>Live</strong>Every word you type is a real call to Jev.";
  } else if (data.source === "recorded") {
    el.className = "mode";
    el.innerHTML =
      "<strong>Replaying a recording</strong>Real answers, captured from Jev for these sample " +
      "replies. Type something of your own and it falls back to the stand-in, and says so.";
  } else {
    el.className = "mode warn";
    el.innerHTML =
      "<strong>No key, no recording &mdash; using a stand-in</strong>" +
      "Judgements below come from about sixty lines of keyword rules in " +
      "<code>src/core/standin.ts</code>, not from Jev. The loop, the interface and the send " +
      "gate are real; the judgement is not. Set <code>TYPESAFE_API_KEY</code> for the real thing.";
  }
}

function renderScenarios() {
  $("scenarios").innerHTML = state.drafts
    .map(
      (d) =>
        `<button type="button" class="scen" data-id="${d.id}" aria-pressed="${state.current === d.id}">` +
        `<b>${escape(d.title)}</b><span>${escape(d.watch)}</span></button>`,
    )
    .join("");
  for (const b of $("scenarios").querySelectorAll(".scen")) {
    b.addEventListener("click", () => { stop(); select(b.dataset.id); });
  }
}

function current() {
  return state.drafts.find((d) => d.id === state.current);
}

function select(id) {
  state.current = id;
  for (const b of $("scenarios").querySelectorAll(".scen")) {
    b.setAttribute("aria-pressed", String(b.dataset.id === id));
  }
  const d = current();
  $("incoming").textContent = d.theyWrote;
  $("watchline").textContent = d.watch;
  $("draft").value = "";
  evaluate();
}

/* ---- typing it out, one word at a time ---- */
function play() {
  const words = current().reply.split(/\s+/);
  let i = $("draft").value.trim() === "" ? 0 : words.length;
  if (i >= words.length) { $("draft").value = ""; i = 0; }

  state.playing = true;
  $("play").textContent = "Stop";

  const step = () => {
    if (!state.playing) return;
    if (i >= words.length) { stop(); return; }
    $("draft").value = words.slice(0, ++i).join(" ");
    evaluate();
    state.timer = setTimeout(step, 150);
  };
  step();
}

function stop() {
  state.playing = false;
  if (state.timer) clearTimeout(state.timer);
  state.timer = null;
  $("play").textContent = "Type it out";
}

let pending = null;
function schedule() {
  if (pending) clearTimeout(pending);
  pending = setTimeout(evaluate, 110);
}

let inflight = null;
async function evaluate() {
  if (inflight) inflight.abort();
  const controller = new AbortController();
  inflight = controller;

  const body = { they_wrote: current().theyWrote, my_reply: $("draft").value };
  let data;
  try {
    const res = await fetch("/api/compose", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    data = await res.json();
  } catch (error) {
    if (error.name === "AbortError") return;
    throw error;
  }
  if (controller !== inflight) return;

  renderMeters(data.answers);
  renderVerdict(data.verdict);
  renderSource(data);
}

function renderSource(data) {
  const el = $("src");
  el.className = "src" + (data.source === "live" ? " live" : data.source === "stand-in" ? " standin" : "");
  el.textContent = data.source === "live" ? `live · ${data.ms.toFixed(0)}ms` : data.source;
  el.title =
    data.source === "stand-in"
      ? "Keyword rules standing in for the model. See src/core/standin.ts."
      : data.source === "recorded"
        ? "A real answer from Jev, captured earlier for this exact draft."
        : "A real call to Jev, just now.";
}

function renderMeters(answers) {
  $("meters").innerHTML = METERS.map((m) => {
    const a = answers[m.key];
    if (m.kind === "score") {
      const level = Math.round(a.score);
      const klass = a.score >= 2.4 ? "hot" : a.score >= 1.7 ? "warn" : "";
      return `
      <div class="meter-row">
        <div class="meter-top"><span>${m.name}</span><span class="n ${klass}">${escape(m.labels[level])}</span></div>
        <div class="ticks">
          ${m.labels.map((_, i) => `<span class="tick ${i <= level ? "on " + klass : ""}"></span>`).join("")}
        </div>
        <p class="meter-caption">${escape(m.captions[level])}</p>
      </div>`;
    }
    const p = a.noul;
    const bad = m.invert ? p < 0.4 : p >= 0.5;
    const klass = bad ? (m.key === "contains_secret" || m.key === "blames_reader" ? "hot" : "warn") : "";
    return `
      <div class="meter-row">
        <div class="meter-top"><span>${m.name}</span><span class="n ${klass === "hot" ? "hot" : ""}">${f2(p)}</span></div>
        <div class="meter-track"><span class="meter-fill ${klass}" style="width:${p * 100}%"></span></div>
      </div>`;
  }).join("");
}

function renderVerdict(v) {
  const button = $("send");
  button.dataset.state = v.blocked ? "blocked" : v.flags.length ? "warn" : "ok";
  button.disabled = v.blocked;
  button.textContent = v.blocked ? "Blocked" : "Send";
  $("summary").textContent = v.summary;
  $("flags").innerHTML = v.flags
    .map((f) => `<li class="${f.severity}">${escape(f.message)}</li>`)
    .join("");
}

function send() {
  const button = $("send");
  if (button.disabled) return;
  button.dataset.state = "sent";
  button.textContent = "Sent";
  setTimeout(() => evaluate(), 1200);
}

function escape(text) {
  return String(text).replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c],
  );
}

$("foot-note").textContent =
  "Five questions per keystroke. At $0.042 per million input tokens, typing this whole page costs less than a cent.";
