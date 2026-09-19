// The browser holds no key. It posts the draft to the server and renders whatever comes
// back, including which source the answer came from.
//
// When the server is live, every single keystroke gets its own call. Nothing is debounced
// and nothing is cancelled: the calls race, and each answer is rendered only if a newer
// one has not already landed. That is only reasonable because a call costs about four
// hundredths of a cent and comes back in under a fifth of a second, which is the whole
// argument for this class of model. The footer keeps the running total honest.
//
// Offline it falls back to the old behaviour. The recording holds one answer per word of
// each sample reply, so asking per keystroke there would just miss the cassette between
// word boundaries and flicker into the stand-in.

const $ = (id) => document.getElementById(id);
const f2 = (n) => Number(n).toFixed(2);

const state = {
  drafts: [],
  current: null,
  playing: false,
  timer: null,
  /** True when the server is live, and every keystroke is worth its own call. */
  perKeystroke: false,
  /** Monotonic request number, so a slow answer never overwrites a newer one. */
  seq: 0,
  rendered: 0,
  inflight: 0,
  calls: 0,
  tokens: 0,
  lastKey: null,
};

/** Above this many calls at once, skip: only a held-down key gets near it. */
const MAX_INFLIGHT = 12;

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

  state.perKeystroke = data.source === "live";

  renderMode(data);
  renderScenarios();
  renderTally();
  select(state.drafts[0].id);

  $("draft").addEventListener("input", () => {
    stop();
    if (state.perKeystroke) evaluate();
    else schedule();
  });
  $("play").addEventListener("click", () => (state.playing ? stop() : play()));
  $("clear").addEventListener("click", () => { stop(); $("draft").value = ""; evaluate(); });
  $("send").addEventListener("click", send);
}

function renderMode(data) {
  const el = $("mode");
  el.hidden = false;
  if (data.source === "live") {
    el.className = "mode live";
    el.innerHTML =
      "<strong>Live</strong>Every keystroke is its own call to Jev. Nothing is batched, " +
      "nothing is cached; the running cost is in the footer.";
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

async function evaluate(force = false) {
  const body = { they_wrote: current().theyWrote, my_reply: $("draft").value };
  const key = `${body.they_wrote}\u0000${body.my_reply}`;
  if (!force && key === state.lastKey) return;
  if (state.inflight >= MAX_INFLIGHT) {
    // Only a held-down key gets here. Come back for the final text once the queue drains.
    schedule();
    return;
  }
  state.lastKey = key;

  const seq = ++state.seq;
  state.inflight += 1;
  renderTally();

  let data;
  try {
    const res = await fetch("/api/compose", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    data = await res.json();
  } catch {
    // A dropped call costs nothing here: the next keystroke asks again.
    return;
  } finally {
    state.inflight -= 1;
  }

  state.calls += 1;
  state.tokens += data.inputTokens ?? 0;
  renderTally();

  // An answer that was overtaken while in flight is stale. Count it, do not draw it.
  if (seq <= state.rendered) return;
  state.rendered = seq;

  renderMeters(data.answers);
  renderVerdict(data.verdict);
  renderSource(data);
}

/**
 * The claim this demo makes about cost, kept as a live measurement rather than a
 * sentence. Tokens are what the API billed, not an estimate.
 */
function renderTally() {
  if (state.calls === 0 && state.inflight === 0) {
    $("foot-note").textContent =
      "Five questions on every keystroke. At $0.042 per million input tokens, typing this whole page costs less than a cent.";
    return;
  }
  const dollars = (state.tokens / 1_000_000) * 0.042;
  const flying = state.inflight > 0 ? `, ${state.inflight} in flight` : "";
  $("foot-note").textContent =
    `Five questions per call. ${state.calls} calls${flying}, ` +
    `${state.tokens.toLocaleString()} input tokens, $${dollars.toFixed(4)} so far.`;
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
  setTimeout(() => evaluate(true), 1200);
}

function escape(text) {
  return String(text).replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c],
  );
}


