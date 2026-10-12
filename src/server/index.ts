import cors from "cors";
import dayjs from "dayjs";
import express from "express";
import multer from "multer";
import OpenAI from "openai";
import { toFile } from "openai/uploads";
import mammoth from "mammoth";
import pdfParse from "pdf-parse";
import WordExtractor from "word-extractor";
import fs from "node:fs/promises";
import path from "node:path";
import { convertToMp3, transcribeWithVolc } from "./volc-transcription.js";
import { transcribeWithSenseVoice } from "./sensevoice-transcription.js";
import { buildSimplificationMessages } from "./simplify-input.js";

import {
  FieldExplanation,
  LlmSettings,
  REQUIRED_FIELD_IDS,
  TEMPLATE_FIELDS,
  TemplateRecord,
  createDefaultLlmSettings,
  createEmptyFieldExplanations,
  createEmptyRecord,
  createEmptyValues,
  getMissingFieldIds,
  hasFieldValue,
  matchDrugSubtypes,
  normalizeFieldValue,
  normalizeLegacyDrugType,
} from "../shared/schema.js";

const rootDir = process.cwd();
const dataDir = path.join(rootDir, "data", "records");
const uploadsDir = path.join(rootDir, "data", "uploads");
const settingsPath = path.join(rootDir, "data", "llm-settings.json");
const clientDistDir = path.join(rootDir, "dist", "client");

const app = express();
const upload = multer({ storage: multer.memoryStorage() });
const audioUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 50 * 1024 * 1024 } });

app.use(cors());
app.use(express.json({ limit: "10mb" }));

app.get("/api/schema", (_req, res) => {
  res.json({
    fields: TEMPLATE_FIELDS,
    requiredFieldIds: REQUIRED_FIELD_IDS,
  });
});

app.get("/api/settings/llm", async (_req, res) => {
  const settings = await loadLlmSettings();
  res.json(settings);
});

app.put("/api/settings/llm", async (req, res) => {
  const settings = normalizeLlmSettings(req.body as Partial<LlmSettings>);
  await persistLlmSettings(settings);
  res.json(settings);
});

app.get("/api/records", async (_req, res) => {
  const records = await loadAllRecords();
  res.json(records);
});

app.get("/api/records/:id", async (req, res) => {
  const record = await readRecord(req.params.id);

  if (!record) {
    res.status(404).json({ message: "记录不存在" });
    return;
  }

  res.json(record);
});

app.post("/api/parse/document", upload.single("file"), async (req, res) => {
  if (!req.file) {
    res.status(400).json({ message: "请先上传文件" });
    return;
  }

  const sourceFileName = normalizeUploadedFileName(req.file.originalname);
  if (![".doc", ".docx", ".pdf"].includes(path.extname(sourceFileName).toLowerCase())) {
    res.status(400).json({ message: "文档仅支持 doc、docx、pdf 格式" });
    return;
  }

  try {
    const settings = await loadLlmSettings();
    const extractedText = await extractTextFromDocument(req.file);
    const record = await buildRecordFromText({
      rawText: extractedText,
      fileName: sourceFileName,
      mimeType: req.file.mimetype,
    }, settings);

    res.json(record);
  } catch (error) {
    console.error(error);
    res.status(500).json({
      message: error instanceof Error ? error.message : "解析失败，请稍后重试",
    });
  }
});

const acceptAudioUpload: express.RequestHandler = (req, res, next) => {
  audioUpload.single("file")(req, res, (error: unknown) => {
    if (error instanceof multer.MulterError && error.code === "LIMIT_FILE_SIZE") {
      res.status(413).json({ message: "录音文件不能超过 50 MB" });
      return;
    }
    if (error) return next(error);
    next();
  });
};

app.post("/api/convert/audio", acceptAudioUpload, async (req, res) => {
  if (!req.file) {
    res.status(400).json({ message: "请先上传录音文件" });
    return;
  }
  const fileName = normalizeUploadedFileName(req.file.originalname);
  if (![".m4a", ".mp3", ".wav"].includes(path.extname(fileName).toLowerCase())) {
    res.status(400).json({ message: "录音仅支持 m4a、mp3、wav 格式" });
    return;
  }
  try {
    const mp3 = await convertToMp3(req.file.buffer);
    res.type("audio/mpeg").send(mp3);
  } catch (error) {
    console.error("Audio conversion failed:", error);
    res.status(500).json({
      message: error instanceof Error ? error.message : "录音转码失败，请稍后重试",
    });
  }
});

