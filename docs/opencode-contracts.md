# OpenCode adapter contracts and plugin consumption

## Scope

This document describes the current as-built contract between:

1. Chrome extension plugin ↔ Python adapter
2. Python adapter ↔ OpenCode server
3. The plugin conversation UI ↔ normalized adapter events

It reflects current code behavior only; it does not propose architectural changes.

---

## 1. Plugin ↔ adapter contract

### Main HTTP/SSE endpoints

| Purpose | Method | Endpoint | Implemented in |
| --- | --- | --- | --- |
| Start run | `POST` | `/api/runs` | `extension/src/shared/api.ts:startRun`, `python_adapter/app/main.py:start_run` |
| Stream normalized events | `GET` (SSE) | `/api/runs/{runId}/events` | `extension/src/shared/api.ts:createRunEventStream`, `python_adapter/app/main.py:stream_run_events` |
| Stream raw opencode events | `GET` (SSE) | `/api/runs/{runId}/events/raw` | `extension/src/shared/api.ts:createRawRunEventStream`, `python_adapter/app/main.py:stream_raw_run_events` |
| Submit question answer | `POST` | `/api/runs/{runId}/answers` | `extension/src/shared/api.ts:submitQuestionAnswer`, `python_adapter/app/main.py:answer_question` |
| Submit message feedback | `POST` | `/api/message-feedback` | `extension/src/shared/api.ts:submitMessageFeedback`, `python_adapter/app/main.py:submit_message_feedback` |
| Adapter health/debug | `GET` | `/health` | `python_adapter/app/main.py:health` |

### Start run request/response

The extension sends `RunStartRequest` (`extension/src/shared/protocol.ts`, `python_adapter/app/models.py`):

```json
{
  "prompt": "...",
  "selectedAgent": "TARA_analyst | ThreatIntelliganceCommander",
  "capture": { "...": "..." },
  "sessionId": "optional-existing-session",
  "context": {
    "source": "chrome-extension",
    "capturedAt": "ISO timestamp",
    "username": "...",
    "usernameSource": "dom_data_attribute | dom_text | meta_tag | page_global | unknown_fallback | unresolved_login_state",
    "pageTitle": "optional",
    "pageUrl": "optional"
  }
}
```

Extension request construction happens in `extension/src/shared/api.ts:startRun`; background orchestration happens in `extension/src/background/index.ts:startRunFromActiveTab`.

Success response shape (`StartRunResponse`):

```json
{
  "ok": true,
  "data": {
    "runId": "run-...",
    "selectedAgent": "TARA_analyst",
    "sessionId": "optional-opencode-session"
  }
}
```

### SSE event stream behavior

The extension subscribes with `EventSource` in `createRunEventStream`.

- URL: `/api/runs/{runId}/events`
- Transport: SSE `message` events carrying JSON-serialized `NormalizedRunEvent`
- Validation: parsed with Zod in `extension/src/shared/api.ts:streamEventSchema`
- Connection states surfaced to UI: `connecting` → `streaming` → `reconnecting`
- Important lifecycle rule: `RUN_STREAM_LIFECYCLE.terminalEventsDoNotGuaranteeStreamEnd === true` (`extension/src/shared/protocol.ts`). The UI treats `result`/`error` as terminal state evidence, but not as a guarantee that the socket has already closed.

### Raw SSE behavior

The extension now prefers the raw SSE endpoint and projects OpenCode payloads into renderable conversation events on the frontend.

- URL: `/api/runs/{runId}/events/raw`
- Transport: SSE `message` events carrying JSON-serialized `RawRunEventEnvelope`
- Adapter responsibility: session filtering, auth, lifecycle proxying, final `/session/{sessionId}/message` snapshot proxying
- Frontend responsibility: mapping raw OpenCode events into assistant output, reasoning, tool-call, question, and final result render state

Normalized event shape (`extension/src/shared/protocol.ts`, `python_adapter/app/models.py`):

