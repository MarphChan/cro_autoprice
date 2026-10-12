import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { transcribeWithSenseVoice } from "./sensevoice-transcription.js";

test("local recognition reports missing model files before launching Python", async () => {
  await assert.rejects(
    transcribeWithSenseVoice(Buffer.from("audio"), "recording.wav", {
      modelDir: path.join(os.tmpdir(), "missing-sensevoice-model"),
      python: "nonexistent-python",
    }),
    /模型未完整安装/,
  );
});

test("local recognition returns Python text and handles failed inference", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "sensevoice-test-"));
  try {
    await fs.writeFile(path.join(directory, "config.yaml"), "model: test");
    await fs.writeFile(path.join(directory, "model.pt"), "");
    await fs.truncate(path.join(directory, "model.pt"), 100_000_001);
    const script = path.join(directory, "infer.cjs");
    await fs.writeFile(script, 'console.log("SENSEVOICE_RESULT:" + JSON.stringify(" 识别成功。 "));\n');
    const options = { modelDir: directory, python: process.execPath, script, ffmpeg: "unused" };
    assert.equal(await transcribeWithSenseVoice(Buffer.from("audio"), "sample.m4a", options), "识别成功。");

    await fs.writeFile(script, 'console.error("推理失败"); process.exit(1);\n');
    await assert.rejects(
      transcribeWithSenseVoice(Buffer.from("audio"), "sample.m4a", options),
      /SenseVoice 识别失败：推理失败/,
    );
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
});