app.post("/api/transcribe", acceptAudioUpload, async (req, res) => {
  if (!req.file) {
    res.status(400).json({ message: "请先上传录音文件" });
    return;
  }

  const fileName = normalizeUploadedFileName(req.file.originalname);
  if (![".m4a", ".mp3", ".wav"].includes(path.extname(fileName).toLowerCase())) {
    res.status(400).json({ message: "录音仅支持 m4a、mp3、wav 格式" });
    return;
  }

  try {
    const settings = await loadLlmSettings();
    if (settings.transcriptionProvider !== "sensevoice" && !settings.transcriptionApiKey) {
      res.status(400).json({ message: "请先配置语音转文字 API Key" });
      return;
    }
    const alreadyConverted = req.body?.converted === "true";
    if (alreadyConverted && (settings.transcriptionProvider !== "volc" || path.extname(fileName).toLowerCase() !== ".mp3")) {
      res.status(400).json({ message: "只有火山语音模式支持提交已转码的 mp3" });
      return;
    }
    const text = settings.transcriptionProvider === "volc"
      ? await transcribeWithVolc(req.file.buffer, settings, alreadyConverted)
      : settings.transcriptionProvider === "sensevoice"
        ? await transcribeWithSenseVoice(req.file.buffer, fileName)
        : await transcribeAudio(req.file, settings);
    res.json({ text, fileName, mimeType: req.file.mimetype });
  } catch (error) {
    console.error("Audio transcription failed:", error);
    res.status(500).json({
      message: error instanceof Error ? error.message : "录音转写失败，请稍后重试",
    });
  }
});

app.post("/api/parse/transcript", async (req, res) => {
  const { text, fileName, mimeType } = (req.body ?? {}) as {
    text?: unknown;
    fileName?: unknown;
    mimeType?: unknown;
  };
  if (typeof text !== "string" || !text.trim() || typeof fileName !== "string" || !fileName.trim()) {
    res.status(400).json({ message: "请先转写录音并确认文字内容" });
    return;
  }
  if (![".m4a", ".mp3", ".wav"].includes(path.extname(fileName).toLowerCase())) {
    res.status(400).json({ message: "转写文本必须来自 m4a、mp3、wav 录音" });
    return;
  }

  try {
    const settings = await loadLlmSettings();
    if (!settings.useLlmExtraction || !settings.apiKey) {
      res.status(400).json({ message: "录音表单提取需要启用大语言模型并配置字段抽取 API Key" });
      return;
    }
    const record = await buildRecordFromText({
      rawText: text.trim(),
      fileName: normalizeUploadedFileName(fileName),
      mimeType: typeof mimeType === "string" ? mimeType : "",
      transcript: text.trim(),
    }, settings, true);
    res.json(record);
  } catch (error) {
    console.error("Transcript extraction failed:", error);
    res.status(500).json({
      message: error instanceof Error ? error.message : "录音表单提取失败，请稍后重试",
    });
  }
});

app.post("/api/simplify/input", async (req, res) => {
  const input = req.body?.record as TemplateRecord | undefined;
  if (!input || !input.meta || typeof input.meta.transcript !== "string" ||
      !input.meta.transcript.trim() || input.meta.extractionMode !== "llm" ||
      ![".m4a", ".mp3", ".wav"].includes(path.extname(input.meta.sourceFileName ?? "").toLowerCase())) {
    res.status(400).json({ message: "请先从录音转写文字提取表单，再简化输入" });
    return;
  }

  try {
    const settings = await loadLlmSettings();
    const openai = createOpenAiClient(settings.apiKey, settings.baseURL);
    if (!openai || !settings.useLlmExtraction) {
      res.status(400).json({ message: "简化输入需要启用大语言模型并配置字段抽取 API Key" });
      return;
    }
    const record = normalizeRecord(input);
    const completion = await openai.chat.completions.create({
      model: settings.chatModel,
      response_format: { type: "json_object" },
      temperature: 0.1,
      messages: buildSimplificationMessages(record),
    });
    const content = completion.choices[0]?.message?.content;
    const parsed = content ? JSON.parse(content) as { simplifiedInput?: unknown } : {};
    if (typeof parsed.simplifiedInput !== "string" || !parsed.simplifiedInput.trim()) {
      throw new Error("模型未返回有效的简化内容");
    }
    res.json({ simplifiedInput: parsed.simplifiedInput.trim() });
  } catch (error) {
    console.error("Input simplification failed:", error);
    res.status(500).json({ message: error instanceof Error ? error.message : "简化输入失败，请稍后重试" });
  }
});

app.post("/api/records", async (req, res) => {
  const body = req.body as TemplateRecord;
  const normalized = normalizeRecord(body);
  await persistRecord(normalized);
  res.status(201).json(normalized);
});