```json
{
  "id": "run-...-1",
  "runId": "run-...",
  "type": "thinking | tool_call | question | result | error",
  "createdAt": "ISO timestamp",
  "sequence": 1,
  "message": "display text",
  "title": "optional title",
  "data": { "optional": "payload" },
  "logData": { "optional": "raw payload" },
  "question": {
    "questionId": "...",
    "title": "...",
    "message": "...",
    "options": [{ "id": "...", "label": "...", "value": "..." }],
    "allowFreeText": true,
    "placeholder": "optional"
  },
  "semantic": {
    "channel": "reasoning | assistant_text",
    "emissionKind": "delta | snapshot | final",
    "identity": "stable-fragment-id",
    "messageId": "optional",
    "partId": "optional"
  }
}
```

Important nuance: assistant answer text is also emitted as event type `thinking`; the UI distinguishes it from actual reasoning by `semantic.channel === "assistant_text"` or fallback `data.field === "text"` (`extension/src/sidepanel/reasoningTimeline.ts:isAssistantResponseDeltaEvent`).

### Auth / API key behavior

- `POST` calls send `x-api-key` when `VITE_API_KEY` is configured (`extension/src/shared/api.ts:withHeaders`).
- SSE cannot set custom headers, so the extension sends `api_key` as a query parameter (`createRunEventStream`).
- The adapter enforces:
  - header auth for `POST` endpoints via `enforce_api_key`
  - query auth for SSE via `enforce_stream_api_key`
  - both only when `PYTHON_ADAPTER_API_KEY` is non-empty (`python_adapter/app/main.py`).

### Error response contract

All adapter-raised `HTTPException`s are normalized to:

```json
{
  "ok": false,
  "error": {
    "code": "...",
    "message": "...",
    "details": "optional"
  }
}
```

Implemented in `python_adapter/app/main.py:http_exception_handler`; consumed by `failureSchema` in `extension/src/shared/api.ts`.

Observed codes from current code/tests:

- `AUTH_ERROR` for missing/wrong API key
- `VALIDATION_ERROR` for disallowed selected agent
- `ANALYSIS_ERROR` for upstream discovery/bootstrap/agent enforcement/backend failures
- `RUN_NOT_FOUND` for unknown `runId`
- client-side `NETWORK_ERROR` is synthesized by the extension when fetch/SSE setup fails (`extension/src/shared/api.ts`)

Relevant tests: `python_adapter/tests/test_app.py`.

### Question answering contract

Question answer request (`QuestionAnswerRequest`):

```json
{
  "questionId": "...",
  "answer": "free text or chosen label",
  "choiceId": "optional-ui-choice-id"
}
```

Success response:

```json
{
  "ok": true,
  "data": {
    "accepted": true,
    "runId": "run-...",
    "questionId": "..."
  }
}
```

Contract points:

- questions arrive as `NormalizedRunEvent.type === "question"`
- the extension records answers as `AnswerRecord` in `useSidepanelController:handleQuestionSubmit`
- the adapter stores answers on the run and forwards them upstream in `OpencodeAdapter.submit_answer`
- if `answer` is empty, the adapter will try to resolve a reply from the upstream question payload using `choiceId` (`_build_question_answer_payload`)

### Message feedback contract

Feedback request (`MessageFeedbackRequest`):

```json
{
  "runId": "run-...",
  "messageId": "assistant-message-or-anchor-id",
  "feedback": "like | dislike"
}
```

Success response (`MessageFeedbackResponse`):

```json
{
  "ok": true,
  "data": {
    "accepted": true,
    "runId": "run-...",
    "messageId": "...",
    "feedback": "like | dislike",
    "updatedAt": "ISO timestamp"
  }
}
```

The adapter does not send this to OpenCode; it proxies to a separate feedback backend via `post_feedback_to_backend` (`python_adapter/app/main.py`).

---

## 2. Adapter ↔ OpenCode server contract

### Remote endpoints used by the adapter

Configured in `python_adapter/app/config.py:Settings` and called from `python_adapter/app/opencode_adapter.py`.

| Purpose | Default endpoint | Called from |
| --- | --- | --- |
| Agent discovery | `/agent` | `_discover_canonical_remote_agent` |
| Session create | `/session` | `_create_session` |
| Prompt dispatch | `/session/{session_id}/prompt_async` | `_prompt_session` |
| Question list fallback | `/question` | `_list_questions` |
| Question reply | `/question/{request_id}/reply` | `submit_answer` |
| Session messages | `/session/{session_id}/message` | `_build_result_from_session` |
| Global event stream | `/global/event` | `_stream_real_events` |
| Health (debug only) | `/global/health` | surfaced by adapter `/health`, not used in run flow |

