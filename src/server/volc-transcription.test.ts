import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs/promises";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { convertToMp3, requestFlashRecognition } from "./volc-transcription.js";

const ffmpeg = createRequire(import.meta.url)("ffmpeg-static") as string | null;

test("converts an uploaded m4a recording to mp3", async () => {
  assert.ok(ffmpeg, "ffmpeg binary must be installed");
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "innostar-test-"));
  try {
    const input = path.join(directory, "sample.m4a");
    execFileSync(ffmpeg, [
      "-hide_banner", "-loglevel", "error",
      "-f", "lavfi", "-i", "sine=frequency=440:duration=1",
      "-c:a", "aac", input,
    ]);
    const mp3 = await convertToMp3(await fs.readFile(input));
    assert.ok(mp3.length > 1000);
    assert.equal(mp3.subarray(0, 3).toString(), "ID3");
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
});

test("flash recognition uses the synchronous endpoint and returns text", async () => {
  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = async (input, init) => {
      assert.equal(input, "https://openspeech.bytedance.com/api/v3/auc/bigmodel/recognize/flash");
      assert.equal(init?.method, "POST");
      assert.equal((init?.headers as Record<string, string>)["X-Api-Resource-Id"], "volc.bigasr.auc_turbo");
      assert.equal((init?.headers as Record<string, string>)["X-Api-Request-Id"], "task-123");
      assert.equal((init?.headers as Record<string, string>)["X-Api-Sequence"], "-1");
      assert.equal((init?.headers as Record<string, string>)["X-Api-Key"], "test-key");
      assert.deepEqual(JSON.parse(init?.body as string), {
        audio: { format: "mp3", url: "https://example.com/audio.mp3" },
        request: { model_name: "bigmodel", enable_itn: true, enable_punc: true },
      });
      return Response.json({ result: { text: " 识别成功。 " } }, {
        headers: { "X-Api-Status-Code": "20000000", "X-Api-Message": "OK" },
      });
    };
    assert.equal(await requestFlashRecognition("https://example.com/audio.mp3", "test-key", "task-123"), "识别成功。");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("flash recognition handles result lists and rejects failed or empty responses", async () => {
  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = async () => Response.json({ result: [{ text: "第一句" }, { text: "第二句" }] }, {
      headers: { "X-Api-Status-Code": "20000000" },
    });
    assert.equal(await requestFlashRecognition("url", "key", "id"), "第一句\n第二句");

    globalThis.fetch = async () => Response.json({}, {
      headers: { "X-Api-Status-Code": "20000001", "X-Api-Message": "invalid audio" },
    });
    await assert.rejects(requestFlashRecognition("url", "key", "id"), /火山极速版转写失败.*invalid audio/);

    globalThis.fetch = async () => Response.json({ result: { text: " " } }, {
      headers: { "X-Api-Status-Code": "20000000" },
    });
    await assert.rejects(requestFlashRecognition("url", "key", "id"), /未返回文字内容/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
