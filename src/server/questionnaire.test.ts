import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import {
  DRUG_TYPE_GROUPS,
  TEMPLATE_FIELDS,
  createEmptyRecord,
  createEmptyValues,
  getDrugTypeCategories,
  getMissingFieldIds,
  matchDrugSubtypes,
  normalizeFieldValue,
  normalizeLegacyDrugType,
} from "../shared/schema.js";
import { buildSimplificationMessages } from "./simplify-input.js";

test("simplification prompt uses template labels, evidence, and uncertainty rules", () => {
  const record = createEmptyRecord();
  record.meta.transcript = "甲说项目可能在苏州做，乙说人员已经离职；拟开展猴试验。";
  record.values["article.keyInfo.animalSpecies"] = ["monkey"];
  record.fieldExplanations["article.keyInfo.animalSpecies"] = {
    sourceText: "拟开展猴试验",
    reasoning: "原文直接提及",
  };
  const messages = buildSimplificationMessages(record);
  const payload = JSON.parse(messages[1].content) as {
    transcript: string;
    extractedFields: Array<{ label: string; value: string; sourceText: string }>;
    pendingFields: string[];
  };
  assert.equal(payload.transcript, record.meta.transcript);
  assert.ok(payload.extractedFields.some((field) =>
    field.label === "拟定动物种属" && field.value === "猴" && field.sourceText === "拟开展猴试验"));
  assert.ok(payload.pendingFields.includes("单位名称"));
  assert.match(messages[0].content, /相互矛盾/);
  assert.match(messages[0].content, /不要臆造说话人身份/);
  assert.match(messages[0].content, /赋形剂来源/);
});

test("drug options have 81 unique subtypes in nine groups", () => {
  const options = DRUG_TYPE_GROUPS.flatMap((group) => group.options);
  assert.equal(DRUG_TYPE_GROUPS.length, 9);
  assert.equal(options.length, 81);
  assert.equal(new Set(options.map((option) => option.value)).size, 81);
  assert.deepEqual(getDrugTypeCategories(["4-8", "2-1", "4-1"]), [
    "chemical_drug", "biological_product",
  ]);
  assert.equal(options.find((option) => option.value === "5-1")?.label, "TII细胞疗法");
  assert.equal(options.at(-1)?.value, "9-3");
});

test("drug parsing needs specific subtypes and preserves legacy categories", () => {
  assert.deepEqual(matchDrugSubtypes("生物制品，基因治疗"), []);
  assert.deepEqual(matchDrugSubtypes("单抗与AAV载体"), ["4-8", "7-1"]);
  assert.deepEqual(matchDrugSubtypes("CAR-Treg"), ["5-8"]);
  assert.deepEqual(matchDrugSubtypes("NK（除CAR-NK以外，含天然和基因修饰的NK）"), ["5-2"]);
  assert.deepEqual(matchDrugSubtypes("特殊制剂"), ["2-2"]);
  const legacy = createEmptyRecord();
  legacy.values["article.drugType"] = "biological_product";
  const normalized = normalizeLegacyDrugType(legacy);
  assert.deepEqual(normalized.values["article.drugType"], []);
  assert.equal(normalized.legacyDrugType, "biological_product");
  assert.ok(getMissingFieldIds(normalized.values).includes("article.drugType"));
  const field = TEMPLATE_FIELDS.find((item) => item.id === "article.drugType")!;
  assert.deepEqual(normalizeFieldValue(field, ["4-8", "7-1", "4-8", "biological_product"]), ["4-8", "7-1"]);
});

