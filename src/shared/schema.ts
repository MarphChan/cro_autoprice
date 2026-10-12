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
  group?: string;
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
  transcript?: string;
  extractionMode: "llm" | "heuristic";
  extractedAt: string;
}

export interface TemplateRecord {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  meta: ParseMeta;
  simplifiedInput?: string;
  values: Record<string, string | string[]>;
  legacyDrugType?: string;
  fieldExplanations: Record<string, FieldExplanation>;
  missingFields: string[];
  issues: ParseIssue[];
}

export interface LlmSettings {
  apiKey: string;
  baseURL: string;
  chatModel: string;
  transcriptionProvider: "openai" | "volc" | "sensevoice";
  transcriptionApiKey: string;
  transcriptionBaseURL: string;
  transcriptionModel: string;
  volcResourceId: string;
  tosAccessKeyId: string;
  tosAccessKeySecret: string;
  tosRegion: string;
  tosEndpoint: string;
  tosBucket: string;
  useLlmExtraction: boolean;
}

export function createDefaultLlmSettings(): LlmSettings {
  return {
    apiKey: "",
    baseURL: "",
    chatModel: "gpt-4.1-mini",
    transcriptionProvider: "openai",
    transcriptionApiKey: "",
    transcriptionBaseURL: "https://api.openai.com/v1",
    transcriptionModel: "gpt-4o-mini-transcribe",
    volcResourceId: "volc.seedasr.auc",
    tosAccessKeyId: "",
    tosAccessKeySecret: "",
    tosRegion: "",
    tosEndpoint: "",
    tosBucket: "",
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

export const DRUG_TYPE_GROUPS: Array<{ label: string; value: string; options: FieldOption[] }> = [
  {
    label: "中药", value: "traditional_chinese_medicine", options: [
      { value: "1-1", label: "中药创新药" },
      { value: "1-2", label: "中药改良型新药" },
      { value: "1-3", label: "古代经典名方中药复方制剂" },
      { value: "1-4", label: "同名同方药" },
    ],
  },
  {
    label: "化药", value: "chemical_drug", options: [
      { value: "2-1", label: "单分子" },
      { value: "2-2", label: "特殊制剂（例如脂质体、微球、液晶、胶束等）" },
      { value: "2-3", label: "复方制剂" },
      { value: "2-4", label: "分子胶" },
      { value: "2-5", label: "PROTAC" },
      { value: "2-6", label: "异构体" },
      { value: "2-7", label: "多肽（化学制备）" },
      { value: "2-8", label: "其他（请备注）" },
    ],
  },
  {
    label: "疫苗", value: "vaccine", options: [
      { value: "3-1", label: "预防用疫苗" },
      { value: "3-2", label: "治疗用疫苗-mRNA疫苗（PCV）" },
      { value: "3-3", label: "治疗用疫苗-mRNA疫苗（通用型）" },
      { value: "3-4", label: "治疗用疫苗-mRNA疫苗（TAA）" },
      { value: "3-5", label: "治疗用疫苗-mRNA疫苗（TSA）" },
      { value: "3-6", label: "治疗用疫苗-DNA疫苗" },
      { value: "3-7", label: "其他（请备注）" },
    ],
  },
  {
    label: "生物制品", value: "biological_product", options: [
      { value: "4-1", label: "偶联类ADC-新分子" },
      { value: "4-2", label: "偶联类ADC-老分子" },
      { value: "4-3", label: "偶联类ApDC-新分子" },
      { value: "4-4", label: "偶联类ApDC-老分子" },
      { value: "4-5", label: "偶联类PDC-新分子" },
      { value: "4-6", label: "偶联类PDC-老分子" },
      { value: "4-7", label: "生物制品复方" },
      { value: "4-8", label: "单抗" },
      { value: "4-9", label: "双/多特异性抗体" },
      { value: "4-10", label: "生物类似药" },
      { value: "4-11", label: "多肽（生物制备）" },
      { value: "4-12", label: "融合蛋白" },
      { value: "4-13", label: "活菌类药物" },
      { value: "4-14", label: "载体递送药物" },
      { value: "4-15", label: "蛋白药物" },
      { value: "4-16", label: "其他（请备注）" },
    ],
  },
  {
    label: "细胞治疗_免疫细胞产品", value: "cell_therapy_immune_cell", options: [
      { value: "5-1", label: "TII细胞疗法" },
      { value: "5-2", label: "NK（除CAR-NK以外，含天然和基因修饰的NK）" },
      { value: "5-3", label: "DC细胞疗法" },
      { value: "5-4", label: "Treg细胞疗法" },
      { value: "5-5", label: "CAR-M（M巨噬细胞）" },
      { value: "5-6", label: "CAR-T" },
      { value: "5-7", label: "CAR-NK（NK自然杀伤细胞）" },
      { value: "5-8", label: "CAR-Treg（Treg调节性T细胞）" },
      { value: "5-9", label: "TCR-T" },
      { value: "5-10", label: "γδT" },
      { value: "5-11", label: "Zrak" },
      { value: "5-12", label: "其他免疫细胞治疗产品（请备注）" },
      { value: "5-13", label: "其他（请备注）" },
    ],
  },
  {
    label: "细胞治疗_干细胞产品", value: "cell_therapy_stem_cell", options: [
      { value: "6-1", label: "ESC-胚胎干细胞衍生产品" },
      { value: "6-2", label: "iPSC-诱导多能干细胞衍生产品" },
      { value: "6-3", label: "MSC-间充质干细胞-骨髓" },
      { value: "6-4", label: "MSC-间充质干细胞-脐带" },
      { value: "6-5", label: "MSC-间充质干细胞-毛囊" },
      { value: "6-6", label: "MSC-间充质干细胞-脂肪ADSCs" },
      { value: "6-7", label: "MSC-间充质干细胞-其他" },
      { value: "6-8", label: "HSCs-造血干细胞" },
      { value: "6-9", label: "NSC-神经干细胞" },
      { value: "6-10", label: "胎盘造血干细胞" },
      { value: "6-11", label: "胎盘亚全能干细胞" },
      { value: "6-12", label: "羊膜干细胞" },
      { value: "6-13", label: "外泌体" },
      { value: "6-14", label: "其他（请备注）" },
      { value: "6-15", label: "MSC-间充质干细胞-羊膜" },
    ],
  },
  {
    label: "基因治疗", value: "gene_therapy", options: [
      { value: "7-1", label: "AAV载体" },
      { value: "7-2", label: "其他病毒载体" },
      { value: "7-3", label: "非病毒载体" },
      { value: "7-4", label: "溶瘤病毒" },
      { value: "7-5", label: "溶瘤细菌" },
      { value: "7-6", label: "其他（请备注）" },
    ],
  },
  {
    label: "核酸药物", value: "nucleic_acid_medicines", options: [
      { value: "8-1", label: "反义寡核苷酸（ASO）" },
      { value: "8-2", label: "小干扰RNA（siRNA）" },
      { value: "8-3", label: "微小RNA（miRNA）" },
      { value: "8-4", label: "小激活RNA（saRNA）" },
      { value: "8-5", label: "信使RNA（mRNA）药物" },
      { value: "8-6", label: "RNA适配（Aptamer）" },
      { value: "8-7", label: "环状RNA（circRNA）" },
      { value: "8-8", label: "DNA药物" },
      { value: "8-9", label: "其他（请备注）" },
    ],
  },
  {
    label: "放射性药物", value: "radiopharmaceuticals", options: [
      { value: "9-1", label: "诊断用放射性药物" },
      { value: "9-2", label: "治疗用放射性药物" },
      { value: "9-3", label: "其他（请备注）" },
    ],
  },
];

export function getDrugTypeCategories(subtypes: string[]): string[] {
  return DRUG_TYPE_GROUPS.filter((group) =>
    group.options.some((option) => subtypes.includes(option.value)),
  ).map((group) => group.value);
}

export function matchDrugSubtypes(text: string): string[] {
  const options = DRUG_TYPE_GROUPS.flatMap((group) => group.options);
  const normalize = (value: string) => value.replace(/[（）()_\s-]/g, "").toLowerCase();
  let remainingText = normalize(text);
  const matched = new Set<string>();

  for (const option of [...options].sort((a, b) => b.label.length - a.label.length)) {
    if (option.label.includes("其他（请备注）") || option.label === "MSC-间充质干细胞-其他") {
      continue;
    }
    if (option.value === "5-6" && remainingText.includes("cartreg")) {
      matched.add("5-8");
      remainingText = remainingText.replace(/cartreg/g, "");
    }
    const label = normalize(option.label);
    if (remainingText.includes(label)) {
      matched.add(option.value);
      remainingText = remainingText.replace(label, "");
    }
  }

  for (const [pattern, value] of [
    [/cartreg/g, "5-8"], [/carnk/g, "5-7"], [/carm(?!rna)/g, "5-5"],
    [/tcrt/g, "5-9"], [/特殊制剂/g, "2-2"],
  ] as const) {
    if (pattern.test(remainingText)) {
      matched.add(value);
      remainingText = remainingText.replace(pattern, "");
    }
  }

  if (/\b(?:单抗|monoclonal antibody)\b/i.test(text) || text.includes("单抗")) {
    matched.add("4-8");
  }

  const codes = text.match(/(?:^|[^\w-])([1-9]-(?:[1-9]|1[0-6]))(?![\d-])/g) ?? [];
  for (const code of codes) {
    const value = code.match(/[1-9]-(?:[1-9]|1[0-6])$/)?.[0];
    if (value && options.some((option) => option.value === value)) {
      matched.add(value);
    }
  }

  return options.filter((option) => matched.has(option.value)).map((option) => option.value);
}

export function normalizeLegacyDrugType(record: TemplateRecord): TemplateRecord {
  const raw = record.values?.["article.drugType"];
  if (typeof raw !== "string") {
    return record;
  }

  const subtype = DRUG_TYPE_GROUPS.flatMap((group) => group.options)
    .find((option) => option.value === raw);
  return {
    ...record,
    legacyDrugType: subtype ? record.legacyDrugType : record.legacyDrugType || raw,
    values: { ...record.values, "article.drugType": subtype ? [raw] : [] },
  };
}

export function getMissingFieldIds(values: Record<string, string | string[]>): string[] {
  return TEMPLATE_FIELDS.filter((field) =>
    (field.required && !hasFieldValue(values[field.id])) || values[field.id] === "pending",
  ).map((field) => field.id);
}

export function hasFieldValue(value: unknown): boolean {
  if (Array.isArray(value)) {
    return value.length > 0;
  }
  return typeof value === "string" && value.trim().length > 0 && value !== "pending";
}

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
    type: "multiselect",
    required: true,
    options: DRUG_TYPE_GROUPS.flatMap((group) =>
      group.options.map((option) => ({ ...option, group: group.label })),
    ),
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
  {
    id: "article.indications.diseaseType", section: "二、供试品信息", label: "疾病类型",
    type: "text", required: true,
    options: [
      "抗肿瘤药物", "皮肤及五官科药物", "抗感染药物", "风湿类疾病及免疫药物",
      "消化系统疾病药物", "呼吸系统疾病及抗过敏药物", "循环系统疾病药物",
      "内分泌系统药物", "肾脏/泌尿系统疾病药物", "神经系统疾病药物",
      "精神障碍类疾病药物", "镇痛药及麻醉科药物", "生殖系统疾病药物",
      "血液系统疾病药物", "电解质、酸碱平衡及营养药、扩容药",
      "预防性疫苗", "医学影像学药物", "外科及其他药物", "体外诊断试剂",
    ].map((label) => ({ label, value: label })),
  },
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
  { id: "article.excipient.specificContent", section: "二、供试品信息", label: "具体辅料内容", type: "textarea" },
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
  {
    id: "handover.toxicologyLocation", section: "三、交接信息补充", label: "毒理试验开展地点",
    type: "text", options: ["上海", "南通", "深圳"].map((label) => ({ label, value: label })),
  },
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
    if (field.id === "article.drugType") {
      const allowed = new Set(DRUG_TYPE_GROUPS.flatMap((group) => group.options.map((option) => option.value)));
      return (Array.isArray(value) ? value : typeof value === "string" ? [value] : [])
        .map((item) => String(item))
        .filter((item, index, items) => allowed.has(item) && items.indexOf(item) === index);
    }
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
