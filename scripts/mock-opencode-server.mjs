import http from "node:http";
import process from "node:process";

const PORT = Number(process.env.OPENCODE_STUB_PORT ?? "8124");
const HOST = process.env.OPENCODE_STUB_HOST ?? "127.0.0.1";
const DIRECTORY = process.env.OPENCODE_STUB_DIRECTORY ?? process.cwd();
const AGENT_ID = process.env.OPENCODE_STUB_AGENT_ID ?? "TARA_analyst";
const FINAL_TEXT = process.env.OPENCODE_STUB_FINAL_TEXT ?? "REAL_EXTENSION_SMOKE_OK\n\n建议先核对当前 SR 的风险范围，再执行针对软件版本的回归验证。";
const STREAM_EVENT_DELAY_MS = Number(process.env.OPENCODE_STUB_STREAM_EVENT_DELAY_MS ?? "75");
const SESSION_IDLE_DELAY_MS = Number(process.env.OPENCODE_STUB_SESSION_IDLE_DELAY_MS ?? "2000");
const STREAM_CHUNK_COUNT = Math.max(1, Number(process.env.OPENCODE_STUB_STREAM_CHUNK_COUNT ?? "1"));
const STREAM_EMISSION_KIND = process.env.OPENCODE_STUB_STREAM_EMISSION_KIND ?? "snapshot";

let nextSessionNumber = 1;
const sessions = new Map();

function now() {
  return Date.now();
}

function readJson(request) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    request.on("data", (chunk) => chunks.push(chunk));
    request.on("end", () => {
      if (chunks.length === 0) {
        resolve({});
        return;
      }

      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString("utf8")));
      } catch (error) {
        reject(error);
      }
    });
    request.on("error", reject);
  });
}

function sendJson(response, statusCode, payload) {
  response.writeHead(statusCode, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store"
  });
  response.end(JSON.stringify(payload));
}

function sendNoContent(response) {
  response.writeHead(204, { "cache-control": "no-store" });
  response.end();
}

function sendNotFound(response) {
  sendJson(response, 404, { error: "not_found" });
}

function createSessionRecord(title) {
  const sessionId = `ses-stub-${nextSessionNumber}`;
  nextSessionNumber += 1;
  const record = {
    id: sessionId,
    title,
    promptPayload: null,
    answeredQuestions: [],
    emittedToConnection: false,
    messageId: `msg-stub-${sessionId}`,
    partId: `part-stub-${sessionId}`,
    finalText: FINAL_TEXT,
    createdAt: now()
  };
  sessions.set(sessionId, record);
  return record;
}

function buildSessionPayload(record) {
  return {
    id: record.id,
    slug: record.id,
    projectID: "proj-stub",
    directory: DIRECTORY,
    title: record.title,
    version: "stub-1.0.0",
    time: {
      created: record.createdAt,
      updated: now()
    }
  };
}

function buildGlobalEvents(record) {
  const partUpdates = buildPartUpdateEvents(record);

  return [
    {
      directory: DIRECTORY,
      payload: {
        type: "session.status",
        properties: {
          sessionID: record.id,
          status: {
            type: "busy"
          }
        }
      }
    },
    {
      directory: DIRECTORY,
      payload: {
        type: "message.updated",
        agent: AGENT_ID,
        properties: {
          info: {
            id: record.messageId,
            sessionID: record.id,
            role: "assistant"
          }
        }
      }
    },
    ...partUpdates,
    {
      directory: DIRECTORY,
      payload: {
        type: "session.idle",
        properties: {
          sessionID: record.id
        }
      }
    }
  ];
}

function buildPartUpdateEvents(record) {
  const textChunks = splitIntoStreamingChunks(record.finalText, STREAM_CHUNK_COUNT);

  return textChunks.map((text, index) => ({
    directory: DIRECTORY,
    payload: {
      type: "message.part.updated",
      agent: AGENT_ID,
      properties: {
        sessionID: record.id,
        messageID: record.messageId,
        partID: record.partId,
        metadata: {
          emissionKind: index === textChunks.length - 1 ? "final" : STREAM_EMISSION_KIND,
          chunkIndex: index + 1,
          chunkCount: textChunks.length
        },
        part: {
          id: record.partId,
          sessionID: record.id,
          type: "text",
          text
        }
      }
    }
  }));
}

