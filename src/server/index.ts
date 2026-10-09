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
  normalizeFieldValue,
} from "../shared/schema.js";

const rootDir = process.cwd();
const dataDir = path.join(rootDir, "data", "records");
const uploadsDir = path.join(rootDir, "data", "uploads");
const settingsPath = path.join(rootDir, "data", "llm-settings.json");
const clientDistDir = path.join(rootDir, "dist", "client");

const app = express();
const upload = multer({ storage: multer.memoryStorage() });

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

app.post("/api/parse", upload.single("file"), async (req, res) => {
  if (!req.file) {
    res.status(400).json({ message: "请先上传文件" });
    return;
  }

  try {
    const settings = await loadLlmSettings();
    const sourceFileName = normalizeUploadedFileName(req.file.originalname);
    const extractedText = await extractTextFromFile(req.file, settings);
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
    transcriptionModel:
      process.env.TRANSCRIPTION_MODEL ?? createDefaultLlmSettings().transcriptionModel,
  });

  if (!(await pathExists(settingsPath))) {
    return defaults;
  }

  const content = await fs.readFile(settingsPath, "utf-8");
  return normalizeLlmSettings({
    ...defaults,
    ...(JSON.parse(content) as Partial<LlmSettings>),
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
    transcriptionModel:
      String(input.transcriptionModel ?? defaults.transcriptionModel).trim() ||
      defaults.transcriptionModel,
    useLlmExtraction:
      typeof input.useLlmExtraction === "boolean"
        ? input.useLlmExtraction
        : defaults.useLlmExtraction,
  };
}

function createOpenAiClient(settings: LlmSettings) {
  if (!settings.apiKey) {
    return null;
  }

  return new OpenAI({
    apiKey: settings.apiKey,
    baseURL: settings.baseURL || undefined,
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

async function extractTextFromFile(
  file: Express.Multer.File,
  settings: LlmSettings,
): Promise<string> {
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

  if (isAudioFile(extension, file.mimetype)) {
    return transcribeAudio(file, settings);
  }

  throw new Error("当前仅支持录音、doc、docx、pdf 文件");
}

function isAudioFile(extension: string, mimeType: string) {
  const audioExtensions = new Set([".mp3", ".wav", ".m4a", ".aac", ".flac", ".ogg", ".webm"]);
  return audioExtensions.has(extension) || mimeType.startsWith("audio/");
}

async function transcribeAudio(
  file: Express.Multer.File,
  settings: LlmSettings,
): Promise<string> {
  const openai = createOpenAiClient(settings);
  if (!openai) {
    throw new Error("未配置 API Key，暂时无法转写录音文件");
  }

  const transcription = await openai.audio.transcriptions.create({
    file: await toFile(file.buffer, normalizeUploadedFileName(file.originalname), { type: file.mimetype }),
    model: settings.transcriptionModel,
  });

  return transcription.text.trim();
}

async function buildRecordFromText(input: {
  rawText: string;
  fileName: string;
  mimeType: string;
}, settings: LlmSettings): Promise<TemplateRecord> {
  const now = new Date().toISOString();
  const baseRecord = createEmptyRecord();
  const parsed =
    (await extractWithLlm(input.rawText, settings).catch((error) => {
      console.warn("LLM extraction failed, fallback to heuristic parser.", error);
      return null;
    })) ?? heuristicExtract(input.rawText, input.fileName);

  const values = createEmptyValues();
  const fieldExplanations = createEmptyFieldExplanations();
  for (const field of TEMPLATE_FIELDS) {
    values[field.id] = normalizeFieldValue(field, parsed.values[field.id]);
    fieldExplanations[field.id] = normalizeFieldExplanation(parsed.fieldExplanations?.[field.id]);
  }

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
      extractionMode: parsed.mode,
      extractedAt: now,
    },
    values,
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

  const openai = createOpenAiClient(settings);
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
          "你是一名供试品信息抽取助手。请根据原始材料提取模板字段，严格输出 JSON。不要猜测未出现的信息；缺失项放到 missingFields 并给出 issues。对于枚举字段，优先输出 schema 中 option 的 value。对每个已识别字段，尽量补充 fieldExplanations，包含原文依据 sourceText 和推理说明 reasoning。",
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

  const drugType = inferDrugType(text);
  if (drugType) {
    values["article.drugType"] = drugType;
    fieldExplanations["article.drugType"] = buildDrugTypeExplanation(text, drugType);
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
    if (!hasValue(values[fieldId])) {
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

function inferDrugType(text: string) {
  const normalized = text.toLowerCase();
  const lookup: Array<[string, string]> = [
    ["疫苗", "vaccine"],
    ["vaccine", "vaccine"],
    ["细胞治疗", "cell_therapy_immune_cell"],
    ["stem cell", "cell_therapy_stem_cell"],
    ["干细胞", "cell_therapy_stem_cell"],
    ["gene therapy", "gene_therapy"],
    ["基因治疗", "gene_therapy"],
    ["核酸", "nucleic_acid_medicines"],
    ["biological", "biological_product"],
    ["生物制品", "biological_product"],
    ["化药", "chemical_drug"],
    ["small molecule", "chemical_drug"],
    ["中药", "traditional_chinese_medicine"],
  ];

  const matched = lookup.find(([keyword]) => normalized.includes(keyword.toLowerCase()));
  return matched?.[1];
}

function normalizeRecord(input: TemplateRecord): TemplateRecord {
  const values = createEmptyValues();
  const fieldExplanations = createEmptyFieldExplanations();
  for (const field of TEMPLATE_FIELDS) {
    values[field.id] = normalizeFieldValue(field, input.values?.[field.id]);
    fieldExplanations[field.id] = normalizeFieldExplanation(input.fieldExplanations?.[field.id]);
  }

  const missingFields = getMissingFields(values);
  const issues = dedupeIssues([
    ...(input.issues ?? []),
    ...missingFields.map((fieldId) => ({
      fieldId,
      reason: "该字段仍需用户确认",
    })),
  ]);
  const now = new Date().toISOString();

  return {
    ...input,
    name: input.name?.trim() || "未命名解析",
    values,
    fieldExplanations,
    missingFields,
    issues,
    createdAt: input.createdAt || now,
    updatedAt: now,
    meta: {
      sourceFileName: normalizeUploadedFileName(input.meta?.sourceFileName ?? ""),
      sourceFileType: input.meta?.sourceFileType,
      extractionMode: input.meta?.extractionMode ?? "heuristic",
      extractedAt: input.meta?.extractedAt ?? now,
    },
  };
}

function getMissingFields(values: Record<string, string | string[]>) {
  return REQUIRED_FIELD_IDS.filter((fieldId) => !hasValue(values[fieldId]));
}

function hasValue(value: unknown) {
  if (Array.isArray(value)) {
    return value.length > 0;
  }
  return typeof value === "string" ? value.trim().length > 0 : false;
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
  const fieldExplanations = createEmptyFieldExplanations();
  for (const field of TEMPLATE_FIELDS) {
    fieldExplanations[field.id] = normalizeFieldExplanation(record.fieldExplanations?.[field.id]);
  }

  return {
    ...record,
    fieldExplanations,
    meta: {
      ...record.meta,
      sourceFileName: normalizeUploadedFileName(record.meta?.sourceFileName ?? ""),
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

function buildDrugTypeExplanation(text: string, drugType: string): FieldExplanation {
  const lookup: Array<[RegExp, string]> = [
    [/(疫苗|vaccine)/i, "命中“疫苗 / vaccine”关键词，映射为疫苗。"],
    [/(细胞治疗)/i, "命中“细胞治疗”关键词，默认映射为免疫细胞产品。"],
    [/(stem cell|干细胞)/i, "命中“stem cell / 干细胞”关键词，映射为干细胞产品。"],
    [/(gene therapy|基因治疗)/i, "命中“gene therapy / 基因治疗”关键词，映射为基因治疗。"],
    [/(核酸)/i, "命中“核酸”关键词，映射为核酸药物。"],
    [/(biological|生物制品)/i, "命中“biological / 生物制品”关键词，映射为生物制品。"],
    [/(化药|small molecule)/i, "命中“化药 / small molecule”关键词，映射为化药。"],
    [/(中药)/i, "命中“中药”关键词，映射为中药。"],
  ];

  const matched = lookup.find(([pattern]) => pattern.test(text));
  return {
    sourceText: matched ? firstLine(text, matched[0]) || matched[0].source : drugType,
    reasoning: matched?.[1] ?? "根据规则关键词映射药物类型。",
  };
}
