import { useEffect, useMemo, useState } from "react";

import {
  FieldExplanation,
  LlmSettings,
  REQUIRED_FIELD_IDS,
  SECTION_ORDER,
  TEMPLATE_FIELDS,
  TemplateField,
  TemplateRecord,
  createDefaultLlmSettings,
  createEmptyRecord,
} from "../shared/schema";

type SaveMethod = "POST" | "PUT";

async function getResponseErrorMessage(response: Response, fallback: string) {
  const errorBody = (await response.json().catch(() => ({}))) as { message?: string };
  return errorBody.message || `${fallback}（HTTP ${response.status}）`;
}

function getRequestErrorMessage(error: unknown, fallback: string) {
  if (error instanceof TypeError) {
    return "无法连接后端服务，请确认 http://localhost:3001 已启动。";
  }

  return error instanceof Error ? error.message : fallback;
}

export default function App() {
  const [records, setRecords] = useState<TemplateRecord[]>([]);
  const [currentRecord, setCurrentRecord] = useState<TemplateRecord>(createEmptyRecord());
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [llmSettings, setLlmSettings] = useState<LlmSettings>(createDefaultLlmSettings());
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isParsing, setIsParsing] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isSavingSettings, setIsSavingSettings] = useState(false);
  const [message, setMessage] = useState("已就绪，可以上传材料开始解析。");

  const fieldsBySection = useMemo(() => {
    return SECTION_ORDER.map((section) => ({
      section,
      fields: TEMPLATE_FIELDS.filter((field) => field.section === section),
    }));
  }, []);

  const missingRequiredFields = useMemo(() => {
    return REQUIRED_FIELD_IDS
      .filter((fieldId) => currentRecord.missingFields.includes(fieldId))
      .map((fieldId) => TEMPLATE_FIELDS.find((field) => field.id === fieldId))
      .filter((field): field is TemplateField => Boolean(field));
  }, [currentRecord.missingFields]);

  const shouldShowMissingRequiredSummary = Boolean(currentRecord.meta.sourceFileName);

  useEffect(() => {
    void loadRecords();
    void loadLlmSettings();
  }, []);

  async function loadRecords() {
    try {
      const response = await fetch("/api/records");
      if (!response.ok) {
        throw new Error(await getResponseErrorMessage(response, "读取记录失败"));
      }
      const data = (await response.json()) as TemplateRecord[];
      setRecords(data);
    } catch (error) {
      console.error(error);
      setMessage(`${getRequestErrorMessage(error, "记录列表读取失败")}，不过你仍然可以继续新建解析。`);
    }
  }

  async function loadLlmSettings() {
    try {
      const response = await fetch("/api/settings/llm");
      if (!response.ok) {
        throw new Error(await getResponseErrorMessage(response, "读取模型配置失败"));
      }
      const data = (await response.json()) as LlmSettings;
      setLlmSettings(data);
    } catch (error) {
      console.error(error);
      setMessage(`${getRequestErrorMessage(error, "模型配置读取失败")}，不过你仍然可以先编辑表单。`);
    }
  }

  async function handleParse() {
    if (!selectedFile) {
      setMessage("请先选择一个录音或文档文件。");
      return;
    }

    setIsParsing(true);
    setMessage("正在解析文件内容并生成表单草稿...");

    try {
      const formData = new FormData();
      formData.append("file", selectedFile);

      const response = await fetch("/api/parse", {
        method: "POST",
        body: formData,
      });

      if (!response.ok) {
        const errorBody = (await response.json().catch(() => ({}))) as { message?: string };
        throw new Error(errorBody.message || "解析失败");
      }

      const data = (await response.json()) as TemplateRecord;
      setCurrentRecord(data);
      setMessage("解析完成。橙色提示表示仍需你确认的字段。");
    } catch (error) {
      console.error(error);
      setMessage(error instanceof Error ? error.message : "解析失败");
    } finally {
      setIsParsing(false);
    }
  }

  async function handleSave() {
    setIsSaving(true);
    setMessage("正在保存当前解析结果...");

    const method: SaveMethod = records.some((record) => record.id === currentRecord.id) ? "PUT" : "POST";
    const url = method === "POST" ? "/api/records" : `/api/records/${currentRecord.id}`;

    try {
      const response = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(refreshRecordState(currentRecord)),
      });

      if (!response.ok) {
        throw new Error(await getResponseErrorMessage(response, "保存失败"));
      }

      const saved = (await response.json()) as TemplateRecord;
      setCurrentRecord(saved);
      setMessage("保存成功，记录已经写入本地 data/records 目录。");
      await loadRecords();
    } catch (error) {
      console.error(error);
      setMessage(getRequestErrorMessage(error, "保存失败"));
    } finally {
      setIsSaving(false);
    }
  }

  async function handleSaveSettings() {
    setIsSavingSettings(true);
    setMessage("正在保存模型配置...");

    try {
      const response = await fetch("/api/settings/llm", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(llmSettings),
      });

      if (!response.ok) {
        throw new Error(await getResponseErrorMessage(response, "模型配置保存失败"));
      }

      const saved = (await response.json()) as LlmSettings;
      setLlmSettings(saved);
      setMessage("模型配置已保存，后续解析会直接使用新配置。");
    } catch (error) {
      console.error(error);
      setMessage(getRequestErrorMessage(error, "模型配置保存失败"));
    } finally {
      setIsSavingSettings(false);
    }
  }

  async function loadRecord(id: string) {
    try {
      const response = await fetch(`/api/records/${id}`);
      if (!response.ok) {
        throw new Error(await getResponseErrorMessage(response, "读取记录失败"));
      }
      const data = (await response.json()) as TemplateRecord;
      setCurrentRecord(data);
      setMessage(`已载入记录：${data.name}`);
    } catch (error) {
      console.error(error);
      setMessage(getRequestErrorMessage(error, "加载记录失败。"));
    }
  }

  function startNewRecord() {
    setSelectedFile(null);
    setCurrentRecord(createEmptyRecord());
    setMessage("已新建空白解析。你可以直接填写，也可以上传材料后重新解析。");
  }

  function updateLlmSetting<K extends keyof LlmSettings>(key: K, value: LlmSettings[K]) {
    setLlmSettings((previous) => ({
      ...previous,
      [key]: value,
    }));
  }

  function updateField(field: TemplateField, value: string | string[]) {
    setCurrentRecord((previous) => {
      const next = refreshRecordState({
        ...previous,
        values: {
          ...previous.values,
          [field.id]: value,
        },
      });

      if (field.id === "article.nameOrCode" && typeof value === "string" && value.trim()) {
        next.name = value.trim();
      }

      return next;
    });
  }

  function updateRecordName(name: string) {
    setCurrentRecord((previous) =>
      refreshRecordState({
        ...previous,
        name,
      }),
    );
  }

  function downloadJson() {
    const blob = new Blob([JSON.stringify(refreshRecordState(currentRecord), null, 2)], {
      type: "application/json;charset=utf-8",
    });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `${sanitizeFileName(currentRecord.name || "parse-result")}.json`;
    anchor.click();
    URL.revokeObjectURL(url);
    setMessage("JSON 已生成下载。");
  }

  return (
    <div className="layout">
      <aside className="sidebar">
        <div className="panel brand-panel">
          <p className="panel-kicker">材料录入与校核工作台</p>
          <h1>供试品信息解析 Demo</h1>
          <p className="panel-intro muted">
            支持录音、`doc`、`docx`、`pdf` 上传，解析为模板字段后进行人工校对、保存和 JSON 导出。
          </p>
          <div className="badge-row">
            <span className="status-badge status-badge-blue">解析工作台</span>
            <span className="status-badge">{llmSettings.useLlmExtraction ? "LLM 优先" : "规则抽取"}</span>
          </div>
        </div>

        <div className="panel sticky">
          <div className="panel-heading">
            <h2>已保存记录</h2>
            <p className="panel-note">从左侧继续加载历史解析，保持当前校对进度。</p>
          </div>
          <div className="record-list">
            {records.length === 0 ? (
              <div className="empty">还没有保存的记录</div>
            ) : (
              records.map((record) => (
                <button
                  key={record.id}
                  className={`record-item ${record.id === currentRecord.id ? "active" : ""}`}
                  onClick={() => void loadRecord(record.id)}
                >
                  <strong>{record.name}</strong>
                  <span>{formatDateTime(record.updatedAt)}</span>
                </button>
              ))
            )}
          </div>
        </div>
      </aside>

      <main className="content">
        <div className="panel upload-panel">
          <div className="section-header">
            <div className="section-heading">
              <h2>上传原始材料</h2>
              <div className="tip">把文件放在最前面，解析、保存都从这里开始。</div>
            </div>
            <span className="section-status">{isParsing ? "解析中" : selectedFile ? "已选择文件" : "待上传"}</span>
          </div>

          <div className="upload-grid">
            <div>
              <label className="field-label" htmlFor="file-input">
                原始材料文件
              </label>
              <input
                id="file-input"
                type="file"
                accept=".doc,.docx,.pdf,audio/*,.mp3,.wav,.m4a,.aac,.flac,.ogg,.webm"
                onChange={(event) => setSelectedFile(event.target.files?.[0] ?? null)}
              />
              <div className="tip">当前文件：{selectedFile ? selectedFile.name : "未选择"}</div>
            </div>

            <div className="action-stack">
              <button onClick={handleParse} disabled={isParsing}>
                {isParsing ? "解析中..." : "开始解析"}
              </button>
              <button className="secondary" onClick={startNewRecord}>
                新建解析
              </button>
            </div>
          </div>

          {isParsing && (
            <div className="parsing-status-card" role="status" aria-live="polite">
              <div className="loading-spinner" aria-hidden="true" />
              <div className="parsing-status-content">
                <strong>正在解析文件</strong>
                <div className="tip">系统正在抽取字段、整理原文依据并生成推理逻辑，请稍候。</div>
              </div>
            </div>
          )}
        </div>

        <div className="panel collapsible-panel">
          <button
            type="button"
            className="collapse-trigger"
            onClick={() => setIsSettingsOpen((previous) => !previous)}
          >
            <div className="collapse-title">
              <div className="section-heading inline">
                <strong>模型配置</strong>
                <span className="tip">默认收起，需要时再展开编辑。</span>
              </div>
              <span className="status-badge">{llmSettings.apiKey ? "已配置" : "未配置"}</span>
            </div>
            <span className="collapse-text">{isSettingsOpen ? "收起配置" : "展开配置"}</span>
          </button>

          {isSettingsOpen ? (
            <div className="settings-content">
              <label className="field-label" htmlFor="api-key-input">
                API Key
              </label>
              <input
                id="api-key-input"
                type="password"
                value={llmSettings.apiKey}
                onChange={(event) => updateLlmSetting("apiKey", event.target.value)}
                placeholder="请输入 OpenAI 兼容接口的 API Key"
              />

              <label className="field-label" htmlFor="base-url-input">
                Base URL
              </label>
              <input
                id="base-url-input"
                value={llmSettings.baseURL}
                onChange={(event) => updateLlmSetting("baseURL", event.target.value)}
                placeholder="例如 https://api.openai.com/v1"
              />

              <div className="settings-grid">
                <div>
                  <label className="field-label" htmlFor="chat-model-input">
                    字段抽取模型
                  </label>
                  <input
                    id="chat-model-input"
                    value={llmSettings.chatModel}
                    onChange={(event) => updateLlmSetting("chatModel", event.target.value)}
                    placeholder="例如 gpt-4.1-mini"
                  />
                </div>

                <div>
                  <label className="field-label" htmlFor="transcription-model-input">
                    录音转写模型
                  </label>
                  <input
                    id="transcription-model-input"
                    value={llmSettings.transcriptionModel}
                    onChange={(event) => updateLlmSetting("transcriptionModel", event.target.value)}
                    placeholder="例如 gpt-4o-mini-transcribe"
                  />
                </div>
              </div>

              <label className="toggle-row">
                <input
                  type="checkbox"
                  checked={llmSettings.useLlmExtraction}
                  onChange={(event) => updateLlmSetting("useLlmExtraction", event.target.checked)}
                />
                <span>启用 LLM 字段抽取</span>
              </label>

              <div className="action-row">
                <button onClick={handleSaveSettings} disabled={isSavingSettings}>
                  {isSavingSettings ? "保存中..." : "保存模型配置"}
                </button>
              </div>
              <div className="tip">
                配置会保存到本地 `data/llm-settings.json`。如果关闭 LLM 抽取，文档解析会退回规则模式；录音转写仍需要 API Key。
              </div>
            </div>
          ) : (
            <div className="tip panel-inline-tip">模型配置默认收起，需要时再展开编辑。</div>
          )}
        </div>

        <div className="panel sticky">
          <div className="toolbar summary-toolbar">
            <div className="summary-main">
              <div className="field-label">解析名称</div>
              <input
                value={currentRecord.name}
                onChange={(event) => updateRecordName(event.target.value)}
                placeholder="请输入记录名称"
              />
              <div className="tip">命名建议使用供试品编号或客户可识别名称，便于后续回查。</div>
              {shouldShowMissingRequiredSummary && (
                <div className="missing-required-panel">
                  <div className="missing-required-header">
                    <strong>原文中未提及的必填项</strong>
                    <span>{missingRequiredFields.length} 项</span>
                  </div>
                  {missingRequiredFields.length > 0 ? (
                    <>
                      <div className="missing-required-tags">
                        {missingRequiredFields.map((field) => (
                          <span key={field.id} className="missing-required-tag">
                            {field.label}
                          </span>
                        ))}
                      </div>
                      <div className="tip">
                        以上必填项未从原文中可靠提取，建议找客户确认后再补充完整信息。
                      </div>
                    </>
                  ) : (
                    <div className="tip">当前原文已覆盖全部必填项，暂时不需要额外补问客户。</div>
                  )}
                </div>
              )}
            </div>
            <div className="summary-side">
              <div className="status" role="status" aria-live="polite">
                {message}
              </div>
              <div className="meta-list meta-grid">
                <div>提取方式：{currentRecord.meta.extractionMode}</div>
                <div>待确认字段：{currentRecord.missingFields.length}</div>
                <div>来源文件：{currentRecord.meta.sourceFileName || "手动新建"}</div>
                <div>最近更新时间：{formatDateTime(currentRecord.updatedAt)}</div>
              </div>
            </div>
          </div>
        </div>

        {fieldsBySection.map(({ section, fields }) => (
          <section className="panel" key={section}>
            <div className="section-header">
              <h2>{section}</h2>
              <span className="section-status">{countMissingInSection(currentRecord, fields)} 个待确认</span>
            </div>

            <div className="form-grid">
              {fields.map((field) => {
                const issues = currentRecord.issues.filter((issue) => issue.fieldId === field.id);
                const isMissing = currentRecord.missingFields.includes(field.id);
                const explanation = currentRecord.fieldExplanations[field.id];

                return (
                  <div
                    key={field.id}
                    className={`form-card ${isMissing ? "needs-confirmation" : ""}`}
                  >
                    <label className="field-label">
                      {field.required ? "* " : ""}
                      {field.label}
                    </label>
                    <FieldControl
                      field={field}
                      value={currentRecord.values[field.id]}
                      onChange={(value) => updateField(field, value)}
                    />
                    <FieldExplanationPanel explanation={explanation} />
                    {issues.length > 0 && (
                      <div className="issue-list">
                        {issues.map((issue, index) => (
                          <div key={`${field.id}-${index}`} className="issue-item">
                            {issue.reason}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </section>
        ))}

        <div className="panel result-actions-panel">
          <div className="section-header compact">
            <div className="section-heading">
              <h2>解析结果操作</h2>
              <div className="tip">校对完成后统一保存或导出，减少重复操作。</div>
            </div>
            <span className="section-status">表单末尾统一处理</span>
          </div>
          <div className="action-row">
            <button onClick={handleSave} disabled={isSaving}>
              {isSaving ? "保存中..." : "保存解析结果"}
            </button>
            <button className="secondary" onClick={downloadJson}>
              下载 JSON
            </button>
          </div>
        </div>
      </main>
    </div>
  );
}

function FieldExplanationPanel(props: { explanation?: FieldExplanation }) {
  const sourceText = props.explanation?.sourceText?.trim() || "未提取到明确原文信息";
  const reasoning = props.explanation?.reasoning?.trim() || "暂无推理逻辑说明";

  return (
    <div className="field-explanation">
      <div className="field-explanation-item">
        <span className="field-explanation-label">原文信息</span>
        <div className="field-explanation-text">{sourceText}</div>
      </div>
      <div className="field-explanation-item">
        <span className="field-explanation-label">推理逻辑</span>
        <div className="field-explanation-text">{reasoning}</div>
      </div>
    </div>
  );
}

function FieldControl(props: {
  field: TemplateField;
  value: string | string[];
  onChange: (value: string | string[]) => void;
}) {
  const { field, value, onChange } = props;

  if (field.type === "multiselect") {
    const selectedValues = Array.isArray(value) ? value : [];
    return (
      <div className="checkbox-group">
        {(field.options ?? []).map((option) => {
          const checked = selectedValues.includes(option.value);
          return (
            <label key={option.value} className="checkbox-item">
              <input
                type="checkbox"
                checked={checked}
                onChange={(event) => {
                  const nextValues = event.target.checked
                    ? [...selectedValues, option.value]
                    : selectedValues.filter((item) => item !== option.value);
                  onChange(nextValues);
                }}
              />
              <span>{option.label}</span>
            </label>
          );
        })}
      </div>
    );
  }

  if (field.type === "select") {
    return (
      <select value={String(value ?? "")} onChange={(event) => onChange(event.target.value)}>
        <option value="">请选择</option>
        {(field.options ?? []).map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    );
  }

  if (field.type === "textarea") {
    return (
      <textarea
        value={String(value ?? "")}
        onChange={(event) => onChange(event.target.value)}
        placeholder={field.placeholder || "请输入"}
      />
    );
  }

  return (
    <input
      type={field.type === "date" ? "date" : field.type === "number" ? "number" : "text"}
      value={String(value ?? "")}
      onChange={(event) => onChange(event.target.value)}
      placeholder={field.placeholder || "请输入"}
    />
  );
}

function refreshRecordState(record: TemplateRecord): TemplateRecord {
  const missingFields = REQUIRED_FIELD_IDS.filter((fieldId) => {
    const value = record.values[fieldId];
    return Array.isArray(value) ? value.length === 0 : !String(value ?? "").trim();
  });

  const issueMap = new Map<string, { fieldId: string; reason: string }>();
  for (const issue of record.issues) {
    const hasValue = record.values[issue.fieldId];
    const resolved = Array.isArray(hasValue) ? hasValue.length > 0 : Boolean(String(hasValue ?? "").trim());
    if (!resolved) {
      issueMap.set(issue.fieldId, issue);
    }
  }

  for (const fieldId of missingFields) {
    if (issueMap.has(fieldId)) {
      continue;
    }
    issueMap.set(fieldId, {
      fieldId,
      reason: "该字段在当前结果中仍为空，需要用户确认",
    });
  }

  return {
    ...record,
    missingFields,
    issues: [...issueMap.values()],
    updatedAt: new Date().toISOString(),
  };
}

function countMissingInSection(record: TemplateRecord, fields: TemplateField[]) {
  return fields.filter((field) => record.missingFields.includes(field.id)).length;
}

function sanitizeFileName(name: string) {
  return name.replace(/[^\w\u4e00-\u9fa5.-]+/g, "_");
}

function formatDateTime(value: string) {
  return new Date(value).toLocaleString("zh-CN", {
    hour12: false,
  });
}
