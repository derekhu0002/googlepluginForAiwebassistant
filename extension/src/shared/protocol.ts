export const NORMALIZED_EVENT_TYPES = ["thinking", "tool_call", "question", "result", "error"] as const;

/** @ArchitectureID: ELM-APP-EXT-SHARED-API-CONTRACT */
export const MAIN_AGENTS = ["TARA_analyst", "ThreatIntelliganceCommander"] as const;

export type MainAgent = typeof MAIN_AGENTS[number];

export const DEFAULT_MAIN_AGENT: MainAgent = "TARA_analyst";

export type NormalizedEventType = typeof NORMALIZED_EVENT_TYPES[number];
export const NORMALIZED_EVENT_CHANNELS = ["reasoning", "assistant_text", "tool"] as const;
export const NORMALIZED_EVENT_EMISSION_KINDS = ["delta", "snapshot", "final"] as const;
export const NORMALIZED_EVENT_ITEM_KINDS = ["reasoning", "text", "tool"] as const;

export type NormalizedEventChannel = typeof NORMALIZED_EVENT_CHANNELS[number];
export type NormalizedEventEmissionKind = typeof NORMALIZED_EVENT_EMISSION_KINDS[number];
export type NormalizedEventItemKind = typeof NORMALIZED_EVENT_ITEM_KINDS[number];

export type CanonicalEventIdentitySource =
  | "semantic_identity"
  | "semantic_message_part_channel_emission"
  | "run_sequence_type"
  | "raw_id";

export type RunEventDecision = "accepted" | "duplicate" | "stale_replay" | "gap" | "out_of_order" | "invalid";

export interface RunEventCanonicalMetadata {
  key: string;
  identitySource: CanonicalEventIdentitySource;
  orderKey: string;
  rawEventId: string;
  semanticIdentity?: string;
  semanticMessageId?: string;
  semanticPartId?: string;
  semanticChannel?: NormalizedEventChannel;
  semanticEmissionKind?: NormalizedEventEmissionKind;
}

export interface RunEventTransportMetadata {
  rawEventId: string;
  receivedAt: string;
  reconnectCount: number;
  streamStatus: "connecting" | "streaming" | "reconnecting" | "closed" | "error";
}

export interface RunEventFrontier {
  version: number;
  acceptedEventCount: number;
  lastSequence: number | null;
  contiguousSequence: number | null;
  lastAcceptedCanonicalKey: string | null;
  lastAcceptedRawEventId: string | null;
  lastAcceptedAt: string | null;
}

export interface RunEventDiagnostic {
  runId: string;
  source: "transport" | "sidepanel" | "background" | "history" | "projection";
  decision: RunEventDecision;
  createdAt: string;
  rawEventId: string | null;
  canonicalEventKey: string | null;
  sequence: number | null;
  priorFrontierSequence: number | null;
  resultingFrontierSequence: number | null;
  semanticIdentity?: string;
  messageId?: string;
  partId?: string;
  channel?: NormalizedEventChannel;
  emissionKind?: NormalizedEventEmissionKind;
  identitySource?: CanonicalEventIdentitySource;
  classification?: "in_order" | "gap" | "out_of_order";
  reason?: string;
}

export interface RunEventState {
  frontier: RunEventFrontier;
  acceptedCanonicalKeys: string[];
  diagnostics: RunEventDiagnostic[];
}

export interface RunStateSyncMetadata {
  origin: "sidepanel" | "background";
  snapshotVersion: number;
  generatedAt: string;
  frontier: RunEventFrontier;
  lastAcceptedCanonicalKey: string | null;
}

export type UsernameSource =
  | "dom_data_attribute"
  | "dom_text"
  | "meta_tag"
  | "page_global"
  | "unknown_fallback"
  | "unresolved_login_state";

export interface QuestionOption {
  id: string;
  label: string;
  value: string;
}

export interface QuestionPayload {
  questionId: string;
  title: string;
  message: string;
  options: QuestionOption[];
  allowFreeText: boolean;
  placeholder?: string;
}

