export interface SidepanelDebugLogEntry {
  timestamp: string;
  source: "sidepanel-run-event" | "sidepanel-run-acceptance" | "transcript-projection" | "transcript-render";
  runId: string | null;
  entry: Record<string, unknown>;
}

const DEBUG_LOG_LIMIT = 800;
const DEBUG_TEXT_PREVIEW_LIMIT = 96;

function compactText(value: unknown, limit = DEBUG_TEXT_PREVIEW_LIMIT) {
  if (typeof value !== "string") {
    return value;
  }

  const normalized = value.replace(/\s+/gu, " ").trim();
  if (!normalized) {
    return "";
  }

  return normalized.length > limit ? `${normalized.slice(0, limit)}...` : normalized;
}

function compactCountedList(value: unknown) {
  if (!Array.isArray(value)) {
    return value;
  }

  return {
    count: value.length,
    sample: value.slice(0, 3)
  };
}

function compactProjectionSnapshot(value: unknown) {
  if (!value || typeof value !== "object") {
    return value;
  }

  const snapshot = value as Record<string, unknown>;
  return {
    logicalMessageId: snapshot.logicalMessageId ?? null,
    groupAnchorId: snapshot.groupAnchorId ?? null,
    outputItemId: snapshot.outputItemId ?? null,
    assistantTextLength: snapshot.assistantTextLength ?? 0,
    itemCount: snapshot.itemCount ?? 0
  };
}

function compactProjectionItem(value: unknown) {
  if (!value || typeof value !== "object") {
    return value;
  }

  const item = value as Record<string, unknown>;
  return {
    id: item.id ?? null,
    kind: item.kind ?? null,
    anchorId: item.anchorId ?? null,
    groupAnchorId: item.groupAnchorId ?? null,
    primaryType: item.primaryType ?? null,
    summaryPreview: compactText(item.summaryPreview)
  };
}

