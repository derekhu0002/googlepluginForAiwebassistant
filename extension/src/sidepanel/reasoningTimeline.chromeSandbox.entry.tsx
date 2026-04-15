import { buildStableTranscriptProjection } from "./reasoningTimeline";
import { ReasoningTimeline } from "./reasoningTimelineView";

const container = document.createElement("div");
document.body.appendChild(container);

const model = buildStableTranscriptProjection({
  historicalSegments: [],
  liveSegment: {
    runId: "run-sandbox",
    prompt: "当前问题",
    events: [
      {
        id: "evt-1",
        runId: "run-sandbox",
        type: "thinking",
        createdAt: "2026-04-02T00:00:01.000Z",
        sequence: 1,
        message: "第一段",
        semantic: {
          channel: "assistant_text",
          emissionKind: "delta",
          identity: "assistant_text:msg-sandbox:part-1",
          itemKind: "text",
          messageId: "msg-sandbox",
          partId: "part-1"
        }
      },
      {
        id: "evt-2",
        runId: "run-sandbox",
        type: "tool_call",
        createdAt: "2026-04-02T00:00:02.000Z",
        sequence: 2,
        message: "调用工具",
        semantic: {
          channel: "tool",
          emissionKind: "delta",
          identity: "tool:msg-sandbox:tool-1",
          itemKind: "tool",
          messageId: "msg-sandbox",
          partId: "tool-1"
        }
      },
      {
        id: "evt-3",
        runId: "run-sandbox",
        type: "thinking",
        createdAt: "2026-04-02T00:00:03.000Z",
        sequence: 3,
        message: "第二段",
        semantic: {
          channel: "assistant_text",
          emissionKind: "delta",
          identity: "assistant_text:msg-sandbox:part-2",
          itemKind: "text",
          messageId: "msg-sandbox",
          partId: "part-2"
        }
      }
    ],
    answers: [{
      id: "answer-empty",
      runId: "run-sandbox",
      questionId: "q-empty",
      answer: "   ",
      submittedAt: "2026-04-02T00:00:04.000Z"
    }],
    status: "streaming",
    runStatus: "streaming",
    streamStatus: "streaming",
    includeSummary: true,
    includeToolCallParts: true
  }
});

export default function ChromeSandboxTranscriptFixture() {
  return (
    <ReasoningTimeline
      transcriptReadModel={model}
      runId="run-sandbox"
      prompt="当前问题"
      events={[]}
      runStatus="streaming"
    />
  );
}

void container;