All upstream requests include `directory` and optional `workspace` query params from `_query_params`.

### Discovery, canonical agent selection, and enforcement

Implemented in:

- `_validate_requested_agent`
- `_extract_remote_agent_catalog`
- `_select_canonical_remote_agent`
- `_discover_canonical_remote_agent`
- `_record_primary_agent_evidence`

Behavior:

1. The adapter only accepts `TARA_analyst` and `ThreatIntelliganceCommander` from the plugin.
2. Before any session bootstrap, it calls remote `/agent`.
3. It maps the plugin-selected main agent to an allowed remote alias set (`REMOTE_AGENT_WHITELIST`).
4. It requires exactly one matching remote canonical agent.
5. During streaming/result fetch, if OpenCode explicitly reports a different agent in event/message payloads, the adapter converts that into a runtime error.
6. If upstream omits agent evidence entirely, the adapter does **not** fail just for that omission.

Relevant tests:

- `python_adapter/tests/test_opencode_adapter.py:test_real_contract_preflights_remote_agent_catalog_before_session_bootstrap`
- `...:test_remote_agent_alias_is_canonicalized_from_supported_catalog`
- `...:test_remote_agent_discovery_rejects_ambiguous_alias_matches`
- `...:test_real_contract_fails_when_message_event_reports_wrong_primary_agent`
- `...:test_real_contract_fails_when_assistant_message_reports_wrong_primary_agent`

### Session reuse vs new session

Implemented in `OpencodeAdapter.start_run`.

- If `RunStartRequest.sessionId` is present after normalization (`_normalize_existing_session_id`), the adapter reuses that OpenCode session and skips `/session` creation.
- Otherwise it creates a new session via `/session` with payload:

```json
{ "title": "SR <selected_sr-or-analysis>" }
```

- It then dispatches the prompt via `/session/{session_id}/prompt_async` with payload:

```json
{
  "agent": "<canonical-remote-agent>",
  "parts": [
    { "type": "text", "text": "<prompt>" },
    { "type": "text", "text": "[capture]\n{...non-empty captured fields...}" },
    { "type": "text", "text": "[context]\n{...run context...}" }
  ]
}
```

Relevant tests:

- `python_adapter/tests/test_opencode_adapter.py:test_real_contract_uses_session_prompt_async_and_question_reply`
- `...:test_real_contract_reuses_existing_session_for_follow_up_prompt`
- `...:test_request_without_capture_defaults_to_generic_session_title`

### Global event → normalized event mapping

Core logic: `python_adapter/app/opencode_adapter.py:_normalize_global_event`.

| OpenCode event | Adapter output |
| --- | --- |
| `session.status` | `tool_call` with status text and raw status in `data` |
| `message.part.delta` | buffered until part type is known; then emitted as `thinking` with `semantic.channel = assistant_text` for text parts, or `semantic.channel = reasoning` for reasoning parts |
| `message.part.updated` with `tool` part | `tool_call` with simplified user-facing text |
| `message.part.updated` with `reasoning` part | `thinking` with reasoning semantics, usually snapshot |
| `message.part.updated` with `text` part | `thinking` with assistant_text semantics, usually snapshot |
| `message.updated` assistant error | `error` |
| `question.asked` | `question` with normalized `QuestionPayload` |
| `question.replied` | `tool_call` acknowledgment |
| `session.error` | `error` |
| `session.idle` | fetch `/session/{id}/message`; emit `result` if assistant text is available, otherwise emit idle `tool_call` or placeholder final result |

Important normalization details:

- The adapter buffers `message.part.delta` until it learns whether the part is `text` or `reasoning` (`_flush_buffered_part_delta`).
- `assistant_text` semantic identities look like `assistant_text:<messageId>:<partId-or-message-body>`.
- `reasoning` semantic identities look like `reasoning:<messageId>:<partId-or-message-reasoning>`.
- Final assistant output is emitted as `type: "result"` with `semantic.emissionKind = "final"`.