function sanitizeDebugLogEntry(source: SidepanelDebugLogEntry["source"], entry: Record<string, unknown>) {
  if (source === "sidepanel-run-acceptance") {
    return {
      phase: entry.phase ?? null,
      runId: entry.runId ?? null,
      rawEventId: entry.rawEventId ?? null,
      canonicalEventKey: entry.canonicalEventKey ?? null,
      type: entry.type ?? null,
      sequence: entry.sequence ?? null,
      decision: entry.decision ?? null,
      accepted: entry.accepted ?? null,
      identitySource: entry.identitySource ?? null,
      messageId: entry.messageId ?? null,
      partId: entry.partId ?? null,
      channel: entry.channel ?? null,
      emissionKind: entry.emissionKind ?? null,
      priorFrontierSequence: entry.priorFrontierSequence ?? null,
      resultingFrontierSequence: entry.resultingFrontierSequence ?? null,
      replacedSameSequenceReplay: entry.replacedSameSequenceReplay ?? false,
      messagePreview: compactText(entry.messagePreview)
    };
  }

  if (source === "transcript-projection") {
    return {
      phase: entry.phase ?? null,
      resolution: entry.resolution ?? null,
      anomalyType: entry.anomalyType ?? null,
      runId: entry.runId ?? null,
      rawEventId: entry.rawEventId ?? null,
      canonicalEventKey: entry.canonicalEventKey ?? null,
      type: entry.type ?? null,
      sequence: entry.sequence ?? null,
      messageId: entry.messageId ?? null,
      partId: entry.partId ?? null,
      before: compactProjectionSnapshot(entry.before),
      after: compactProjectionSnapshot(entry.after),
      outputItem: compactProjectionItem(entry.outputItem),
      openedNextAssistantNode: entry.openedNextAssistantNode ?? null,
      pendingQuestion: entry.pendingQuestion ?? null,
      answerCountForQuestion: entry.answerCountForQuestion ?? null,
      messageCount: entry.messageCount ?? null,
      partCount: entry.partCount ?? null,
      anomalyCount: entry.anomalyCount ?? null,
      activeMessageId: entry.activeMessageId ?? null,
      finalAnswerPartId: entry.finalAnswerPartId ?? null,
      questionPartId: entry.questionPartId ?? null,
      errorPartId: entry.errorPartId ?? null,
      tailPatchRevision: entry.tailPatchRevision ?? null,
      anomalyTypes: compactCountedList(entry.anomalyTypes),
      messagePreview: compactText(entry.messagePreview),
      assistantTextPreview: compactText(entry.assistantTextPreview),
      latestResultTextPreview: compactText(entry.latestResultTextPreview),
      finalAnswerPreview: compactText(entry.finalAnswerPreview),
      tailDeltaPreview: compactText(entry.tailDeltaPreview),
      errorPreview: compactText(entry.errorPreview),
      reasoningOnlyTextPreview: compactText(entry.reasoningOnlyTextPreview)
    };
  }

  if (source === "transcript-render") {
    return {
      phase: entry.phase ?? null,
      runId: entry.runId ?? null,
      projectedTranscriptPresent: entry.projectedTranscriptPresent ?? null,
      traceCount: entry.traceCount ?? null,
      activeMessageId: entry.activeMessageId ?? null,
      sealedMessageCount: entry.sealedMessageCount ?? null,
      visiblePartCount: entry.visiblePartCount ?? null,
      finalAnswerPartId: entry.finalAnswerPartId ?? null,
      tailPatchRevision: entry.tailPatchRevision ?? null,
      missingRenderedIds: compactCountedList(entry.missingRenderedIds),
      finalAnswerPreview: compactText(entry.finalAnswerPreview),
      tailDeltaPreview: compactText(entry.tailDeltaPreview)
    };
  }

  return {
    phase: entry.phase ?? null,
    runId: entry.runId ?? null,
    rawEventId: entry.rawEventId ?? null,
    canonicalEventKey: entry.canonicalEventKey ?? null,
    type: entry.type ?? null,
    sequence: entry.sequence ?? null,
    decision: entry.decision ?? null,
    rejected: entry.rejected ?? null,
    messageId: entry.messageId ?? null,
    partId: entry.partId ?? null,
    channel: entry.channel ?? null,
    emissionKind: entry.emissionKind ?? null,
    priorFrontierSequence: entry.priorFrontierSequence ?? null,
    resultingFrontierSequence: entry.resultingFrontierSequence ?? null,
    acceptedEventCount: entry.acceptedEventCount ?? null,
    lastAcceptedCanonicalKey: entry.lastAcceptedCanonicalKey ?? null,
    snapshotVersion: entry.snapshotVersion ?? null,
    activeMessageId: entry.activeMessageId ?? null,
    tailPatchRevision: entry.tailPatchRevision ?? null,
    tailRenderRevision: entry.tailRenderRevision ?? null,
    missingRenderedIds: compactCountedList(entry.missingRenderedIds),
    messagePreview: compactText(entry.messagePreview)
  };
}

const debugLogBuffer: SidepanelDebugLogEntry[] = [];

export function appendSidepanelDebugLog(
  source: SidepanelDebugLogEntry["source"],
  entry: Record<string, unknown>
) {
  const sanitizedEntry = sanitizeDebugLogEntry(source, entry);
  const nextEntry: SidepanelDebugLogEntry = {
    timestamp: new Date().toISOString(),
    source,
    runId: typeof sanitizedEntry.runId === "string" ? sanitizedEntry.runId : null,
    entry: sanitizedEntry
  };
  debugLogBuffer.push(nextEntry);
  if (debugLogBuffer.length > DEBUG_LOG_LIMIT) {
    debugLogBuffer.splice(0, debugLogBuffer.length - DEBUG_LOG_LIMIT);
  }
  return nextEntry;
}

export function getSidepanelDebugLogs(runId?: string | null) {
  if (!runId) {
    return [...debugLogBuffer];
  }

  return debugLogBuffer.filter((entry) => entry.runId === runId || entry.runId === null);
}

export function clearSidepanelDebugLogs() {
  debugLogBuffer.splice(0, debugLogBuffer.length);
}