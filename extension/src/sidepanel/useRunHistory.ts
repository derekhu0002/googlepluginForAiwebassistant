import { useEffect, useMemo, useState } from "react";
import { createIndexedDbHistoryStore } from "../shared/history";
import type { AnswerRecord, NormalizedRunEvent, RunHistoryDetail, RunRecord } from "../shared/protocol";

const historyStore = createIndexedDbHistoryStore();

/** @ArchitectureID: ELM-APP-EXT-CONVERSATION-LIVE-HISTORY-UX */
export function useRunHistory() {
  const [history, setHistory] = useState<RunRecord[]>([]);
  const [selectedHistoryDetail, setSelectedHistoryDetail] = useState<RunHistoryDetail | null>(null);

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
    selectedHistoryDetail,
    saveRun,
    saveEvent,
    saveAnswer,
    selectRun,
    clearSelectedRun,
    refresh,
    setSelectedHistoryDetail
  }), [history, selectedHistoryDetail]);
}
