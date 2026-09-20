// Mock model API server for offline sandbox testing.
//
// Implements the two wire protocols the runtime speaks — OpenAI chat
// completions and Anthropic messages — against 127.0.0.1, records every
// request it receives, and can inject failures (rate limits, auth errors,
// truncated streams, malformed payloads). The default success body carries a
// unique sentinel so tests can assert the full pipeline rendered it.


export interface RecordedRequest {
  seq: number;
  protocol: "openai" | "anthropic";
  url: string;
  model: string | undefined;
  stream: boolean;
  authPrefix: string;
  headers: Record<string, string>;
  body: unknown;
  at: number;
}

export type Scenario =
  | { kind: "success"; text?: string; chunks?: number }
  | { kind: "rate-limit"; retryAfterSeconds?: number }
  | { kind: "unauthorized" }
  | { kind: "server-error" }
  | { kind: "malformed-sse" }
  | { kind: "cut-stream"; afterChunks?: number }
  | { kind: "slow"; chunkDelayMs: number; chunks?: number }
  | {
      kind: "tool-use";
      /** First turn returns this tool call; every later turn returns followUpText. */
      toolName: string;
      toolInput: Record<string, unknown>;
      followUpText: string;
      /**
       * Serve the tool call only to requests that advertise the tool
       * (default true — kills the title-generation race). Set false only for
       * headless flows with no background requests; the Workflow tool is
       * dynamically dispatched and absent from the advertised table.
       */
      requireAdvertised?: boolean;
    };

export interface ModelServer {
  url: string;
  requests(): RecordedRequest[];
  setScenario(scenario: Scenario): void;
  close(): Promise<void>;
}

export interface StartOptions {
  /** Default success text; tests wait for this sentinel on screen/output. */
  sentinel?: string;
  scenario?: Scenario;
  journalPath?: string;
}

const ANTHROPIC_1302 = {
  type: "error",
  error: { type: "rate_limit_error", code: "1302", message: "[1302][Rate limit reached for requests][mock]" },
};

function sseChunk(content: string, role = "assistant") {
  return `data: ${JSON.stringify({ choices: [{ index: 0, delta: { role, content }, finish_reason: null }] })}\n\n`;
}
const SSE_DONE = "data: [DONE]\n\n";

function openAiNonStream(text: string) {
  return Response.json({
    id: "chatcmpl-mock", object: "chat.completion", created: 1, model: "mock",
    choices: [{ index: 0, message: { role: "assistant", content: text }, finish_reason: "stop" }],
    usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
  });
}

function openAiStream(text: string, chunks = 3) {
  const parts: string[] = [];
  const size = Math.ceil(text.length / chunks);
  for (let i = 0; i < text.length; i += size) {
    parts.push(sseChunk(text.slice(i, i + size)));
  }
  // Usage rides on the final chunk, mirroring stream_options.include_usage.
  parts.push(`data: ${JSON.stringify({ choices: [{ index: 0, delta: {}, finish_reason: "stop" }], usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 } })}\n\n`);
  parts.push(SSE_DONE);
  return new Response(parts.join(""), { headers: { "content-type": "text/event-stream" } });
}

function anthropicNonStream(text: string) {
  return Response.json({
    id: "msg_mock", type: "message", role: "assistant", model: "mock",
    content: [{ type: "text", text }],
    stop_reason: "end_turn",
    usage: { input_tokens: 10, output_tokens: 5 },
  });
}

function anthropicStream(text: string, chunks = 3) {
  const parts: string[] = [
    `event: message_start\ndata: ${JSON.stringify({ type: "message_start", message: { id: "msg_mock", type: "message", role: "assistant", model: "mock", content: [], usage: { input_tokens: 10, output_tokens: 0 } } })}\n\n`,
    `event: content_block_start\ndata: ${JSON.stringify({ type: "content_block_start", index: 0, content_block: { type: "text", text: "" } })}\n\n`,
  ];
  const size = Math.ceil(text.length / chunks);
  for (let i = 0; i < text.length; i += size) {
    parts.push(`event: content_block_delta\ndata: ${JSON.stringify({ type: "content_block_delta", index: 0, delta: { type: "text_delta", text: text.slice(i, i + size) } })}\n\n`);
  }
  parts.push(`event: content_block_stop\ndata: ${JSON.stringify({ type: "content_block_stop", index: 0 })}\n\n`);
  parts.push(`event: message_delta\ndata: ${JSON.stringify({ type: "message_delta", delta: { stop_reason: "end_turn" }, usage: { output_tokens: 5 } })}\n\n`);
  parts.push(`event: message_stop\ndata: ${JSON.stringify({ type: "message_stop" })}\n\n`);
  return new Response(parts.join(""), { headers: { "content-type": "text/event-stream" } });
}

