import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import http from "node:http";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { createEmptyRecord } from "../shared/schema.js";

async function freePort() {
  return new Promise<number>((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      server.close(() => resolve(typeof address === "object" && address ? address.port : 0));
    });
  });
}

test("simplification requires extracted audio and returns model summary without changing record", async (context) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "innostar-simplify-"));
  const port = await freePort();
  const modelPort = await freePort();
  let requestBody = "";
  const model = http.createServer(async (req, res) => {
    for await (const chunk of req) requestBody += chunk.toString();
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({
      id: "chatcmpl-test",
      object: "chat.completion",
      created: 0,
      model: "test-model",
      choices: [{
        index: 0,
        finish_reason: "stop",
        message: {
          role: "assistant",
          content: JSON.stringify({ simplifiedInput: "一、已确认关键信息\n- 拟开展猴试验。\n二、待确认/争议\n- 地点待核实。" }),
        },
      }],
    }));
  });
  await new Promise<void>((resolve) => model.listen(modelPort, "127.0.0.1", resolve));
  await fs.mkdir(path.join(directory, "data"), { recursive: true });
  await fs.writeFile(path.join(directory, "data", "llm-settings.json"), JSON.stringify({
    apiKey: "test-key",
    baseURL: `http://127.0.0.1:${modelPort}/v1`,
    chatModel: "test-model",
    useLlmExtraction: true,
  }));
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
    await new Promise<void>((resolve) => model.close(() => resolve()));
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

  const record = createEmptyRecord();
  const url = `http://127.0.0.1:${port}/api/simplify/input`;
  const submit = () => fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ record }),
  });
  assert.equal((await submit()).status, 400);
  record.meta = {
    transcript: "甲说拟开展猴试验。乙说地点还没确定。",
    sourceFileName: "meeting.m4a",
    extractionMode: "llm",
    extractedAt: new Date().toISOString(),
  };
  record.values["article.keyInfo.animalSpecies"] = ["monkey"];
  const response = await submit();
  assert.equal(response.status, 200);
  assert.match((await response.json() as { simplifiedInput: string }).simplifiedInput, /地点待核实/);
  assert.match(requestBody, /拟定动物种属/);
  assert.equal(record.simplifiedInput, undefined);
});
