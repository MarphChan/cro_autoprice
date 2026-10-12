import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { TosClient } from "@volcengine/tos-sdk";
import type { LlmSettings } from "../shared/schema.js";

const bundledFfmpegPath = createRequire(import.meta.url)("ffmpeg-static") as string | null;
const speechBaseUrl = "https://openspeech.bytedance.com/api/v3/auc/bigmodel";
const maxAudioBytes = 50 * 1024 * 1024;
const maxWaitMs = 30 * 60 * 1000;

export async function transcribeWithVolc(
  audio: Buffer,
  settings: LlmSettings,
  alreadyConverted = false,
): Promise<string> {
  if (!settings.tosAccessKeyId || !settings.tosAccessKeySecret ||
      !settings.tosRegion || !settings.tosEndpoint || !settings.tosBucket) {
    throw new Error("请先填写 TOS 访问密钥、地域、端点和存储桶");
  }
  if (!["volc.bigasr.auc", "volc.seedasr.auc", "volc.bigasr.auc_turbo"].includes(settings.volcResourceId)) {
    throw new Error("请选择有效的火山录音文件识别资源 ID");
  }

  const taskId = randomUUID();
  const startedAt = Date.now();
  let phase = "转码";
  const log = (status: string, details: Record<string, string | number> = {}) => {
    console.info("[volc-transcription]", { taskId, phase, status, elapsedMs: Date.now() - startedAt, ...details });
  };
  let client: TosClient | undefined;
  let key = "";
  let uploaded = false;

  try {
    log("开始", { inputBytes: audio.length });
    const converted = alreadyConverted ? audio : await convertToMp3(audio);
    log("完成", { outputBytes: converted.length });

    phase = "TOS 上传";
    client = new TosClient({
      accessKeyId: settings.tosAccessKeyId,
      accessKeySecret: settings.tosAccessKeySecret,
      region: settings.tosRegion,
      endpoint: settings.tosEndpoint,
    });
    key = `innostar-transcriptions/${randomUUID()}.mp3`;
    log("开始");
    await client.putObject({
      bucket: settings.tosBucket,
      key,
      body: converted,
      contentType: "audio/mpeg",
    });
    uploaded = true;
    log("完成");

    phase = "生成 TOS 签名链接";
    const url = client.getPreSignedUrl({
      method: "GET",
      bucket: settings.tosBucket,
      key,
      expires: 60 * 60,
    });
    log("完成");
    const headers = {
      "Content-Type": "application/json",
      "X-Api-Key": settings.transcriptionApiKey,
      "X-Api-Resource-Id": settings.volcResourceId,
      "X-Api-Request-Id": taskId,
    };

    if (settings.volcResourceId === "volc.bigasr.auc_turbo") {
      phase = "火山极速版同步识别";
      log("开始");
      const text = await requestFlashRecognition(url, settings.transcriptionApiKey, taskId);
      log("完成", { textLength: text.length });
      return text;
    }

    phase = "提交火山识别任务";
    log("开始");
    await speechRequest("submit", {
      ...headers,
      "X-Api-Sequence": "-1",
    }, {
      audio: { format: "mp3", url },
      request: { model_name: "bigmodel", enable_itn: true, enable_punc: true },
    });
    log("完成");

    phase = "查询火山识别结果";
    const deadline = Date.now() + maxWaitMs;
    let queryCount = 0;
    let lastStatus = "";
    while (Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 3000));
      const result = await speechRequest("query", headers, {});
      queryCount += 1;
      if (result.status !== lastStatus || queryCount % 10 === 0) {
        log("轮询", { queryCount, apiStatus: result.status || "无状态码" });
      }
      lastStatus = result.status;
      if (result.status === "20000001" || result.status === "20000002") {
        continue;
      }
      if (result.status === "20000003") {
        throw new Error("录音中未检测到人声");
      }
      if (result.status !== "20000000") {
        throw new Error(`火山录音转写失败（${result.status}）：${result.message}`);
      }
      if (!result.text) {
        throw new Error("火山语音服务未返回文字内容");
      }
      log("完成", { queryCount, textLength: result.text.length });
      return result.text;
    }
    log("超时", { queryCount, lastApiStatus: lastStatus || "无状态码" });
    throw new Error("录音转写等待超时，请稍后重试");
  } catch (error) {
    log("失败", getErrorDetails(error));
    throw error;
  } finally {
    if (uploaded && client) {
      phase = "清理 TOS 临时文件";
      try {
        log("开始");
        await client.deleteObject({ bucket: settings.tosBucket, key });
        log("完成");
      } catch (error) {
        console.warn("[volc-transcription]", {
          taskId, phase, status: "失败", elapsedMs: Date.now() - startedAt, ...getErrorDetails(error),
        });
      }
    }
  }
}