Relevant tests:

- `python_adapter/tests/test_opencode_adapter.py:test_reasoning_part_delta_is_buffered_and_emitted_as_thinking_after_part_type_is_known`
- `...:test_text_part_delta_is_buffered_and_emitted_as_answer_stream_after_part_type_is_known`
- `...:test_text_part_snapshot_uses_assistant_text_snapshot_semantics`
- `...:test_session_idle_without_text_defers_placeholder_until_stream_end`
- `...:test_reasoning_only_session_message_does_not_become_final_result_text`

### Question contract with OpenCode

- Questions originate from `question.asked` events on `/global/event`.
- The adapter normalizes the first upstream question into `QuestionPayload` via `_normalize_question_request`.
- When the plugin answers, the adapter replies to `/question/{request_id}/reply` with:

```json
{
  "answers": [ ["resolved answer text"] ]
}
```

The final answer text is resolved by `_build_question_answer_payload`.

### Result/message fetch contract

The adapter does not trust the event stream alone for final text. On `session.idle` or stream end without a result, `_build_result_from_session` calls `/session/{session_id}/message?limit=20` and:

- scans assistant messages for agent-enforcement evidence
- finds the latest assistant message
- joins all assistant text parts into the final `result.message`
- falls back to buffered streamed text or a placeholder message if no displayable text exists

---

## 3. Plugin consumption logic

### How background starts runs and syncs state

Main orchestration lives in `extension/src/background/index.ts`.

- `START_RUN` runtime message is handled by `startRunFromActiveTab`
- it optionally captures page fields and username context
- it calls adapter `startRun`
- it builds a `RunRecord` with `buildRunRecord`
- it persists state to `chrome.storage.local` via `patchState` / `setState`
- it broadcasts `STATE_UPDATED` so the sidepanel can merge the same state

Background state shape is defined by `AssistantState` in `extension/src/shared/types.ts` and initialized in `extension/src/shared/state.ts`.

### How sidepanel subscribes and merges state

`extension/src/sidepanel/useSidepanelController.ts` does both initial sync and live sync:

- `loadBaseState()` requests `GET_STATE`, `GET_RULES`, `GET_ACTIVE_CONTEXT`
- it listens for `STATE_UPDATED`
- it merges incoming background state using `mergeStateUpdate` (`extension/src/sidepanel/model.ts`)

`mergeStateUpdate` is conservative: for the same active run it can keep newer local `runEvents`, `currentRun`, `stream`, and `status` instead of accepting a stale terminal snapshot from background.

### How normalized events become `runEvents`, `RunRecord`, and `AnswerRecord`

#### `runEvents`

- SSE events are received in `useSidepanelController:startStreamingRun`
- each event is stored in IndexedDB via `useRunHistory.saveEvent`
- live state updates use `mergeRunEvent` to dedupe by `id` or `(runId, sequence)` (`extension/src/sidepanel/model.ts`)

#### `RunRecord`

- initial `RunRecord` is created in background `buildRunRecord`
- as SSE events arrive, `currentRun` is updated with:
  - `status` from `deriveLifecycleStatus`
  - `updatedAt` from `event.createdAt`
  - `finalOutput` from `deriveRunFinalOutput`
  - `errorMessage` from `error` events

#### `AnswerRecord`

- the sidepanel creates an `AnswerRecord` in `handleQuestionSubmit`
- it persists it through `useRunHistory.saveAnswer`
- it syncs the updated `answers` list back to background through `SYNC_RUN_STATE`

### How transcript/read model is built and rendered

Core mapping code is in `extension/src/sidepanel/reasoningTimeline.ts`.

Pipeline:

1. Raw `NormalizedRunEvent[]` + `AnswerRecord[]` are converted into fragment items in `buildFragmentSequence` / `buildIncrementalLiveTranscriptSegmentReadModel`.
2. Those fragments become grouped transcript messages via `buildTranscriptMessagesFromFragments`.
3. Historical segments + live segment are merged by `buildStableTranscriptProjection`.

Important rendering rules:

