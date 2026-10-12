# InnoStar 供试品信息解析 Demo

一个本地可运行的 demo，支持把录音或 `doc` / `docx` / `pdf` 文件解析成供试品信息模板对应的结构化字段，并提供人工校对、保存和 JSON 导出能力。

## 功能覆盖

- 新建空白解析
- 上传 `doc` / `docx` / `pdf` 文档并解析为交互表单
- 单独上传 `m4a` / `mp3` / `wav` 录音，在线转写并校对文字，再通过大语言模型提取表单
- 提取表单后点击“从提取结果简化输入”，按 `Test Article Information-template.docx` 的字段范围精简双方对话；已确认信息与待确认/争议分开呈现，可人工校对后随记录保存，不覆盖转写及表单
- 高亮缺失字段，提示需要用户确认
- 修改解析结果并保存到本地
- 下载 JSON 文件，便于流转到其他系统

## 技术方案

- 前端：React + Vite
- 后端：Express + TypeScript
- 文档提取：
  - `pdf` -> `pdf-parse`
  - `docx` -> `mammoth`
  - `doc` -> `word-extractor`
  - 录音 -> OpenAI 兼容语音转写 API、火山录音文件识别，或本机 SenseVoiceSmall（FunASR）
- 字段抽取：
  - 优先使用 OpenAI compatible LLM
  - 未配置 LLM 时自动退回规则抽取，保证 demo 可跑通

## 启动方式

1. 安装依赖

```bash
npm install
```

2. 复制环境变量

```bash
cp .env.example .env
```

3. 可选：配置大模型与录音转写

- `OPENAI_API_KEY`：字段抽取模型的 API Key
- `OPENAI_BASE_URL`：字段抽取模型的 OpenAI 兼容网关地址
- `OPENAI_MODEL`：默认 `gpt-4.1-mini`
- `TRANSCRIPTION_API_KEY`：独立的语音转文字 API Key
- `TRANSCRIPTION_BASE_URL`：语音接口地址，默认 `https://api.openai.com/v1`
- `TRANSCRIPTION_MODEL`：语音转写模型，默认 `gpt-4o-mini-transcribe`
- 也可以在页面“模型与语音配置”中分别保存文本模型和语音服务配置；已有配置不会自动复用文本模型的密钥
- 旧版配置没有独立语音服务字段时，界面会显示新的默认转写模型；原文件只在手动保存配置后更新
- 选择 OpenAI 兼容语音服务时必须支持 `/audio/transcriptions` 接口，文本对话模型不能直接充当转写模型

### 本地 SenseVoice 语音识别

在“模型与语音配置”中选择“本地大模型 - SenseVoice”并保存，即可用本机模型转写 `m4a`、`mp3`、`wav`。无需语音 API Key，录音不会上传到在线语音服务。模型默认读取 `/Volumes/SANDISK ELE/SenseVoice`；如需改路径可设置服务端环境变量 `SENSEVOICE_MODEL_DIR`。

先在 macOS 内置磁盘准备 Python 环境（外接盘可能生成不可读的 `._*.pth` 文件；已有 PyTorch 的 Python 可使用 `--system-site-packages`）：

```bash
python3 -m venv --system-site-packages "$HOME/.local/share/innostar-sensevoice-venv"
"$HOME/.local/share/innostar-sensevoice-venv/bin/python" -m pip install 'funasr==1.2.7'
```

再将官方模型下载到指定目录，包含 `model.pt`、`config.yaml`、`am.mvn` 和分词模型。需要该目录的写入权限：

```bash
"$HOME/.local/share/innostar-sensevoice-venv/bin/python" -c "from huggingface_hub import snapshot_download; snapshot_download('FunAudioLLM/SenseVoiceSmall', local_dir='/Volumes/SANDISK ELE/SenseVoice', allow_patterns=['model.pt','config.yaml','configuration.json','am.mvn','*.bpe.model'])"
```

服务端优先使用上述虚拟环境；也可用 `SENSEVOICE_PYTHON` 指定已安装 FunASR 的 Python。音频由项目的 `ffmpeg-static` 转为本地 16 kHz、20 秒片段，推理使用 CPU 并在临时目录清理音频；首次加载模型和较长录音可能需要较久。字段抽取、简化输入仍使用另行配置的文本大模型及其 API Key；SenseVoice 只负责录音转写。

