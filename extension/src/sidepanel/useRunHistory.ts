import { useEffect, useMemo, useState } from "react";
import { createIndexedDbHistoryStore } from "../shared/history";
import type { AnswerRecord, NormalizedRunEvent, RunHistoryDetail, RunRecord } from "../shared/protocol";

const historyStore = createIndexedDbHistoryStore();

export function useRunHistory() {
  const [history, setHistory] = useState<RunRecord[]>([]);
  const [selectedHistoryDetail, setSelectedHistoryDetail] = useState<RunHistoryDetail | null>(null);

  async function refresh() {
    setHistory(await historyStore.listRuns());
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

  useEffect(() => {
    refresh().catch(() => undefined);
  }, []);

  return useMemo(() => ({
    history,
    selectedHistoryDetail,
    saveRun,
    saveEvent,
    saveAnswer,
    selectRun,
    refresh,
    setSelectedHistoryDetail
  }), [history, selectedHistoryDetail]);
}
