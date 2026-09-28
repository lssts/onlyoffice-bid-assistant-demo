<script setup>
import { ref, computed, onMounted, onBeforeUnmount, nextTick } from "vue";
import {
  FileText,
  FlaskConical,
  ArrowUpRight,
  Upload,
  Plus,
  RefreshCw,
  Check,
  ChevronRight,
  Download,
  Activity,
  AlertCircle,
  Link,
  PanelRightClose,
} from "lucide-vue-next";
import { api, post, download } from "./api";
import { command, method, readControlState } from "./office";
import { cases } from "./cases";
import { createStateSync } from "./stateSync";

const docs = ref([]),
  docId = ref(""),
  health = ref(null),
  active = ref("connection"),
  busy = ref(false),
  ready = ref(false),
  editorState = ref("等待连接"),
  error = ref(""),
  notice = ref(""),
  versions = ref([]),
  results = ref([]),
  logs = ref([]),
  controls = ref([]),
  currentControl = ref(null),
  paragraph = ref(null),
  side = ref(true);
const projectName = ref("南昌示范工程投标项目"),
  projectNumber = ref("DEMO-2026-001"),
  selection = ref(""),
  suggestion = ref(""),
  note = ref(""),
  verdict = ref("partial"),
  auditResult = ref(null),
  viewVersion = ref("");
const params = new URLSearchParams(location.search),
  user = params.get("user") === "b" ? "b" : "a";
let editor = null,
  connector = null,
  loadingScript = null,
  openSequence = 0;
const selected = computed(() => cases.find((c) => c.id === active.value)),
  currentDoc = computed(() => docs.value.find((d) => d.id === docId.value));
