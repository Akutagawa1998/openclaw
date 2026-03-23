# OpenClaw 本地部署指南 (Docker 容器化)

本文档包含 OpenClaw 的**功能更新日志（中文）**以及**本地 Docker 部署的完整流程**。

**部署日期：** 2026-03-04（最后更新：2026-03-17）
**OpenClaw 版本：** 2026.3.3
**源码仓库：** `~/Documents/GitHub/openclaw`

---

## 目录

- [功能更新日志（中文）](#功能更新日志中文)
  - [2026.3.3 版本](#202633-版本)
  - [2026.3.2 版本](#202632-版本)
- [本地 Docker 部署](#本地-docker-部署)
  - [架构概览](#架构概览)
  - [前置要求](#前置要求)
  - [从零开始部署](#从零开始部署)
  - [日常运维](#日常运维)
  - [版本升级](#版本升级)
  - [安全配置](#安全配置)
  - [故障排查](#故障排查)
  - [凭证轮换](#凭证轮换)
  - [备份与恢复](#备份与恢复)
- [Claude Code 快捷命令](#claude-code-快捷命令)

---

# 功能更新日志（中文）

## 2026.3.3 版本

### 新功能与改进

- **Discord/allowBots 提及过滤**：新增 `allowBots: "mentions"` 配置，仅接受提及了本机器人的 bot 消息。
- **工具/Web 搜索**：Perplexity 搜索提供商切换至 Search API，支持结构化结果及语言/地区/时间过滤器。
- **工具/Diffs 引导加载**：将 diffs 使用引导从无条件 prompt-hook 注入改为插件伴侣技能路径，减少无关回合的 prompt 噪声。
- **Agent/工具结果截断**：对超大工具结果采用头部+尾部截断策略，保留重要的末尾诊断信息。
- **Telegram/话题 Agent 路由**：支持论坛群组和私聊话题中的 `agentId` 按话题覆写，使话题可路由到专属 Agent 并隔离会话。
- **Slack/DM 输入反馈**：新增 `channels.slack.typingReaction` 配置，Socket Mode 私聊可通过表情反应显示处理状态。

### 修复

- **Nodes/system.run 审批加固**：修复 `rawCommand` 重新生成时的显式 argv 变更信号，解决直接 PATH 命令的 `rawCommand does not match` 错误。
- **模型/自定义 Provider Headers**：在内联、回退和注册表模型解析中一致传播 `models.providers.<name>.headers`，使认证代理正确接收请求头。
- **Ollama/自定义 Headers**：将解析后的模型 headers 转发至原生 Ollama 流请求。
- **守护进程/systemd 安装鲁棒性**：正确处理 `systemctl --user is-enabled` 的退出码 4（`not-found`），修复 Ubuntu 全新安装失败问题。
- **Slack/系统事件会话路由**：通过通道/账户绑定解析反应/成员/固定/交互系统事件的会话键，修复多账户场景下事件默认路由到 `agent:main` 的问题。
- **Gateway/HTTP 工具媒体兼容**：为直接 `/tools/invoke` 客户端保留原始媒体载荷访问，同时在 agent 上下文中阻止 base64 prompt 膨胀。
- **Agent/Nodes 媒体输出**：新增 `photos_latest` 动作处理，阻止返回媒体的 `nodes invoke` 命令，防止 base64 上下文膨胀。
- **TUI/会话键规范化**：将 `openclaw tui --session` 值统一为小写，修复大写名称导致实时流更新丢失的问题。
- **出站/发送配置线程化**：在出站适配器中传递已解析的 SecretRef 配置，避免重新加载未解析的运行时配置。
- **会话/子 Agent 附件**：移除 `sessions_spawn` schema 中的 `attachments[].content.maxLength` 以避免 llama.cpp GBNF 重复溢出。
- **运行时/工具状态稳定性**：修复压缩后悬空的 Anthropic `tool_use`，序列化 Discord 长时间处理运行避免阻塞新事件。
- **ACP/Discord 启动加固**：在网关重启时清理卡住的 ACP worker 子进程，解绑过时的 ACP 线程绑定。
- **扩展/媒体本地根路径传播**：在 Google Chat、Slack、iMessage、Signal、WhatsApp 的 `sendMedia` 适配器中一致转发 `mediaLocalRoots`。
- **Gateway/安全默认响应头**：为所有响应添加 `Permissions-Policy: camera=(), microphone=(), geolocation=()` 基线安全头。
- **插件/启动加载**：延迟初始化插件运行时，将启动关键 SDK 导入拆分为 `openclaw/plugin-sdk/core` 和 `openclaw/plugin-sdk/telegram`。
- **插件/启动性能**：通过短进程缓存减少突发插件发现/清单开销，跳过被禁用的内存插件导入。
- **配置/心跳遗留路径**：自动迁移顶层 `heartbeat` 至 `agents.defaults.heartbeat`（带合并语义），保留启动失败的详细错误路径。
- **路由/会话重复抑制**：对齐共享会话投递上下文继承和通道配对路由字段合并，避免 dmScope=main 跨表面重复回复。
- **安全/认证标签**：从用户界面的认证状态标签中移除令牌和 API 密钥片段，防止 `/status` 和 `/models` 泄露凭证。
- **iOS/语音时序安全**：守卫系统语音的开始/完成回调仅对活跃 utterance 生效，避免快速停止/重启周期中的误归因。
- **iOS/Talk 增量语音节奏**：允许长段无标点助手内容在安全空白边界开始朗读，使语音响应更快开始。
- **iOS/Watch 回复可靠性**：使 watch 会话激活等待在并发请求下更鲁棒，对齐 Swift 6 actor 安全。
- **iOS/TTS 播放回退**：在 provider 格式不支持时从 PCM 切换到 MP3，保持语音播放韧性。
- **Telegram/多账户默认路由**：仅对无显式默认的 2+ 账户配置发出警告，增加 `openclaw doctor` 多账户默认缺失/无效警告。
- **Telegram/草稿流边界稳定性**：稳定回答通道消息边界、保留/重置预览状态、抑制 `NO_REPLY` 前导片段泄漏。
- **Telegram/DM 草稿最终投递**：将纯文本 `sendMessageDraft` 预览物化为一条永久最终消息，避免重复最终发送。
- **Discord/频道解析改进**：默认数字接收者为频道，加固允许列表数字 ID 处理，避免入站 WS 心跳停滞。
- **Discord/分块投递可靠性**：使用 REST 客户端时保持分块顺序，在 429/5xx 时按账户重试设置重试。
- **Discord/提及处理**：添加基于 ID 的提及格式化 + 缓存重写，解析入站提及为显示名称。
- **Discord/在线状态默认值**：在就绪时发送在线状态更新（未配置自定义时），使 bot 不再默认显示离线。
- **Discord/语音消息**：使用 JSON fetch 请求上传槽，修复内容类型错误。
- **Discord/语音解码回退**：放弃原生 Opus 依赖，使用 opusscript 进行语音解码。
- **Telegram/设备配对通知**：`/pair qr` 自动启用一次性通知，新配对请求自动 ping。
- **执行心跳路由**：将 exec 触发的心跳唤醒限定到 agent 会话键，不再唤醒无关 agent。
- **macOS/Tailscale 远程网关发现**：添加 Tailscale Serve 回退对等探测路径。
- **iOS/Gateway 密钥链加固**：将网关元数据和 TLS 指纹移至设备密钥链存储，减少升级期间的凭证丢失风险。
- **iOS/并发稳定性**：用锁保护访问模式替换相机和网关连接路径中的共享状态访问。
- **插件出站/纯文本适配器兼容**：允许仅实现 `sendText` 的直接投递通道插件保持出站能力。
- **CLI/编码 Agent 可靠性**：默认 `claude-cli` 非交互参数切换至 `--permission-mode bypassPermissions`。
- **ACP/ACPX 会话引导**：当 `sessions ensure` 未返回会话标识符时重试 `sessions new`。
- **ACP/sessions_spawn 父流可见性**：新增 `streamTo: "parent"` 将子运行进度转发回请求者会话。
- **Agent/引导截断警告**：统一嵌入式 + CLI 运行时的引导预算/截断分析。
- **Agent/Skills 运行时加载**：将运行配置传播至嵌入式尝试和压缩技能入口加载。
- **Agent/会话启动日期定位**：在启动/压缩后上下文中替换 `YYYY-MM-DD` 占位符。
- **Agent/压缩连续性**：扩展分阶段摘要合并指令以保留活跃任务状态、批处理进度。
- **Agent/压缩安全结构加固**：要求精确的回退摘要标题，在 prompt 嵌入前清理不受信任的压缩指令文本。
- **Gateway/状态自版本报告**：使 `openclaw status` 中的网关版本优先使用运行时 `VERSION`。
- **内存/QMD 索引隔离**：设置 `QMD_CONFIG_DIR` 防止跨 Agent 集合索引。
- **LINE 认证边界加固**：跨配对存储、DM/群组允许列表、webhook 认证等全面强化安全语义。
- **LINE 媒体下载修复**：修复文件媒体下载处理和 M4A 音频分类。
- **LINE 上下文和路由修复**：修复群组/房间对等路由和命令授权上下文传播。
- **LINE 状态/配置/webhook 修复**：修复快照/配置状态的误报，接受 LINE webhook HEAD 探测。

---

## 2026.3.2 版本

### 新功能与改进

- **密钥/SecretRef 全面覆盖**：在全部 64 个受支持的用户凭证目标上扩展 SecretRef 支持，包括运行时收集器、`openclaw secrets` 规划/应用/审计流程、onboarding SecretInput UX。
- **工具/PDF 分析**：新增一级 `pdf` 工具，支持原生 Anthropic 和 Google PDF provider，以及非原生模型的提取回退，可配置默认值（`agents.defaults.pdfModel`、`pdfMaxBytesMb`、`pdfMaxPages`）。
- **出站适配器/插件**：在 Discord、Slack、WhatsApp、Zalo 等添加共享 `sendPayload` 支持，支持多媒体迭代和分块文本回退。
- **模型/MiniMax**：新增 `MiniMax-M2.5-highspeed` 一级支持，保留 `MiniMax-M2.5-Lightning` 兼容。
- **会话/附件**：为 `sessions_spawn`（子 Agent 运行时）新增内联文件附件支持，支持 base64/utf8 编码。
- **Telegram/流式默认值**：`channels.telegram.streaming` 默认改为 `partial`（原为 `off`），新 Telegram 配置开箱即用实时预览流。
- **Telegram/DM 流式**：使用 `sendMessageDraft` 进行私聊预览流式传输，推理/回答预览通道分离。
- **Telegram/语音提及过滤**：新增 `disableAudioPreflight` 选项，可跳过群组/话题中语音笔记的提及检测预处理。
- **CLI/配置验证**：新增 `openclaw config validate`（含 `--json`），在网关启动前验证配置文件。
- **工具/Diffs**：新增 PDF 文件输出支持及渲染质量自定义控件（`fileQuality`、`fileScale`、`fileMaxWidth`）。
- **内存/Ollama 嵌入**：新增 `memorySearch.provider = "ollama"` 和 `memorySearch.fallback = "ollama"` 支持。
- **Zalo Personal 插件**：重构通道运行时为原生 `zca-js` 集成，移除外部 CLI 传输。
- **Plugin SDK/通道可扩展性**：在 `ChannelGatewayContext` 上暴露 `channelRuntime`，使外部通道插件可访问共享运行时助手。
- **Plugin 运行时/STT**：新增 `api.runtime.stt.transcribeAudioFile(...)` 供扩展通过 OpenClaw 配置的音频 provider 转录本地音频文件。
- **Plugin Hooks/会话生命周期**：在 `session_start`/`session_end` hook 事件中包含 `sessionKey`。
- **Hooks/消息生命周期**：新增内部 hook 事件 `message:transcribed` 和 `message:preprocessed`，以及更丰富的出站 `message:sent` 上下文。
- **媒体理解/音频回显**：新增 `tools.media.audio.echoTranscript` + `echoFormat`，可向原始聊天发送预 Agent 转录确认消息。
- **Plugin 运行时/系统**：暴露 `runtime.system.requestHeartbeatNow(...)` 供扩展立即唤醒目标会话。
- **Plugin 运行时/事件**：暴露 `runtime.events.onAgentEvent` 和 `runtime.events.onSessionTranscriptUpdate`。
- **CLI/横幅标语**：新增 `cli.banner.taglineMode`（`random` | `default` | `off`）控制启动输出中的趣味标语。

### 破坏性变更

- **工具配置文件默认值变更**：onboarding 现在默认将 `tools.profile` 设为 `messaging`。新配置不再默认启用广泛的编码/系统工具。
- **ACP 调度默认启用**：ACP dispatch 现在默认启用，需显式 `acp.dispatch.enabled=false` 来关闭。
- **Plugin SDK HTTP 处理器变更**：移除 `api.registerHttpHandler(...)`，插件需通过 `api.registerHttpRoute(...)` 注册显式 HTTP 路由。
- **Zalo Personal 插件变更**：不再依赖外部 `zca`-compatible CLI 二进制文件，升级后需运行 `openclaw channels login --channel zalouser` 刷新会话。

### 修复

- **飞书/出站渲染模式**：尊重飞书账户 `renderMode` 设置，卡片模式使用 markdown 卡片投递。
- **插件命令/运行时加固**：验证和规范化插件命令名称/描述，防止格式错误导致启动崩溃。
- **Telegram/重复令牌检查**：在账户令牌缺失时守卫重复令牌检查，防止 `token.trim()` 崩溃。
- **Discord/生命周期启动状态**：在生命周期调试监听器附加前推送即时 `connected` 状态快照。
- **飞书/入站提及规范化**：将飞书提及占位符规范化为显式标签，提升多提及上下文保真度。
- **飞书/多应用提及路由**：验证提及显示名称及 bot `open_id`，防止多 bot 群组中的假阳性自提及。
- **飞书/会话内存 hook 一致性**：飞书 `/new` 和 `/reset` 命令触发共享 `before_reset` 会话内存 hook。
- **飞书/群组系统提示**：将群组 `systemPrompt` 配置转发至飞书和 LINE 群组事件的入站上下文。
- **Gateway/子 Agent TLS 配对**：允许认证的本地网关客户端后端自连接跳过设备配对。
- **Gateway/WS 安全**：默认仅保留明文 `ws://` 回环访问，需显式 `OPENCLAW_ALLOW_INSECURE_PRIVATE_WS=1` 放行私网。
- **Gateway/安全加固**：将回环原点开发允许与实际本地 socket 客户端绑定，加固安全正则检测。
- **Gateway/插件 HTTP 加固**：要求插件路由注册显式 `auth`，添加路由所有权守卫。
- **安全/Webhook 请求加固**：在 BlueBubbles 和 Google Chat webhook 处理器中强制认证前解析。
- **安全/ACP 沙箱继承**：对沙箱请求者会话的 ACP spawn 实施失败关闭运行时守卫。
- **安全/Web 工具 SSRF 守卫**：在设置了代理环境变量时保持 DNS 固定。
- **安全/节点相机 URL 下载**：将节点相机 URL 下载绑定到已解析的节点主机，使用 SSRF 守卫 fetch。
- **安全/提示欺骗加固**：停止将排队的运行时事件注入用户角色 prompt 文本，改为通过受信任的系统 prompt 上下文路由。
- **配置/备份加固**：对轮换的配置备份强制仅所有者（`0600`）权限。
- **浏览器/CDP 启动就绪**：启动 Chrome 后等待 CDP websocket 就绪，减少 `PortInUseError` 竞争。
- **沙箱/Docker 设置命令解析**：接受 `setupCommand` 为字符串或字符串数组。
- **沙箱/引导上下文边界加固**：拒绝解析到源工作区外的符号链接/硬链接别名引导种子文件。
- **语音通话/Twilio 签名验证**：跨确定性 URL 端口变体重试签名验证。
- **语音通话/运行时生命周期**：防止 `EADDRINUSE` 循环，使 webhook `start()` 幂等。
- **媒体理解/音频转录守卫**：跳过微小/空音频文件（< 1024 字节）。
- **媒体理解/MIME 规范化**：规范化参数化/大小写变体 MIME 字符串，使 WhatsApp 语音笔记正确分类和路由。

---

# 本地 Docker 部署

## 架构概览

```
浏览器 (http://127.0.0.1:18789)
        |
  [Docker 桥接网络]
        |
  ┌─────────────────────────────────────────┐
  │  openclaw-gateway 容器                  │
  │  用户: node (uid 1000, 非 root)         │
  │  文件系统: 只读根 + tmpfs               │
  │  能力: 全部丢弃 + NET_BIND_SERVICE      │
  │  安全: no-new-privileges               │
  │                                         │
  │  ws://0.0.0.0:18789 (容器内部)          │
  │  → 映射到宿主机 127.0.0.1:18789        │
  └─────────────────────────────────────────┘
        |
  [仅出站]
        |
  Anthropic / OpenAI / Google APIs
```

---

## 目录结构

```
~/.openclaw-docker/                     # 700 (仅所有者)
├── .env                                # 600 — API 密钥、网关令牌
├── docker-compose.yml                  # Docker 编排（加固版）
├── README.md                           # 本文件
├── config/                             # 700
│   └── openclaw.json                   # 600 — 网关配置
└── workspace/                          # 700 — Agent 工作区
```

所有敏感文件权限设为 `600`（仅所有者可读写），父目录权限为 `700`（仅所有者）。

---

## 前置要求

- **Docker** >= 24.0（已测试 28.4.0）
- **Node.js** >= 22（从源码构建镜像时需要）
- **pnpm**（从源码构建时需要）
- 至少一个模型 provider 的 API 密钥：
  - Anthropic: `ANTHROPIC_API_KEY`
  - OpenAI: `OPENAI_API_KEY`
  - Google: `GOOGLE_API_KEY`

---

## 从零开始部署

### 方式一：自动部署脚本（推荐）

从仓库根目录运行：

```bash
cd ~/Documents/GitHub/openclaw
./docker-setup.sh
```

该脚本会自动完成：构建镜像、运行 onboarding 向导、生成网关令牌写入 `.env`、通过 Docker Compose 启动网关。

可选环境变量：
- `OPENCLAW_IMAGE` — 使用远程镜像（如 `ghcr.io/openclaw/openclaw:latest`）
- `OPENCLAW_SANDBOX=1` — 启用 Docker 网关沙箱
- `OPENCLAW_DOCKER_SOCKET` — 自定义 Docker socket 路径（默认 `/var/run/docker.sock`）

### 方式二：手动部署

#### 1. 构建 Docker 镜像

```bash
cd ~/Documents/GitHub/openclaw
docker build -t openclaw:local .
```

构建约需 5 分钟，镜像约 3.4 GB（含 Node.js、pnpm 依赖、构建产物）。

可选构建参数：
- `--build-arg OPENCLAW_INSTALL_BROWSER=1` — 预装 Chromium + Xvfb（约 +300 MB）
- `--build-arg OPENCLAW_INSTALL_DOCKER_CLI=1` — 安装 Docker CLI（约 +50 MB，沙箱功能需要）

#### 2. 创建隔离配置目录

```bash
mkdir -p ~/.openclaw-docker/config ~/.openclaw-docker/workspace
chmod 700 ~/.openclaw-docker ~/.openclaw-docker/config ~/.openclaw-docker/workspace
```

#### 3. 生成认证令牌

```bash
openssl rand -hex 32
# 生成 64 字符的十六进制字符串，保存备用
```

#### 4. 创建 .env 文件

```bash
cat > ~/.openclaw-docker/.env << 'EOF'
OPENCLAW_GATEWAY_TOKEN=<粘贴生成的令牌>

ANTHROPIC_API_KEY=<你的密钥>
OPENAI_API_KEY=<你的密钥>
GOOGLE_API_KEY=<你的密钥>

OPENCLAW_CONFIG_DIR=/Users/<用户名>/.openclaw-docker/config
OPENCLAW_WORKSPACE_DIR=/Users/<用户名>/.openclaw-docker/workspace
OPENCLAW_GATEWAY_PORT=18789
OPENCLAW_BRIDGE_PORT=18790
OPENCLAW_GATEWAY_BIND=lan
EOF

chmod 600 ~/.openclaw-docker/.env
```

#### 5. 创建网关配置

将 `openclaw.json` 放置于 `~/.openclaw-docker/config/openclaw.json`。
首次启动时，Gateway 的 `doctor` 会自动填充默认字段。
加固设置详见下方"安全配置"章节。

```bash
chmod 600 ~/.openclaw-docker/config/openclaw.json
```

#### 6. 创建 docker-compose.yml

文件位于 `~/.openclaw-docker/docker-compose.yml`。
加固版 Docker Compose 配置详见下方"Docker Compose 加固"章节。

#### 7. 启动网关

```bash
cd ~/.openclaw-docker
docker compose up -d openclaw-gateway
```

#### 8. 审批浏览器设备

首次访问时，Control UI 需要设备配对：

```bash
# 列出待审批请求
docker exec openclaw-docker-openclaw-gateway-1 node dist/index.js devices list

# 审批请求（使用列表输出中的 Request ID）
docker exec openclaw-docker-openclaw-gateway-1 node dist/index.js devices approve <request-id>
```

然后在浏览器中刷新 `http://127.0.0.1:18789`。

---

## 日常运维

### 启动 / 停止 / 重启

```bash
cd ~/.openclaw-docker

# 启动
docker compose up -d openclaw-gateway

# 停止
docker compose down

# 重启
docker compose restart openclaw-gateway
```

### 查看日志

```bash
# 实时跟踪日志
docker logs -f openclaw-docker-openclaw-gateway-1

# 查看最近 100 行
docker logs --tail 100 openclaw-docker-openclaw-gateway-1
```

### 访问 Control UI

在浏览器中打开 `http://127.0.0.1:18789`。
首次连接时，在 UI 设置中粘贴 `.env` 中的网关令牌。

### 使用 CLI

```bash
cd ~/.openclaw-docker
docker compose run --rm openclaw-cli chat
```

### 健康检查

```bash
# 容器状态
docker ps --filter name=openclaw-gateway

# 健康端点
curl -sf http://127.0.0.1:18789/healthz

# 详细状态（需要令牌）
docker exec openclaw-docker-openclaw-gateway-1 node dist/index.js status
```

### 设备管理

```bash
# 列出已配对和待配对设备
docker exec openclaw-docker-openclaw-gateway-1 node dist/index.js devices list

# 审批待配对设备
docker exec openclaw-docker-openclaw-gateway-1 node dist/index.js devices approve <request-id>
```

---

## 版本升级

```bash
# 1. 拉取最新源码
cd ~/Documents/GitHub/openclaw
git pull

# 2. 重新构建镜像
docker build -t openclaw:local .

# 3. 使用新镜像重启
cd ~/.openclaw-docker
docker compose down
docker compose up -d openclaw-gateway

# 4. 验证
docker logs --tail 20 openclaw-docker-openclaw-gateway-1
curl -sf http://127.0.0.1:18789/healthz
```

---

## 安全配置

### openclaw.json 加固设置

| 设置项 | 值 | 用途 |
|--------|------|------|
| `gateway.bind` | `"lan"` | Docker 桥接网络内必需；宿主机端口绑定限制到 `127.0.0.1` |
| `gateway.auth.mode` | `"token"` | 256 位随机令牌认证 |
| `gateway.controlUi.allowedOrigins` | `["http://localhost:18789", "http://127.0.0.1:18789"]` | WebSocket 严格源允许列表 |
| `gateway.reload.mode` | `"hybrid"` | 安全变更热应用，其他变更重启 |
| `tools.profile` | `"messaging"` | 受限工具集（非 "full"） |
| `tools.deny` | `["group:automation", "group:runtime", "sessions_spawn"]` | 阻止自动化、运行时和会话 spawn 工具 |
| `tools.exec.security` | `"deny"` | 完全阻止 shell 执行 |
| `tools.fs.workspaceOnly` | `true` | 文件操作限制在工作区目录 |
| `tools.elevated.enabled` | `false` | 无特权提升 |
| `session.dmScope` | `"per-channel-peer"` | 每通道每联系人隔离会话 |
| `logging.redactSensitive` | `"tools"` | 日志中脱敏工具输出 |

### Docker Compose 加固

| 措施 | 设置 | 用途 |
|------|------|------|
| **端口绑定** | `127.0.0.1:18789:18789` | 仅本地可访问，非局域网 |
| **能力** | `cap_drop: ALL`, `cap_add: NET_BIND_SERVICE` | 最小 Linux 能力 |
| **特权提升** | `no-new-privileges:true` | 阻止 suid/sgid 提权 |
| **只读根** | `read_only: true` | 不可变容器文件系统 |
| **tmpfs** | `/tmp:noexec,nosuid`, `/home/node/.npm` | 可写临时目录，禁止执行 |
| **用户** | `node` (uid 1000) | 非 root 容器用户 |
| **健康检查** | `/healthz` 每 30 秒 | 自动检测故障 |
| **Init** | `init: true` | 正确的信号处理和僵尸进程回收 |
| **重启** | `unless-stopped` | 崩溃后自动重启 |

### 文件权限汇总

| 路径 | 权限 | 内容 |
|------|------|------|
| `~/.openclaw-docker/` | `700` | 所有部署文件 |
| `~/.openclaw-docker/.env` | `600` | API 密钥、网关令牌 |
| `~/.openclaw-docker/config/openclaw.json` | `600` | 含认证令牌的网关配置 |
| `~/.openclaw-docker/config/` | `700` | 配置目录 |
| `~/.openclaw-docker/workspace/` | `700` | Agent 工作区 |

---

## 安全验证清单

定期或在任何配置更改后运行以下检查：

```bash
# 1. 端口绑定 — 必须显示 127.0.0.1，而非 0.0.0.0
docker port openclaw-docker-openclaw-gateway-1

# 2. 容器安全设置
docker inspect openclaw-docker-openclaw-gateway-1 --format '
User: {{.Config.User}}
ReadOnly: {{.HostConfig.ReadonlyRootfs}}
Privileged: {{.HostConfig.Privileged}}
CapDrop: {{.HostConfig.CapDrop}}
CapAdd: {{.HostConfig.CapAdd}}
SecurityOpt: {{.HostConfig.SecurityOpt}}'

# 3. 认证强制 — 无令牌应失败
curl -sf http://127.0.0.1:18789/api/status && echo "失败: API 无需认证即可访问" || echo "通过: API 需要认证"

# 4. 文件权限
ls -la ~/.openclaw-docker/.env ~/.openclaw-docker/config/openclaw.json
# 两者应显示 -rw------- (600)

# 5. 配置完整性哈希（初始设置后保存，后续比较）
shasum -a 256 ~/.openclaw-docker/config/openclaw.json
```

---

## 故障排查

### 容器持续重启

```bash
docker logs openclaw-docker-openclaw-gateway-1 --tail 40
```

常见原因：
- **配置验证错误**：修复 `openclaw.json` 中报告的字段，或删除让 `doctor` 重新创建
- **端口冲突**：18789 端口被占用；在 `.env` 中更改 `OPENCLAW_GATEWAY_PORT`

### 浏览器中出现 "origin not allowed"

`gateway.controlUi.allowedOrigins` 必须包含浏览器中使用的确切 URL（含端口）。
修改配置后重启容器。

### "token_missing" / 需要配对

1. Control UI 需要网关令牌 — 在 UI 设置中粘贴
2. 如因多次重试被限流，先重启容器
3. 新浏览器/设备需通过 `docker exec ... devices approve <id>` 审批

### "rate_limited" 错误

重启容器以清除限流器：
```bash
cd ~/.openclaw-docker && docker compose restart openclaw-gateway
```

### 配置被网关自动修改

Gateway 的 `doctor` 可能在启动时添加默认字段，这是正常行为。
查看差异：
```bash
docker exec openclaw-docker-openclaw-gateway-1 cat /home/node/.openclaw/openclaw.json
```

---

## 凭证轮换

### 轮换网关令牌

```bash
# 1. 生成新令牌
NEW_TOKEN=$(openssl rand -hex 32)

# 2. 更新 .env
sed -i '' "s/^OPENCLAW_GATEWAY_TOKEN=.*/OPENCLAW_GATEWAY_TOKEN=$NEW_TOKEN/" ~/.openclaw-docker/.env

# 3. 更新 openclaw.json（gateway.auth 下的 token 字段）
jq --arg t "$NEW_TOKEN" '.gateway.auth.token = $t' \
  ~/.openclaw-docker/config/openclaw.json > /tmp/oc-config.tmp \
  && mv /tmp/oc-config.tmp ~/.openclaw-docker/config/openclaw.json \
  && chmod 600 ~/.openclaw-docker/config/openclaw.json

# 4. 重启
cd ~/.openclaw-docker && docker compose restart openclaw-gateway

# 5. 重新配对浏览器（旧令牌已失效）
```

### 轮换 API 密钥

编辑 `~/.openclaw-docker/.env`，替换密钥后重启：
```bash
cd ~/.openclaw-docker && docker compose restart openclaw-gateway
```

---

## 备份与恢复

### 备份

```bash
tar czf openclaw-backup-$(date +%Y%m%d).tar.gz \
  -C ~ .openclaw-docker/config .openclaw-docker/workspace .openclaw-docker/.env .openclaw-docker/docker-compose.yml

chmod 600 openclaw-backup-$(date +%Y%m%d).tar.gz
```

### 恢复

```bash
mkdir -p ~/.openclaw-docker
tar xzf openclaw-backup-YYYYMMDD.tar.gz -C ~
chmod 700 ~/.openclaw-docker ~/.openclaw-docker/config ~/.openclaw-docker/workspace
chmod 600 ~/.openclaw-docker/.env ~/.openclaw-docker/config/openclaw.json

cd ~/.openclaw-docker && docker compose up -d openclaw-gateway
```

---

## Claude Code 快捷命令

两个自定义 Claude Code 斜杠命令管理此部署，安装在 `~/.claude/commands/`，任何项目、任何目录均可使用。

### `/openclaw_setup` — 新设备一键部署

在新机器上自动完成整个部署流程（交互式，会询问配置和 API 密钥）。

**执行步骤（共 9 步）：**

| 步骤 | 操作 | 详情 |
|------|------|------|
| 预检 | 检查 Docker | 验证 `docker` 及守护进程可用 |
| 预检 | 检查已有安装 | 若 `~/.openclaw-docker/` 存在，提供备份+覆盖或中止选项 |
| 预检 | 定位源码仓库 | 搜索常见路径；未找到则提供克隆选项 |
| 1 | 构建镜像 | `docker build -t openclaw:local .`（约 5 分钟，后台运行） |
| 2 | 创建目录 | `~/.openclaw-docker/{config,workspace}`，`chmod 700` |
| 3 | 生成令牌 | `openssl rand -hex 32`（256 位） |
| 4 | 配置 API 密钥 | 创建带 `REPLACE_ME` 占位符的 `.env`，提示手动编辑 |
| 5 | 写入配置 | 加固版 `openclaw.json` |
| 6 | 写入 docker-compose | 加固版：`cap_drop: ALL`、`read_only: true`、仅本地端口 |
| 7 | 启动网关 | `docker compose up -d` + 等待 + 健康检查 |
| 8 | 安全审计 | 验证端口绑定、能力、认证、文件权限 |
| 9 | 设备配对 | 列出待审批请求，引导审批浏览器访问 |

### `/openclaw_run` — 管理运行中的服务

一体化管理命令，默认子命令为 `start`。

| 命令 | 功能 | 关键操作 |
|------|------|----------|
| `/openclaw_run` | 启动网关 | `docker compose up -d` + 健康检查 |
| `/openclaw_run stop` | 停止网关 | `docker compose down` |
| `/openclaw_run restart` | 重启网关 | `docker compose restart` + 健康检查 |
| `/openclaw_run status` | 查看状态 | 容器状态 + 健康端点 + CPU/内存 |
| `/openclaw_run logs` | 查看日志 | `docker logs --tail 50` |
| `/openclaw_run logs follow` | 实时日志 | `docker logs -f` |
| `/openclaw_run approve` | 设备配对 | 列出待审批请求并引导审批 |
| `/openclaw_run shell` | CLI 聊天 | `docker compose run --rm openclaw-cli chat` |
| `/openclaw_run update` | 重建重启 | `git pull` + `docker build` + 重启 + 验证 |
| `/openclaw_run check` | 安全审计 | 端口、能力、认证、权限、配置哈希 |
| `/openclaw_run token` | 查看令牌 | 从 `.env` 读取 |
| `/openclaw_run rotate` | 轮换令牌 | 新 256 位令牌 + 更新配置 + 重启 |
| `/openclaw_run backup` | 备份全部 | 压缩 config + workspace + .env + compose |

### 命令文件位置

| 文件 | 路径 |
|------|------|
| 部署命令 | `~/.claude/commands/openclaw_setup.md` |
| 运行命令 | `~/.claude/commands/openclaw_run.md` |

修改 markdown 文件即可调整命令行为，下次调用时生效（无需重启）。

### 迁移命令到新机器

```bash
scp ~/.claude/commands/openclaw_setup.md user@new-host:~/.claude/commands/
scp ~/.claude/commands/openclaw_run.md user@new-host:~/.claude/commands/
```

然后在新机器上运行 `/openclaw_setup` 进行部署。
