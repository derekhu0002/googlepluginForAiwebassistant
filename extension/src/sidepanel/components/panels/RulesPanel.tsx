import type { FieldRuleDefinition, PageRule } from "../../../shared/types";

export function RulesPanel({
  active,
  draftRule,
  onAddFieldRule,
  onAddRule,
  onDeleteRule,
  onRemoveFieldRule,
  onSaveRule,
  onSelectRule,
  onUpdateDraft,
  rules,
  savingRule,
  selectedRuleId
}: {
  active: boolean;
  draftRule: PageRule | null;
  onAddFieldRule: () => void;
  onAddRule: () => void;
  onDeleteRule: () => void | Promise<void>;
  onRemoveFieldRule: (fieldId: string) => void;
  onSaveRule: () => void | Promise<void>;
  onSelectRule: (rule: PageRule) => void;
  onUpdateDraft: (mutator: (current: PageRule) => PageRule) => void;
  rules: PageRule[];
  savingRule: boolean;
  selectedRuleId: string | null;
}) {
  return (
    <section className={`panel-block secondary-panel auxiliary-panel ${active ? "is-active" : "is-hidden"}`} aria-label="规则控制台">
      <div className="section-header compact floating-console-header">
        <div>
          <h2>规则配置中心</h2>
          <small>OpenCode-like auxiliary rules workspace</small>
        </div>
      </div>
      <div className="inline-actions">
        <button className="secondary" onClick={() => onAddRule()}>新增规则</button>
        <button className="secondary" disabled={!selectedRuleId} onClick={() => onDeleteRule()}>删除规则</button>
        <button disabled={!draftRule || savingRule} onClick={() => onSaveRule()}>{savingRule ? "保存中..." : "保存规则"}</button>
      </div>
      <div className="rules-layout">
        <aside className="rule-list">
          {rules.map((rule) => (
            <button
              key={rule.id}
              className={`rule-list-item ${selectedRuleId === rule.id ? "active" : ""}`}
              onClick={() => onSelectRule(rule)}
            >
              <strong>{rule.name}</strong>
              <small>{rule.hostnamePattern}{rule.pathPattern !== "*" ? ` · ${rule.pathPattern}` : ""}</small>
            </button>
          ))}
        </aside>

        {draftRule ? (
          <div className="rule-editor">
            <label>
              <span>规则名称</span>
              <input value={draftRule.name} onChange={(event) => onUpdateDraft((current) => ({ ...current, name: event.target.value }))} />
            </label>
            <div className="two-column">
              <label>
                <span>Hostname 模式</span>
                <input value={draftRule.hostnamePattern} onChange={(event) => onUpdateDraft((current) => ({ ...current, hostnamePattern: event.target.value }))} placeholder="如 *.example.com" />
              </label>
              <label>
                <span>Path 模式</span>
                <input value={draftRule.pathPattern} onChange={(event) => onUpdateDraft((current) => ({ ...current, pathPattern: event.target.value }))} placeholder="如 /products/*" />
              </label>
            </div>
            <label className="checkbox-row">
              <input type="checkbox" checked={draftRule.enabled} onChange={(event) => onUpdateDraft((current) => ({ ...current, enabled: event.target.checked }))} />
              <span>启用规则</span>
            </label>

            <div className="section-header compact">
              <h3>字段规则</h3>
              <button className="secondary" onClick={() => onAddFieldRule()}>新增字段</button>
            </div>

            <div className="field-rule-list">
              {draftRule.fields.map((field, index) => (
                <div key={field.id} className="field-rule-card">
                  <div className="field-rule-toolbar">
                    <strong>{field.label || `字段 ${index + 1}`}</strong>
                    <button className="secondary" onClick={() => onRemoveFieldRule(field.id)}>删除</button>
                  </div>
                  <div className="two-column">
                    <label>
                      <span>字段 key</span>
                      <input value={field.key} onChange={(event) => onUpdateDraft((current) => ({ ...current, fields: current.fields.map((item) => item.id === field.id ? { ...item, key: event.target.value } : item) }))} />
                    </label>
                    <label>
                      <span>展示名称</span>
                      <input value={field.label} onChange={(event) => onUpdateDraft((current) => ({ ...current, fields: current.fields.map((item) => item.id === field.id ? { ...item, label: event.target.value } : item) }))} />
                    </label>
                  </div>
                  <FieldRuleEditor field={field} onUpdate={(updater) => onUpdateDraft((current) => ({ ...current, fields: current.fields.map((item) => item.id === field.id ? updater(item) : item) }))} />
                </div>
              ))}
            </div>
          </div>
        ) : (
          <p className="empty-state">暂无规则，点击“新增规则”开始配置。</p>
        )}
      </div>
    </section>
  );
}

function FieldRuleEditor({ field, onUpdate }: { field: FieldRuleDefinition; onUpdate: (updater: (field: FieldRuleDefinition) => FieldRuleDefinition) => void }) {
  return (
    <>
      <div className="two-column">
        <label>
          <span>来源类型</span>
          <select value={field.source} onChange={(event) => onUpdate((current) => ({ ...current, source: event.target.value as FieldRuleDefinition["source"] }))}>
            <option value="documentTitle">document.title</option>
            <option value="pageUrl">window.location.href</option>
            <option value="selectedText">window.getSelection()</option>
            <option value="meta">meta[name]</option>
            <option value="selectorText">selector.textContent</option>
            <option value="selectorAttribute">selector.getAttribute</option>
          </select>
        </label>
        <label className="checkbox-row">
          <input type="checkbox" checked={field.enabled} onChange={(event) => onUpdate((current) => ({ ...current, enabled: event.target.checked }))} />
          <span>启用字段</span>
        </label>
      </div>
      {(field.source === "selectorText" || field.source === "selectorAttribute") ? (
        <label>
          <span>CSS Selector</span>
          <input value={field.selector ?? ""} onChange={(event) => onUpdate((current) => ({ ...current, selector: event.target.value }))} />
        </label>
      ) : null}
      {field.source === "selectorAttribute" ? (
        <label>
          <span>属性名</span>
          <input value={field.attribute ?? ""} onChange={(event) => onUpdate((current) => ({ ...current, attribute: event.target.value }))} />
        </label>
      ) : null}
      {field.source === "meta" ? (
        <label>
          <span>meta name</span>
          <input value={field.metaName ?? "description"} onChange={(event) => onUpdate((current) => ({ ...current, metaName: event.target.value }))} />
        </label>
      ) : null}
      <label>
        <span>兜底值</span>
        <input value={field.fallbackValue ?? ""} onChange={(event) => onUpdate((current) => ({ ...current, fallbackValue: event.target.value }))} />
      </label>
    </>
  );
}