### 火山录音文件识别

在页面“模型与语音配置”中，将语音服务类型切换为“火山录音文件识别”，填写：

- 火山语音新版控制台的 API Key（`X-Api-Key`），以及已开通的录音识别资源 ID（2.0 为 `volc.seedasr.auc`，1.0 为 `volc.bigasr.auc`，极速版为 `volc.bigasr.auc_turbo`）。本接入使用新版控制台凭证。
- 火山 TOS 私有存储桶的 Access Key ID、Secret Access Key、地域、**公网**端点和桶名。凭证须具有对象上传、读取、删除权限；桶无需公开访问。
- 表单字段抽取的 LLM API Key、Base URL、模型，并保持“启用 LLM 字段抽取”。语音识别只生成文字，表单提取仍需单独配置。

页面上传 `m4a`、`mp3` 或 `wav` 后，后端先用 ffmpeg 统一转成 mp3，再上传 TOS，并将有效期 1 小时的预签名 URL 提交给火山语音。查询成功后临时对象会删除；失败和超时也尝试清理。单次录音上限 50 MB，转写最多等待约 30 分钟。`npm install` 会安装 `ffmpeg-static`；如该平台不提供可执行文件，可设置服务端环境变量 `FFMPEG_PATH` 指向本机 ffmpeg。

选择极速版时，使用 `/api/v3/auc/bigmodel/recognize/flash` 同步返回转写文字，不提交异步任务或轮询；TOS 上传、转码及清理流程保持不变。当前应用仍限制上传文件为 50 MB，且录音的转码和上传耗时不会因选择极速版而省去。需先在火山语音控制台开通对应资源。

排查转写失败时查看后端终端的 `[volc-transcription]` 日志。同一个 `taskId` 会串起转码、TOS 上传、提交火山任务、轮询及临时文件清理；每条记录包含阶段、状态和已耗时。轮询只在状态变化或每 10 次查询时输出，超时记录会给出最后的接口状态码。若转码或 TOS 上传失败，后续阶段不会执行；若提交完成后仍超时，应继续检查火山任务状态及 TOS 签名链接能否被语音服务访问。日志不包含密钥、签名链接或转写全文。

也可通过 `.env` 的 `TRANSCRIPTION_PROVIDER=volc`、`TRANSCRIPTION_API_KEY`、`VOLC_RESOURCE_ID`、`TOS_ACCESS_KEY_ID`、`TOS_ACCESS_KEY_SECRET`、`TOS_REGION`、`TOS_ENDPOINT`、`TOS_BUCKET` 配置。页面保存的配置优先于这些环境变量。录音会经第三方语音服务处理，请只上传已获授权的内容；配置文件包含明文密钥，不要将 `data/llm-settings.json` 对外提供或提交版本库。

4. 启动开发环境

```bash
npm run dev
```

- 前端：http://localhost:5173
- 后端：http://localhost:3001

## 保存结果

保存后的记录会写入：

```bash
data/records/*.json
```

模型配置会写入：

```bash
data/llm-settings.json
```

## 说明

- 模板字段定义位于 `src/shared/schema.ts`
- 药物类型按问卷的 81 个子类编码多选并自动归属大类；疾病类型和毒理地点可选择建议项或自由填写；具体辅料内容独立保存
- 问卷见 `供试品信息采集问卷.md`，字段说明和可追踪的 JSON 样例见 `docs/字段说明.md`、`docs/expertExample.json`；本机演示记录同步于 `data/records/expertExample.json`
- 旧记录仅有药物大类时会展示原分类供人工核对，不自动猜测具体子类；交接信息不设阶段切换或阶段校验
- 当前 demo 聚焦“解析 -> 人工确认 -> 保存/导出 JSON”链路，没有生成回填后的 `docx`
- 文档类文件在未配置 LLM 时可退回规则抽取；录音须先配置语音服务，转写文本提取表单还须启用并配置字段抽取模型
- 转写文字可人工校对，并在提取后随记录保存到 `meta.transcript`
- 简化输入复用字段抽取模型配置，仅对已提取的录音表单开放；修改转写需重新提取，修改表单字段需重新生成简化内容
- GUI 中保存的模型配置会覆盖 `.env` 中的默认值，并在下一次解析时立即生效