export async function requestFlashRecognition(url: string, apiKey: string, taskId: string): Promise<string> {
  const response = await fetch(`${speechBaseUrl}/recognize/flash`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Api-Key": apiKey,
      "X-Api-Resource-Id": "volc.bigasr.auc_turbo",
      "X-Api-Request-Id": taskId,
      "X-Api-Sequence": "-1",
    },
    body: JSON.stringify({
      audio: { format: "mp3", url },
      request: { model_name: "bigmodel", enable_itn: true, enable_punc: true },
    }),
    signal: AbortSignal.timeout(maxWaitMs),
  });
  const status = response.headers.get("X-Api-Status-Code") ?? "";
  const message = response.headers.get("X-Api-Message") ?? "";
  if (!response.ok || status !== "20000000") {
    throw new Error(`火山极速版转写失败（HTTP ${response.status}，${status || "无状态码"}）：${message || "请检查语音服务配置"}`);
  }
  const data = await response.json() as { result?: { text?: string } | Array<{ text?: string }> };
  const text = (Array.isArray(data.result)
    ? data.result.map((item) => item.text?.trim() ?? "").filter(Boolean).join("\n")
    : data.result?.text?.trim()) ?? "";
  if (!text) {
    throw new Error("火山极速版未返回文字内容");
  }
  return text;
}

function getErrorDetails(error: unknown): Record<string, string | number> {
  if (typeof error !== "object" || error === null) {
    return { errorType: typeof error };
  }
  const details: Record<string, string | number> = {
    errorType: error instanceof Error ? error.name : "UnknownError",
  };
  if ("statusCode" in error && typeof error.statusCode === "number") {
    details.httpStatus = error.statusCode;
  }
  if ("code" in error && typeof error.code === "string") {
    details.errorCode = error.code;
  }
  return details;
}

async function speechRequest(
  action: "submit" | "query",
  headers: Record<string, string>,
  body: object,
): Promise<{ status: string; message: string; text: string }> {
  const response = await fetch(`${speechBaseUrl}/${action}`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(20000),
  });
  const status = response.headers.get("X-Api-Status-Code") ?? "";
  const message = response.headers.get("X-Api-Message") ?? "";
  if (!response.ok) {
    throw new Error(`火山语音接口请求失败（HTTP ${response.status}，${status}）：${message}`);
  }
  if (action === "submit") {
    if (status !== "20000000") {
      throw new Error(`火山录音任务提交失败（${status}）：${message}`);
    }
    return { status, message, text: "" };
  }
  const data = await response.json().catch(() => ({})) as { result?: { text?: string } };
  return { status, message, text: data.result?.text?.trim() ?? "" };
}

export async function convertToMp3(audio: Buffer): Promise<Buffer> {
  if (audio.length > maxAudioBytes) {
    throw new Error("录音文件不能超过 50 MB");
  }
  const executable = process.env.FFMPEG_PATH || bundledFfmpegPath;
  if (!executable) {
    throw new Error("当前系统没有可用的 ffmpeg，请安装 ffmpeg 或配置 FFMPEG_PATH");
  }
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "innostar-audio-"));
  const input = path.join(directory, "input");
  const output = path.join(directory, "output.mp3");
  try {
    await fs.writeFile(input, audio);
    await new Promise<void>((resolve, reject) => {
      const processHandle = spawn(executable, [
        "-hide_banner", "-loglevel", "error", "-nostdin", "-y",
        "-i", input, "-vn", "-ac", "1", "-ar", "16000", "-b:a", "64k", output,
      ]);
      let stderr = "";
      const timer = setTimeout(() => processHandle.kill(), 120000);
      processHandle.stderr.on("data", (chunk: Buffer) => {
        stderr = (stderr + chunk.toString()).slice(-1000);
      });
      processHandle.on("error", (error) => {
        clearTimeout(timer);
        reject(error);
      });
      processHandle.on("close", (code) => {
        clearTimeout(timer);
        if (code === 0) resolve();
        else reject(new Error(`ffmpeg 转码失败：${stderr || `退出码 ${code}`}`));
      });
    });
    return await fs.readFile(output);
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
}
