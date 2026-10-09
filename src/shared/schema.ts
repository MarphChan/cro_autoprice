export type FieldType =
  | "text"
  | "textarea"
  | "select"
  | "multiselect"
  | "date"
  | "email"
  | "phone"
  | "number";

export interface FieldOption {
  label: string;
  value: string;
}

export interface TemplateField {
  id: string;
  section: string;
  label: string;
  type: FieldType;
  required?: boolean;
  options?: FieldOption[];
  placeholder?: string;
  helpText?: string;
}

export interface ParseIssue {
  fieldId: string;
  reason: string;
}

export interface FieldExplanation {
  sourceText: string;
  reasoning: string;
}

export interface ParseMeta {
  sourceFileName?: string;
  sourceFileType?: string;
  extractionMode: "llm" | "heuristic";
  extractedAt: string;
}

export interface TemplateRecord {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  meta: ParseMeta;
  values: Record<string, string | string[]>;
  fieldExplanations: Record<string, FieldExplanation>;
  missingFields: string[];
  issues: ParseIssue[];
}

export interface LlmSettings {
  apiKey: string;
  baseURL: string;
  chatModel: string;
  transcriptionModel: string;
  useLlmExtraction: boolean;
}

export function createDefaultLlmSettings(): LlmSettings {
  return {
    apiKey: "",
    baseURL: "",
    chatModel: "gpt-4.1-mini",
    transcriptionModel: "gpt-4o-mini-transcribe",
    useLlmExtraction: true,
  };
}

const yesNoOptions: FieldOption[] = [
  { label: "是", value: "yes" },
  { label: "否", value: "no" },
];

const selectOneOptions: FieldOption[] = [
  { label: "是", value: "yes" },
  { label: "否", value: "no" },
  { label: "待确认", value: "pending" },
];