export interface NormalizedRunEvent {
  id: string;
  runId: string;
  type: NormalizedEventType;
  createdAt: string;
  sequence: number;
  message: string;
  title?: string;
  data?: Record<string, unknown>;
  logData?: Record<string, unknown>;
  tool?: {
    name?: string;
    status?: string;
    title?: string;
    callId?: string;
  };
  question?: QuestionPayload;
  semantic?: {
    channel: NormalizedEventChannel;
    emissionKind: NormalizedEventEmissionKind;
    identity: string;
    itemKind: NormalizedEventItemKind;
    messageId?: string;
    partId?: string;
  };
  canonical?: RunEventCanonicalMetadata;
  transport?: RunEventTransportMetadata;
}

export interface RunStreamLifecycle {
  terminalEventsDoNotGuaranteeStreamEnd: true;
}

export const RUN_STREAM_LIFECYCLE: RunStreamLifecycle = {
  terminalEventsDoNotGuaranteeStreamEnd: true
};

export interface RunStartRequest {
  prompt: string;
  selectedAgent: MainAgent;
  capture?: Record<string, string>;
  sessionId?: string;
  context: {
    source: string;
    capturedAt: string;
    username: string;
    usernameSource: UsernameSource;
    pageTitle?: string;
    pageUrl?: string;
  };
}

export interface QuestionAnswerRequest {
  questionId: string;
  answer: string;
  choiceId?: string;
}

export const MESSAGE_FEEDBACK_VALUES = ["like", "dislike"] as const;

export type MessageFeedbackValue = typeof MESSAGE_FEEDBACK_VALUES[number];

export interface MessageFeedbackRequest {
  runId: string;
  messageId: string;
  feedback: MessageFeedbackValue;
}

export interface MessageFeedbackResponse {
  accepted: true;
  runId: string;
  messageId: string;
  feedback: MessageFeedbackValue;
  updatedAt: string;
}

export interface RunRecord {
  runId: string;
  sessionId?: string;
  selectedAgent: MainAgent;
  prompt: string;
  username: string;
  usernameSource: UsernameSource;
  softwareVersion: string;
  selectedSr: string;
  pageTitle: string;
  pageUrl: string;
  status: "streaming" | "waiting_for_answer" | "done" | "error";
  startedAt: string;
  updatedAt: string;
  finalOutput: string;
  errorMessage?: string;
}

export interface AnswerRecord {
  id: string;
  runId: string;
  questionId: string;
  answer: string;
  choiceId?: string;
  submittedAt: string;
}

export interface RunHistoryDetail {
  run: RunRecord;
  events: NormalizedRunEvent[];
  answers: AnswerRecord[];
}

export function createEmptyRunEventFrontier(): RunEventFrontier {
  return {
    version: 0,
    acceptedEventCount: 0,
    lastSequence: null,
    contiguousSequence: null,
    lastAcceptedCanonicalKey: null,
    lastAcceptedRawEventId: null,
    lastAcceptedAt: null
  };
}

export function createEmptyRunEventState(): RunEventState {
  return {
    frontier: createEmptyRunEventFrontier(),
    acceptedCanonicalKeys: [],
    diagnostics: []
  };
}

function toCanonicalPart(value?: string | null) {
  const normalized = value?.trim();
  return normalized ? normalized : undefined;
}

export function deriveCanonicalEventMetadata(event: NormalizedRunEvent): RunEventCanonicalMetadata {
  const semanticIdentity = toCanonicalPart(event.semantic?.identity);
  const semanticMessageId = toCanonicalPart(event.semantic?.messageId);
  const semanticPartId = toCanonicalPart(event.semantic?.partId);
  const semanticChannel = event.semantic?.channel;
  const semanticEmissionKind = event.semantic?.emissionKind;

  let identitySource: CanonicalEventIdentitySource = "raw_id";
  let key = event.id;

  if (semanticIdentity) {
    identitySource = "semantic_identity";
    key = semanticIdentity;
  } else if (semanticMessageId && semanticPartId && semanticChannel && semanticEmissionKind) {
    identitySource = "semantic_message_part_channel_emission";
    key = `${semanticMessageId}:${semanticPartId}:${semanticChannel}:${semanticEmissionKind}`;
  } else if (Number.isFinite(event.sequence)) {
    identitySource = "run_sequence_type";
    key = `${event.runId}:${event.sequence}:${event.type}`;
  }

  return {
    key,
    identitySource,
    orderKey: [
      event.runId,
      String(Number.isFinite(event.sequence) ? event.sequence : Number.MAX_SAFE_INTEGER),
      event.createdAt,
      key,
      event.id
    ].join(":"),
    rawEventId: event.id,
    semanticIdentity,
    semanticMessageId,
    semanticPartId,
    semanticChannel,
    semanticEmissionKind
  };
}