function splitIntoStreamingChunks(text, chunkCount) {
  if (chunkCount <= 1 || text.length <= 1) {
    return [text];
  }

  const chunks = [];
  const size = Math.max(1, Math.ceil(text.length / chunkCount));

  for (let index = 1; index < chunkCount; index += 1) {
    chunks.push(text.slice(0, Math.min(text.length, size * index)));
  }

  chunks.push(text);
  return chunks;
}

async function sendSse(response, events) {
  response.writeHead(200, {
    "content-type": "text/event-stream; charset=utf-8",
    "cache-control": "no-cache, no-store, must-revalidate",
    connection: "keep-alive"
  });

  for (const [index, event] of events.entries()) {
    const delayMs = index === events.length - 1 ? SESSION_IDLE_DELAY_MS : STREAM_EVENT_DELAY_MS;
    if (delayMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
    response.write(`data: ${JSON.stringify(event)}\n\n`);
  }

  response.end();
}

function getSessionIdFromPath(pathname, suffix) {
  const prefix = "/session/";
  if (!pathname.startsWith(prefix) || !pathname.endsWith(suffix)) {
    return null;
  }

  return pathname.slice(prefix.length, pathname.length - suffix.length);
}

const server = http.createServer(async (request, response) => {
  const url = new URL(request.url ?? "/", `http://${request.headers.host ?? `${HOST}:${PORT}`}`);
  const { pathname } = url;

  try {
    if (request.method === "GET" && pathname === "/global/health") {
      sendJson(response, 200, {
        ok: true,
        service: "mock-opencode-server",
        agent: AGENT_ID,
        directory: DIRECTORY
      });
      return;
    }

    if (request.method === "GET" && pathname === "/agent") {
      sendJson(response, 200, [{ id: AGENT_ID }]);
      return;
    }

    if (request.method === "POST" && pathname === "/session") {
      const payload = await readJson(request);
      const record = createSessionRecord(typeof payload.title === "string" && payload.title.trim() ? payload.title.trim() : "SR analysis");
      sendJson(response, 200, buildSessionPayload(record));
      return;
    }

    if (request.method === "POST" && pathname.startsWith("/session/") && pathname.endsWith("/prompt_async")) {
      const sessionId = getSessionIdFromPath(pathname, "/prompt_async");
      const record = sessionId ? sessions.get(sessionId) : null;
      if (!record) {
        sendNotFound(response);
        return;
      }

      record.promptPayload = await readJson(request);
      sendNoContent(response);
      return;
    }

    if (request.method === "GET" && pathname === "/global/event") {
      const pendingRecords = Array.from(sessions.values()).filter((record) => record.promptPayload && !record.emittedToConnection);
      for (const record of pendingRecords) {
        record.emittedToConnection = true;
      }
      await sendSse(response, pendingRecords.flatMap((record) => buildGlobalEvents(record)));
      return;
    }

    if (request.method === "GET" && pathname.startsWith("/session/") && pathname.endsWith("/message")) {
      const sessionId = getSessionIdFromPath(pathname, "/message");
      const record = sessionId ? sessions.get(sessionId) : null;
      if (!record) {
        sendNotFound(response);
        return;
      }

      sendJson(response, 200, [
        {
          agent: AGENT_ID,
          info: {
            id: record.messageId,
            sessionID: record.id,
            role: "assistant",
            time: {
              created: record.createdAt,
              completed: now()
            }
          },
          parts: [
            {
              type: "text",
              text: record.finalText
            }
          ]
        }
      ]);
      return;
    }

    if (request.method === "GET" && pathname === "/question") {
      sendJson(response, 200, []);
      return;
    }

    if (request.method === "POST" && pathname.startsWith("/question/") && pathname.endsWith("/reply")) {
      sendJson(response, 200, { ok: true });
      return;
    }

    sendNotFound(response);
  } catch (error) {
    sendJson(response, 500, {
      error: error instanceof Error ? error.message : String(error)
    });
  }
});

server.listen(PORT, HOST, () => {
  console.error(`[mock-opencode-server] listening on http://${HOST}:${PORT}`);
});

function shutdown() {
  server.close(() => {
    process.exit(0);
  });
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);