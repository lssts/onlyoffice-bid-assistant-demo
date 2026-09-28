# 原功能验证台

以下内容对应首页 `/`；业务工作台入口为 `/workflow`。这些是验证方法与已知边界，并非生产能力承诺。

## 建议验证顺序

编辑区域保持 `100dvh`（一整个视口高），编辑配置使用 `editorConfig.customization.integrationMode: "embed"`，关闭 ONLYOFFICE 默认的外层页面自动定位。更改此配置后需点击「重连」或重新打开页面；它不是只读的 `type: "embedded"`，仍使用 desktop 编辑器。

文件工具栏下方的「内容控件外观」可选择显示或隐藏全部内容控件的边框与标签。隐藏不删除控件、文字或标签，也不解除固定条款锁定。此项通过 `SetAppearance` 修改文档属性，保存后保留，协作者共享；不是仅当前浏览器的显示偏好。打开文档时读取实际外观，不自动覆盖原设置；历史只读版本不可修改。

已在本机 9.2.1 验证显示/隐藏双向切换，并核对保存后的 DOCX：6 个内容控件均为 hidden，原标签、正文和固定承诺的锁定仍保留。

撤销/重做保留。外观下拉框及固定条款锁定提示均从统一的文档状态派生：外部命令完成、`onChangeContentControl`、文档状态事件、页面恢复焦点时重新读取；可见页面每 1.5 秒补充检查。读取合并、单次在途，切换文档丢弃旧响应，销毁时清理监听和定时器。项目名称等输入框仍是待填充草稿，不用同步读取覆盖用户尚未提交的输入。

状态读取必须使用 `executeMethod("GetAllContentControls")`。实测本机 9.2.1 中，即使 `callCommand` 只调用 getter，也可能清空重做记录；不能用它轮询状态。已用真实编辑器工具栏验证外观和锁定的撤销/重做与 Vue 同步。Demo 的锁定仍是可撤销的模板编辑操作，不代表不可绕过的业务权限。

同步层回归测试：在 frontend 目录运行 `node --test src/stateSync.test.js src/office.test.js`，覆盖事件合并、旧会话响应丢弃、暂停与异常恢复，以及只读接口和版本枚举映射。

1. 新建样本 → 文档加载 → 探测能力。
2. 填充项目名称编号 → 固定条款锁定 → 手工尝试编辑/删除条款。
3. 插入证书 → 调整宽度 → 检查比例和分页。
4. 商务/技术章节定位 → 将光标放入另一控件 → 反向读取。
5. 选择少量纯文字 → 读取 → 修改建议 → 回填 → 检查样式与撤销。
6. 新增标题 → 更新域或原生引用菜单更新目录 → 核对页码。
7. 修改独特文字 → 保存版本 → 确认等待回调完成 → 下载版本检查。
8. 双人协同 → 分别编辑 → 保存、关闭并重开检查。
9. 导出 DOCX、PDF、材料包；记录人工结论并导出报告。

每项右侧都有验收方式和当前边界。接口返回后只记录 `api_ok`；`passed` 必须通过人工选择并填写实际观察。历史记录不可自动覆盖。

## Excel 对应关系与边界

| Excel 行 | Demo 验证入口 | 现阶段边界 |
|---|---|---|
| 32 / 33 | 控件变量填充、锁定/解锁、残留词检索 | 未实现逐字符差异比较；控件锁不是权限安全边界 |
| 35 / 43 / 76 | 指定证书区域插入、替换、等比例缩放 | 样本图片比例已知；复杂浮动图和任意历史文档未验证 |
| 44 / 55 | 更新所有域、原生目录、关键词检查 | 未实现完整格式自动审查或无损自动修复 |
| 45 / 46 | 强制保存、回调落盘、快照、历史预览和副本恢复 | 文件快照，不是原生修订时间线；恢复生成新文档避免覆盖协同会话 |
| 47 / 83 | 双用户同文档协作、原生审阅 | 未实现按人限制章节、逐字符编辑审计 |
| 64 / 84 | 验证报告 DOCX、已保存 DOCX/PDF、材料 ZIP | 报告不是 AI 审查报告；ZIP 不提取任意文档内嵌附件 |
| 22 / 48 / 49 | 已标记 DOCX 章节定位、读取当前控件 | PDF 坐标定位和跨文档稳定映射未实现 |
| 61 / 62 | 关键词定位、9.2 段落标注探测 | 临时会话标注，不保证保存或重开后存在 |

界面里的 Excel 行号来自已有功能清单的对应评估项；请结合原始条款理解，不把本 Demo 缩小的实验范围当作完整交付。

## 保存机制

Vue 发起保存 → Python 调用 CommandService forcesave → ONLYOFFICE 生成文件 → 请求 Python callback → Python 校验凭证、下载文件、持久化新版本 → Vue 轮询显示结果。

收到命令返回 `error=0` 只代表请求已受理。只有回调文件落盘后才是 `saved`。`error=4` 表示服务端没有新变更；此时仅对上次已落盘文件做快照并标记 `unchanged`，不能拿它证明浏览器的新修改已经同步。

下载 DOCX/ZIP 始终读取已落盘文件；PDF 转换绑定不可变版本。导出前必须保存并核对最新版本。24 小时下载/回调凭证到期后需重新打开编辑会话。

## 工程位置

```text
backend/app.py          文件、编辑配置、签名、回调、快照、报告和转换
backend/samples.py      DOCX 内容控件样本、虚构证书图片
backend/test_app.py     隔离后端集成测试
backend/data/           SQLite、文档与版本（不入库）
frontend/src/App.vue    验证台页面、编辑器生命周期、操作流程
frontend/src/office.js  在 ONLYOFFICE 内执行的独立命令
frontend/src/cases.js   功能清单、验证步骤与边界
scripts/configure.py   读取容器配置，不输出密钥
```

`officeCommand` 会序列化到编辑器内执行，不能引用 Vue 状态或导入模块。参数经 `Asc.scope` 传递。构建暂不压缩 JS，避免隔离函数引用的名字被压缩器改写。

## 检查命令

```powershell
cd backend
.\.venv\Scripts\python.exe -m pytest -q
cd ..\frontend
npm run build
```

后端测试覆盖上传、下载签名、宏拒绝、回调签名/文档 key、过期会话不覆盖、回调下载来源限制、保存落盘、无变更快照、历史副本隔离和报告/材料包结构。

## 官方参考

- [Automation Connector](https://api.onlyoffice.com/docs/docs-api/usage-api/automation-api/connector-class/)
- [保存回调](https://api.onlyoffice.com/docs/docs-api/usage-api/callback-handler/)
- [强制保存](https://api.onlyoffice.com/docs/docs-api/additional-api/command-service/forcesave/)
- [转换接口](https://api.onlyoffice.com/docs/docs-api/additional-api/conversion-api/)

官网默认文档会随最新版更新。已从现有 9.2.1 容器静态脚本核对部分方法名称，但这不替代真实编辑器测试。