export function withCanonicalEventMetadata(event: NormalizedRunEvent): NormalizedRunEvent {
  const canonical = deriveCanonicalEventMetadata(event);
  if (
    event.canonical?.key === canonical.key
    && event.canonical.identitySource === canonical.identitySource
    && event.canonical.orderKey === canonical.orderKey
  ) {
    return event;
  }

  return {
    ...event,
    canonical
  };
}

export function compareNormalizedRunEvents(left: NormalizedRunEvent, right: NormalizedRunEvent) {
  const leftCanonical = left.canonical ?? deriveCanonicalEventMetadata(left);
  const rightCanonical = right.canonical ?? deriveCanonicalEventMetadata(right);
  const leftSequence = Number.isFinite(left.sequence) ? left.sequence : Number.MAX_SAFE_INTEGER;
  const rightSequence = Number.isFinite(right.sequence) ? right.sequence : Number.MAX_SAFE_INTEGER;

  if (leftSequence !== rightSequence) {
    return leftSequence - rightSequence;
  }

  const createdAtCompare = left.createdAt.localeCompare(right.createdAt);
  if (createdAtCompare !== 0) {
    return createdAtCompare;
  }

  const orderKeyCompare = leftCanonical.orderKey.localeCompare(rightCanonical.orderKey);
  if (orderKeyCompare !== 0) {
    return orderKeyCompare;
  }

  return left.id.localeCompare(right.id);
}

export function sortNormalizedRunEvents(events: NormalizedRunEvent[]) {
  return [...events]
    .map((event) => withCanonicalEventMetadata(event))
    .sort(compareNormalizedRunEvents);
}

export function deriveRunEventFrontier(events: NormalizedRunEvent[]): RunEventFrontier {
  const acceptedEvents = sortNormalizedRunEvents(events);
  if (!acceptedEvents.length) {
    return createEmptyRunEventFrontier();
  }

  let contiguousSequence: number | null = null;
  let previousSequence: number | null = null;
  for (const event of acceptedEvents) {
    if (!Number.isFinite(event.sequence)) {
      continue;
    }
    if (contiguousSequence === null) {
      contiguousSequence = event.sequence;
      previousSequence = event.sequence;
      continue;
    }
    if (previousSequence !== null && event.sequence === previousSequence + 1) {
      contiguousSequence = event.sequence;
      previousSequence = event.sequence;
      continue;
    }
    if (previousSequence !== null && event.sequence <= previousSequence) {
      continue;
    }
    break;
  }

  const lastAccepted = acceptedEvents[acceptedEvents.length - 1];
  const lastCanonical = lastAccepted.canonical ?? deriveCanonicalEventMetadata(lastAccepted);
  return {
    version: acceptedEvents.length,
    acceptedEventCount: acceptedEvents.length,
    lastSequence: Number.isFinite(lastAccepted.sequence) ? lastAccepted.sequence : null,
    contiguousSequence,
    lastAcceptedCanonicalKey: lastCanonical.key,
    lastAcceptedRawEventId: lastAccepted.id,
    lastAcceptedAt: lastAccepted.createdAt
  };
}

export function compareRunEventFrontiers(left?: RunEventFrontier | null, right?: RunEventFrontier | null) {
  const safeLeft = left ?? createEmptyRunEventFrontier();
  const safeRight = right ?? createEmptyRunEventFrontier();
  if (safeLeft.version !== safeRight.version) {
    return safeLeft.version - safeRight.version;
  }
  if ((safeLeft.lastSequence ?? -1) !== (safeRight.lastSequence ?? -1)) {
    return (safeLeft.lastSequence ?? -1) - (safeRight.lastSequence ?? -1);
  }
  if (safeLeft.acceptedEventCount !== safeRight.acceptedEventCount) {
    return safeLeft.acceptedEventCount - safeRight.acceptedEventCount;
  }
  return (safeLeft.lastAcceptedAt ?? "").localeCompare(safeRight.lastAcceptedAt ?? "");
}

export function appendRunEventDiagnostic(
  diagnostics: RunEventDiagnostic[],
  diagnostic: RunEventDiagnostic,
  limit = 50
) {
  const next = [...diagnostics, diagnostic];
  return next.length > limit ? next.slice(next.length - limit) : next;
}
