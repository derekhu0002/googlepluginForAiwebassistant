import { useEffect, useMemo, useState } from "react";
import ReactMarkdown from "react-markdown";
import { toDisplayMessage } from "../shared/errors";
import { createDefaultFieldTemplates, createDefaultRule, createId } from "../shared/rules";
import { initialAssistantState } from "../shared/state";
import type { ActiveTabContext, AssistantState, FieldRuleDefinition, PageRule, RuntimeMessage } from "../shared/types";

const fieldLabels: Record<string, string> = {
  pageTitle: "pageTitle",
  pageUrl: "pageUrl",
  metaDescription: "metaDescription",
  h1: "h1",
  selectedText: "selectedText"
};

function cloneRule(rule: PageRule): PageRule {
  return {
    ...rule,
    fields: rule.fields.map((field) => ({ ...field }))
  };
}

function createEmptyRule(): PageRule {
  const seed = createDefaultRule();
  return {
    ...seed,
    name: "新规则",
    hostnamePattern: "*.example.com",
    pathPattern: "*",
    fields: createDefaultFieldTemplates()
  };
}

function createFieldRule(): FieldRuleDefinition {
  return {
    id: createId("field"),
    key: "customField",
    label: "自定义字段",
    source: "selectorText",
    selector: "body",
    enabled: true,
    fallbackValue: ""
  };
}

async function sendMessage<T>(message: RuntimeMessage): Promise<T> {
  return chrome.runtime.sendMessage(message) as Promise<T>;
}

