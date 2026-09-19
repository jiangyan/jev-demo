/**
 * The same four endpoints as `src/server/index.ts`, as a Vercel function.
 *
 * This exists so the demo can be shown from a URL instead of a laptop. The key stays
 * on the server here exactly as it does locally: the browser posts text and gets back
 * answers, and never sees `TYPESAFE_API_KEY`.
 *
 * Live is the point of this deployment, so live is the default. With no key set the
 * function still answers, from the checked-in recording, and says which in `source`.
 */
import type { IncomingMessage, ServerResponse } from "node:http";
import { ask, openSession, type Session } from "../src/core/client.js";
import { judge, type ComposeState } from "../src/core/compose.js";
import { openComposeEngine } from "../src/core/composeSource.js";
import { drafts } from "../src/core/drafts.js";
import { defaultThresholds, route, type Answers, type Thresholds } from "../src/core/gate.js";
import { operatingPoints, reliability, type Outcome } from "../src/core/calibration.js";
import { decisionSheet } from "../src/core/questions.js";
import { tickets } from "../src/core/tickets.js";

const hasKey = Boolean(process.env["TYPESAFE_API_KEY"]?.trim());

const session: Session = openSession(hasKey ? { mode: "live" } : { mode: "replay" });
const compose = openComposeEngine({ live: hasKey });

interface Sheet {
  ticketId: string;
  answers: Answers;
  ms: number;
  inputTokens: number;
}

let observedModel = session.client.defaultModel;

/**
 * One instance answers the 24 tickets once and keeps them. A cold start pays for 24
 * calls; everything after that is arithmetic. Moving a threshold never calls the model.
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
      escapes: automatedWrong.length,
      escapedTickets: automatedWrong.map((r) => r.ticketId),
      inputTokens,
      costPerThousand: (inputTokens / all.length / 1_000_000) * 0.042 * 1000,
      medianMs: median(all.map((s) => s.ms)),
    },
    calibration: { ...reliability(outcomes), operatingPoints: operatingPoints(outcomes) },
  };
}

function median(xs: number[]): number {
  const sorted = [...xs].sort((a, b) => a - b);
  if (sorted.length === 0) return 0;
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? (sorted[mid] ?? 0) : ((sorted[mid - 1] ?? 0) + (sorted[mid] ?? 0)) / 2;
}

/** Vercel parses JSON bodies onto `req.body`; fall back to reading the stream. */
async function readBody(req: IncomingMessage & { body?: unknown }): Promise<Record<string, unknown>> {
  if (req.body && typeof req.body === "object") return req.body as Record<string, unknown>;
  if (typeof req.body === "string") return req.body ? JSON.parse(req.body) : {};
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  const text = Buffer.concat(chunks).toString("utf8");
  return text ? JSON.parse(text) : {};
}

function json(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(body));
}

export default async function handler(
  req: IncomingMessage & { body?: unknown },
  res: ServerResponse,
): Promise<void> {
  const pathname = new URL(req.url ?? "/", "http://localhost").pathname;

  try {
    if (pathname === "/api/state") {
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

    if (pathname === "/api/drafts") {
      return json(res, 200, { drafts, source: compose.preferred, hasRecording: compose.hasRecording });
    }

    if (pathname === "/api/compose" && req.method === "POST") {
      const body = await readBody(req);
      const state: ComposeState = {
        they_wrote: String(body["they_wrote"] ?? ""),
        my_reply: String(body["my_reply"] ?? ""),
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

    if (pathname === "/api/decide" && req.method === "POST") {
      const all = await loadSheets();
      const body = await readBody(req);
      return json(res, 200, decide(all, { ...defaultThresholds, ...(body as Partial<Thresholds>) }));
    }

    return json(res, 404, { error: "No such endpoint" });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(message);
    return json(res, 500, { error: message });
  }
}
