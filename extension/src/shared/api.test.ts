import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const originalFetch = global.fetch;
const OriginalEventSource = global.EventSource;

class FakeEventSource {
  listeners = new Map<string, Array<(event?: MessageEvent<string>) => void>>();
  originalClose = vi.fn();

  constructor(public readonly url: string) {}

  addEventListener(type: string, handler: (event?: MessageEvent<string>) => void) {
    const current = this.listeners.get(type) ?? [];
    current.push(handler);
    this.listeners.set(type, current);
  }

  emit(type: string, data?: string) {
    for (const handler of this.listeners.get(type) ?? []) {
      handler(data === undefined ? undefined : ({ data } as MessageEvent<string>));
    }
  }

  close() {
    this.originalClose();
  }
}

describe("streaming api client", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    global.fetch = originalFetch;
    global.EventSource = OriginalEventSource;
    vi.unstubAllEnvs();
  });

  it("starts run against python adapter endpoint", async () => {
    vi.stubEnv("VITE_EXTENSION_ENV", "development");
    vi.stubEnv("VITE_ALLOWED_API_ORIGINS", "http://localhost:8000");
    vi.stubEnv("VITE_API_BASE_URL", "http://localhost:8000");

    const fetchMock = vi.fn().mockResolvedValue({
      json: async () => ({ ok: true, data: { runId: "run-1" } })
    });
    global.fetch = fetchMock as typeof fetch;

    const { startRun } = await import("./api");
    const result = await startRun("hello", {
      pageTitle: "Example",
      pageUrl: "https://example.com",
      metaDescription: "desc",
      h1: "Heading",
      selectedText: "picked",
      software_version: "v1",
      selected_sr: "SR-1"
    }, { username: "alice", usernameSource: "dom_text" });

    expect(result).toEqual({ ok: true, data: { runId: "run-1" } });
    expect(fetchMock).toHaveBeenCalledWith(
      "http://localhost:8000/api/runs",
      expect.objectContaining({ method: "POST" })
    );
    expect(JSON.parse(fetchMock.mock.calls[0]?.[1]?.body as string)).toMatchObject({
      capture: expect.objectContaining({
        pageTitle: "Example",
        selected_sr: "SR-1"
      }),
      context: expect.objectContaining({
        pageTitle: "Example",
        pageUrl: "https://example.com"
      })
    });
  });

  it("submits question answers", async () => {
    vi.stubEnv("VITE_EXTENSION_ENV", "development");
    vi.stubEnv("VITE_ALLOWED_API_ORIGINS", "http://localhost:8000");
    vi.stubEnv("VITE_API_BASE_URL", "http://localhost:8000");

    global.fetch = vi.fn().mockResolvedValue({
      json: async () => ({ ok: true, data: { accepted: true, runId: "run-1", questionId: "q1" } })
    }) as typeof fetch;

    const { submitQuestionAnswer } = await import("./api");
    const result = await submitQuestionAnswer("run-1", { questionId: "q1", answer: "yes" });

    expect(result.ok).toBe(true);
  });

  it("starts run without capture payload when send is decoupled", async () => {
    vi.stubEnv("VITE_EXTENSION_ENV", "development");
    vi.stubEnv("VITE_ALLOWED_API_ORIGINS", "http://localhost:8000");
    vi.stubEnv("VITE_API_BASE_URL", "http://localhost:8000");

    const fetchMock = vi.fn().mockResolvedValue({
      json: async () => ({ ok: true, data: { runId: "run-no-capture" } })
    });
    global.fetch = fetchMock as typeof fetch;

    const { startRun } = await import("./api");
    const result = await startRun("hello", null, { username: "unknown", usernameSource: "unresolved_login_state" });

    expect(result).toEqual({ ok: true, data: { runId: "run-no-capture" } });
    const requestBody = JSON.parse(fetchMock.mock.calls[0]?.[1]?.body as string);
    expect(requestBody).toMatchObject({
      prompt: "hello",
      context: {
        username: "unknown",
        usernameSource: "unresolved_login_state"
      }
    });
    expect(requestBody).not.toHaveProperty("capture");
  });

  it("submits message feedback", async () => {
    vi.stubEnv("VITE_EXTENSION_ENV", "development");
    vi.stubEnv("VITE_ALLOWED_API_ORIGINS", "http://localhost:8000");
    vi.stubEnv("VITE_API_BASE_URL", "http://localhost:8000");

    const fetchMock = vi.fn().mockResolvedValue({
      json: async () => ({
        ok: true,
        data: {
          accepted: true,
          runId: "run-1",
          messageId: "message-1",
          feedback: "like",
          updatedAt: "2026-04-08T00:00:00.000Z"
        }
      })
    });
    global.fetch = fetchMock as typeof fetch;

    const { submitMessageFeedback } = await import("./api");
    const result = await submitMessageFeedback({ runId: "run-1", messageId: "message-1", feedback: "like" });

    expect(result).toEqual({
      ok: true,
      data: {
        accepted: true,
        runId: "run-1",
        messageId: "message-1",
        feedback: "like",
        updatedAt: "2026-04-08T00:00:00.000Z"
      }
    });
    expect(fetchMock).toHaveBeenCalledWith(
      "http://localhost:8000/api/message-feedback",
      expect.objectContaining({ method: "POST" })
    );
  });

  it("returns failure state for message feedback network errors", async () => {
    vi.stubEnv("VITE_EXTENSION_ENV", "development");
    vi.stubEnv("VITE_ALLOWED_API_ORIGINS", "http://localhost:8000");
    vi.stubEnv("VITE_API_BASE_URL", "http://localhost:8000");

    global.fetch = vi.fn().mockRejectedValue(new Error("socket closed")) as typeof fetch;

    const { submitMessageFeedback } = await import("./api");
    const result = await submitMessageFeedback({ runId: "run-1", messageId: "message-1", feedback: "dislike" });

    expect(result).toEqual({
      ok: false,
      error: expect.objectContaining({ code: "NETWORK_ERROR", message: "socket closed" })
    });
  });

  it("parses incoming SSE messages", async () => {
    vi.stubEnv("VITE_EXTENSION_ENV", "development");
    vi.stubEnv("VITE_ALLOWED_API_ORIGINS", "http://localhost:8000");
    vi.stubEnv("VITE_API_BASE_URL", "http://localhost:8000");

    global.EventSource = FakeEventSource as unknown as typeof EventSource;

    const { createRunEventStream } = await import("./api");
    const events: string[] = [];
    const stream = createRunEventStream("run-1", {
      onEvent(event) {
        events.push(event.type);
      },
      onError() {
        throw new Error("unexpected");
      }
    }) as unknown as FakeEventSource;

    stream.emit("message", JSON.stringify({
      id: "event-1",
      runId: "run-1",
      type: "thinking",
      createdAt: "2026-04-01T00:00:00.000Z",
      sequence: 1,
      message: "Thinking"
    }));

    expect(events).toEqual(["thinking"]);
    expect(stream.url).toBe("http://localhost:8000/api/runs/run-1/events");
  });

  it("accepts thinking and result events with question null", async () => {
    vi.stubEnv("VITE_EXTENSION_ENV", "development");
    vi.stubEnv("VITE_ALLOWED_API_ORIGINS", "http://localhost:8000");
    vi.stubEnv("VITE_API_BASE_URL", "http://localhost:8000");

    global.EventSource = FakeEventSource as unknown as typeof EventSource;

    const { createRunEventStream } = await import("./api");
    const onEvent = vi.fn();
    const onError = vi.fn();
    const stream = createRunEventStream("run-null-question", { onEvent, onError }) as unknown as FakeEventSource;

    stream.emit("message", JSON.stringify({
      id: "event-thinking",
      runId: "run-null-question",
      type: "thinking",
      createdAt: "2026-04-01T00:00:00.000Z",
      sequence: 1,
      message: "Thinking",
      question: null
    }));
    stream.emit("message", JSON.stringify({
      id: "event-result",
      runId: "run-null-question",
      type: "result",
      createdAt: "2026-04-01T00:00:01.000Z",
      sequence: 2,
      message: "Done",
      question: null
    }));

    expect(onError).not.toHaveBeenCalled();
    expect(onEvent).toHaveBeenNthCalledWith(1, expect.objectContaining({ type: "thinking", question: undefined }));
    expect(onEvent).toHaveBeenNthCalledWith(2, expect.objectContaining({ type: "result", question: undefined }));
  });

  it("accepts events with data null", async () => {
    vi.stubEnv("VITE_EXTENSION_ENV", "development");
    vi.stubEnv("VITE_ALLOWED_API_ORIGINS", "http://localhost:8000");
    vi.stubEnv("VITE_API_BASE_URL", "http://localhost:8000");

    global.EventSource = FakeEventSource as unknown as typeof EventSource;

    const { createRunEventStream } = await import("./api");
    const onEvent = vi.fn();
    const onError = vi.fn();
    const stream = createRunEventStream("run-null-data", { onEvent, onError }) as unknown as FakeEventSource;

    stream.emit("message", JSON.stringify({
      id: "event-tool-call",
      runId: "run-null-data",
      type: "tool_call",
      createdAt: "2026-04-01T00:00:00.000Z",
      sequence: 1,
      message: "Calling tool",
      data: null
    }));

    expect(onError).not.toHaveBeenCalled();
    expect(onEvent).toHaveBeenCalledWith(expect.objectContaining({ type: "tool_call", data: undefined }));
  });

  it("accepts events with logData for internal diagnostics", async () => {
    vi.stubEnv("VITE_EXTENSION_ENV", "development");
    vi.stubEnv("VITE_ALLOWED_API_ORIGINS", "http://localhost:8000");
    vi.stubEnv("VITE_API_BASE_URL", "http://localhost:8000");

    global.EventSource = FakeEventSource as unknown as typeof EventSource;

    const { createRunEventStream } = await import("./api");
    const onEvent = vi.fn();
    const onError = vi.fn();
    const stream = createRunEventStream("run-log-data", { onEvent, onError }) as unknown as FakeEventSource;

    stream.emit("message", JSON.stringify({
      id: "event-tool-call",
      runId: "run-log-data",
      type: "tool_call",
      createdAt: "2026-04-01T00:00:00.000Z",
      sequence: 1,
      title: "处理中",
      message: "正在处理当前分析步骤。",
      data: { stage: "running" },
      logData: { tool: "bash", args: ["secret"] }
    }));

    expect(onError).not.toHaveBeenCalled();
    expect(onEvent).toHaveBeenCalledWith(expect.objectContaining({ logData: { tool: "bash", args: ["secret"] } }));
  });

  it("still parses valid question events", async () => {
    vi.stubEnv("VITE_EXTENSION_ENV", "development");
    vi.stubEnv("VITE_ALLOWED_API_ORIGINS", "http://localhost:8000");
    vi.stubEnv("VITE_API_BASE_URL", "http://localhost:8000");

    global.EventSource = FakeEventSource as unknown as typeof EventSource;

    const { createRunEventStream } = await import("./api");
    const onEvent = vi.fn();
    const onError = vi.fn();
    const stream = createRunEventStream("run-question", { onEvent, onError }) as unknown as FakeEventSource;

    stream.emit("message", JSON.stringify({
      id: "event-question",
      runId: "run-question",
      type: "question",
      createdAt: "2026-04-01T00:00:00.000Z",
      sequence: 1,
      message: "Need confirmation",
      question: {
        questionId: "q1",
        title: "请选择",
        message: "继续前请回答",
        options: [{ id: "opt-1", label: "是", value: "yes" }],
        allowFreeText: false
      }
    }));

    expect(onError).not.toHaveBeenCalled();
    expect(onEvent).toHaveBeenCalledWith(expect.objectContaining({
      type: "question",
      question: expect.objectContaining({ questionId: "q1", title: "请选择" })
    }));
  });

  it("appends api key for sse stream when configured", async () => {
    vi.stubEnv("VITE_EXTENSION_ENV", "development");
    vi.stubEnv("VITE_ALLOWED_API_ORIGINS", "http://localhost:8000");
    vi.stubEnv("VITE_API_BASE_URL", "http://localhost:8000");
    vi.stubEnv("VITE_API_KEY", "secret");

    global.EventSource = FakeEventSource as unknown as typeof EventSource;
    const { createRunEventStream } = await import("./api");
    const stream = createRunEventStream("run-2", { onEvent() {}, onError() {} }) as unknown as FakeEventSource;
    expect(stream.url).toBe("http://localhost:8000/api/runs/run-2/events?api_key=secret");
  });

  it("reports initial SSE connection failure before any open or event", async () => {
    vi.stubEnv("VITE_EXTENSION_ENV", "development");
    vi.stubEnv("VITE_ALLOWED_API_ORIGINS", "http://localhost:8000");
    vi.stubEnv("VITE_API_BASE_URL", "http://localhost:8000");

    global.EventSource = FakeEventSource as unknown as typeof EventSource;
    const { createRunEventStream } = await import("./api");
    const onError = vi.fn();
    const onStatusChange = vi.fn();
    const stream = createRunEventStream("run-3", { onEvent() {}, onError, onStatusChange }) as unknown as FakeEventSource;

    stream.emit("error");

    expect(onStatusChange).toHaveBeenCalledWith("connecting");
    expect(onError).toHaveBeenCalledWith(expect.objectContaining({ message: "SSE connection failed" }));
  });

  it("does not report error after stream has already received events", async () => {
    vi.stubEnv("VITE_EXTENSION_ENV", "development");
    vi.stubEnv("VITE_ALLOWED_API_ORIGINS", "http://localhost:8000");
    vi.stubEnv("VITE_API_BASE_URL", "http://localhost:8000");

    global.EventSource = FakeEventSource as unknown as typeof EventSource;
    const { createRunEventStream } = await import("./api");
    const onError = vi.fn();
    const onStatusChange = vi.fn();
    const stream = createRunEventStream("run-4", { onEvent() {}, onError, onStatusChange }) as unknown as FakeEventSource;

    stream.emit("open");
    stream.emit("message", JSON.stringify({
      id: "event-1",
      runId: "run-4",
      type: "thinking",
      createdAt: "2026-04-01T00:00:00.000Z",
      sequence: 1,
      message: "Thinking"
    }));
    stream.emit("error");

    expect(onError).not.toHaveBeenCalled();
    expect(onStatusChange).toHaveBeenLastCalledWith("reconnecting");
  });

  it("keeps stream open after terminal-looking event so later valid messages still arrive", async () => {
    vi.stubEnv("VITE_EXTENSION_ENV", "development");
    vi.stubEnv("VITE_ALLOWED_API_ORIGINS", "http://localhost:8000");
    vi.stubEnv("VITE_API_BASE_URL", "http://localhost:8000");

    global.EventSource = FakeEventSource as unknown as typeof EventSource;
    const { createRunEventStream } = await import("./api");
    const onError = vi.fn();
    const onEvent = vi.fn();
    const stream = createRunEventStream("run-5", { onEvent, onError }) as unknown as FakeEventSource;

    stream.emit("open");
    stream.emit("message", JSON.stringify({
      id: "event-2",
      runId: "run-5",
      type: "result",
      createdAt: "2026-04-01T00:00:00.000Z",
      sequence: 2,
      message: "Done"
    }));
    stream.emit("message", JSON.stringify({
      id: "event-3",
      runId: "run-5",
      type: "thinking",
      createdAt: "2026-04-01T00:00:01.000Z",
      sequence: 3,
      message: "Later delta",
      data: { field: "text" }
    }));
    stream.emit("error");

    expect(onEvent).toHaveBeenNthCalledWith(1, expect.objectContaining({ type: "result" }));
    expect(onEvent).toHaveBeenNthCalledWith(2, expect.objectContaining({ type: "thinking", message: "Later delta" }));
    expect(stream.originalClose).not.toHaveBeenCalled();
    expect(onError).not.toHaveBeenCalled();
  });

  it("still allows explicit client close override", async () => {
    vi.stubEnv("VITE_EXTENSION_ENV", "development");
    vi.stubEnv("VITE_ALLOWED_API_ORIGINS", "http://localhost:8000");
    vi.stubEnv("VITE_API_BASE_URL", "http://localhost:8000");

    global.EventSource = FakeEventSource as unknown as typeof EventSource;
    const { createRunEventStream } = await import("./api");
    const stream = createRunEventStream("run-close", {
      onEvent() {},
      onError() {},
      shouldClose: (event) => event.type === "error"
    }) as unknown as FakeEventSource;

    stream.emit("message", JSON.stringify({
      id: "event-close",
      runId: "run-close",
      type: "error",
      createdAt: "2026-04-01T00:00:00.000Z",
      sequence: 1,
      message: "stop"
    }));

    expect(stream.originalClose).toHaveBeenCalledTimes(1);
  });

  it("returns to streaming after reconnect open event", async () => {
    vi.stubEnv("VITE_EXTENSION_ENV", "development");
    vi.stubEnv("VITE_ALLOWED_API_ORIGINS", "http://localhost:8000");
    vi.stubEnv("VITE_API_BASE_URL", "http://localhost:8000");

    global.EventSource = FakeEventSource as unknown as typeof EventSource;
    const { createRunEventStream } = await import("./api");
    const onError = vi.fn();
    const onStatusChange = vi.fn();
    const stream = createRunEventStream("run-6", { onEvent() {}, onError, onStatusChange }) as unknown as FakeEventSource;

    stream.emit("open");
    stream.emit("message", JSON.stringify({
      id: "event-1",
      runId: "run-6",
      type: "thinking",
      createdAt: "2026-04-01T00:00:00.000Z",
      sequence: 1,
      message: "Thinking"
    }));
    stream.emit("error");
    stream.emit("open");

    expect(onError).not.toHaveBeenCalled();
    expect(onStatusChange.mock.calls.map(([status]) => status)).toEqual([
      "connecting",
      "streaming",
      "streaming",
      "reconnecting",
      "streaming"
    ]);
  });
});