app.put("/api/records/:id", async (req, res) => {
  const body = req.body as TemplateRecord;
  const normalized = normalizeRecord({
    ...body,
    id: req.params.id,
  });
  await persistRecord(normalized);
  res.json(normalized);
});

if ((await pathExists(clientDistDir)) === true) {
  app.use(express.static(clientDistDir));
  app.get("*", (_req, res) => {
    res.sendFile(path.join(clientDistDir, "index.html"));
  });
}

const port = Number(process.env.PORT ?? 3001);
await ensureDirectories();
app.listen(port, () => {
  console.log(`API server listening on http://localhost:${port}`);
});

async function ensureDirectories() {
  await fs.mkdir(dataDir, { recursive: true });
  await fs.mkdir(uploadsDir, { recursive: true });
}

async function loadLlmSettings(): Promise<LlmSettings> {
  const defaults = normalizeLlmSettings({
    ...createDefaultLlmSettings(),
    apiKey: process.env.OPENAI_API_KEY ?? "",
    baseURL: process.env.OPENAI_BASE_URL ?? "",
    chatModel: process.env.OPENAI_MODEL ?? createDefaultLlmSettings().chatModel,
    transcriptionApiKey: process.env.TRANSCRIPTION_API_KEY ?? "",
    transcriptionBaseURL:
      process.env.TRANSCRIPTION_BASE_URL ?? createDefaultLlmSettings().transcriptionBaseURL,
    transcriptionModel:
      process.env.TRANSCRIPTION_MODEL ?? createDefaultLlmSettings().transcriptionModel,
    transcriptionProvider: process.env.TRANSCRIPTION_PROVIDER === "volc" || process.env.TRANSCRIPTION_PROVIDER === "sensevoice"
      ? process.env.TRANSCRIPTION_PROVIDER : "openai",
    volcResourceId: process.env.VOLC_RESOURCE_ID ?? createDefaultLlmSettings().volcResourceId,
    tosAccessKeyId: process.env.TOS_ACCESS_KEY_ID ?? "",
    tosAccessKeySecret: process.env.TOS_ACCESS_KEY_SECRET ?? "",
    tosRegion: process.env.TOS_REGION ?? "",
    tosEndpoint: process.env.TOS_ENDPOINT ?? "",
    tosBucket: process.env.TOS_BUCKET ?? "",
  });

  if (!(await pathExists(settingsPath))) {
    return defaults;
  }

  const content = await fs.readFile(settingsPath, "utf-8");
    const saved = JSON.parse(content) as Partial<LlmSettings>;
    return normalizeLlmSettings({
    ...defaults,
      ...saved,
      // Legacy settings shared the text provider; require an explicit speech setup.
      transcriptionModel:
        saved.transcriptionApiKey === undefined && saved.transcriptionBaseURL === undefined
          ? defaults.transcriptionModel
          : saved.transcriptionModel ?? defaults.transcriptionModel,
  });
}

async function persistLlmSettings(settings: LlmSettings) {
  await ensureDirectories();
  await fs.writeFile(settingsPath, JSON.stringify(settings, null, 2), "utf-8");
}

function normalizeLlmSettings(input: Partial<LlmSettings>): LlmSettings {
  const defaults = createDefaultLlmSettings();

  return {
    apiKey: String(input.apiKey ?? defaults.apiKey).trim(),
    baseURL: String(input.baseURL ?? defaults.baseURL).trim(),
    chatModel: String(input.chatModel ?? defaults.chatModel).trim() || defaults.chatModel,
    transcriptionProvider: input.transcriptionProvider === "volc" || input.transcriptionProvider === "sensevoice"
      ? input.transcriptionProvider : "openai",
    transcriptionApiKey: String(input.transcriptionApiKey ?? defaults.transcriptionApiKey).trim(),
    transcriptionBaseURL:
      String(input.transcriptionBaseURL ?? defaults.transcriptionBaseURL).trim() ||
      defaults.transcriptionBaseURL,
    transcriptionModel:
      String(input.transcriptionModel ?? defaults.transcriptionModel).trim() ||
      defaults.transcriptionModel,
    volcResourceId: String(input.volcResourceId ?? defaults.volcResourceId).trim() || defaults.volcResourceId,
    tosAccessKeyId: String(input.tosAccessKeyId ?? defaults.tosAccessKeyId).trim(),
    tosAccessKeySecret: String(input.tosAccessKeySecret ?? defaults.tosAccessKeySecret).trim(),
    tosRegion: String(input.tosRegion ?? defaults.tosRegion).trim(),
    tosEndpoint: String(input.tosEndpoint ?? defaults.tosEndpoint).trim(),
    tosBucket: String(input.tosBucket ?? defaults.tosBucket).trim(),
    useLlmExtraction:
      typeof input.useLlmExtraction === "boolean"
        ? input.useLlmExtraction
        : defaults.useLlmExtraction,
  };
}