const canAct = computed(() => ready.value && !busy.value && !viewVersion.value);
const snapshotReady = ref(false), syncError = ref("");
const controlAppearance = computed(() => {
  if (!snapshotReady.value) return "unknown";
  const values = controls.value.map(c => c.appearance);
  return !values.length ? "none" : values.every(v => v === values[0]) ? values[0] : "mixed";
});
const fixedLock = computed(() => {
  if (!snapshotReady.value) return "尚未读取";
  const c = controls.value.find(c => c.tag === "fixed:commitment");
  if (!c) return "未找到固定条款";
  return {unlocked:"未锁定",sdtContentLocked:"内容与控件均锁定",contentLocked:"内容锁定",sdtLocked:"控件锁定"}[c.lock] || "未知状态";
});
const stateSync = createStateSync({
  read: () => readControlState(connector),
  apply: value => { controls.value = value.controls; snapshotReady.value = true; syncError.value = ""; },
  fail: e => { snapshotReady.value = false; syncError.value = "状态同步失败：" + e.message; },
  paused: () => busy.value || !ready.value,
  visible: () => document.visibilityState === "visible",
});
const refreshEditorState = () => stateSync.request();
async function setControlAppearance(event) {
  const appearance = event.target.value;
  event.target.value = controlAppearance.value;
  await run("设置内容控件显示", () => command(connector, {op:"appearance_set",appearance}), "control-appearance");
}
const manualCount = computed(
  () =>
    cases.filter(
      (c) =>
        ["passed", "partial", "failed"].includes(testStatus(c.id)) &&
        results.value.some(
          (r) => r.test_id === c.id && r.evidence_type === "manual",
        ),
    ).length,
);
const labels = {
  api_ok: "接口已返回",
  passed: "人工通过",
  partial: "部分可行",
  failed: "验证失败",
  untested: "未测试",
};
const testStatus = (id) => {
  const rows = results.value.filter((r) => r.test_id === id);
  return (
    rows.find((r) => r.evidence_type === "manual")?.status ||
    rows[0]?.status ||
    "untested"
  );
};
function log(name, data) {
  logs.value.unshift({
    name,
    data: typeof data === "string" ? data : JSON.stringify(data, null, 2),
    time: new Date().toLocaleTimeString(),
  });
  logs.value = logs.value.slice(0, 40);
}
async function refresh() {
  [docs.value, health.value] = await Promise.all([
    api("/documents"),
    api("/health"),
  ]);
  if (!docId.value)
    docId.value =
      docs.value.find((d) => d.id === params.get("doc"))?.id ||
      docs.value[0]?.id;
  await refreshDoc();
}
async function refreshDoc() {
  if (!docId.value) return;
  [versions.value, results.value] = await Promise.all([
    api(`/documents/${docId.value}/versions`),
    api(`/results?document_id=${docId.value}`),
  ]);
}
async function run(name, fn, testId = active.value) {
  if (busy.value) return;
  busy.value = true;
  error.value = "";
  notice.value = "";
  const documentId = docId.value;
  try {
    const value = await fn();
    log(name, value ?? "接口调用完成");
    await post("/results", {
      document_id: documentId,
      test_id: testId,
      status: "api_ok",
      details: name + "\n" + JSON.stringify(value ?? null),
      evidence_type: "api",
    });
    await refreshDoc();
    notice.value = name + "已完成，请按验收提示检查实际效果。";
    return value;
  } catch (e) {
    error.value = e.message;
    log(name, e.message);
    await post("/results", {
      document_id: documentId || null,
      test_id: testId,
      status: "failed",
      details: name + "：" + e.message,
      evidence_type: "api",
    }).catch(() => {});
    await refreshDoc().catch(() => {});
  } finally {
    busy.value = false;
    stateSync.request();
  }
}
function destroy() {
  stateSync.stop();
  ready.value = false;
  snapshotReady.value = false;
  syncError.value = "";
  controls.value = [];
  connector?.disconnect();
  connector = null;
  editor?.destroyEditor();
  editor = null;
}
async function loadScript(url) {
  if (window.DocsAPI) return;
  if (!loadingScript)
    loadingScript = new Promise((resolve, reject) => {
      const script = document.createElement("script");
      script.src = url + "/web-apps/apps/api/documents/api.js";
      script.onload = resolve;
      script.onerror = () => {
        script.remove();
        loadingScript = null;
        reject(new Error("无法加载 ONLYOFFICE 编辑器脚本"));
      };
      document.head.appendChild(script);
    });
  return loadingScript;
}
async function open(version = "") {
  const seq = ++openSequence;
  destroy();
  viewVersion.value = version;
  controls.value = [];
  paragraph.value = null;
  currentControl.value = null;
  error.value = "";
  editorState.value = "检查服务";
  try {
    health.value = await api("/health");
    if (seq !== openSequence) return;
    if (!health.value.documentServer) throw new Error(health.value.message);
    const data = await api(
      `/documents/${docId.value}/config?user=${user}${version ? "&version=" + version : ""}`,
    );
    await loadScript(data.documentServerUrl);
    if (seq !== openSequence) return;
    await nextTick();
    editorState.value = "加载文档";
    editor = new window.DocsAPI.DocEditor("document-editor", {
      ...data.config,
      events: {
        onDocumentReady: () => {
          if (seq !== openSequence) return;
          editorState.value = version ? "历史版本 · 只读" : "文档已就绪";
          if (version) return;
          try {
            connector = editor.createConnector();
            ready.value = true;
            connector.attachEvent("onParagraphText", (data) => {
              paragraph.value = data;
            });
            connector.attachEvent("onClickAnnotation", (data) => {
              active.value = "review";
              log("点击段落标注", data);
            });
            log("Automation", "连接已创建；点击能力探测验证命令回调");
            connector.attachEvent("onChangeContentControl", refreshEditorState);
            stateSync.start();
          } catch (e) {
            error.value = "Automation 连接失败：" + e.message;
          }
        },
        onError: (event) => {
          error.value = "ONLYOFFICE：" + JSON.stringify(event.data);
          editorState.value = "编辑器报错";
        },
        onWarning: (event) => log("编辑器警告", event.data),
        onDocumentStateChange: (event) => {
          if (seq !== openSequence) return;
          if (event.data) editorState.value = "文档有修改；导出前请保存";
          stateSync.request();
        },
      },
    });
  } catch (e) {
    if (seq === openSequence) {
      error.value = e.message;
      editorState.value = "文档服务离线";
    }
  }
}
async function changeDoc() {
  await refreshDoc();
  await open();
}
async function makeSample() {
  await run(
    "新建验证样本",
    async () => {
      const d = await post("/documents/sample");
      docId.value = d.id;
      await refresh();
      await open();
      return { title: d.title };
    },
    "connection",
  );
}
async function upload(event) {
  const file = event.target.files[0];
  if (!file) return;
  await run(
    "上传 DOCX",
    async () => {
      const form = new FormData();
      form.append("file", file);
      const d = await api("/documents/upload", { method: "POST", body: form });
      docId.value = d.id;
      await refresh();
      await open();
      return { title: d.title };
    },
    "connection",
  );
  event.target.value = "";
}
async function inspect() {
  await run("探测文档能力", async () => {
    const v = await command(connector, { op: "inspect" });
    return v;
  });
}
const act = (name, input) => run(name, () => command(connector, input));
async function locate(tag) {
  await run("定位 " + tag, async () => {
    const all = await method(connector, "GetAllContentControls");
    const c = all?.find((c) => c.Tag === tag);
    if (!c) throw new Error("找不到指定控件，请使用验证样本");
    await method(connector, "SelectContentControl", [c.InternalId]);
    return c;
  });
}
async function reverse() {
  await run("读取光标所在控件", async () => {
    currentControl.value = await method(
      connector,
      "GetCurrentContentControlPr",
    );
    if (!currentControl.value)
      throw new Error("请先把光标放入一个内容控件内部");
    return currentControl.value;
  });
}
async function insertImage() {
  await run("插入 / 替换测试证书", async () => {
    const blob = await fetch("/api/assets/certificate.png").then((r) =>
      r.blob(),
    );
    const data = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
    return command(connector, {
      op: "image",
      tag: "asset:certificate",
      url: data,
    });
  });
}
async function readSelection() {
  await run("读取选区", async () => {
    const v = await method(connector, "GetSelectedContent", [{ type: "text" }]);
    if (!v?.trim()) throw new Error("请先在正文中选择一小段纯文本");
    selection.value = v;
    suggestion.value = v + "（请在此编辑改写建议）";
    return { text: v };
  });
}
async function replaceSelection() {
  await run("回填当前选区", async () => {
    const current = await method(connector, "GetSelectedContent", [
      { type: "text" },
    ]);
    if (current !== selection.value)
      throw new Error("选区已变化，请重新读取后再回填");
    await method(connector, "PasteText", [suggestion.value]);
    selection.value = "";
    return { note: "已调用纯文本回填，需人工检查格式与范围" };
  });
}
async function annotate() {
  await run("标注最近编辑的段落", async () => {
    const p = paragraph.value;
    if (!p?.text)
      throw new Error("尚未收到段落文本事件，请在正文中编辑一个段落");
    const length = Math.min(8, p.text.length);
    await method(connector, "AnnotateParagraph", [
      {
        type: "highlightText",
        name: "bid-demo",
        paragraphId: p.paragraphId,
        recalcId: p.recalcId,
        ranges: [{ start: 0, length, id: "demo-issue-1" }],
      },
    ]);
    return {
      paragraphId: p.paragraphId,
      length,
      note: "仅会话临时标注，请检查可视效果",
    };
  });
}
async function save() {
  return run(
    "保存并等待回调",
    async () => {
      const request = await post(`/documents/${docId.value}/save`, {
        label: "验证台手动保存",
      });
      for (let i = 0; i < 45; i++) {
        const state = await api("/save-requests/" + request.id);
        if (state.state === "failed") throw new Error(state.error);
        if (["saved", "unchanged"].includes(state.state)) {
          if (state.state === "unchanged")
            return {
              state: "unchanged",
              warning:
                "服务端没有新修改，只对已落盘文件创建快照；请确认编辑器同步完成后再保存",
              version: state.version_id,
            };
          return {
            state: "saved",
            version: state.version_id,
            note: "回调文件已落盘",
          };
        }
        await new Promise((r) => setTimeout(r, 1000));
      }
      throw new Error(
        "45 秒内未收到保存回调；请检查容器到 Python 的网络和回调日志",
      );
    },
    "versions",
  );
}
async function exportPdf() {
  await run(
    "转换已保存版本为 PDF",
    async () => {
      await refreshDoc();
      const version = versions.value[0]?.id;
      if (!version) throw new Error("没有可转换的版本");
      const result = await post(
        `/documents/${docId.value}/export/pdf?version=${version}`,
      );
      download(result.url);
      return result;
    },
    "export",
  );
}
async function restore(vid) {
  await run(
    "从历史版本创建副本",
    async () => {
      const d = await post(
        `/documents/${docId.value}/versions/${vid}/restore-copy`,
      );
      docId.value = d.id;
      await refresh();
      await open();
      return { title: d.title };
    },
    "versions",
  );
}
async function record() {
  if (!note.value.trim()) {
    error.value = "请填写实际看到的效果或受限原因";
    return;
  }
  busy.value = true;
  error.value = "";
  try {
    await post("/results", {
      document_id: docId.value,
      test_id: active.value,
      status: verdict.value,
      details: note.value,
      evidence_type: "manual",
    });
    note.value = "";
    notice.value = "已保存人工验证结论";
    await refreshDoc();
  } catch (e) {
    error.value = e.message;
  } finally {
    busy.value = false;
  }
}
onMounted(async () => {
  window.addEventListener("focus", refreshEditorState);
  document.addEventListener("visibilitychange", refreshEditorState);
  try {
    await refresh();
    await open();
  } catch (e) {
    error.value = e.message;
  }
});
onBeforeUnmount(() => {
  window.removeEventListener("focus", refreshEditorState);
  document.removeEventListener("visibilitychange", refreshEditorState);
  openSequence++;
  destroy();
});
</script>