- assistant streamed text is reconstructed from `thinking` events that carry `assistant_text` semantics plus any final `result`
- reasoning/tool/process text becomes `assistant_process` fragments
- questions become `assistant_question` fragments
- answers become `user_answer` fragments
- errors become `assistant_error` fragments
- transcript messages are grouped by `groupAnchorId` so one assistant turn can contain process fragments plus output fragments

### Message extraction and rendering path for visible chat text

This is the end-to-end path for the text a user finally sees in chat.

#### 1. Raw OpenCode JSON payloads

The adapter first receives raw JSON from OpenCode `/global/event`, for example `message.part.delta`, `message.part.updated`, `question.asked`, `session.idle`, plus the later `/session/{session_id}/message` list used to build the final answer.

Compact event example:

```json
{
  "type": "message.part.delta",
  "properties": {
    "messageID": "msg-1",
    "partID": "part-1",
    "delta": "Hello"
  }
}
```

Compact session-message example:

```json
{
  "items": [{
    "id": "msg-1",
    "role": "assistant",
    "parts": [{ "id": "part-1", "type": "text", "text": "Hello world" }]
  }]
}
```

#### 2. Adapter normalization into `NormalizedRunEvent`

`python_adapter/app/opencode_adapter.py:_normalize_global_event` converts those raw payloads into adapter SSE events. The plugin does not render raw OpenCode JSON directly; it renders `NormalizedRunEvent`.

- `message.part.delta` is buffered until the adapter knows whether the part is `text` or `reasoning`
- `message.part.updated` usually supplies that type information and becomes a normalized snapshot/update
- `/session/{session_id}/message` may later be joined into a final `result`

The normalized fields that matter most for rendering are:

- `type`: broad UI behavior (`thinking`, `tool_call`, `question`, `result`, `error`)
- `message`: display text for the event/result
- `data`: fallback raw metadata used by some UI logic
- `question`: normalized question payload for interactive prompts
- `semantic.channel`: distinguishes `assistant_text` from `reasoning`
- `semantic.emissionKind`: whether text is a `delta`, `snapshot`, or `final`
- `semantic.messageId` and `semantic.partId`: stable anchors for grouping/deduping transcript parts

#### 3. Plugin storage layers

After normalization, the plugin stores JSON-derived data in three places:

- `runEvents`: the ordered live/persisted `NormalizedRunEvent[]`
- `RunRecord.finalOutput`: only the final assistant answer derived from `result` events
- `AnswerRecord`: the user's replies to normalized `question` events

This means visible transcript text is not sourced from one field only; it is projected from event history plus answers, while `finalOutput` keeps the final answer snapshot.

#### 4. Transcript projection to visible chat parts

`extension/src/sidepanel/reasoningTimeline.ts` turns `runEvents` + `AnswerRecord[]` into visible transcript parts:

1. `buildFragmentSequence` / `buildIncrementalLiveTranscriptSegmentReadModel` derive fragments from normalized events
2. `buildTranscriptMessagesFromFragments` groups them into assistant/user messages
3. `buildStableTranscriptProjection` merges historical and live segments into the final transcript read model

Compact pipeline example:

```text
OpenCode JSON -> NormalizedRunEvent -> runEvents / finalOutput / AnswerRecord -> buildStableTranscriptProjection -> TranscriptPartBlock
```

#### 5. Why visible assistant text often comes from `thinking`

Some assistant text is intentionally emitted as `type: "thinking"` with `semantic.channel = "assistant_text"`, not as `result`. This is how streamed assistant text appears while the run is still in progress. The UI detects that via `isAssistantResponseDeltaEvent`, so these events render as assistant output even though their `type` is not `result`.

`result` is mainly the final committed answer snapshot, often produced later after the adapter fetches `/session/{session_id}/message` on `session.idle` or stream completion.

#### 6. Final render component

`useSidepanelController.ts` builds `transcriptReadModel` with `buildStableTranscriptProjection`, `MainStage.tsx` passes it into `ReasoningTimeline`, and `extension/src/sidepanel/reasoningTimelineView.tsx` finally maps the projected parts to chat UI blocks via `TranscriptPartBlock`.

### How status, final output, question, and completion are derived

#### Run lifecycle

`deriveLifecycleStatus` (`extension/src/sidepanel/model.ts`) maps each incoming event into:

- assistant status
- run status
- stream status
- pending question id