function createOpenAiClient(apiKey: string, baseURL: string) {
  if (!apiKey) {
    return null;
  }

  return new OpenAI({
    apiKey,
    baseURL: baseURL || undefined,
  });
}

async function loadAllRecords(): Promise<TemplateRecord[]> {
  await ensureDirectories();
  const files = await fs.readdir(dataDir);
  const jsonFiles = files.filter((file) => file.endsWith(".json") && !path.basename(file).startsWith("._"));
  const loadedRecords = await Promise.all(
    jsonFiles.map(async (file) => {
      const fullPath = path.join(dataDir, file);

      try {
        const content = await fs.readFile(fullPath, "utf-8");
        return normalizeRecordMetadata(JSON.parse(content) as TemplateRecord);
      } catch (error) {
        console.warn(`Skip invalid record file: ${file}`, error);
        return null;
      }
    }),
  );
  const records = loadedRecords.filter((record): record is TemplateRecord => record !== null);

  return records.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

async function readRecord(id: string): Promise<TemplateRecord | null> {
  const fullPath = path.join(dataDir, `${id}.json`);
  if (!(await pathExists(fullPath))) {
    return null;
  }

  const content = await fs.readFile(fullPath, "utf-8");
  return normalizeRecordMetadata(JSON.parse(content) as TemplateRecord);
}

async function persistRecord(record: TemplateRecord) {
  await ensureDirectories();
  const fullPath = path.join(dataDir, `${record.id}.json`);
  await fs.writeFile(fullPath, JSON.stringify(record, null, 2), "utf-8");
}

async function pathExists(targetPath: string) {
  try {
    await fs.access(targetPath);
    return true;
  } catch {
    return false;
  }
}

async function extractTextFromDocument(file: Express.Multer.File): Promise<string> {
  const sourceFileName = normalizeUploadedFileName(file.originalname);
  const extension = path.extname(sourceFileName).toLowerCase();

  if (extension === ".pdf") {
    const result = await pdfParse(file.buffer);
    return result.text.trim();
  }

  if (extension === ".docx") {
    const result = await mammoth.extractRawText({ buffer: file.buffer });
    return result.value.trim();
  }

  if (extension === ".doc") {
    const tmpPath = path.join(
      uploadsDir,
      `${Date.now()}-${sanitizeFileName(sourceFileName)}`,
    );
    await fs.writeFile(tmpPath, file.buffer);
    try {
      const extractor = new WordExtractor();
      const document = await extractor.extract(tmpPath);
      return document.getBody().trim();
    } finally {
      await fs.rm(tmpPath, { force: true });
    }
  }

  throw new Error("当前仅支持 doc、docx、pdf 文件");
}

async function transcribeAudio(
  file: Express.Multer.File,
  settings: LlmSettings,
): Promise<string> {
  const openai = createOpenAiClient(settings.transcriptionApiKey, settings.transcriptionBaseURL);
  if (!openai) {
    throw new Error("请先配置语音转文字 API Key");
  }

  let transcription;
  try {
    transcription = await openai.audio.transcriptions.create({
      file: await toFile(file.buffer, normalizeUploadedFileName(file.originalname), {
        type: file.mimetype || "application/octet-stream",
      }),
      model: settings.transcriptionModel,
    });
  } catch (error) {
    const status = error instanceof OpenAI.APIError ? `（HTTP ${error.status}）` : "";
    throw new Error(`语音转文字服务调用失败${status}，请检查转写 API 地址、模型和密钥`);
  }

  if (!transcription.text?.trim()) {
    throw new Error("语音转文字服务未返回文字内容");
  }
  return transcription.text.trim();
}

async function buildRecordFromText(input: {
  rawText: string;
  fileName: string;
  mimeType: string;
  transcript?: string;
}, settings: LlmSettings, requireLlm = false): Promise<TemplateRecord> {
  const now = new Date().toISOString();
  const baseRecord = createEmptyRecord();
  const parsed = requireLlm
    ? await extractWithLlm(input.rawText, settings).catch((error) => {
        console.error("Transcript LLM extraction failed:", error);
        throw new Error("大语言模型提取表单失败，请检查字段抽取模型及接口配置");
      })
    : (await extractWithLlm(input.rawText, settings).catch((error) => {
        console.warn("LLM extraction failed, fallback to heuristic parser.", error);
        return null;
      })) ?? heuristicExtract(input.rawText, input.fileName);

  const values = createEmptyValues();
  const fieldExplanations = createEmptyFieldExplanations();
  for (const field of TEMPLATE_FIELDS) {
    values[field.id] = normalizeFieldValue(field, parsed.values[field.id]);
    fieldExplanations[field.id] = normalizeFieldExplanation(parsed.fieldExplanations?.[field.id]);
  }
  const rawDrugType = parsed.values["article.drugType"];
  const legacyDrugType = typeof rawDrugType === "string" && !hasFieldValue(values["article.drugType"])
    ? rawDrugType.trim()
    : undefined;

  const missingFields = getMissingFields(values);
  const issues = dedupeIssues([
    ...parsed.issues,
    ...missingFields.map((fieldId) => ({
      fieldId,
      reason: "原始材料中未能可靠识别该字段，需要用户确认",
    })),
  ]);

  return normalizeRecord({
    ...baseRecord,
    id: `record-${Date.now()}`,
    name: deriveRecordName(input.fileName, values),
    meta: {
      sourceFileName: input.fileName,
      sourceFileType: input.mimeType,
        transcript: input.transcript,
      extractionMode: parsed.mode,
      extractedAt: now,
    },
    values,
    legacyDrugType,
    fieldExplanations,
    missingFields,
    issues,
    createdAt: now,
    updatedAt: now,
  });
}

async function extractWithLlm(rawText: string, settings: LlmSettings): Promise<{
  mode: "llm";
  values: Record<string, unknown>;
  fieldExplanations: Record<string, FieldExplanation>;
  issues: { fieldId: string; reason: string }[];
}> {
  if (!settings.useLlmExtraction) {
    throw new Error("LLM extraction disabled");
  }

  const openai = createOpenAiClient(settings.apiKey, settings.baseURL);
  if (!openai) {
    throw new Error("LLM not configured");
  }

  const schemaForPrompt = TEMPLATE_FIELDS.map((field) => ({
    id: field.id,
    label: field.label,
    section: field.section,
    type: field.type,
    required: Boolean(field.required),
    options: field.options ?? [],
  }));

  const completion = await openai.chat.completions.create({
    model: settings.chatModel,
    response_format: { type: "json_object" },
    temperature: 0.2,
    messages: [
      {
        role: "system",
        content:
          "你是一名供试品信息抽取助手。请根据原始材料提取模板字段，严格输出 JSON。不要猜测未出现的信息；缺失项放到 missingFields 并给出 issues。对于枚举字段，优先输出 schema 中 option 的 value。药物类型可跨大类多选，但 article.drugType 只能输出有明确依据的具体子类编码数组，不能根据大类推测子类。对每个已识别字段，尽量补充 fieldExplanations，包含原文依据 sourceText 和推理说明 reasoning。",
      },
      {
        role: "user",
        content: JSON.stringify(
          {
            task: "从原始文件文本中抽取供试品信息表字段",
            outputShape: {
              values: { "<fieldId>": "string | string[]" },
              fieldExplanations: {
                "<fieldId>": {
                  sourceText: "string",
                  reasoning: "string",
                },
              },
              missingFields: ["fieldId"],
              issues: [{ fieldId: "fieldId", reason: "string" }],
            },
            schema: schemaForPrompt,
            rawText,
          },
          null,
          2,
        ),
      },
    ],
  });

  const content = completion.choices[0]?.message?.content;
  if (!content) {
    throw new Error("LLM 未返回有效内容");
  }

  const parsed = JSON.parse(content) as {
    values?: Record<string, unknown>;
    fieldExplanations?: Record<string, Partial<FieldExplanation>>;
    missingFields?: string[];
    issues?: { fieldId: string; reason: string }[];
  };

  const values = parsed.values ?? {};
  const fieldExplanations = createEmptyFieldExplanations();
  for (const field of TEMPLATE_FIELDS) {
    fieldExplanations[field.id] = normalizeFieldExplanation(parsed.fieldExplanations?.[field.id]);
  }
  const llmIssues = parsed.issues ?? [];
  const hintedMissing = new Set(parsed.missingFields ?? []);

  for (const fieldId of hintedMissing) {
    llmIssues.push({
      fieldId,
      reason: "大模型未从原始材料中找到该字段的可靠依据",
    });
    if (!fieldExplanations[fieldId]?.reasoning) {
      fieldExplanations[fieldId] = {
        sourceText: fieldExplanations[fieldId]?.sourceText ?? "",
        reasoning: "原文中未找到足够明确的依据，因此保留为空，等待人工确认。",
      };
    }
  }

  return {
    mode: "llm",
    values,
    fieldExplanations,
    issues: dedupeIssues(llmIssues),
  };
}

function heuristicExtract(rawText: string, fileName: string) {
  const text = rawText.replace(/\r/g, "");
  const values: Record<string, unknown> = {};
  const fieldExplanations = createEmptyFieldExplanations();
  const issues: { fieldId: string; reason: string }[] = [];

  values["article.nameOrCode"] = stripExtension(fileName);
  fieldExplanations["article.nameOrCode"] = {
    sourceText: fileName,
    reasoning: "规则抽取未识别到更明确的供试品名称时，先使用上传文件名作为默认名称/代码。",
  };
  values["client.email"] = firstMatch(text, /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
  if (values["client.email"]) {
    fieldExplanations["client.email"] = {
      sourceText: String(values["client.email"]),
      reasoning: "通过邮箱正则匹配提取联系人邮箱。",
    };
  }
  values["client.phoneNumber"] = firstMatch(text, /1[3-9]\d{9}/);
  if (values["client.phoneNumber"]) {
    fieldExplanations["client.phoneNumber"] = {
      sourceText: String(values["client.phoneNumber"]),
      reasoning: "通过手机号正则匹配提取联系人手机号。",
    };
  }

  const companyLine = firstLine(text, /(公司|药业|制药|生物|医药|集团|研究院|研究所|医院|大学)/);
  if (companyLine) {
    values["client.companyName"] = companyLine;
    fieldExplanations["client.companyName"] = {
      sourceText: companyLine,
      reasoning: "命中机构关键词的整行文本，作为单位名称候选。",
    };
  }

  const contactLine = firstLine(text, /(联系人|contact|负责人)/i);
  if (contactLine) {
    values["client.contactName"] = contactLine.replace(/.*[:：]/, "").trim();
    fieldExplanations["client.contactName"] = {
      sourceText: contactLine,
      reasoning: "从包含“联系人 / contact / 负责人”的行中截取冒号后的姓名。",
    };
  }

  const speciesMatches = collectOptionMatches("article.keyInfo.animalSpecies", text);
  if (speciesMatches.length > 0) {
    values["article.keyInfo.animalSpecies"] = speciesMatches;
    fieldExplanations["article.keyInfo.animalSpecies"] = buildOptionMatchExplanation(
      "article.keyInfo.animalSpecies",
      speciesMatches,
      text,
      "根据原文中出现的动物种属关键词，映射为模板枚举值。",
    );
  }

  const methodMatches = collectOptionMatches("article.keyInfo.bioAnalyticalMethods", text);
  if (methodMatches.length > 0) {
    values["article.keyInfo.bioAnalyticalMethods"] = methodMatches;
    fieldExplanations["article.keyInfo.bioAnalyticalMethods"] = buildOptionMatchExplanation(
      "article.keyInfo.bioAnalyticalMethods",
      methodMatches,
      text,
      "根据原文中出现的生物分析方法关键词，映射为模板枚举值。",
    );
  }

  const routeMatches = collectOptionMatches("article.clinicalUse.route", text);
  if (routeMatches.length > 0) {
    values["article.clinicalUse.route"] = routeMatches;
    fieldExplanations["article.clinicalUse.route"] = buildOptionMatchExplanation(
      "article.clinicalUse.route",
      routeMatches,
      text,
      "根据原文中的给药途径关键词，映射为模板枚举值。",
    );
  }

  const frequencyMatches = collectOptionMatches("article.clinicalUse.frequency", text);
  if (frequencyMatches.length > 0) {
    values["article.clinicalUse.frequency"] = frequencyMatches;
    fieldExplanations["article.clinicalUse.frequency"] = buildOptionMatchExplanation(
      "article.clinicalUse.frequency",
      frequencyMatches,
      text,
      "根据原文中的用药频率关键词，映射为模板枚举值。",
    );
  }

  const cycleMatches = collectOptionMatches("article.clinicalUse.cycle", text);
  if (cycleMatches.length > 0) {
    values["article.clinicalUse.cycle"] = cycleMatches;
    fieldExplanations["article.clinicalUse.cycle"] = buildOptionMatchExplanation(
      "article.clinicalUse.cycle",
      cycleMatches,
      text,
      "根据原文中的治疗周期关键词，映射为模板枚举值。",
    );
  }

  const drugSubtypes = matchDrugSubtypes(text);
  if (drugSubtypes.length > 0) {
    values["article.drugType"] = drugSubtypes;
    fieldExplanations["article.drugType"] = {
      sourceText: text.split("\n")
        .filter((line) => matchDrugSubtypes(line).some((value) => drugSubtypes.includes(value)))
        .slice(0, 6).join("\n").slice(0, 1000),
      reasoning: "仅提取原文中明确出现的药物子类，不依据大类猜测子类。",
    };
  }

  const declarationTypes = collectOptionMatches("article.declarationType", text);
  if (declarationTypes.length > 0) {
    values["article.declarationType"] = declarationTypes;
    fieldExplanations["article.declarationType"] = buildOptionMatchExplanation(
      "article.declarationType",
      declarationTypes,
      text,
      "根据原文中的申报类别关键词，映射为模板枚举值。",
    );
  }

  const requirements = collectOptionMatches("article.additionalRequirements", text);
  if (requirements.length > 0) {
    values["article.additionalRequirements"] = requirements;
    fieldExplanations["article.additionalRequirements"] = buildOptionMatchExplanation(
      "article.additionalRequirements",
      requirements,
      text,
      "根据原文中的附加要求关键词，映射为模板枚举值。",
    );
  }

  const generalContent = collectOptionMatches("article.generalCommissioningContent", text);
  if (generalContent.length > 0) {
    values["article.generalCommissioningContent"] = generalContent;
    fieldExplanations["article.generalCommissioningContent"] = buildOptionMatchExplanation(
      "article.generalCommissioningContent",
      generalContent,
      text,
      "根据原文中的委托内容关键词，映射为模板枚举值。",
    );
  }

  const reportingAuthorities = collectOptionMatches("article.reportingAuthority", text);
  if (reportingAuthorities.length > 0) {
    values["article.reportingAuthority"] = reportingAuthorities;
    fieldExplanations["article.reportingAuthority"] = buildOptionMatchExplanation(
      "article.reportingAuthority",
      reportingAuthorities,
      text,
      "根据原文中的申报机构关键词，映射为模板枚举值。",
    );
  }

  if (/肿瘤|oncology|tumor/i.test(text)) {
    values["article.indications.isAntiTumor"] = "yes";
    fieldExplanations["article.indications.isAntiTumor"] = {
      sourceText: firstLine(text, /(肿瘤|oncology|tumor)/i) || "肿瘤 / oncology / tumor",
      reasoning: "命中肿瘤相关关键词，规则判断为抗肿瘤药物。",
    };
  }

  const dateMatches = text.match(/\d{4}[-/.年]\d{1,2}[-/.月]\d{1,2}日?/g) ?? [];
  if (dateMatches[0]) {
    values["handover.projectStartDate"] = normalizeDate(dateMatches[0]);
    fieldExplanations["handover.projectStartDate"] = {
      sourceText: dateMatches[0],
      reasoning: "取原文中首个日期并标准化为 YYYY-MM-DD，作为项目启动日期候选。",
    };
  }

  for (const fieldId of REQUIRED_FIELD_IDS) {
    if (!hasFieldValue(values[fieldId])) {
      issues.push({
        fieldId,
        reason: "兜底规则未能识别，建议人工确认",
      });
      if (!fieldExplanations[fieldId]?.reasoning) {
        fieldExplanations[fieldId] = {
          sourceText: "",
          reasoning: "当前规则未在原文中找到足够明确的匹配依据，需人工确认。",
        };
      }
    }
  }

  return {
    mode: "heuristic" as const,
    values,
    fieldExplanations,
    issues,
  };
}

function collectOptionMatches(fieldId: string, text: string) {
  const field = TEMPLATE_FIELDS.find((item) => item.id === fieldId);
  if (!field?.options) {
    return [];
  }

  return field.options
    .filter((option) => {
      if (option.value === "other") {
        return false;
      }

      const normalizedLabel = option.label.replace(/[（）()_\s-]/g, "");
      const escaped = escapeRegExp(normalizedLabel);
      return new RegExp(escaped, "i").test(text.replace(/[（）()_\s-]/g, ""));
    })
    .map((option) => option.value);
}

function normalizeRecord(input: TemplateRecord): TemplateRecord {
  const compatible = normalizeLegacyDrugType(input);
  const values = createEmptyValues();
  const fieldExplanations = createEmptyFieldExplanations();
  for (const field of TEMPLATE_FIELDS) {
    values[field.id] = normalizeFieldValue(field, compatible.values?.[field.id]);
    fieldExplanations[field.id] = normalizeFieldExplanation(compatible.fieldExplanations?.[field.id]);
  }

  const missingFields = getMissingFields(values);
  const issues = dedupeIssues([
    ...(compatible.issues ?? []).filter((issue) => !hasFieldValue(values[issue.fieldId])),
    ...missingFields.map((fieldId) => ({
      fieldId,
      reason: values[fieldId] === "pending" ? "该字段仍待确认" : "该字段仍需用户确认",
    })),
  ]);
  const now = new Date().toISOString();

  return {
    ...compatible,
    name: input.name?.trim() || "未命名解析",
    simplifiedInput: typeof input.simplifiedInput === "string" ? input.simplifiedInput.trim() : undefined,
    values,
    fieldExplanations,
    missingFields,
    issues,
    createdAt: input.createdAt || now,
    updatedAt: now,
    meta: {
      sourceFileName: normalizeUploadedFileName(input.meta?.sourceFileName ?? ""),
      sourceFileType: input.meta?.sourceFileType,
        transcript: input.meta?.transcript,
      extractionMode: input.meta?.extractionMode ?? "heuristic",
      extractedAt: input.meta?.extractedAt ?? now,
    },
  };
}

function getMissingFields(values: Record<string, string | string[]>) {
  return getMissingFieldIds(values);
}

function dedupeIssues(issues: Array<{ fieldId: string; reason: string }>) {
  const seen = new Set<string>();
  return issues.filter((issue) => {
    const key = issue.fieldId;
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

function deriveRecordName(fileName: string, values: Record<string, string | string[]>) {
  const articleName = values["article.nameOrCode"];
  if (typeof articleName === "string" && articleName.trim()) {
    return articleName.trim();
  }

  return stripExtension(fileName);
}

function sanitizeFileName(fileName: string) {
  return fileName.replace(/[^a-zA-Z0-9._-]/g, "_");
}

function normalizeUploadedFileName(fileName: string) {
  if (!fileName || !looksLikeMojibake(fileName)) {
    return fileName;
  }

  const decoded = Buffer.from(fileName, "latin1").toString("utf8");
  if (decoded.includes("�")) {
    return fileName;
  }

  return isBetterDecodedFileName(fileName, decoded) ? decoded : fileName;
}

function normalizeRecordMetadata(record: TemplateRecord): TemplateRecord {
  const compatible = normalizeLegacyDrugType(record);
  const values = createEmptyValues();
  const fieldExplanations = createEmptyFieldExplanations();
  for (const field of TEMPLATE_FIELDS) {
    values[field.id] = normalizeFieldValue(field, compatible.values?.[field.id]);
    fieldExplanations[field.id] = normalizeFieldExplanation(compatible.fieldExplanations?.[field.id]);
  }

  return {
    ...compatible,
    values,
    missingFields: getMissingFields(values),
    issues: (compatible.issues ?? []).filter((issue) => !hasFieldValue(values[issue.fieldId])),
    fieldExplanations,
    meta: {
      ...compatible.meta,
      sourceFileName: normalizeUploadedFileName(compatible.meta?.sourceFileName ?? ""),
    },
  };
}

function normalizeFieldExplanation(
  explanation: Partial<FieldExplanation> | undefined,
): FieldExplanation {
  return {
    sourceText: String(explanation?.sourceText ?? "").trim(),
    reasoning: String(explanation?.reasoning ?? "").trim(),
  };
}

function looksLikeMojibake(value: string) {
  return /[À-ÿ]/.test(value);
}

function isBetterDecodedFileName(original: string, decoded: string) {
  return countCjkChars(decoded) > countCjkChars(original) || countLatin1Noise(decoded) < countLatin1Noise(original);
}

function countCjkChars(value: string) {
  return (value.match(/[\u3400-\u9fff]/g) ?? []).length;
}

function countLatin1Noise(value: string) {
  return (value.match(/[À-ÿ]/g) ?? []).length;
}

function stripExtension(fileName: string) {
  return fileName.replace(/\.[^.]+$/, "");
}

function firstMatch(text: string, pattern: RegExp) {
  return text.match(pattern)?.[0]?.trim() ?? "";
}

function firstLine(text: string, pattern: RegExp) {
  return text
    .split("\n")
    .map((line) => line.trim())
    .find((line) => pattern.test(line))
    ?.trim() ?? "";
}

function normalizeDate(rawDate: string) {
  const cleaned = rawDate.replace(/[年/.]/g, "-").replace(/[月]/g, "-").replace(/[日]/g, "");
  const parsed = dayjs(cleaned);
  return parsed.isValid() ? parsed.format("YYYY-MM-DD") : "";
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function buildOptionMatchExplanation(
  fieldId: string,
  values: string[],
  text: string,
  reasoning: string,
): FieldExplanation {
  const field = TEMPLATE_FIELDS.find((item) => item.id === fieldId);
  const matchedLabels = (field?.options ?? [])
    .filter((option) => values.includes(option.value))
    .map((option) => option.label);

  return {
    sourceText: matchedLabels
      .map((label) => firstLine(text, new RegExp(escapeRegExp(label), "i")) || label)
      .join("；"),
    reasoning,
  };
}