export const TEMPLATE_FIELDS: TemplateField[] = [
  { id: "client.companyName", section: "一、委托方信息", label: "单位名称", type: "text", required: true },
  { id: "client.contactName", section: "一、委托方信息", label: "联系人姓名", type: "text", required: true },
  { id: "client.jobTitle", section: "一、委托方信息", label: "职位", type: "text" },
  { id: "client.phoneNumber", section: "一、委托方信息", label: "手机号", type: "phone" },
  { id: "client.email", section: "一、委托方信息", label: "邮箱", type: "email" },
  { id: "client.address", section: "一、委托方信息", label: "地址", type: "textarea" },

  { id: "article.nameOrCode", section: "二、供试品信息", label: "供试品名称/代码", type: "text", required: true },
  {
    id: "article.drugType",
    section: "二、供试品信息",
    label: "药物类型",
    type: "select",
    required: true,
    options: [
      { label: "中药", value: "traditional_chinese_medicine" },
      { label: "化药", value: "chemical_drug" },
      { label: "疫苗", value: "vaccine" },
      { label: "生物制品", value: "biological_product" },
      { label: "细胞治疗_免疫细胞产品", value: "cell_therapy_immune_cell" },
      { label: "细胞治疗_干细胞产品", value: "cell_therapy_stem_cell" },
      { label: "基因治疗", value: "gene_therapy" },
      { label: "核酸药物", value: "nucleic_acid_medicines" },
      { label: "放射性药物", value: "radiopharmaceuticals" },
    ],
  },
  {
    id: "article.reportingAuthority",
    section: "二、供试品信息",
    label: "申报机构",
    type: "multiselect",
    required: true,
    options: [
      { label: "NMPA", value: "nmpa" },
      { label: "NMPA&FDA", value: "nmpa_fda" },
      { label: "FDA", value: "fda" },
      { label: "non GLP", value: "non_glp" },
      { label: "NMPA&FDA&OECD", value: "nmpa_fda_oecd" },
      { label: "OECD", value: "oecd" },
      { label: "FDA&OECD", value: "fda_oecd" },
      { label: "IIT", value: "iit" },
    ],
  },
  { id: "article.reportingAuthorityMemo", section: "二、供试品信息", label: "申报机构备注", type: "textarea" },
  {
    id: "article.additionalRequirements",
    section: "二、供试品信息",
    label: "其他要求",
    type: "multiselect",
    required: true,
    options: [
      { label: "SEND数据集", value: "send_dataset" },
      { label: "翻译（中文->英文）", value: "translation_cn_to_en" },
      { label: "翻译（英文->中文）", value: "translation_en_to_cn" },
      { label: "同行评议-国内病理学家资质", value: "peer_review_domestic_pathologist" },
      { label: "同行评议-日本病理学家资质", value: "peer_review_japanese_pathologist" },
      { label: "同行评议-其他", value: "peer_review_other" },
      { label: "其他要求", value: "other_request" },
    ],
  },
  { id: "article.additionalRequirementsMemo", section: "二、供试品信息", label: "其他要求备注", type: "textarea" },
  {
    id: "article.declarationType",
    section: "二、供试品信息",
    label: "申报类别",
    type: "multiselect",
    required: true,
    options: [
      { label: "IND", value: "ind" },
      { label: "NDA", value: "nda" },
      { label: "IND+NDA", value: "ind_nda" },
      { label: "研究者发起临床", value: "iit" },
      { label: "其他", value: "other" },
    ],
  },
  { id: "article.declarationTypeMemo", section: "二、供试品信息", label: "申报类别备注", type: "textarea" },
  { id: "article.indications.diseaseType", section: "二、供试品信息", label: "疾病类型", type: "text", required: true },
  {
    id: "article.indications.isAntiTumor",
    section: "二、供试品信息",
    label: "是否抗肿瘤药物",
    type: "select",
    options: selectOneOptions,
    required: true,
  },
  { id: "article.indications.memo", section: "二、供试品信息", label: "适应症备注", type: "textarea" },
  { id: "article.indications.target", section: "二、供试品信息", label: "靶点", type: "text" },
  {
    id: "article.keyInfo.animalSpecies",
    section: "二、供试品信息",
    label: "拟定动物种属",
    type: "multiselect",
    required: true,
    options: [
      { label: "大鼠", value: "rats" },
      { label: "小鼠", value: "mouse" },
      { label: "豚鼠", value: "guinea_pig" },
      { label: "犬", value: "dog" },
      { label: "兔", value: "rabbit" },
      { label: "猴", value: "monkey" },
      { label: "猪", value: "pig" },
      { label: "人源化小鼠", value: "humanized_mouse" },
      { label: "N/A", value: "not_applicable" },
    ],
  },
  { id: "article.keyInfo.animalSpeciesMemo", section: "二、供试品信息", label: "动物种属备注", type: "textarea" },
  {
    id: "article.keyInfo.bioAnalyticalMethods",
    section: "二、供试品信息",
    label: "拟定生物分析方法",
    type: "multiselect",
    options: [
      { label: "LC-MS", value: "lc_ms" },
      { label: "ELISA", value: "elisa" },
      { label: "MSD", value: "msd" },
      { label: "活性法", value: "biological_activities" },
      { label: "空斑法", value: "plaque_assay" },
      { label: "PCR", value: "pcr" },
      { label: "qPCR法", value: "qpcr" },
      { label: "ddPCR法", value: "ddpcr" },
      { label: "流式", value: "flow_cytometry" },
      { label: "其他", value: "other" },
    ],
  },
  { id: "article.keyInfo.bioAnalyticalMethodsMemo", section: "二、供试品信息", label: "生物分析方法备注", type: "textarea" },
  { id: "article.keyInfo.analyteCount", section: "二、供试品信息", label: "目标待测物数量", type: "number" },
  { id: "article.keyInfo.analyteCountMemo", section: "二、供试品信息", label: "待测物数量备注", type: "textarea" },
  {
    id: "article.clinicalUse.route",
    section: "二、供试品信息",
    label: "临床用法-途径",
    type: "multiselect",
    required: true,
    options: [
      { label: "口服", value: "oral" },
      { label: "静脉输注", value: "intravenous_infusion" },
      { label: "静脉滴注", value: "intravenous_drip" },
      { label: "皮下注射", value: "subcutaneous" },
      { label: "肌肉注射", value: "intramuscular" },
      { label: "颅内注射", value: "intracranial" },
      { label: "关节腔注射", value: "articular_cavity" },
      { label: "心肌注射", value: "myocardial" },
      { label: "脾内注射", value: "intrasplenic" },
      { label: "瘤内注射", value: "intratumoral" },
      { label: "视网膜下注射", value: "subretinal" },
      { label: "蛛网膜下腔", value: "subarachnoid" },
      { label: "玻璃体注射", value: "vitreous" },
      { label: "其他", value: "other" },
    ],
  },
  { id: "article.clinicalUse.routeMemo", section: "二、供试品信息", label: "临床用法-途径备注", type: "textarea" },
  {
    id: "article.clinicalUse.frequency",
    section: "二、供试品信息",
    label: "临床用法-频率",
    type: "multiselect",
    options: [
      { label: "每天1次", value: "once_per_day" },
      { label: "每周1次", value: "once_per_week" },
      { label: "每月1次", value: "once_per_month" },
      { label: "其他", value: "other" },
    ],
  },
  { id: "article.clinicalUse.frequencyMemo", section: "二、供试品信息", label: "临床用法-频率备注", type: "textarea" },
  {
    id: "article.clinicalUse.cycle",
    section: "二、供试品信息",
    label: "临床用法-周期",
    type: "multiselect",
    options: [
      { label: "≤2周", value: "under_2_weeks" },
      { label: "2周~1个月", value: "2_weeks_to_1_month" },
      { label: "1个月~3个月", value: "1_to_3_months" },
      { label: "＞3个月", value: "more_than_3_months" },
      { label: "2周~6个月", value: "2_weeks_to_6_months" },
      { label: "＞6个月", value: "more_than_6_months" },
    ],
  },
  { id: "article.clinicalUse.cycleMemo", section: "二、供试品信息", label: "临床用法-周期备注", type: "textarea" },
  {
    id: "article.excipient.clientProvided",
    section: "二、供试品信息",
    label: "赋形剂-委托方提供",
    type: "select",
    options: yesNoOptions,
    required: true,
  },
  {
    id: "article.excipient.procurementByInnostar",
    section: "二、供试品信息",
    label: "赋形剂-由益诺思采购",
    type: "select",
    options: yesNoOptions,
    required: true,
  },
  {
    id: "article.excipient.designatedSupplier",
    section: "二、供试品信息",
    label: "赋形剂-是否指定供应商",
    type: "select",
    options: selectOneOptions,
  },
  { id: "article.excipient.supplierName", section: "二、供试品信息", label: "供应商名称", type: "text" },
  { id: "article.excipient.productNumber", section: "二、供试品信息", label: "货号", type: "text" },
  { id: "article.excipient.memo", section: "二、供试品信息", label: "赋形剂说明", type: "textarea" },
  {
    id: "article.generalCommissioningContent",
    section: "二、供试品信息",
    label: "总体委托内容",
    type: "multiselect",
    required: true,
    options: [
      { label: "毒理", value: "toxicology" },
      { label: "药代动力学", value: "pharmacokinetics" },
      { label: "药效", value: "efficacy" },
      { label: "药理毒理综述撰写", value: "pharmacotoxicology_review_writing" },
      { label: "其他", value: "other" },
    ],
  },
  { id: "article.generalCommissioningContentMemo", section: "二、供试品信息", label: "总体委托内容备注", type: "textarea" },

  { id: "handover.projectStartDate", section: "三、交接信息补充", label: "项目启动日期", type: "date" },
  {
    id: "handover.useTechnologyVouchers",
    section: "三、交接信息补充",
    label: "是否使用科技券",
    type: "select",
    options: selectOneOptions,
  },
  { id: "handover.toxicologyLocation", section: "三、交接信息补充", label: "毒理试验开展地点", type: "text" },
  { id: "handover.statutoryReportingDate", section: "三、交接信息补充", label: "法定报告日期", type: "date" },
  { id: "handover.translationReportDate", section: "三、交接信息补充", label: "翻译报告日期", type: "date" },
  { id: "handover.sendDate", section: "三、交接信息补充", label: "SEND 日期", type: "date" },
  { id: "handover.deliveryDate", section: "三、交接信息补充", label: "供试品送达日期", type: "date" },
];

