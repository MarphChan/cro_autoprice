# InnoStar 供试品信息解析 Demo

一个本地可运行的 demo，支持把录音或 `doc` / `docx` / `pdf` 文件解析成供试品信息模板对应的结构化字段，并提供人工校对、保存和 JSON 导出能力。

## 功能覆盖

- 新建空白解析
- 上传文件并解析为交互表单
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
  - 录音 -> OpenAI compatible transcription API
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

- `OPENAI_API_KEY`：必填后才会启用 LLM 抽取与录音转写
- `OPENAI_BASE_URL`：如果你用的是 OpenAI 兼容网关，可在这里填写
- `OPENAI_MODEL`：默认 `gpt-4.1-mini`
- `TRANSCRIPTION_MODEL`：默认 `gpt-4o-mini-transcribe`
- 也可以在页面左侧的“模型配置”卡片中直接通过 GUI 保存这些配置

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
- 当前 demo 聚焦“解析 -> 人工确认 -> 保存/导出 JSON”链路，没有生成回填后的 `docx`
- 如果没有配置 LLM，录音文件无法转写，但文档类文件仍可使用规则抽取流程继续演示
- GUI 中保存的模型配置会覆盖 `.env` 中的默认值，并在下一次解析时立即生效