// --- tool_use responses -----------------------------------------------------
// The runtime must issue the tool call, execute the tool, and send the result
// back as a follow-up turn (where the mock replies with followUpText).

const TOOL_CALL_ID = "call_mock_1";

function toolUseResponse(
  protocol: "openai" | "anthropic",
  stream: boolean,
  toolName: string,
  toolInput: Record<string, unknown>,
  followUpText: string,
  firstTurn: boolean,
): Response {
  if (!firstTurn) {
    // Follow-up turn (carries the tool result): plain final text.
    return stream
      ? (protocol === "anthropic" ? anthropicStream(followUpText) : openAiStream(followUpText))
      : (protocol === "anthropic" ? anthropicNonStream(followUpText) : openAiNonStream(followUpText));
  }
  if (protocol === "openai") {
    const toolCall = { index: 0, id: TOOL_CALL_ID, type: "function", function: { name: toolName, arguments: JSON.stringify(toolInput) } };
    if (stream) {
      const parts = [
        `data: ${JSON.stringify({ choices: [{ index: 0, delta: { role: "assistant", tool_calls: [toolCall] }, finish_reason: null }] })}\n\n`,
        `data: ${JSON.stringify({ choices: [{ index: 0, delta: {}, finish_reason: "tool_calls" }] })}\n\n`,
        SSE_DONE,
      ];
      return new Response(parts.join(""), { headers: { "content-type": "text/event-stream" } });
    }
    return Response.json({
      id: "chatcmpl-mock", object: "chat.completion", created: 1, model: "mock",
      choices: [{ index: 0, message: { role: "assistant", content: null, tool_calls: [toolCall] }, finish_reason: "tool_calls" }],
      usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
    });
  }
  // anthropic
  if (stream) {
    const json = JSON.stringify(toolInput);
    const parts = [
      `event: message_start\ndata: ${JSON.stringify({ type: "message_start", message: { id: "msg_mock", type: "message", role: "assistant", model: "mock", content: [], usage: { input_tokens: 10, output_tokens: 0 } } })}\n\n`,
      `event: content_block_start\ndata: ${JSON.stringify({ type: "content_block_start", index: 0, content_block: { type: "tool_use", id: TOOL_CALL_ID, name: toolName, input: {} } })}\n\n`,
      `event: content_block_delta\ndata: ${JSON.stringify({ type: "content_block_delta", index: 0, delta: { type: "input_json_delta", partial_json: json } })}\n\n`,
      `event: content_block_stop\ndata: ${JSON.stringify({ type: "content_block_stop", index: 0 })}\n\n`,
      `event: message_delta\ndata: ${JSON.stringify({ type: "message_delta", delta: { stop_reason: "tool_use" }, usage: { output_tokens: 5 } })}\n\n`,
      `event: message_stop\ndata: ${JSON.stringify({ type: "message_stop" })}\n\n`,
    ];
    return new Response(parts.join(""), { headers: { "content-type": "text/event-stream" } });
  }
  return Response.json({
    id: "msg_mock", type: "message", role: "assistant", model: "mock",
    content: [{ type: "tool_use", id: TOOL_CALL_ID, name: toolName, input: toolInput }],
    stop_reason: "tool_use",
    usage: { input_tokens: 10, output_tokens: 5 },
  });
}

