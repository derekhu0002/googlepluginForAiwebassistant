import { compareNormalizedRunEvents, withCanonicalEventMetadata, type AnswerRecord, type NormalizedRunEvent, type RunHistoryDetail, type RunRecord } from "./protocol";

const DB_NAME = "ai-web-assistant-history";
const DB_VERSION = 2;
const RUNS_STORE = "runs";
const EVENTS_STORE = "events";
const ANSWERS_STORE = "answers";

const memoryDb = {
  runs: new Map<string, RunRecord>(),
  events: new Map<string, NormalizedRunEvent>(),
  answers: new Map<string, AnswerRecord>(),
  canonicalEventIndex: new Map<string, string>()
};

export interface HistoryStore {
  saveRun(run: RunRecord): Promise<void>;
  listRuns(): Promise<RunRecord[]>;
  getRunDetail(runId: string): Promise<RunHistoryDetail | null>;
  saveEvent(event: NormalizedRunEvent): Promise<void>;
  saveAnswer(answer: AnswerRecord): Promise<void>;
}

function promisifyRequest<T>(request: IDBRequest<T>) {
  return new Promise<T>((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function promisifyTransaction(transaction: IDBTransaction) {
  return new Promise<void>((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error);
  });
}

function openDatabase() {
  if (typeof indexedDB === "undefined") {
    return Promise.resolve(null);
  }

  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;

      if (!db.objectStoreNames.contains(RUNS_STORE)) {
        db.createObjectStore(RUNS_STORE, { keyPath: "runId" });
      }

      if (!db.objectStoreNames.contains(EVENTS_STORE)) {
        const store = db.createObjectStore(EVENTS_STORE, { keyPath: "id" });
        store.createIndex("by_run", "runId", { unique: false });
        store.createIndex("by_run_sequence", ["runId", "sequence"], { unique: false });
        store.createIndex("by_run_canonical", ["runId", "canonical.key"], { unique: false });
      }

      if (!db.objectStoreNames.contains(ANSWERS_STORE)) {
        const store = db.createObjectStore(ANSWERS_STORE, { keyPath: "id" });
        store.createIndex("by_run", "runId", { unique: false });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function toCanonicalHistoryEvent(event: NormalizedRunEvent) {
  return withCanonicalEventMetadata(event);
}

function orderHistoryEvents(events: NormalizedRunEvent[]) {
  return [...events].map(toCanonicalHistoryEvent).sort(compareNormalizedRunEvents);
}

function getCanonicalStorageKey(event: NormalizedRunEvent) {
  const canonicalEvent = toCanonicalHistoryEvent(event);
  return `${canonicalEvent.runId}:${canonicalEvent.canonical?.key ?? canonicalEvent.id}`;
}

async function withStore<T>(storeNames: string[], mode: IDBTransactionMode, fn: (tx: IDBTransaction) => Promise<T>) {
  const db = await openDatabase();
  if (!db) {
    return fn({} as IDBTransaction);
  }
  try {
    const tx = db.transaction(storeNames, mode);
    const result = await fn(tx);
    await promisifyTransaction(tx);
    return result;
  } finally {
    db.close();
  }
}

/** @ArchitectureID: ELM-FUNC-EXT-CALL-ADAPTER-API */
export function createIndexedDbHistoryStore(): HistoryStore {
  return {
    async saveRun(run) {
      if (typeof indexedDB === "undefined") {
        memoryDb.runs.set(run.runId, run);
        return;
      }
      await withStore([RUNS_STORE], "readwrite", async (tx) => {
        tx.objectStore(RUNS_STORE).put(run);
      });
    },
    async listRuns() {
      if (typeof indexedDB === "undefined") {
        return [...memoryDb.runs.values()].sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
      }
      return withStore([RUNS_STORE], "readonly", async (tx) => {
        const records = await promisifyRequest(tx.objectStore(RUNS_STORE).getAll() as IDBRequest<RunRecord[]>);
        return records.sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
      });
    },
    async getRunDetail(runId) {
      if (typeof indexedDB === "undefined") {
        const run = memoryDb.runs.get(runId);
        if (!run) {
          return null;
        }
        return {
          run,
          events: orderHistoryEvents([...memoryDb.events.values()].filter((event) => event.runId === runId)),
          answers: [...memoryDb.answers.values()].filter((answer) => answer.runId === runId).sort((left, right) => left.submittedAt.localeCompare(right.submittedAt))
        };
      }
      return withStore([RUNS_STORE, EVENTS_STORE, ANSWERS_STORE], "readonly", async (tx) => {
        const run = await promisifyRequest(tx.objectStore(RUNS_STORE).get(runId) as IDBRequest<RunRecord | undefined>);
        if (!run) {
          return null;
        }

        const events = await promisifyRequest(tx.objectStore(EVENTS_STORE).index("by_run").getAll(runId) as IDBRequest<NormalizedRunEvent[]>);
        const answers = await promisifyRequest(tx.objectStore(ANSWERS_STORE).index("by_run").getAll(runId) as IDBRequest<AnswerRecord[]>);

        return {
          run,
          events: orderHistoryEvents(events),
          answers: answers.sort((left, right) => left.submittedAt.localeCompare(right.submittedAt))
        };
      });
    },
    async saveEvent(event) {
      const canonicalEvent = toCanonicalHistoryEvent(event);
      const canonicalStorageKey = getCanonicalStorageKey(canonicalEvent);
      if (typeof indexedDB === "undefined") {
        const existingId = memoryDb.canonicalEventIndex.get(canonicalStorageKey);
        if (existingId) {
          const existingEvent = memoryDb.events.get(existingId);
          memoryDb.events.set(existingId, existingEvent ? { ...existingEvent, ...canonicalEvent, canonical: canonicalEvent.canonical } : canonicalEvent);
          return;
        }
        memoryDb.events.set(canonicalEvent.id, canonicalEvent);
        memoryDb.canonicalEventIndex.set(canonicalStorageKey, canonicalEvent.id);
        return;
      }
      await withStore([EVENTS_STORE], "readwrite", async (tx) => {
        const store = tx.objectStore(EVENTS_STORE);
        const existingEvents = await promisifyRequest(store.index("by_run_canonical").getAll([canonicalEvent.runId, canonicalEvent.canonical?.key ?? canonicalEvent.id]) as IDBRequest<NormalizedRunEvent[]>);
        const existingEvent = existingEvents[0];
        if (existingEvent) {
          store.put({
            ...existingEvent,
            ...canonicalEvent,
            id: existingEvent.id,
            canonical: canonicalEvent.canonical
          });
          return;
        }
        store.put(canonicalEvent);
      });
    },
    async saveAnswer(answer) {
      if (typeof indexedDB === "undefined") {
        memoryDb.answers.set(answer.id, answer);
        return;
      }
      await withStore([ANSWERS_STORE], "readwrite", async (tx) => {
        tx.objectStore(ANSWERS_STORE).put(answer);
      });
    }
  };
}
