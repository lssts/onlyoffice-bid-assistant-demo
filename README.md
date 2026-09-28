# ONLYOFFICE 投标助手 Demo

Vue 3 + Python FastAPI + SQLite 的投标模板业务验证项目。连接共享的 ONLYOFFICE Docs 9.2.1 商用实例，支持外部页面 Automation API。

**业务工作台：** http://127.0.0.1:5173/workflow  
**原功能验证台：** http://127.0.0.1:5173/

## 给接手的 AI

先读 [AI_HANDOFF.md](AI_HANDOFF.md)，再读 [AGENTS.md](AGENTS.md)。其中说明业务目标、代码位置、字段协议、网络方向、保存机制与未实现能力。不要把本 Demo 当成已验收的全自动标书系统。

## 同一局域网快速运行

共享文档服务在项目所有者电脑：`http://10.174.202.82:9898`。接收者在**自己的电脑**运行前后端，无需另装 ONLYOFFICE 容器。

准备 Git、Python 3.12、Node.js 22 LTS（含 npm）；先确认能够访问上面的文档服务健康检查 `/healthcheck`。

```powershell
git clone https://github.com/lssts/onlyoffice-bid-assistant-demo.git
cd onlyoffice-bid-assistant-demo
.\start.ps1
```

这是私有仓库，需要先获授 GitHub 访问权限。若 PowerShell 阻止脚本，可只对本次进程运行 `powershell -ExecutionPolicy Bypass -File .\start.ps1`。

首次运行会安装锁定的依赖、自动检测本机到文档服务器所用的 IPv4 地址，生成被 Git 忽略的 `backend/.env`，后台启动服务。配置已存在时不覆盖。示例：

```powershell
# 自动选择了 VPN/虚拟网卡时，请明确填“自己的电脑 IP”
.\start.ps1 -BackendHost 10.174.202.100
```

该参数只在首次创建 `.env` 时生效。已有配置请修改 `.env` 后重启 Python 后端。`start.ps1` 会保留已监听的服务，不会自动重启已有进程。

## 两个地址不能混淆

| 配置 | 对方电脑上应填写 | 用途 |
|---|---|---|
| `ONLYOFFICE_URL` | `http://10.174.202.82:9898` | 浏览器、Python 访问共享文档服务 |
| `BACKEND_CONTAINER_URL` | `http://对方电脑的局域网IP:8010` | ONLYOFFICE 下载源文档、调用保存回调 |

第二项不能照抄所有者的 IP，也不能在对方电脑使用 `localhost` 或 `host.docker.internal`；它们不能指向对方的后端。

对方电脑需允许共享文档服务器访问 TCP 8010；所有者电脑需允许对方访问 TCP 9898。Windows 防火墙应只对需要的局域网来源开放。前端默认只监听对方电脑的 127.0.0.1:5173。受控开发 Demo 没有业务登录与权限隔离，不要开放到公网。

目前共享 ONLYOFFICE 的 browser/inbox/outbox JWT 均关闭，示例与其一致。若所有者启用 JWT，双方需要私下同步对应密钥并填写本地 `.env`，不要提交密钥。仓库不包含商业许可证、容器配置或数据库备份。

健康检查：

```powershell
.\scripts\check-environment.ps1
```

所有者还需在自己的容器中验证回程（示例中的 IP 换成对方电脑）：

```powershell
docker exec onlyoffice-prod curl -s -o /dev/null -w '%{http_code}' --max-time 8 http://10.174.202.100:8010/api/health
```

必须返回 200；仅对方能访问 9898，并不能证明文档能加载和保存。

## AI 配置

仓库中的 AI 地址、模型、密钥均为空，不包含所有者的 AI 配置。对方自行在 `backend/.env` 填写：

```dotenv
BID_AI_BASE_URL=https://YOUR_PROVIDER/v1
BID_AI_MODEL=YOUR_MODEL
BID_AI_API_KEY=YOUR_KEY
```

带引号的字符串也可使用。修改后重启后端。未配置时可运行“本地规则演示”。接口采用 OpenAI 兼容 Chat Completions；不同提供商的模型、参数、输出限额需要自行验证。

## 业务步骤

上传 DOCX → 分析最后一个父章节 → 拆分独立模板与字段 → ONLYOFFICE 审核 → 匹配 SQLite 示例数据 → 后端回填新副本 → 保存检查与导出。

详细功能与限制见 [WORKFLOW.md](WORKFLOW.md)。内置数据均为虚构；真实招标原件、生成结果、AI 响应和运行数据不会随代码发布。

## 验证

```powershell
.\backend\.venv\Scripts\python.exe -m pytest backend -q
cd frontend
node --test src/stateSync.test.js src/office.test.js src/batchReview.test.js
npm run build
```

本地测试不能代替对方机器上的实际验收。克隆后至少验证：规则样本生成、文档打开、修改后保存、重新打开、字段回填、PDF 导出。