export async function startModelServer(options: StartOptions = {}): Promise<ModelServer> {
  let scenario: Scenario = options.scenario ?? { kind: "success" };
  let seq = 0;
  // tool-use scenario: the first request after setScenario gets the tool call,
  // every later request gets followUpText.
  let toolUseServed = false;
  const recorded: RecordedRequest[] = [];
  const sentinel = options.sentinel ?? "MOCKED-RESPONSE-OK";
  const journal = options.journalPath;

  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    async fetch(request) {
      const url = new URL(request.url);
      const protocol: "openai" | "anthropic" = url.pathname.includes("/chat/completions")
        ? "openai"
        : url.pathname.includes("/messages")
          ? "anthropic"
          : "openai";
      let body: any = {};
      try {
        body = await request.json();
      } catch {
        // no/invalid body — leave empty
      }
      const headers: Record<string, string> = {};
      request.headers.forEach((value, key) => {
        headers[key] = /auth/i.test(key) ? value.slice(0, 10) + "…redacted" : value;
      });
      const record: RecordedRequest = {
        seq: seq++,
        protocol,
        url: url.pathname,
        model: body.model,
        stream: body.stream === true,
        authPrefix: (request.headers.get("authorization") ?? request.headers.get("x-api-key") ?? "").slice(0, 8),
        headers,
        body,
        at: Date.now(),
      };
      recorded.push(record);
      if (journal) {
        const existing = await Bun.file(journal).exists() ? await Bun.file(journal).text() : "";
        await Bun.write(journal, existing + JSON.stringify(record) + "\n");
      }

      const kind = scenario.kind;
      const s = scenario as any;

      if (kind === "tool-use") {
        // Serve the tool call ONLY when the request actually advertises the
        // tool. Background requests (e.g. the TUI's title generation) send
        // tools: [] — the vendor discards tool calls from them, so handing
        // the tool call to such a request would lose it nondeterministically
        // (codex judge round 2, finding 3).
        const advertised = s.requireAdvertised === false || (
          Array.isArray(body?.tools)
            && body.tools.some((t: any) => (t?.function?.name ?? t?.name) === s.toolName)
        );
        const first = !toolUseServed && advertised;
        if (first) toolUseServed = true;
        return toolUseResponse(protocol, body.stream === true, s.toolName, s.toolInput, s.followUpText, first);
      }
      if (kind === "rate-limit") {
        return Response.json(ANTHROPIC_1302, {
          status: 429,
          headers: { "retry-after": String(s.retryAfterSeconds ?? 0), "anthropic-ratelimit-unified-status": "rejected" },
        });
      }
      if (kind === "unauthorized") {
        return Response.json({ error: { message: "invalid api key", type: "401" } }, { status: 401 });
      }
      if (kind === "server-error") {
        return Response.json({ error: { message: "internal error", type: "500" } }, { status: 500 });
      }
      if (kind === "malformed-sse") {
        return new Response("this is not sse at all\n\n\0garbage", { headers: { "content-type": "text/event-stream" } });
      }
      if (kind === "cut-stream") {
        // Premature end: the stream starts, then the connection drops without
        // a terminal SSE chunk — the retryable "network reset" class. We close
        // (not error) the stream deliberately: erroring would make bun log a
        // server-side unhandled error that pollutes CI annotations.
        const enc = new TextEncoder();
        const start = protocol === "anthropic"
          ? `event: message_start\ndata: ${JSON.stringify({ type: "message_start", message: { id: "msg_mock", type: "message", role: "assistant", model: "mock", content: [], usage: { input_tokens: 5, output_tokens: 0 } } })}\n\nevent: content_block_start\ndata: ${JSON.stringify({ type: "content_block_start", index: 0, content_block: { type: "text", text: "" } })}\n\n`
          : sseChunk("partial");
        const stream = new ReadableStream({
          start(controller) {
            controller.enqueue(enc.encode(start));
            setTimeout(() => controller.close(), 30);
          },
        });
        return new Response(stream, { headers: { "content-type": "text/event-stream" } });
      }

      const text = kind === "success" && s.text !== undefined ? s.text : sentinel;
      const chunks = kind === "success" && s.chunks !== undefined ? s.chunks : 3;
      if (kind === "slow") {
        // Genuinely slow: sleep between EVERY chunk so the turn stays
        // in-flight for the whole stream (interrupt tests rely on this).
        const delay = s.chunkDelayMs;
        const parts: string[] = [];
        const size = Math.ceil(text.length / chunks);
        for (let i = 0; i < text.length; i += size) {
          parts.push(sseChunk(text.slice(i, i + size)));
        }
        parts.push(`data: ${JSON.stringify({ choices: [{ index: 0, delta: {}, finish_reason: "stop" }], usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 } })}\n\n`);
        parts.push(SSE_DONE);
        const enc = new TextEncoder();
        let idx = 0;
        let closed = false;
        const stream = new ReadableStream({
          pull(controller) {
            if (closed) return;
            if (idx < parts.length) {
              const chunk = parts[idx++]!;
              return new Promise((resolve) => {
                setTimeout(() => {
                  // The client may disconnect mid-stream (interrupt tests):
                  // never touch the controller after close/cancel.
                  if (closed) { resolve(); return; }
                  try {
                    controller.enqueue(enc.encode(chunk));
                  } catch {
                    closed = true;
                  }
                  resolve();
                }, delay);
              });
            }
            closed = true;
            controller.close();
          },
          cancel() {
            closed = true;
          },
        });
        return new Response(stream, { headers: { "content-type": "text/event-stream" } });
      }
      if (body.stream === true) {
        return protocol === "anthropic" ? anthropicStream(text, chunks) : openAiStream(text, chunks);
      }
      return protocol === "anthropic" ? anthropicNonStream(text) : openAiNonStream(text);
    },
  });

  return {
    url: server.url.origin,
    requests: () => recorded,
    setScenario(s) {
      scenario = s;
      if (s.kind === "tool-use") toolUseServed = false;
    },
    async close() {
      server.stop(true);
    },
  };
}