<template>
  <div class="app-shell">
    <header class="topbar">
      <div class="brand">
        <span class="brand-mark"><FlaskConical :size="22" /></span>
        <div>
          <strong>投标文档实验室</strong><small>DOCUMENT CAPABILITY LAB</small>
        </div>
      </div>
      <div class="environment">
        <a href="/workflow" target="_blank" style="color: #27644f; margin-right: 16px">多模板业务 Demo ↗</a>
        <span class="dot" :class="{ live: health?.documentServer }"></span
        >ONLYOFFICE 9.2.1 <span class="divider">/</span> 本机验证环境
      </div>
      <span class="user-avatar">{{ user === "a" ? "甲" : "乙" }}</span>
    </header>
    <main class="workspace">
      <nav class="nav-panel" aria-label="验证功能">
        <div class="nav-heading">
          <span>验证清单</span
          ><span>{{ manualCount }} / {{ cases.length }}</span>
        </div>
        <button
          v-for="c in cases"
          :key="c.id"
          class="case-nav"
          :class="{ active: active === c.id }"
          @click="
            active = c.id;
            error = '';
          "
          :disabled="busy"
        >
          <span class="case-number">{{ c.no }}</span>
          <div>
            <strong>{{ c.title }}</strong
            ><small>{{ c.rows }}</small>
          </div>
          <span
            class="status-dot"
            :class="testStatus(c.id)"
            :title="labels[testStatus(c.id)]"
          ></span>
        </button>
        <div class="nav-foot">
          <Activity :size="16" />
          <p>
            每次测试，都留下证据。<br /><span>接口成功 ≠ 效果验收通过</span>
          </p>
        </div>
      </nav>
      <section class="main-panel">
        <div class="page-heading">
          <div>
            <div class="eyebrow">
              WORKBENCH <span>/ {{ selected.no }}</span>
            </div>
            <h1>{{ selected.title }}</h1>
            <p>{{ selected.description }}</p>
          </div>
          <span class="level" :class="{ hard: selected.level === '高难度' }">{{
            selected.level
          }}</span>
        </div>
        <div class="filebar">
          <FileText :size="18" /><select
            aria-label="当前文档"
            v-model="docId"
            @change="changeDoc"
            :disabled="busy"
          >
            <option v-for="d in docs" :key="d.id" :value="d.id">
              {{ d.title }} · {{ d.id.slice(0, 5) }}
            </option></select
          ><button @click="makeSample" :disabled="busy" title="新建样本">
            <Plus :size="15" />新样本</button
          ><label class="button" :class="{ disabled: busy }"
            ><Upload :size="15" />上传 DOCX<input
              type="file"
              accept=".docx"
              @change="upload"
              :disabled="busy"
              hidden /></label
          ><button @click="open()" :disabled="busy">
            <RefreshCw :size="15" />重连</button
          ><button class="primary" @click="save" :disabled="!canAct">
            <Check :size="15" />保存版本</button
          ><button @click="side = !side" title="显示或隐藏验收栏">
            <PanelRightClose :size="17" />
          </button>
        </div>
        <div class="control-display-settings">
          <label for="control-appearance">内容控件外观</label>
          <select id="control-appearance" :value="controlAppearance" :disabled="!canAct || controlAppearance === 'none'" @change="setControlAppearance">
            <option value="unknown" disabled>尚未读取</option>
            <option value="none" disabled>文档中没有内容控件</option>
            <option value="mixed" disabled>部分显示、部分隐藏</option>
            <option value="boundingBox">显示边框与标签</option>
            <option value="hidden">隐藏边框与标签</option>
          </select>
          <span>正文及填充、定位、锁定功能保留；保存版本后保留此文档设置。</span>
          <span v-if="syncError" role="alert">{{syncError}}</span>
        </div>
        <div class="action-panel">
          <template v-if="active === 'connection'"
            ><div class="action-copy">
              <b>先验证连接，再开始编辑</b
              ><span>真实容器 → 真实文档 → Automation 回调</span>
            </div>
            <button class="primary" :disabled="!canAct" @click="inspect">
              探测文档能力 <ArrowUpRight :size="15" /></button
            ><span class="muted">{{
              controls.length ? `已读取 ${controls.length} 个控件` : editorState
            }}</span></template
          >
          <template v-if="active === 'template'"
            ><input
              v-model="projectName"
              aria-label="项目名称"
              placeholder="项目名称"
            /><input
              v-model="projectNumber"
              aria-label="项目编号"
              placeholder="项目编号"
            /><button
              class="primary"
              :disabled="!canAct"
              @click="
                act('填充项目变量', {
                  op: 'fill',
                  values: {
                    'field:project_name': projectName,
                    'field:project_number': projectNumber,
                  },
                })
              "
            >
              填充变量</button
            ><button
              :disabled="!canAct"
              @click="
                act('锁定固定条款', {
                  op: 'lock',
                  tag: 'fixed:commitment',
                  lock: 'sdtContentLocked',
                })
              "
            >
              锁定条款</button
            ><button
              :disabled="!canAct"
              @click="
                act('解除样本条款锁定', {
                  op: 'lock',
                  tag: 'fixed:commitment',
                  lock: 'unlocked',
                })
              "
            >
              解锁测试
            </button><span class="muted" aria-live="polite" data-testid="fixed-lock-state">固定条款：{{fixedLock}}</span></template
          >
          <template v-if="active === 'assets'"
            ><img
              class="asset-thumb"
              src="/api/assets/certificate.png"
              alt="虚构证书样本"
            />
            <div class="action-copy">
              <b>虚构企业资质证书</b><span>指定插入到 asset:certificate</span>
            </div>
            <button class="primary" :disabled="!canAct" @click="insertImage">
              插入 / 替换证书</button
            ><button
              :disabled="!canAct"
              @click="
                act('调整样本图片尺寸', {
                  op: 'resize',
                  tag: 'asset:certificate',
                })
              "
            >
              调整为 110 mm 宽
            </button></template
          >
          <template v-if="active === 'trace'"
            ><button :disabled="!canAct" @click="locate('section:business')">
              <Link :size="14" />商务响应</button
            ><button :disabled="!canAct" @click="locate('section:technical')">
              技术方案</button
            ><button :disabled="!canAct" @click="locate('asset:certificate')">
              证明材料</button
            ><button class="primary" :disabled="!canAct" @click="reverse">
              反向读取当前位置</button
            ><span class="muted">{{
              currentControl?.Tag || "将光标置于控件内后读取"
            }}</span></template
          >
          <template v-if="active === 'rewrite'"
            ><div class="rewrite">
              <div>
                <span class="mini-label">01 / 在正文选择文字</span
                ><button :disabled="!canAct" @click="readSelection">
                  读取选区
                </button>
                <p>{{ selection || "尚未读取选区" }}</p>
              </div>
              <div>
                <label class="mini-label" for="suggestion"
                  >02 / 编辑建议（未接入 AI）</label
                ><textarea
                  id="suggestion"
                  v-model="suggestion"
                  placeholder="先读取选区，再编辑建议"
                ></textarea>
              </div>
              <button
                class="primary"
                :disabled="!canAct || !selection || !suggestion"
                @click="replaceSelection"
              >
                回填选区
              </button>
            </div></template
          >
          <template v-if="active === 'layout'"
            ><div class="action-copy">
              <b>目录 / 页码更新实验</b
              ><span>可同时使用编辑器「引用」菜单进行人工验证</span>
            </div>
            <button
              class="primary"
              :disabled="!canAct"
              @click="act('更新文档域', { op: 'fields' })"
            >
              尝试更新所有域</button
            ><button
              :disabled="!canAct"
              @click="
                run(
                  '检查占位符和旧项目残留',
                  async () =>
                    (auditResult = await command(connector, {
                      op: 'audit',
                      terms: ['待填充', '旧项目', '待补充'],
                    })),
                )
              "
            >
              检查文字残留
            </button></template
          >
          <template v-if="active === 'review'"
            ><button
              :disabled="!canAct"
              @click="act('定位示例服务期限', { op: 'search', text: '365' })"
            >
              定位「365」</button
            ><button
              :disabled="!canAct"
              @click="act('定位待补充项', { op: 'search', text: '待补充' })"
            >
              定位待补充项</button
            ><button
              class="primary"
              :disabled="!canAct || !paragraph"
              @click="annotate"
            >
              标注最近编辑段落</button
            ><span class="muted">{{
              paragraph ? "已收到段落事件" : "请先编辑一个段落，等待段落事件"
            }}</span></template
          >
          <template v-if="active === 'versions'"
            ><div class="action-copy">
              <b>{{ versions.length }} 个已存储版本</b
              ><span>修改正文 → 保存版本 → 等待回调 → 下载核对</span>
            </div>
            <button @click="refreshDoc" :disabled="busy">
              刷新版本列表
            </button></template
          >
          <template v-if="active === 'collab'"
            ><div class="action-copy">
              <b>当前：测试用户{{ user === "a" ? "甲" : "乙" }}</b
              ><span>使用相同文档 key，观察实时同步</span>
            </div>
            <a
              class="button primary"
              :href="`/?doc=${docId}&user=${user === 'a' ? 'b' : 'a'}`"
              target="_blank"
              rel="noopener"
              >打开另一位测试用户 <ArrowUpRight :size="15" /></a
          ></template>
          <template v-if="active === 'export'"
            ><button
              :disabled="busy || !docId"
              @click="download(`/api/documents/${docId}/download`)"
            >
              <Download :size="14" />已保存 DOCX</button
            ><button
              class="primary"
              :disabled="busy || !health?.documentServer"
              @click="exportPdf"
            >
              已保存版本 → PDF</button
            ><button
              :disabled="busy || !docId"
              @click="download(`/api/documents/${docId}/attachments.zip`)"
            >
              材料包 ZIP</button
            ><button @click="download('/api/results/report.docx')">
              验证报告 DOCX</button
            ><span class="muted">导出前，请先点击保存版本。</span></template
          >
        </div>
        <div v-if="error" class="message error" role="alert">
          <AlertCircle :size="16" /><span>{{ error }}</span>
        </div>
        <div v-else-if="busy" class="message">
          <RefreshCw :size="15" class="spin" />正在执行，请等待接口返回…
        </div>
        <div v-else-if="notice" class="message" role="status">
          <Check :size="15" />{{ notice }}
        </div>
        <div v-if="active === 'versions'" class="version-strip">
          <article v-for="v in versions.slice(0, 6)" :key="v.id">
            <b>{{ v.label }}</b
            ><small>{{ new Date(v.created_at).toLocaleString() }}</small>
            <div>
              <button @click="open(v.id)" :disabled="busy">预览</button
              ><button @click="download('/api/versions/' + v.id + '/download')">
                下载</button
              ><button @click="restore(v.id)" :disabled="busy">
                恢复为副本
              </button>
            </div>
          </article>
        </div>
        <div v-if="auditResult" class="audit-result">
          <span v-for="f in auditResult.findings" :key="f.term"
            >「{{ f.term }}」 {{ f.count }} 处</span
          ><button @click="auditResult = null">关闭</button>
        </div>
        <div class="editor-region">
          <div class="editor-caption">
            <span
              ><span class="dot" :class="{ live: ready }"></span
              >{{ editorState }}</span
            ><span v-if="viewVersion"
              >历史快照 <button @click="open()">返回当前文档</button></span
            ><span v-else>DOCX · {{ currentDoc?.title || "未选择文档" }}</span>
          </div>
          <div class="editor-body">
            <div id="document-editor"></div>
            <div v-if="!health?.documentServer" class="offline">
              <div class="offline-icon">
                <FileText :size="36" :stroke-width="1.2" />
              </div>
              <div class="eyebrow">WAITING FOR DOCUMENT SERVER</div>
              <h2>工作台已准备好，等待文档服务</h2>
              <p>
                Python 负责文件与版本，Vue 负责交互。<br />ONLYOFFICE
                恢复后，点击重连即可加载真实文档。
              </p>
              <div class="connection-lines">
                <span
                  ><i class="dot" :class="{ live: health?.backend }"></i>Python
                  后端 <b>{{ health?.backend ? "已连接" : "检查中" }}</b></span
                ><span><i class="dot"></i>onlyoffice-prod <b>待恢复</b></span>
              </div>
              <button @click="open()" :disabled="busy">
                <RefreshCw :size="15" />重新检查
              </button>
            </div>
          </div>
        </div>
      </section>
      <aside v-if="side" class="evidence-panel">
        <div class="evidence-title">
          <span>验收笔记</span
          ><span class="status-label" :class="testStatus(active)">{{
            labels[testStatus(active)]
          }}</span>
        </div>
        <div class="evidence-section">
          <span class="mini-label">HOW TO VERIFY</span>
          <h3>怎么判断是否可用</h3>
          <p>{{ selected.accept }}</p>
        </div>
        <div class="limit-box">
          <span class="mini-label">当前边界</span>
          <p>{{ selected.limit }}</p>
        </div>
        <div class="evidence-section">
          <h3>记录你的测试结论</h3>
          <select aria-label="测试结论" v-model="verdict">
            <option value="partial">部分可行 / 有限制</option>
            <option value="passed">人工验证通过</option>
            <option value="failed">验证失败</option>
            <option value="untested">待进一步测试</option></select
          ><textarea
            v-model="note"
            placeholder="实际发生了什么？保存重开后是否一致？哪些情况还没验证？"
            rows="4"
            aria-label="测试笔记"
          ></textarea
          ><button class="wide" :disabled="busy || !docId" @click="record">
            保存结论 <ChevronRight :size="14" />
          </button>
        </div>
        <div class="evidence-section history">
          <h3>
            最近记录
            <span>{{
              results.filter((r) => r.test_id === active).length
            }}</span>
          </h3>
          <article
            v-for="r in results.filter((r) => r.test_id === active).slice(0, 4)"
            :key="r.id"
          >
            <span class="mini-label"
              >{{ labels[r.status] }} ·
              {{ r.evidence_type === "manual" ? "人工" : "接口" }}</span
            >
            <p>{{ r.details }}</p>
          </article>
          <p v-if="!results.some((r) => r.test_id === active)" class="muted">
            尚无记录。先操作，再判断。
          </p>
        </div>
        <details class="logs">
          <summary>开发日志 · {{ logs.length }}</summary>
          <article v-for="(l, i) in logs.slice(0, 10)" :key="i">
            <strong>{{ l.time }} {{ l.name }}</strong>
            <pre>{{ l.data }}</pre>
          </article>
        </details>
      </aside>
    </main>
    <footer>
      <span>仅用于本机功能验证 · 测试资料均为虚构</span
      ><span>Vue 3 <i>+</i> Python <i>+</i> Automation API</span>
    </footer>
  </div>
</template>