export function App() {
  const [state, setState] = useState<AssistantState>(initialAssistantState);
  const [rules, setRules] = useState<PageRule[]>([]);
  const [selectedRuleId, setSelectedRuleId] = useState<string | null>(null);
  const [draftRule, setDraftRule] = useState<PageRule | null>(null);
  const [activeContext, setActiveContext] = useState<ActiveTabContext | null>(null);
  const [savingRule, setSavingRule] = useState(false);
  const isBusy = state.status === "collecting" || state.status === "analyzing";
  const isEmbedded = useMemo(() => new URLSearchParams(window.location.search).get("mode") === "embedded", []);
  const errorTitle = state.error?.code ? `${state.error.code}` : null;
  const errorDescription = state.error ? toDisplayMessage(state.error) : state.errorMessage;

  async function loadState() {
    const [currentState, currentRules, context] = await Promise.all([
      sendMessage<AssistantState>({ type: "GET_STATE" }),
      sendMessage<PageRule[]>({ type: "GET_RULES" }),
      sendMessage<ActiveTabContext>({ type: "GET_ACTIVE_CONTEXT" }).catch(() => null as ActiveTabContext | null)
    ]);

    setState(currentState ?? initialAssistantState);
    setRules(currentRules);
    setActiveContext(context);

    if (!selectedRuleId && currentRules[0]) {
      setSelectedRuleId(currentRules[0].id);
      setDraftRule(cloneRule(currentRules[0]));
    }
  }

  useEffect(() => {
    loadState().catch(() => undefined);

    const listener = (message: RuntimeMessage) => {
      if (message.type === "STATE_UPDATED") {
        setState(message.payload);
      }
    };

    chrome.runtime.onMessage.addListener(listener);
    return () => chrome.runtime.onMessage.removeListener(listener);
  }, []);

  useEffect(() => {
    if (!selectedRuleId && rules[0]) {
      setSelectedRuleId(rules[0].id);
      setDraftRule(cloneRule(rules[0]));
      return;
    }

    if (selectedRuleId) {
      const selected = rules.find((rule) => rule.id === selectedRuleId);
      if (selected) {
        setDraftRule(cloneRule(selected));
      }
    }
  }, [rules, selectedRuleId]);

  const selectedRule = draftRule;

  function updateDraft(mutator: (current: PageRule) => PageRule) {
    setDraftRule((current) => current ? mutator(cloneRule(current)) : current);
  }

  async function saveCurrentRule() {
    if (!draftRule) {
      return;
    }

    setSavingRule(true);
    try {
      const nextRules = await sendMessage<PageRule[]>({ type: "UPSERT_RULE", payload: draftRule });
      setRules(nextRules);
      setSelectedRuleId(draftRule.id);
      await loadState();
    } finally {
      setSavingRule(false);
    }
  }

  async function deleteCurrentRule() {
    if (!selectedRuleId) {
      return;
    }

    const nextRules = await sendMessage<PageRule[]>({ type: "DELETE_RULE", payload: { ruleId: selectedRuleId } });
    setRules(nextRules);
    const nextSelected = nextRules[0] ?? null;
    setSelectedRuleId(nextSelected?.id ?? null);
    setDraftRule(nextSelected ? cloneRule(nextSelected) : null);
    await loadState();
  }

  function addRule() {
    const rule = createEmptyRule();
    setSelectedRuleId(rule.id);
    setDraftRule(rule);
  }

  async function requestPermission() {
    const context = await sendMessage<ActiveTabContext>({ type: "REQUEST_HOST_PERMISSION" });
    setActiveContext(context);
  }

  return (
    <main className="app-shell">
      <header className="app-header">
        <div>
          <h1>AI Web Assistant</h1>
          <p>Chrome 页面字段采集与 Mock 分析</p>
        </div>
        <span className="mode-chip">{isEmbedded || state.uiMode === "embedded" ? "Embedded" : "Side Panel"}</span>
      </header>

      <section className="status-card">
        <strong>当前页面上下文</strong>
        <small>{activeContext?.url ?? "尚未读取当前标签页"}</small>
        <small>{activeContext?.message ?? ""}</small>
        {activeContext?.activeTabFallbackAvailable ? (
          <small>activeTab 仅用于用户点击扩展动作时的当前页嵌入式面板兜底，不替代域名授权采集。</small>
        ) : null}
        <div className="context-actions">
          <span className={`pill ${activeContext?.matchedRule ? "pill-success" : "pill-muted"}`}>
            {activeContext?.matchedRule ? `命中规则：${activeContext.matchedRule.name}` : "未命中规则"}
          </span>
          <span className={`pill ${activeContext?.permissionGranted ? "pill-success" : "pill-warning"}`}>
            {activeContext?.permissionGranted ? "域名已授权" : "域名未授权"}
          </span>
        </div>
        {!activeContext?.permissionGranted && activeContext?.canRequestPermission ? (
          <button className="secondary" onClick={() => requestPermission()}>
            授权当前域名
          </button>
        ) : null}
      </section>

      <section className="button-group">
        <button disabled={isBusy} onClick={() => sendMessage({ type: "CAPTURE_AND_ANALYZE" })}>
          采集并分析
        </button>
        <button disabled={isBusy} className="secondary" onClick={() => sendMessage({ type: "RECAPTURE" })}>
          重新采集
        </button>
        <button disabled={isBusy} className="secondary" onClick={() => sendMessage({ type: "CLEAR_RESULT" })}>
          清空结果
        </button>
      </section>

      <section className="status-card">
        <strong>状态：</strong>
        <span>{state.status}</span>
        {state.lastUpdatedAt ? <small>更新时间：{new Date(state.lastUpdatedAt).toLocaleString()}</small> : null}
        {state.matchedRule ? <small>最近命中规则：{state.matchedRule.name}</small> : null}
        {errorTitle ? <small>错误域：{errorTitle}</small> : null}
        {errorDescription ? <p className="error-text">{errorDescription}</p> : null}
      </section>

      <section className="panel-block">
        <div className="section-header">
          <h2>规则配置中心</h2>
          <div className="inline-actions">
            <button className="secondary" onClick={() => addRule()}>新增规则</button>
            <button className="secondary" disabled={!selectedRuleId} onClick={() => deleteCurrentRule()}>删除规则</button>
            <button disabled={!selectedRule || savingRule} onClick={() => saveCurrentRule()}>{savingRule ? "保存中..." : "保存规则"}</button>
          </div>
        </div>

        <div className="rules-layout">
          <aside className="rule-list">
            {rules.map((rule) => (
              <button
                key={rule.id}
                className={`rule-list-item ${selectedRuleId === rule.id ? "active" : ""}`}
                onClick={() => {
                  setSelectedRuleId(rule.id);
                  setDraftRule(cloneRule(rule));
                }}
              >
                <strong>{rule.name}</strong>
                <small>{rule.hostnamePattern}{rule.pathPattern !== "*" ? ` · ${rule.pathPattern}` : ""}</small>
              </button>
            ))}
          </aside>

          {selectedRule ? (
            <div className="rule-editor">
              <label>
                <span>规则名称</span>
                <input value={selectedRule.name} onChange={(event) => updateDraft((current) => ({ ...current, name: event.target.value }))} />
              </label>
              <div className="two-column">
                <label>
                  <span>Hostname 模式</span>
                  <input value={selectedRule.hostnamePattern} onChange={(event) => updateDraft((current) => ({ ...current, hostnamePattern: event.target.value }))} placeholder="如 *.example.com" />
                </label>
                <label>
                  <span>Path 模式</span>
                  <input value={selectedRule.pathPattern} onChange={(event) => updateDraft((current) => ({ ...current, pathPattern: event.target.value }))} placeholder="如 /products/*" />
                </label>
              </div>
              <label className="checkbox-row">
                <input type="checkbox" checked={selectedRule.enabled} onChange={(event) => updateDraft((current) => ({ ...current, enabled: event.target.checked }))} />
                <span>启用规则</span>
              </label>

              <div className="section-header compact">
                <h3>字段规则</h3>
                <button className="secondary" onClick={() => updateDraft((current) => ({ ...current, fields: [...current.fields, createFieldRule()] }))}>新增字段</button>
              </div>

              <div className="field-rule-list">
                {selectedRule.fields.map((field, index) => (
                  <div key={field.id} className="field-rule-card">
                    <div className="field-rule-toolbar">
                      <strong>{field.label || `字段 ${index + 1}`}</strong>
                      <button className="secondary" onClick={() => updateDraft((current) => ({ ...current, fields: current.fields.filter((item) => item.id !== field.id) }))}>删除</button>
                    </div>
                    <div className="two-column">
                      <label>
                        <span>字段 key</span>
                        <input value={field.key} onChange={(event) => updateDraft((current) => ({ ...current, fields: current.fields.map((item) => item.id === field.id ? { ...item, key: event.target.value } : item) }))} />
                      </label>
                      <label>
                        <span>展示名称</span>
                        <input value={field.label} onChange={(event) => updateDraft((current) => ({ ...current, fields: current.fields.map((item) => item.id === field.id ? { ...item, label: event.target.value } : item) }))} />
                      </label>
                    </div>
                    <div className="two-column">
                      <label>
                        <span>来源类型</span>
                        <select value={field.source} onChange={(event) => updateDraft((current) => ({ ...current, fields: current.fields.map((item) => item.id === field.id ? { ...item, source: event.target.value as FieldRuleDefinition["source"] } : item) }))}>
                          <option value="documentTitle">document.title</option>
                          <option value="pageUrl">window.location.href</option>
                          <option value="selectedText">window.getSelection()</option>
                          <option value="meta">meta[name]</option>
                          <option value="selectorText">selector.textContent</option>
                          <option value="selectorAttribute">selector.getAttribute</option>
                        </select>
                      </label>
                      <label className="checkbox-row">
                        <input type="checkbox" checked={field.enabled} onChange={(event) => updateDraft((current) => ({ ...current, fields: current.fields.map((item) => item.id === field.id ? { ...item, enabled: event.target.checked } : item) }))} />
                        <span>启用字段</span>
                      </label>
                    </div>
                    {(field.source === "selectorText" || field.source === "selectorAttribute") ? (
                      <label>
                        <span>CSS Selector</span>
                        <input value={field.selector ?? ""} onChange={(event) => updateDraft((current) => ({ ...current, fields: current.fields.map((item) => item.id === field.id ? { ...item, selector: event.target.value } : item) }))} />
                      </label>
                    ) : null}
                    {field.source === "selectorAttribute" ? (
                      <label>
                        <span>属性名</span>
                        <input value={field.attribute ?? ""} onChange={(event) => updateDraft((current) => ({ ...current, fields: current.fields.map((item) => item.id === field.id ? { ...item, attribute: event.target.value } : item) }))} />
                      </label>
                    ) : null}
                    {field.source === "meta" ? (
                      <label>
                        <span>meta name</span>
                        <input value={field.metaName ?? "description"} onChange={(event) => updateDraft((current) => ({ ...current, fields: current.fields.map((item) => item.id === field.id ? { ...item, metaName: event.target.value } : item) }))} />
                      </label>
                    ) : null}
                    <label>
                      <span>兜底值</span>
                      <input value={field.fallbackValue ?? ""} onChange={(event) => updateDraft((current) => ({ ...current, fields: current.fields.map((item) => item.id === field.id ? { ...item, fallbackValue: event.target.value } : item) }))} />
                    </label>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <p className="empty-state">暂无规则，点击“新增规则”开始配置。</p>
          )}
        </div>
      </section>

      <section className="panel-block">
        <h2>采集结果</h2>
        {state.capturedFields ? (
          <dl className="field-list">
            {Object.entries(state.capturedFields).map(([key, value]) => (
              <div key={key} className="field-item">
                <dt>{fieldLabels[key] ?? key}</dt>
                <dd>{value || <span className="empty-value">(empty)</span>}</dd>
              </div>
            ))}
          </dl>
        ) : (
          <p className="empty-state">尚未采集任何字段。</p>
        )}
      </section>

      <section className="panel-block markdown-body">
        <h2>Markdown 分析结果</h2>
        {state.analysisMarkdown ? <ReactMarkdown>{state.analysisMarkdown}</ReactMarkdown> : <p className="empty-state">暂无分析结果。</p>}
      </section>
    </main>
  );
}
