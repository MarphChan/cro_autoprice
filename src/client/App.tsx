import { useEffect, useMemo, useState } from "react";

import {
  DRUG_TYPE_GROUPS,
  FieldExplanation,
  LlmSettings,
  REQUIRED_FIELD_IDS,
  SECTION_ORDER,
  TEMPLATE_FIELDS,
  TemplateField,
  TemplateRecord,
  createDefaultLlmSettings,
  createEmptyRecord,
  getDrugTypeCategories,
  getMissingFieldIds,
  hasFieldValue,
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
  const [documentFile, setDocumentFile] = useState<File | null>(null);
  const [audioFile, setAudioFile] = useState<File | null>(null);
  const [convertedAudio, setConvertedAudio] = useState<{ url: string; name: string } | null>(null);
  const [transcript, setTranscript] = useState("");
  const [transcriptionError, setTranscriptionError] = useState("");
  const [audioSourceName, setAudioSourceName] = useState("");
  const [audioMimeType, setAudioMimeType] = useState("");
  const [uploadVersion, setUploadVersion] = useState(0);
  const [llmSettings, setLlmSettings] = useState<LlmSettings>(createDefaultLlmSettings());
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [activity, setActivity] = useState<"document" | "transcribe" | "extract" | "simplify" | null>(null);
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

  useEffect(() => {
    return () => {
      if (convertedAudio) URL.revokeObjectURL(convertedAudio.url);
    };
  }, [convertedAudio]);

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

  async function handleDocumentParse() {
    if (!documentFile) {
      setMessage("请先选择文档文件。");
      return;
    }

    setActivity("document");
    setMessage("正在解析文档并生成表单草稿...");

    try {
      const formData = new FormData();
      formData.append("file", documentFile);

      const response = await fetch("/api/parse/document", {
        method: "POST",
        body: formData,
      });

      if (!response.ok) {
        throw new Error(await getResponseErrorMessage(response, "文档解析失败"));
      }

      const data = (await response.json()) as TemplateRecord;
      setCurrentRecord(data);
      setTranscript("");
      setTranscriptionError("");
      setAudioSourceName("");
      setAudioMimeType("");
      setAudioFile(null);
      setConvertedAudio(null);
      setUploadVersion((previous) => previous + 1);
      setMessage("解析完成。橙色提示表示仍需你确认的字段。");
    } catch (error) {
      console.error(error);
      setMessage(getRequestErrorMessage(error, "文档解析失败"));
    } finally {
      setActivity(null);
    }
  }

  async function handleTranscribe() {
    if (!audioFile) {
      setMessage("请先选择录音文件。");
      return;
    }

    setActivity("transcribe");
    setTranscript("");
    setTranscriptionError("");
    setAudioSourceName("");
    setConvertedAudio(null);
    const useVolc = llmSettings.transcriptionProvider === "volc";
    setMessage(useVolc ? "正在转码录音为 MP3..." :
      llmSettings.transcriptionProvider === "sensevoice" ? "正在使用本地 SenseVoice 转写录音..." :
        "正在通过在线语音服务转写录音...");

    try {
      let fileToTranscribe: File = audioFile;
      if (useVolc) {
        const conversionData = new FormData();
        conversionData.append("file", audioFile);
        const conversionResponse = await fetch("/api/convert/audio", {
          method: "POST",
          body: conversionData,
        });
        if (!conversionResponse.ok) {
          throw new Error(await getResponseErrorMessage(conversionResponse, "录音转码失败"));
        }
        const mp3 = await conversionResponse.blob();
        const mp3Name = `${audioFile.name.replace(/\.[^.]+$/, "")}.mp3`;
        fileToTranscribe = new File([mp3], mp3Name, { type: "audio/mpeg" });
        setConvertedAudio({ url: URL.createObjectURL(mp3), name: mp3Name });
        setMessage("转码成功，MP3 下载链接已显示。正在提交语音转写...");
      }
      const formData = new FormData();
      formData.append("file", fileToTranscribe);
      if (useVolc) formData.append("converted", "true");
      const response = await fetch("/api/transcribe", { method: "POST", body: formData });
      if (!response.ok) {
        throw new Error(await getResponseErrorMessage(response, "录音转写失败"));
      }
      const data = (await response.json()) as { text: string; fileName: string; mimeType: string };
      if (!data.text?.trim() || !data.fileName) {
        throw new Error("语音服务未返回有效的转写文字，请重试。");
      }
      setTranscript(data.text);
      setAudioSourceName(audioFile.name);
      setAudioMimeType(audioFile.type);
      setMessage("转写完成。请校对文字，然后提取表单信息。");
    } catch (error) {
      console.error(error);
      const errorMessage = getRequestErrorMessage(error, "录音转写失败");
      setTranscriptionError(errorMessage);
      setMessage(errorMessage);
    } finally {
      setActivity(null);
    }
  }

  async function handleTranscriptParse() {
    if (!transcript.trim() || !audioSourceName) {
      setMessage("请先完成录音转写并确认文字内容。");
      return;
    }

    setActivity("extract");
    setMessage("正在使用大语言模型从转写文本提取表单信息...");
    try {
      const response = await fetch("/api/parse/transcript", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: transcript, fileName: audioSourceName, mimeType: audioMimeType }),
      });
      if (!response.ok) {
        throw new Error(await getResponseErrorMessage(response, "表单提取失败"));
      }
      const data = (await response.json()) as TemplateRecord;
      setCurrentRecord(data);
      setMessage("录音表单提取完成。请核对字段后保存。");
    } catch (error) {
      console.error(error);
      setMessage(getRequestErrorMessage(error, "表单提取失败"));
    } finally {
      setActivity(null);
    }
  }

  async function handleSimplifyInput() {
    if (!currentRecord.meta.transcript || transcript !== currentRecord.meta.transcript ||
        audioSourceName !== currentRecord.meta.sourceFileName) {
      setMessage("转写文字有变更，请重新提取表单后再简化输入。");
      return;
    }
    const recordId = currentRecord.id;
    setActivity("simplify");
    setMessage("正在按供试品信息模板精简双方对话...");
    try {
      const response = await fetch("/api/simplify/input", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ record: refreshRecordState(currentRecord) }),
      });
      if (!response.ok) {
        throw new Error(await getResponseErrorMessage(response, "简化输入失败"));
      }
      const data = (await response.json()) as { simplifiedInput: string };
      if (!data.simplifiedInput?.trim()) throw new Error("模型未返回有效的简化内容");
      setCurrentRecord((previous) => previous.id === recordId
        ? { ...previous, simplifiedInput: data.simplifiedInput }
        : previous);
      setMessage("简化完成。请核对关键信息和待确认项，再保存解析结果。");
    } catch (error) {
      console.error(error);
      setMessage(getRequestErrorMessage(error, "简化输入失败"));
    } finally {
      setActivity(null);
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
      setTranscript(data.meta.transcript ?? "");
      setTranscriptionError("");
      setAudioSourceName(data.meta.transcript ? data.meta.sourceFileName ?? "" : "");
      setAudioMimeType(data.meta.transcript ? data.meta.sourceFileType ?? "" : "");
      setAudioFile(null);
      setConvertedAudio(null);
      setUploadVersion((previous) => previous + 1);
      setMessage(`已载入记录：${data.name}`);
    } catch (error) {
      console.error(error);
      setMessage(getRequestErrorMessage(error, "加载记录失败。"));
    }
  }

  function startNewRecord() {
    setDocumentFile(null);
    setAudioFile(null);
    setTranscript("");
    setTranscriptionError("");
    setAudioSourceName("");
    setAudioMimeType("");
    setConvertedAudio(null);
    setUploadVersion((previous) => previous + 1);
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
        simplifiedInput: undefined,
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
              分别上传文档或录音；录音先转写为文字，再通过大语言模型提取表单字段。
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
                <h2>上传文件</h2>
                <div className="tip">支持 doc、docx、pdf 文档，解析后生成可校对的表单。</div>
              </div>
              <span className="section-status">{activity === "document" ? "解析中" : documentFile ? "已选择文件" : "待上传"}</span>
          </div>

          <div className="upload-grid">
            <div>
                <label className="field-label" htmlFor="document-input">
                  文档文件
              </label>
                <input
                  key={`document-${uploadVersion}`}
                  id="document-input"
                type="file"
                  accept=".doc,.docx,.pdf"
                  disabled={activity !== null}
                  onChange={(event) => setDocumentFile(event.target.files?.[0] ?? null)}
              />
                <div className="tip">当前文件：{documentFile ? documentFile.name : "未选择"}</div>
            </div>

            <div className="action-stack">
                <button onClick={handleDocumentParse} disabled={activity !== null || !documentFile}>
                  {activity === "document" ? "解析中..." : "解析文档"}
              </button>
                <button className="secondary" onClick={startNewRecord} disabled={activity !== null}>
                新建解析
              </button>
            </div>
            </div>
            {activity === "document" && (
              <div className="parsing-status-card" role="status" aria-live="polite">
                <div className="loading-spinner" aria-hidden="true" />
                <div className="parsing-status-content">
                  <strong>正在解析文档</strong>
                  <div className="tip">正在抽取字段并生成表单，请稍候。</div>
                </div>
              </div>
            )}
          </div>

          <div className="panel upload-panel">
            <div className="section-header">
              <div className="section-heading">
                <h2>上传录音</h2>
                <div className="tip">支持 m4a、mp3、wav。选择 SenseVoice 时录音在本机识别；火山模式会先转为 mp3。</div>
              </div>
              <span className="section-status">{activity === "transcribe" ? (llmSettings.transcriptionProvider === "volc" && !convertedAudio ? "转码中" : "转写中") : audioFile ? "已选择录音" : "待上传"}</span>
            </div>
            <div className="upload-grid">
              <div>
                <label className="field-label" htmlFor="audio-input">录音文件</label>
                <input
                  key={`audio-${uploadVersion}`}
                  id="audio-input"
                  type="file"
                  accept=".m4a,.mp3,.wav,audio/mp4,audio/mpeg,audio/wav"
                  disabled={activity !== null}
                  onChange={(event) => {
                    setAudioFile(event.target.files?.[0] ?? null);
                    setTranscript("");
                    setTranscriptionError("");
                    setAudioSourceName("");
                    setAudioMimeType("");
                    setConvertedAudio(null);
                  }}
                />
                <div className="tip">当前录音：{audioFile ? audioFile.name : audioSourceName || "未选择"}</div>
              </div>
              <div className="action-stack">
                <button onClick={handleTranscribe} disabled={activity !== null || !audioFile}>
                  {activity === "transcribe" ? "转写中..." : "转写为文字"}
                </button>
              </div>
            </div>
            {convertedAudio && (
              <div className="conversion-success" role="status">
                转码成功：
                <a href={convertedAudio.url} download={convertedAudio.name}>
                  下载转码文件 {convertedAudio.name}
                </a>
                <span className="tip">链接仅在当前页面有效；刷新或更换录音后会失效。</span>
              </div>
            )}
            {(activity === "transcribe" || audioSourceName || transcriptionError) && (
              <div className="transcript-panel" aria-live="polite">
                <div className="transcript-heading">
                  <strong>转写结果</strong>
                  <span className="section-status">
                    {activity === "transcribe"
                      ? (llmSettings.transcriptionProvider === "volc" && !convertedAudio ? "转码中" : "转写中")
                      : transcriptionError
                        ? (llmSettings.transcriptionProvider === "volc" && !convertedAudio ? "转码失败" : "转写失败")
                        : "转写完成"}
                  </span>
                </div>
                {activity === "transcribe" ? (
                  <div className="transcript-progress" role="status">
                    <div className="loading-spinner" aria-hidden="true" />
                    <span>{llmSettings.transcriptionProvider === "volc" && !convertedAudio
                      ? "正在转码录音为 MP3，成功后会在上方显示下载链接。"
                      : "正在转写录音，完成后可在这里查看和校对文字。"}</span>
                  </div>
                ) : transcriptionError ? (
                  <div className="transcript-error" role="alert">{transcriptionError}</div>
                ) : (
                  <>
                    <label className="field-label" htmlFor="transcript-input">转写文字（可校对）</label>
                    <textarea
                      id="transcript-input"
                      rows={7}
                      value={transcript}
                      disabled={activity !== null}
                      onChange={(event) => {
                        setTranscript(event.target.value);
                        setCurrentRecord((previous) => ({ ...previous, simplifiedInput: undefined }));
                      }}
                    />
                    <div className="tip">确认文字准确后，由字段抽取模型生成表单。转写文字会随解析结果保存。</div>
                    <div className="transcript-actions">
                      <button onClick={handleTranscriptParse} disabled={activity !== null || !transcript.trim()}>
                        {activity === "extract" ? "提取中..." : "从文字提取表单"}
                      </button>
                      <button className="secondary" onClick={handleSimplifyInput}
                        disabled={activity !== null || !currentRecord.meta.transcript ||
                          transcript !== currentRecord.meta.transcript ||
                          audioSourceName !== currentRecord.meta.sourceFileName ||
                          currentRecord.meta.extractionMode !== "llm"}>
                        {activity === "simplify" ? "简化中..." : "从提取结果简化输入"}
                      </button>
                    </div>
                    <div className="tip">先提取表单，再精简双方对话；原始转写与表单不会被覆盖。</div>
                  </>
                )}
              </div>
            )}
              {(activity === "extract" || activity === "simplify") && (
              <div className="parsing-status-card" role="status" aria-live="polite">
                <div className="loading-spinner" aria-hidden="true" />
                <div className="parsing-status-content">
                  <strong>{activity === "simplify" ? "正在简化输入" : "正在生成表单"}</strong>
                  <div className="tip">{activity === "simplify" ? "正在归纳关键信息和待确认事项。" : "正在处理当前材料，请稍候。"}</div>
                </div>
              </div>
            )}
            {currentRecord.simplifiedInput !== undefined && currentRecord.meta.transcript &&
              audioSourceName === currentRecord.meta.sourceFileName &&
              transcript === currentRecord.meta.transcript && (
              <div className="simplified-panel">
                <div className="transcript-heading">
                  <strong>简化输入</strong>
                  <span className="section-status">可校对 · 随记录保存</span>
                </div>
                <label className="field-label" htmlFor="simplified-input">关键信息与待确认事项</label>
                <textarea id="simplified-input" rows={9} value={currentRecord.simplifiedInput}
                  onChange={(event) => setCurrentRecord((previous) => ({
                    ...previous, simplifiedInput: event.target.value,
                  }))} />
                <div className="tip">简化结果仅供核对，不会改写原始转写或表单字段；修改表单字段后请重新生成。</div>
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
                  <strong>模型与语音配置</strong>
                <span className="tip">默认收起，需要时再展开编辑。</span>
              </div>
                <span className="status-badge">
                  {llmSettings.apiKey && (llmSettings.transcriptionProvider === "sensevoice" || llmSettings.transcriptionApiKey) &&
                    (llmSettings.transcriptionProvider !== "volc" ||
                      (llmSettings.tosAccessKeyId && llmSettings.tosAccessKeySecret &&
                        llmSettings.tosRegion && llmSettings.tosEndpoint && llmSettings.tosBucket))
                    ? "均已配置" : "查看配置"}
                </span>
            </div>
            <span className="collapse-text">{isSettingsOpen ? "收起配置" : "展开配置"}</span>
          </button>

          {isSettingsOpen ? (
            <div className="settings-content">
                <h3 className="settings-subtitle">表单字段抽取</h3>
              <label className="field-label" htmlFor="api-key-input">
                  大语言模型 API Key
              </label>
              <input
                id="api-key-input"
                type="password"
                value={llmSettings.apiKey}
                onChange={(event) => updateLlmSetting("apiKey", event.target.value)}
                placeholder="请输入 OpenAI 兼容接口的 API Key"
              />

              <label className="field-label" htmlFor="base-url-input">
                  大语言模型 Base URL
              </label>
              <input
                id="base-url-input"
                value={llmSettings.baseURL}
                onChange={(event) => updateLlmSetting("baseURL", event.target.value)}
                placeholder="例如 https://api.openai.com/v1"
              />

                <label className="field-label" htmlFor="chat-model-input">
                  字段抽取模型
                </label>
                <input
                  id="chat-model-input"
                  value={llmSettings.chatModel}
                  onChange={(event) => updateLlmSetting("chatModel", event.target.value)}
                  placeholder="例如 gpt-4.1-mini"
                />
                <label className="toggle-row">
                <input
                  type="checkbox"
                  checked={llmSettings.useLlmExtraction}
                  onChange={(event) => updateLlmSetting("useLlmExtraction", event.target.checked)}
                />
                <span>启用 LLM 字段抽取</span>
              </label>
                <h3 className="settings-subtitle">语音转文字</h3>
                <label className="field-label" htmlFor="transcription-provider-input">语音服务类型</label>
                <select
                  id="transcription-provider-input"
                  value={llmSettings.transcriptionProvider}
                  onChange={(event) => updateLlmSetting("transcriptionProvider", event.target.value as LlmSettings["transcriptionProvider"])}
                >
                  <option value="openai">OpenAI 兼容转写</option>
                  <option value="volc">火山录音文件识别</option>
                  <option value="sensevoice">本地大模型 - SenseVoice</option>
                </select>
                <div className="tip">语音服务与上方的字段抽取模型分开配置。</div>
                {llmSettings.transcriptionProvider === "sensevoice" ? (
                  <div className="tip">SenseVoiceSmall 在本机识别，无需语音 API Key。模型目录：/Volumes/SANDISK ELE/SenseVoice；需安装本地 Python FunASR 依赖。表单字段抽取仍使用上方单独配置的模型。</div>
                ) : (
                  <>
                <label className="field-label" htmlFor="transcription-key-input">
                  {llmSettings.transcriptionProvider === "volc" ? "火山语音 X-Api-Key（新版控制台）" : "语音服务 API Key"}
                </label>
                <input
                  id="transcription-key-input"
                  type="password"
                  value={llmSettings.transcriptionApiKey}
                  onChange={(event) => updateLlmSetting("transcriptionApiKey", event.target.value)}
                  placeholder={llmSettings.transcriptionProvider === "volc" ? "请输入火山语音控制台 APP Key" : "请输入语音转文字服务的 API Key"}
                />
                {llmSettings.transcriptionProvider === "volc" ? (
                  <>
                    <label className="field-label" htmlFor="volc-resource-input">录音识别资源 ID</label>
                    <select
                      id="volc-resource-input"
                      value={llmSettings.volcResourceId}
                      onChange={(event) => updateLlmSetting("volcResourceId", event.target.value)}
                    >
                      <option value="volc.seedasr.auc">豆包录音文件识别 2.0（volc.seedasr.auc）</option>
                      <option value="volc.bigasr.auc">豆包录音文件识别 1.0（volc.bigasr.auc）</option>
                      <option value="volc.bigasr.auc_turbo">火山引擎极速版（volc.bigasr.auc_turbo）</option>
                    </select>
                    <div className="tip">极速版同步返回识别结果，无需等待标准版任务轮询；仍需配置下方 TOS 临时音频存储。</div>
                    <h3 className="settings-subtitle">临时音频存储（火山 TOS）</h3>
                    <div className="tip">转码后的录音临时上传到私有存储桶，使用短期签名链接提交识别，结束后自动删除。请使用具有该桶上传、读取和删除权限的凭证。</div>
                    <label className="field-label" htmlFor="tos-ak-input">TOS Access Key ID</label>
                    <input id="tos-ak-input" value={llmSettings.tosAccessKeyId}
                      onChange={(event) => updateLlmSetting("tosAccessKeyId", event.target.value)}
                      placeholder="TOS Access Key ID" />
                    <label className="field-label" htmlFor="tos-sk-input">TOS Secret Access Key</label>
                    <input id="tos-sk-input" type="password" value={llmSettings.tosAccessKeySecret}
                      onChange={(event) => updateLlmSetting("tosAccessKeySecret", event.target.value)}
                      placeholder="TOS Secret Access Key" />
                    <label className="field-label" htmlFor="tos-region-input">TOS 地域</label>
                    <input id="tos-region-input" value={llmSettings.tosRegion}
                      onChange={(event) => updateLlmSetting("tosRegion", event.target.value)}
                      placeholder="例如 cn-beijing" />
                    <label className="field-label" htmlFor="tos-endpoint-input">TOS 公网端点</label>
                    <input id="tos-endpoint-input" value={llmSettings.tosEndpoint}
                      onChange={(event) => updateLlmSetting("tosEndpoint", event.target.value)}
                      placeholder="例如 tos-cn-beijing.volces.com" />
                    <label className="field-label" htmlFor="tos-bucket-input">TOS 存储桶名称</label>
                    <input id="tos-bucket-input" value={llmSettings.tosBucket}
                      onChange={(event) => updateLlmSetting("tosBucket", event.target.value)}
                      placeholder="私有存储桶名称" />
                  </>
                ) : (
                  <>
                    <div className="tip">此服务需支持 OpenAI 兼容的 /audio/transcriptions 接口。</div>
                <label className="field-label" htmlFor="transcription-url-input">语音服务 Base URL</label>
                <input
                  id="transcription-url-input"
                  value={llmSettings.transcriptionBaseURL}
                  onChange={(event) => updateLlmSetting("transcriptionBaseURL", event.target.value)}
                  placeholder="例如 https://api.openai.com/v1"
                />
                <label className="field-label" htmlFor="transcription-model-input">语音转写模型</label>
                <input
                  id="transcription-model-input"
                  value={llmSettings.transcriptionModel}
                  onChange={(event) => updateLlmSetting("transcriptionModel", event.target.value)}
                  placeholder="例如 gpt-4o-mini-transcribe"
                />
                  </>
                )}
                  </>
                )}

              <div className="action-row">
                <button onClick={handleSaveSettings} disabled={isSavingSettings}>
                  {isSavingSettings ? "保存中..." : "保存模型配置"}
                </button>
              </div>
              <div className="tip">
                  配置会保存到本地 data/llm-settings.json。文档可退回规则抽取；录音表单提取必须启用大语言模型。
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
            {section === "三、交接信息补充" && (
              <div className="tip handover-note">创建供试品表时本节非必填；项目交接时请按原问卷填写，其中科技券选填、翻译报告日期在有翻译时填写。</div>
            )}

            <div className="form-grid">
              {fields.map((field) => {
                if (field.id === "article.excipient.specificContent" &&
                    currentRecord.values["article.excipient.procurementByInnostar"] !== "yes" &&
                    !hasFieldValue(currentRecord.values[field.id])) {
                  return null;
                }
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
                      legacyDrugType={field.id === "article.drugType" ? currentRecord.legacyDrugType : undefined}
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
  legacyDrugType?: string;
  onChange: (value: string | string[]) => void;
}) {
  const { field, value, legacyDrugType, onChange } = props;

  if (field.type === "multiselect") {
    const selectedValues = Array.isArray(value) ? value : [];
    if (field.id === "article.drugType") {
      const categories = getDrugTypeCategories(selectedValues);
      const legacyLabel = DRUG_TYPE_GROUPS.find((group) => group.value === legacyDrugType)?.label ?? legacyDrugType;
      return (
        <div className="drug-type-control">
          {legacyLabel && (
            <div className="drug-type-legacy">旧记录原分类：{legacyLabel}。原记录没有具体子类，请核对并补选；原分类会保留在记录中。</div>
          )}
          <div className="tip">可跨大类选择多个子类；当前大类：{categories.map((value) =>
            DRUG_TYPE_GROUPS.find((group) => group.value === value)?.label).join("、") || "未选择"}</div>
          <div className="drug-type-groups">
            {DRUG_TYPE_GROUPS.map((group) => {
              const count = group.options.filter((option) => selectedValues.includes(option.value)).length;
              return (
                <details key={group.value} className="drug-type-group" open={count > 0 ? true : undefined}>
                  <summary>{group.label}<span className="drug-type-count">{count ? `已选 ${count} 项` : `${group.options.length} 项`}</span></summary>
                  <div className="checkbox-group">
                    {group.options.map((option) => (
                      <label key={option.value} className="checkbox-item">
                        <input type="checkbox" checked={selectedValues.includes(option.value)}
                          onChange={(event) => onChange(event.target.checked
                            ? [...selectedValues, option.value]
                            : selectedValues.filter((item) => item !== option.value))} />
                        <span>{option.value} {option.label}</span>
                      </label>
                    ))}
                  </div>
                </details>
              );
            })}
          </div>
        </div>
      );
    }
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

  if (field.type === "text" && field.options?.length) {
    const suggestionsId = `suggestions-${field.id}`;
    return (
      <div className="suggestion-control">
        <input list={suggestionsId} value={String(value ?? "")}
          onChange={(event) => onChange(event.target.value)}
          placeholder="选择建议项或自行填写" />
        <datalist id={suggestionsId}>
          {field.options.map((option) => <option key={option.value} value={option.value} />)}
        </datalist>
        <div className="tip">可选择问卷选项，也可填写更具体的内容。</div>
      </div>
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
  const missingFields = getMissingFieldIds(record.values);

  const issueMap = new Map<string, { fieldId: string; reason: string }>();
  for (const issue of record.issues) {
    const hasValue = record.values[issue.fieldId];
    if (hasValue !== "pending" && !hasFieldValue(hasValue)) {
      issueMap.set(issue.fieldId, issue);
    }
  }

  for (const fieldId of missingFields) {
    if (issueMap.has(fieldId)) {
      continue;
    }
    issueMap.set(fieldId, {
      fieldId,
      reason: record.values[fieldId] === "pending"
        ? "该字段仍待确认"
        : "该字段在当前结果中仍为空，需要用户确认",
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