export const SECTION_ORDER = Array.from(new Set(TEMPLATE_FIELDS.map((field) => field.section)));

export const REQUIRED_FIELD_IDS = TEMPLATE_FIELDS.filter((field) => field.required).map((field) => field.id);

export function createEmptyValues(): Record<string, string | string[]> {
  return TEMPLATE_FIELDS.reduce<Record<string, string | string[]>>((acc, field) => {
    acc[field.id] = field.type === "multiselect" ? [] : "";
    return acc;
  }, {});
}

export function createEmptyFieldExplanations(): Record<string, FieldExplanation> {
  return TEMPLATE_FIELDS.reduce<Record<string, FieldExplanation>>((acc, field) => {
    acc[field.id] = {
      sourceText: "",
      reasoning: "",
    };
    return acc;
  }, {});
}

export function createEmptyRecord(): TemplateRecord {
  const now = new Date().toISOString();

  return {
    id: `draft-${Date.now()}`,
    name: "未命名解析",
    createdAt: now,
    updatedAt: now,
    meta: {
      extractionMode: "heuristic",
      extractedAt: now,
    },
    values: createEmptyValues(),
    fieldExplanations: createEmptyFieldExplanations(),
    missingFields: REQUIRED_FIELD_IDS,
    issues: REQUIRED_FIELD_IDS.map((fieldId) => ({
      fieldId,
      reason: "模板必填字段，原始材料中尚未确认",
    })),
  };
}

export function normalizeFieldValue(
  field: TemplateField,
  value: unknown,
): string | string[] {
  if (field.type === "multiselect") {
    if (Array.isArray(value)) {
      return value.map((item) => String(item)).filter(Boolean);
    }

    if (typeof value === "string") {
      return value
        .split(/[;,，；\n]/)
        .map((item) => item.trim())
        .filter(Boolean);
    }

    return [];
  }

  if (typeof value === "number") {
    return String(value);
  }

  if (typeof value === "string") {
    return value.trim();
  }

  return "";
}
