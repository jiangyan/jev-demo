/**
 * The demo server.
 *
 * It holds the API key and does the talking to Jev; the browser never sees either.
 * That is not incidental -- the SDK makes you pass `dangerouslyAllowBrowser` to run
 * it client-side, because doing so hands your key to everyone who loads the page.
 *
 *   npm run web            # replay mode unless TYPESAFE_API_KEY is set
 *   npm run web -- --live  # call the real API
 */
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { ask, openSession, type Session } from "../core/client.js";
import { judge, type ComposeState } from "../core/compose.js";
import { openComposeEngine } from "../core/composeSource.js";
import { drafts } from "../core/drafts.js";
import { defaultThresholds, route, type Answers, type Thresholds } from "../core/gate.js";
import { operatingPoints, reliability, type Outcome } from "../core/calibration.js";
import { decisionSheet } from "../core/questions.js";
import { tickets } from "../core/tickets.js";

const WEB_ROOT = fileURLToPath(new URL("../../web/", import.meta.url));
const PORT = Number(process.env["PORT"] ?? 5173);

const argv = process.argv.slice(2);
const forceLive = argv.includes("--live");
const session: Session = openSession(
  forceLive ? { mode: "live" } : argv.includes("--replay") ? { mode: "replay" } : {},
);
const compose = openComposeEngine(forceLive ? { live: true } : argv.includes("--replay") ? { live: false } : {});

interface Sheet {
  ticketId: string;
  answers: Answers;
  ms: number;
  inputTokens: number;
}

/** The model name the API actually answered with, which may be more specific than the alias asked for. */
let observedModel = session.client.defaultModel;

/**
 * Answers are fetched once and kept. Everything the UI does afterwards -- moving
 * thresholds, re-deciding the whole queue, redrawing the reliability curve -- is
 * arithmetic over these numbers, with no further model calls. That separation is
 * the point being demonstrated: the model decides, the software rules.
 */
let sheets: Sheet[] | null = null;
let loading: Promise<Sheet[]> | null = null;

async function loadSheets(): Promise<Sheet[]> {
  if (sheets) return sheets;
  if (loading) return loading;
  loading = (async () => {
    const collected: Sheet[] = [];
    for (const ticket of tickets) {
      const decision = await ask(session, ticket);
      observedModel = decision.model;
      collected.push({
        ticketId: ticket.id,
        answers: decision.answers,
        ms: decision.ms,
        inputTokens: decision.usage.input_tokens,
      });
    }
    sheets = collected;
    return collected;
  })();
  return loading;
}

function decide(all: Sheet[], thresholds: Thresholds) {
  const routings = all.map((sheet) => ({ ticketId: sheet.ticketId, ...route(sheet.answers, thresholds) }));

  const outcomes: Outcome[] = all.map((sheet) => {
    const ticket = tickets.find((t) => t.id === sheet.ticketId);
    return {
      confidence: sheet.answers.department.confidence,
      correct: sheet.answers.department.choice === ticket?.label.department,
    };
  });

  const automated = routings.filter((r) => r.disposition === "auto");
  const automatedWrong = automated.filter((r) => {
    const ticket = tickets.find((t) => t.id === r.ticketId);
    return ticket !== undefined && r.department !== ticket.label.department;
  });

  const inputTokens = all.reduce((sum, s) => sum + s.inputTokens, 0);

  return {
    routings,
    summary: {
      total: routings.length,
      auto: automated.length,
      confirm: routings.filter((r) => r.disposition === "confirm").length,
      human: routings.filter((r) => r.disposition === "human").length,
      /** Automated decisions that went to the wrong team. These reach a customer. */
      escapes: automatedWrong.length,
      escapedTickets: automatedWrong.map((r) => r.ticketId),
      inputTokens,
      // $0.042 per million input tokens; output is free.
      costPerThousand: (inputTokens / all.length / 1_000_000) * 0.042 * 1000,
      medianMs: median(all.map((s) => s.ms)),
    },
    calibration: {
      ...reliability(outcomes),
      operatingPoints: operatingPoints(outcomes),
    },
  };
}

function median(xs: number[]): number {
  const sorted = [...xs].sort((a, b) => a - b);
  if (sorted.length === 0) return 0;
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? (sorted[mid] ?? 0) : ((sorted[mid - 1] ?? 0) + (sorted[mid] ?? 0)) / 2;
}

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".svg": "image/svg+xml",
  ".json": "application/json; charset=utf-8",
};

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);

  try {
    if (url.pathname === "/api/state") {
      const all = await loadSheets();
      return json(res, 200, {
        mode: session.mode,
        generator: session.cassette?.generator ?? "live",
        staleCassette: session.staleCassette,
        model: observedModel,
        defaultThresholds,
        questions: decisionSheet,
        tickets,
        sheets: all,
      });
    }

    if (url.pathname === "/api/drafts") {
      return json(res, 200, {
        drafts,
        source: compose.preferred,
        hasRecording: compose.hasRecording,
      });
    }

    if (url.pathname === "/api/compose" && req.method === "POST") {
      const body = (await readBody(req)) as Partial<ComposeState>;
      const state: ComposeState = {
        they_wrote: String(body.they_wrote ?? ""),
        my_reply: String(body.my_reply ?? ""),
      };
      const reading = await compose.read(state);
      return json(res, 200, {
        answers: reading.answers,
        source: reading.source,
        ms: reading.ms,
        inputTokens: reading.inputTokens,
        verdict: judge(reading.answers, state.my_reply),
      });
    }

    if (url.pathname === "/api/decide" && req.method === "POST") {
      const all = await loadSheets();
      const body = await readBody(req);
      const thresholds = { ...defaultThresholds, ...(body as Partial<Thresholds>) };
      return json(res, 200, decide(all, thresholds));
    }

    if (url.pathname.startsWith("/api/")) return json(res, 404, { error: "No such endpoint" });

    // Static files. `normalize` plus the prefix check keeps `..` inside WEB_ROOT.
    const requested = url.pathname === "/" ? "index.html" : url.pathname.slice(1);
    const path = normalize(join(WEB_ROOT, requested));
    if (!path.startsWith(WEB_ROOT)) return json(res, 403, { error: "Outside the web root" });

    const file = await readFile(path);
    res.writeHead(200, { "content-type": MIME[extname(path)] ?? "application/octet-stream" });
    return res.end(file);
  } catch (error) {
    if (isNotFound(error)) return json(res, 404, { error: "Not found" });
    const message = error instanceof Error ? error.message : String(error);
    console.error(message);
    return json(res, 500, { error: message });
  }
});

function json(res: import("node:http").ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(body));
}

async function readBody(req: import("node:http").IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  const text = Buffer.concat(chunks).toString("utf8");
  return text ? JSON.parse(text) : {};
}

function isNotFound(error: unknown): boolean {
  return typeof error === "object" && error !== null && (error as { code?: string }).code === "ENOENT";
}

server.listen(PORT, () => {
  console.log();
  console.log(`  Jev triage desk  http://localhost:${PORT}`);
  console.log(
    session.mode === "live"
      ? `  live: ${session.client.baseURL}, model ${session.client.defaultModel}`
      : `  replay: ${session.cassette?.generator ?? "unknown"} fixtures, no network`,
  );
  if (session.staleCassette) console.log("  warning: cassette recorded for a different question set");
  console.log();
});
