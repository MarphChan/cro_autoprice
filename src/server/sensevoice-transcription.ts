import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import fs from "node:fs/promises";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const bundledFfmpeg = createRequire(import.meta.url)("ffmpeg-static") as string | null;
const defaultModelDir = "/Volumes/SANDISK ELE/SenseVoice";
const resultPrefix = "SENSEVOICE_RESULT:";

export async function transcribeWithSenseVoice(
  audio: Buffer,
  fileName: string,
  options: { modelDir?: string; python?: string; script?: string; ffmpeg?: string } = {},
): Promise<string> {
  const modelDir = options.modelDir ?? process.env.SENSEVOICE_MODEL_DIR ?? defaultModelDir;
  const localPython = path.join(os.homedir(), ".local", "share", "innostar-sensevoice-venv", "bin", "python");
  const python = options.python ?? process.env.SENSEVOICE_PYTHON ??
    (existsSync(localPython) ? localPython : "python3");
  const ffmpeg = options.ffmpeg ?? process.env.FFMPEG_PATH ?? bundledFfmpeg;
  const script = options.script ?? fileURLToPath(new URL("./sensevoice_infer.py", import.meta.url));
  if (!ffmpeg) throw new Error("本地识别需要 ffmpeg，请配置 FFMPEG_PATH");

  try {
    const weights = await fs.stat(path.join(modelDir, "model.pt"));
    if (weights.size < 100_000_000) throw new Error("模型权重文件不完整");
    await fs.access(path.join(modelDir, "config.yaml"));
  } catch {
    throw new Error(`SenseVoice 模型未完整安装在 ${modelDir}（需要 model.pt 和 config.yaml）`);
  }

  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "innostar-sensevoice-"));
  try {
    const input = path.join(directory, `input${path.extname(fileName).toLowerCase()}`);
    await fs.writeFile(input, audio);
    const output = await new Promise<string>((resolve, reject) => {
      const child = spawn(python, [script, modelDir, input, ffmpeg], {
        env: { ...process.env, HF_HUB_OFFLINE: "1", MODELSCOPE_OFFLINE: "1" },
      });
      let stdout = "";
      let stderr = "";
      let timedOut = false;
      const timer = setTimeout(() => {
        timedOut = true;
        child.kill();
      }, 30 * 60 * 1000);
      child.stdout.on("data", (chunk: Buffer) => {
        stdout = (stdout + chunk.toString()).slice(-100_000);
      });
      child.stderr.on("data", (chunk: Buffer) => {
        stderr = (stderr + chunk.toString()).slice(-3000);
      });
      child.on("error", (error) => {
        clearTimeout(timer);
        reject(new Error(`无法启动 SenseVoice Python 环境（${python}）：${error.message}`));
      });
      child.on("close", (code) => {
        clearTimeout(timer);
        if (timedOut) return reject(new Error("SenseVoice 识别超时（30 分钟）"));
        if (code !== 0) return reject(new Error(`SenseVoice 识别失败：${stderr.trim() || stdout.trim() || `退出码 ${code}`}`));
        const line = stdout.split(/\r?\n/).reverse().find((item) => item.startsWith(resultPrefix));
        if (!line) return reject(new Error("SenseVoice 未返回识别结果"));
        try {
          const text = JSON.parse(line.slice(resultPrefix.length)) as unknown;
          if (typeof text !== "string" || !text.trim()) throw new Error("未检测到可识别的语音");
          resolve(text.trim());
        } catch (error) {
          reject(error);
        }
      });
    });
    return output;
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
}