Rules:

- `error` event → all statuses become `error`
- `question` event → statuses become `waiting_for_answer`
- `result` event → statuses become `done`
- otherwise remains `streaming` unless a pending question exists

#### Final output

- persisted run final output is only set directly from `result` events (`deriveRunFinalOutput`)
- visible assistant text in the UI is richer: `collectAssistantResponseAggregation`, `resolveAssistantDisplayText`, and `sanitizeAssistantDisplayText` reconstruct streamed text and de-duplicate overlaps/reasoning leaks

#### Active question

- `pendingQuestionId` is tracked in stream state
- `getActiveQuestionEvent` resolves the matching latest question event for rendering

#### Completion / cockpit status

- `resolveTimelinePresentationState` only trusts terminal state when terminal evidence exists (`result`/`error` or equivalent persisted text)
- `resolveCockpitStatusModel` turns that into display copy such as `连接中`, `生成回答`, `等待补充`, `结果已就绪`, `异常中断`
- `buildTranscriptSummary` derives the summary banner (`待开始` / `进行中` / `等待补充` / `已完成` / `已中断`)

### History and session view

- run history is persisted in IndexedDB by `extension/src/shared/history.ts`
- `useRunHistory` loads `RunHistoryDetail = { run, events, answers }`
- session grouping uses `deriveSessionKey` / `buildSessionNavigationItems` in `extension/src/sidepanel/model.ts`
- session key is `session:<sessionId>` when the adapter returns an OpenCode session id, otherwise `run:<runId>`

---

## 4. End-to-end examples

### Example A: fresh run, new OpenCode session, streamed answer

1. Sidepanel calls runtime `START_RUN` (`useSidepanelController:startStreamingRun`).
2. Background `startRunFromActiveTab` collects capture/user context and posts `POST /api/runs`.
3. Adapter `start_run` calls:
   - `GET /agent`
   - `POST /session`
   - `POST /session/{sessionId}/prompt_async`
4. Adapter returns `{ ok: true, data: { runId, sessionId, selectedAgent } }`.
5. Sidepanel opens SSE `GET /api/runs/{runId}/events`.
6. OpenCode `/global/event` emits `message.part.delta` / `message.part.updated`; adapter normalizes them into `thinking` events with `semantic.channel = assistant_text`.
7. When OpenCode reaches `session.idle`, adapter fetches `/session/{sessionId}/message` and emits final `result`.
8. Sidepanel derives `RunRecord.finalOutput`, marks the run `done`, and `buildStableTranscriptProjection` renders the final transcript.

### Example B: follow-up in existing session with a question

1. Sidepanel chooses an existing session; `START_RUN` includes `sessionId`.
2. Background forwards that `sessionId` to `POST /api/runs`.
3. Adapter reuses the existing session and skips `POST /session`.
4. OpenCode emits `question.asked` on `/global/event`.
5. Adapter emits a normalized `question` event with `QuestionPayload`.
6. Sidepanel renders the question, user submits an answer, and `handleQuestionSubmit` posts `POST /api/runs/{runId}/answers`.
7. Adapter forwards the reply to `POST /question/{request_id}/reply`.
8. OpenCode later emits more text / `session.idle`; adapter emits `result`; UI clears `pendingQuestionId` and resumes/completes the assistant turn in the same session transcript.

---

## 5. Primary code references

### Extension shared contract

- `extension/src/shared/protocol.ts`
- `extension/src/shared/types.ts`
- `extension/src/shared/api.ts`
- `extension/src/shared/configuration.ts`

### Extension orchestration and UI

- `extension/src/background/index.ts`
- `extension/src/sidepanel/useSidepanelController.ts`
- `extension/src/sidepanel/model.ts`
- `extension/src/sidepanel/reasoningTimeline.ts`
- `extension/src/sidepanel/questionState.ts`
- `extension/src/shared/history.ts`

### Python adapter

- `python_adapter/app/main.py`
- `python_adapter/app/models.py`
- `python_adapter/app/opencode_adapter.py`
- `python_adapter/app/config.py`

### Tests that lock in behavior

- `python_adapter/tests/test_app.py`
- `python_adapter/tests/test_opencode_adapter.py`
