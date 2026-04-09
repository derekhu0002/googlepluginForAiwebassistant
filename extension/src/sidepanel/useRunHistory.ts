import { useEffect, useMemo, useState } from "react";
import { createIndexedDbHistoryStore } from "../shared/history";
import type { AnswerRecord, NormalizedRunEvent, RunHistoryDetail, RunRecord } from "../shared/protocol";

const historyStore = createIndexedDbHistoryStore();

/** @ArchitectureID: ELM-APP-EXT-CONVERSATION-LIVE-HISTORY-UX */
export function useRunHistory() {
  const [history, setHistory] = useState<RunRecord[]>([]);
  const [selectedHistoryDetail, setSelectedHistoryDetail] = useState<RunHistoryDetail | null>(null);

  const sessionHistory = useMemo(() => {
    const sessions = new Map<string, RunRecord[]>();

    for (const run of history) {
      const key = run.sessionId ? `session:${run.sessionId}` : `run:${run.runId}`;
      const bucket = sessions.get(key) ?? [];
      bucket.push(run);
      sessions.set(key, bucket);
    }

    return [...sessions.entries()]
      .map(([sessionKey, runs]) => ({
        sessionKey,
        runs: [...runs].sort((left, right) => new Date(left.startedAt).getTime() - new Date(right.startedAt).getTime()),
        latestRun: [...runs].sort((left, right) => new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime())[0]
      }))
      .sort((left, right) => new Date(right.latestRun.updatedAt).getTime() - new Date(left.latestRun.updatedAt).getTime());
  }, [history]);

  async function loadRunDetail(runId: string) {
    return historyStore.getRunDetail(runId);
  }

  async function refresh() {
    const [runs, currentDetail] = await Promise.all([
      historyStore.listRuns(),
      selectedHistoryDetail ? historyStore.getRunDetail(selectedHistoryDetail.run.runId) : Promise.resolve(null)
    ]);

    setHistory(runs);

    if (selectedHistoryDetail) {
      setSelectedHistoryDetail(currentDetail);
    }
  }

  async function saveRun(run: RunRecord) {
    await historyStore.saveRun(run);
    await refresh();
  }

  async function saveEvent(event: NormalizedRunEvent) {
    await historyStore.saveEvent(event);
  }

  async function saveAnswer(answer: AnswerRecord) {
    await historyStore.saveAnswer(answer);
  }

  async function selectRun(runId: string) {
    setSelectedHistoryDetail(await historyStore.getRunDetail(runId));
  }

  async function clearSelectedRun() {
    setSelectedHistoryDetail(null);
  }

  useEffect(() => {
    refresh().catch(() => undefined);
  }, []);

  return useMemo(() => ({
    history,
    sessionHistory,
    selectedHistoryDetail,
    saveRun,
    saveEvent,
    saveAnswer,
    loadRunDetail,
    selectRun,
    clearSelectedRun,
    refresh,
    setSelectedHistoryDetail
  }), [history, selectedHistoryDetail, sessionHistory]);
}