test("specific excipient content and pending are represented without handover stage", () => {
  const values = createEmptyValues();
  assert.equal(values["article.excipient.specificContent"], "");
  assert.equal(Object.prototype.hasOwnProperty.call(createEmptyRecord(), "stage"), false);
  values["article.indications.isAntiTumor"] = "pending";
  values["handover.useTechnologyVouchers"] = "pending";
  assert.ok(getMissingFieldIds(values).includes("article.indications.isAntiTumor"));
  assert.ok(getMissingFieldIds(values).includes("handover.useTechnologyVouchers"));
  values["handover.useTechnologyVouchers"] = "no";
  assert.ok(!getMissingFieldIds(values).includes("handover.useTechnologyVouchers"));
  assert.equal(
    TEMPLATE_FIELDS.find((item) => item.id === "article.indications.diseaseType")?.options?.length,
    19,
  );
  assert.equal(
    TEMPLATE_FIELDS.find((item) => item.id === "handover.toxicologyLocation")?.options?.length,
    3,
  );
});

test("record API reads old category without guessing subtype and saves updated fields", async (context) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "innostar-questionnaire-"));
  const recordDir = path.join(directory, "data", "records");
  await fs.mkdir(recordDir, { recursive: true });
  const old = createEmptyRecord();
  old.id = "legacy-record";
  old.values["article.drugType"] = "biological_product";
  await fs.writeFile(path.join(recordDir, "legacy-record.json"), JSON.stringify(old), "utf8");

  const port = await new Promise<number>((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      server.close(() => resolve(typeof address === "object" && address ? address.port : 0));
    });
  });
  const serverFile = fileURLToPath(new URL("./index.ts", import.meta.url));
  const child = spawn(process.execPath, ["--import", import.meta.resolve("tsx"), serverFile], {
    cwd: directory,
    env: { ...process.env, PORT: String(port) },
    stdio: ["ignore", "pipe", "pipe"],
  });
  context.after(async () => {
    if (child.exitCode === null) {
      child.kill();
      await new Promise<void>((resolve) => child.once("exit", () => resolve()));
    }
    await fs.rm(directory, { recursive: true, force: true });
  });
  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error("server startup timed out")), 15_000);
    child.stdout?.on("data", (chunk: Buffer) => {
      if (chunk.toString().includes("API server listening")) {
        clearTimeout(timeout);
        resolve();
      }
    });
    child.once("exit", (code) => {
      clearTimeout(timeout);
      reject(new Error(`server exited before startup: ${code}`));
    });
  });

  const base = `http://127.0.0.1:${port}/api/records/legacy-record`;
  const loaded = await fetch(base).then((response) => response.json()) as ReturnType<typeof createEmptyRecord>;
  assert.deepEqual(loaded.values["article.drugType"], []);
  assert.equal(loaded.legacyDrugType, "biological_product");
  assert.ok(loaded.missingFields.includes("article.drugType"));
  loaded.values["article.drugType"] = ["4-8", "7-1"];
  loaded.values["article.excipient.specificContent"] = "磷酸盐缓冲液";
  loaded.values["article.indications.isAntiTumor"] = "pending";
  loaded.simplifiedInput = "一、已确认关键信息\n- 拟开展猴试验。\n二、待确认/争议\n- 地点待确认。";

  const response = await fetch(base, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(loaded),
  });
  assert.equal(response.status, 200);
  const saved = await response.json() as ReturnType<typeof createEmptyRecord>;
  assert.deepEqual(saved.values["article.drugType"], ["4-8", "7-1"]);
  assert.equal(saved.legacyDrugType, "biological_product");
  assert.equal(saved.simplifiedInput, loaded.simplifiedInput);
  assert.ok(!saved.missingFields.includes("article.drugType"));
  assert.ok(saved.missingFields.includes("article.indications.isAntiTumor"));
  const stored = JSON.parse(await fs.readFile(path.join(recordDir, "legacy-record.json"), "utf8")) as typeof saved;
  assert.equal(stored.values["article.excipient.specificContent"], "磷酸盐缓冲液");
  assert.deepEqual(stored.values["article.drugType"], saved.values["article.drugType"]);
  assert.equal(stored.simplifiedInput, loaded.simplifiedInput);
});
