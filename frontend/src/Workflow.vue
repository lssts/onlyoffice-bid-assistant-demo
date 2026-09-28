<script setup>
import { ref, computed, onMounted, nextTick } from "vue";
import {
  ArrowRight,
  ArrowUpRight,
  Check,
  CheckCheck,
  ChevronRight,
  CircleHelp,
  Database,
  Download,
  FileCheck2,
  FileStack,
  FileText,
  FolderOpen,
  Layers3,
  LoaderCircle,
  Plus,
  Search,
  ShieldCheck,
  Sparkles,
  Trash2,
  Upload,
  X,
} from "lucide-vue-next";
import { api, post, download } from "./api";
import WorkflowEditor from "./WorkflowEditor.vue";
import { batchReview } from "./batchReview";
const batchReviewing = ref(false);

const settings = ref(null),
  projects = ref([]),
  project = ref(null),
  step = ref(0),
  busy = ref(false),
  busyText = ref(""),
  error = ref(""),
  notice = ref("");
const mode = ref("rules"),
  plan = ref([]),
  activeTemplate = ref(""),
  editorRef = ref(null),
  matches = ref(null),
  profileValues = ref({}),
  mappings = ref({});
const sourceQuery = ref(""),
  sourceFocus = ref(null),
  addFieldFor = ref(""),
  fieldDraft = ref({
    block: 1,
    paragraph: 1,
    anchor: "",
    label: "",
    fieldKey: "",
  }),
  dirtyOutputs = ref(new Set());
const stages = [
  ["上传解析", "导入原始招标文件"],
  ["识别要求", "定位模板与填写位置"],
  ["生成模板", "确认拆分与字段"],
  ["模板审核", "检查文档与字段映射"],
  ["匹配数据", "核对企业资料来源"],
  ["自动回填", "生成独立填写成果"],
  ["检查保存", "检查、保存与导出"],
];
const current = computed(
  () =>
    project.value?.templates.find((t) => t.id === activeTemplate.value) ||
    project.value?.templates[0],
);
const reviewed = computed(
  () => project.value?.templates.filter((t) => t.reviewed).length || 0,
);
const fieldCount = computed(
  () =>
    project.value?.templates.reduce((n, t) => n + t.fields.length, 0) ||
    plan.value.reduce((n, t) => n + t.fields.length, 0),
);
const maxStep = computed(() =>
  !project.value
    ? 0
    : project.value.fill_run
      ? 6
      : project.value.templates.length
        ? reviewed.value === project.value.templates.length
          ? 5
          : 3
        : project.value.analysis
          ? 2
          : 1,
);
const sourceBlocks = computed(
  () =>
    project.value?.blocks
      .filter(
        (b) =>
          (sourceFocus.value === null || b.id === sourceFocus.value) &&
          (!sourceQuery.value || b.text.includes(sourceQuery.value)),
      )
      .slice(0, 250) || [],
);
const selectedReport = computed(() =>
  current.value ? project.value.report[current.value.id] : null,
);
const bundleReady = computed(
  () =>
    project.value?.templates.length &&
    project.value.templates.every(
      (t) =>
        project.value.report[t.id]?.passed && !dirtyOutputs.value.has(t.id),
    ),
);
const missing = computed(
  () => matches.value?.rows.filter((r) => r.status === "missing").length || 0,
);
const knownKeys = computed(() => [
  ...new Set(
    project.value?.templates
      .flatMap((t) => t.fields.map((f) => f.fieldKey))
      .filter(Boolean) || [],
  ),
]);
const profileDirty = computed(
  () =>
    matches.value &&
    Object.keys(profileValues.value).some(
      (key) =>
        (profileValues.value[key] || "") !==
        (matches.value.profile.values[key] || ""),
    ),
);
function catalog(key) {
  return settings.value?.catalog.find((f) => f.key === key);
}
function setProject(p) {
  if (project.value?.id !== p.id) {
    sourceFocus.value = null;
    sourceQuery.value = "";
  }
  project.value = p;
  if (!p.templates.some((t) => t.id === activeTemplate.value))
    activeTemplate.value = p.templates[0]?.id || "";
  mappings.value = Object.fromEntries(
    p.templates.flatMap((t) => t.fields.map((f) => [f.tag, f.fieldKey])),
  );
  localStorage.setItem("bid-workflow-project", p.id);
}
async function run(label, fn) {
  if (busy.value) return;
  busy.value = true;
  busyText.value = label;
  error.value = "";
  notice.value = "";
  try {
    await fn();
  } catch (e) {
    error.value = e.message;
  } finally {
    busy.value = false;
    busyText.value = "";
  }
}
async function refreshProjects() {
  projects.value = await api("/workflow/projects");
}
async function chooseProject(id) {
  if (!id) return;
  await run("读取项目", async () => {
    setProject(await api("/workflow/projects/" + id));
    plan.value = JSON.parse(
      JSON.stringify(
        project.value.templates.length
          ? project.value.templates
          : project.value.analysis?.templates || [],
      ),
    );
    step.value = maxStep.value === 5 ? 4 : maxStep.value;
    matches.value = null;
    if (step.value === 4) await loadMatches();
    dirtyOutputs.value = new Set();
  });
}
async function sample() {
  await run("创建演示招标文件", async () => {
    setProject(await post("/workflow/sample"));
    plan.value = [];
    matches.value = null;
    step.value = 1;
    await refreshProjects();
    notice.value = "示例招标文件已解析，包含三份附件模板。";
  });
}
async function upload(e) {
  const file = e.target.files?.[0];
  if (!file) return;
  await run("上传并解析招标文件", async () => {
    const form = new FormData();
    form.append("file", file);
    setProject(await api("/workflow/upload", { method: "POST", body: form }));
    plan.value = [];
    matches.value = null;
    step.value = 1;
    await refreshProjects();
    notice.value = "原文已解析，开始识别模板与字段。";
  });
  e.target.value = "";
}
async function analyze() {
  await run(
    mode.value === "ai" ? "解析最后一章的模板与字段" : "执行本地规则识别",
    async () => {
      setProject(
        await post(`/workflow/projects/${project.value.id}/analyze`, {
          mode: mode.value,
        }),
      );
      plan.value = JSON.parse(JSON.stringify(project.value.analysis.templates));
      step.value = 2;
      notice.value = plan.value.length
        ? `识别到 ${plan.value.length} 份候选模板，请确认拆分范围与字段。`
        : "未识别到常见模板标题，请手动添加模板范围。";
    },
  );
}
async function detectFields(candidate) {
  await run("识别该范围的填写位置", async () => {
    const result = await post(
      `/workflow/projects/${project.value.id}/detect-fields`,
      { templates: [candidate] },
    );
    candidate.fields = result.templates[0].fields;
    notice.value = `识别到 ${candidate.fields.length} 个填写位置。`;
  });
}
function addTemplate() {
  plan.value.push({
    id: crypto.randomUUID(),
    title: "新模板",
    start: 0,
    end: Math.max(0, (project.value?.blocks.length || 1) - 1),
    fields: [],
    reason: "人工指定模板范围",
  });
}
function addField(candidate) {
  error.value = "";
  const d = fieldDraft.value,
    bi = Number(d.block) - 1,
    pi = Number(d.paragraph) - 1;
  const text = project.value.blocks[bi]?.paragraphs[pi]?.text;
  if (
    bi < candidate.start ||
    bi > candidate.end ||
    !d.anchor ||
    !d.label ||
    text === undefined
  ) {
    error.value = "请填写范围内的原文块、段落、精确占位文字和字段名称。";
    return;
  }
  const start = text.indexOf(d.anchor);
  if (start < 0) {
    error.value = "在指定原文段落中未找到该文字。";
    return;
  }
  if (
    candidate.fields.some(
      (f) =>
        f.block === bi &&
        f.paragraph === pi &&
        start < f.end &&
        start + d.anchor.length > f.start,
    )
  ) {
    error.value = "该位置已被标记。重复文字请先在原文中改成不同占位名称。";
    return;
  }
  candidate.fields.push({
    id: crypto.randomUUID(),
    block: bi,
    paragraph: pi,
    start,
    end: start + d.anchor.length,
    anchor: d.anchor,
    label: d.label,
    fieldKey: d.fieldKey,
    required: true,
  });
  addFieldFor.value = "";
}
async function generate() {
  await run("拆分 DOCX 并插入行内字段", async () => {
    setProject(
      await post(`/workflow/projects/${project.value.id}/generate`, {
        templates: plan.value,
      }),
    );
    step.value = 3;
    notice.value = "独立模板已生成，请逐份打开审核。";
  });
}
async function review() {
  await run("保存模板并确认审核版本", async () => {
    const t = current.value;
    const vid = await editorRef.value.save("模板审核");
    setProject(
      await post(
        `/workflow/projects/${project.value.id}/templates/${t.id}/review`,
        {
          version_id: vid,
          mappings: Object.fromEntries(
            t.fields.map((f) => [f.tag, mappings.value[f.tag] || ""]),
          ),
        },
      ),
    );
    const next = project.value.templates.find((t) => !t.reviewed);
    if (next) activeTemplate.value = next.id;
    notice.value = next
      ? "当前模板已审核，已打开下一份。"
      : "全部模板已审核，可以匹配数据库内容。";
  });
}
async function reviewAll() {
  await run("批量保存并确认模板", async () => {
    batchReviewing.value = true;
    const mappingSnapshot = { ...mappings.value };
    const pid = project.value.id;
    try {
      await batchReview({
        templates: project.value.templates,
        currentId: current.value.id,
        mappings: mappingSnapshot,
        onProgress: (index, total, t) => {
          busyText.value = `正在确认 ${index}/${total}：${t.title}`;
        },
        openAndSave: async (t) => {
          activeTemplate.value = t.id;
          await nextTick();
          await editorRef.value.waitReady(t.document_id);
          return await editorRef.value.save("批量模板审核");
        },
        confirm: (t, body) => post(`/workflow/projects/${pid}/templates/${t.id}/review`, body),
        onConfirmed: (state) => {
          setProject(state);
          mappings.value = { ...mappings.value, ...mappingSnapshot };
        },
      });
      notice.value = "全部模板已确认，可以进入下一步匹配数据。";
    } finally {
      batchReviewing.value = false;
    }
  });
}
async function loadMatches() {
  matches.value = await api(`/workflow/projects/${project.value.id}/matches`);
  profileValues.value = { ...matches.value.profile.values };
}
async function go(n) {
  if (busy.value || n > maxStep.value) return;
  if (step.value === 4 && n !== 4 && profileDirty.value) {
    error.value = "资料有未保存的修改，请先点击“保存资料并重新匹配”。";
    return;
  }
  await run("读取步骤数据", async () => {
    if (n === 4 || n === 5) await loadMatches();
    step.value = n;
  });
}
async function repairPlaceholders() {
  await run("保存并修复模板占位内容", async () => {
    const t = current.value;
    const fieldMappings = Object.fromEntries(t.fields.map(f => [f.tag, mappings.value[f.tag] || ""]));
    const versionId = t.reviewed ? t.review_version_id : await editorRef.value.save("占位修复前保存");
    setProject(await post(`/workflow/projects/${project.value.id}/templates/${t.id}/repair-placeholders`, {
      version_id: versionId, mappings: fieldMappings,
    }));
    notice.value = "已创建修复副本，保留原文修改和旧版本。请核对占位提示及日期，再重新确认模板。";
  });
}
async function reopenReview() {
  await run("创建可编辑的模板审核副本", async () => {
    setProject(
      await post(
        `/workflow/projects/${project.value.id}/templates/${current.value.id}/reopen`,
      ),
    );
    notice.value = "已从审核版本创建可编辑副本，修改后请重新确认。";
  });
}
async function saveProfile() {
  await run("保存资料并重新匹配", async () => {
    await post("/workflow/profiles/demo-company", {
      values: profileValues.value,
    });
    await loadMatches();
    notice.value = "演示数据库已更新，匹配结果已刷新。";
  });
}
async function fill() {
  await run("从审核模板生成填写成果", async () => {
    setProject(
      await post(`/workflow/projects/${project.value.id}/fill`, {
        profile_id: "demo-company",
      }),
    );
    step.value = 6;
    dirtyOutputs.value = new Set();
    notice.value = `已回填 ${project.value.fill_run.matched} 处，${project.value.fill_run.missing} 处仍需人工补充。原始模板已保留。`;
  });
}
async function locate(tag) {
  await run("定位填写位置", () => editorRef.value.locate(tag));
}
function changed() {
  if (step.value === 6 && current.value)
    dirtyOutputs.value = new Set([...dirtyOutputs.value, current.value.id]);
}
async function saveCheck() {
  await run("保存成果并检查字段", async () => {
    const t = current.value,
      vid = await editorRef.value.save("成果检查");
    const result = await post(`/workflow/projects/${project.value.id}/check`, {
      template_id: t.id,
      version_id: vid,
    });
    project.value.report[t.id] = result;
    dirtyOutputs.value.delete(t.id);
    dirtyOutputs.value = new Set(dirtyOutputs.value);
    notice.value = result.passed
      ? "字段检查已完成；请继续核对页面排版。"
      : "已保存，仍有必填内容或控件问题需要处理。";
  });
}
async function exportPdf() {
  await run("转换已检查版本为 PDF", async () => {
    const result = await post(
      `/documents/${current.value.output_id}/export/pdf?version=${selectedReport.value.version_id}`,
    );
    download(result.url);
  });
}
function focusSource(id) {
  sourceFocus.value = id;
  sourceQuery.value = "";
}
onMounted(() =>
  run("读取工作台", async () => {
    [settings.value] = await Promise.all([
      api("/workflow/settings"),
      refreshProjects(),
    ]);
    const saved = localStorage.getItem("bid-workflow-project");
    if (saved && projects.value.some((p) => p.id === saved)) {
      setProject(await api("/workflow/projects/" + saved));
      plan.value = JSON.parse(
        JSON.stringify(
          project.value.templates.length
            ? project.value.templates
            : project.value.analysis?.templates || [],
        ),
      );
      step.value = maxStep.value === 5 ? 4 : maxStep.value;
      if (step.value === 4) await loadMatches();
    }
  }),
);
</script>

<template>
  <div class="wf-app">
    <aside class="wf-sidebar">
      <a class="wf-brand" href="/workflow"
        ><span class="wf-brand-icon"><Layers3 :size="23" /></span
        ><span>投标编制工坊<small>BID DOCUMENT STUDIO</small></span></a
      >
      <div class="wf-side-label">编制流程 <span>WORKFLOW</span></div>
      <nav aria-label="业务流程">
        <button
          v-for="(s, i) in stages"
          :key="s[0]"
          :class="['wf-nav', { active: step === i, done: i < maxStep }]"
          :disabled="busy || i > maxStep"
          @click="go(i)"
        >
          <span class="wf-step-number"
            ><Check v-if="i < maxStep" :size="15" /><template v-else>{{
              String(i + 1).padStart(2, "0")
            }}</template></span
          ><span
            >{{ s[0] }}<small>{{ s[1] }}</small></span
          ><ChevronRight v-if="step === i" :size="15" />
        </button>
      </nav>
      <div class="wf-side-bottom">
        <span class="wf-side-label">最近项目</span
        ><select
          aria-label="切换项目"
          :value="project?.id || ''"
          :disabled="busy"
          @change="chooseProject($event.target.value)"
        >
          <option value="">选择项目</option>
          <option v-for="p in projects" :value="p.id">
            {{ p.title }}
          </option></select
        ><a href="/" target="_blank"
          >打开功能验证台 <ArrowUpRight :size="14"
        /></a>
        <p>Python · Vue · ONLYOFFICE 9.2.1</p>
      </div>
    </aside>
    <main class="wf-main">
      <header class="wf-topbar">
        <span
          ><FolderOpen :size="16" /> 业务 Demo <ChevronRight :size="14" />
          {{ project?.title || "新建编制项目" }}</span
        ><span class="wf-mode"
          ><span class="wf-dot online"></span
          >{{ project?.analysis?.mode === "ai" ? "AI 接口模式" : "本地规则演示"
          }}<span class="wf-version">DEMO / 01</span></span
        >
      </header>
      <div class="wf-page">
        <div class="wf-page-heading">
          <div>
            <p class="wf-eyebrow">
              STEP {{ String(step + 1).padStart(2, "0") }} / DOCUMENT WORKFLOW
            </p>
            <h1>{{ stages[step][0] }}</h1>
            <p>
              {{ stages[step][1] }}。{{
                [
                  "从原始要求出发，把每份投标附件变成可填写的文档。",
                  "每个识别结果都能回到原文，便于核对。",
                  "确认拆分边界，再将填写位置转换为行内内容控件。",
                  "先确认模板，再让数据进入文档。",
                  "使用可追溯的资料，让每一处填写有据可查。",
                  "保留审核模板，为本次投标创建独立文件。",
                  "以已保存版本为准，逐份检查并交付。",
                ][step]
              }}
            </p>
          </div>
          <span class="wf-stage-count" v-if="project"
            >{{ project.templates.length || plan.length }} <small>份模板</small
            ><i></i>{{ fieldCount }} <small>个字段</small></span
          >
        </div>
        <div v-if="error" class="wf-error" role="alert">
          <X :size="17" />{{ error }}
        </div>
        <div v-if="notice" class="wf-notice" role="status">
          <CheckCheck :size="17" />{{ notice }}
        </div>
        <div v-if="busy" class="wf-busy" role="status">
          <LoaderCircle class="wf-spin" :size="17" />{{ busyText }}…
        </div>

        <template v-if="step === 0">
          <section class="wf-intro">
            <div class="wf-intro-copy">
              <p class="wf-eyebrow">从一份招标文件，到一组可填写模板</p>
              <h2>让资料找到<br />它该在的位置。</h2>
              <p>
                拆出承诺书、财务表和授权书，核对字段，<br />将企业资料填入每一份文档。
              </p>
              <div class="wf-tags">
                <span>保留原文样式</span><span>行内字段</span
                ><span>多文档回填</span>
              </div>
            </div>
            <div class="wf-document-art" aria-hidden="true">
              <div class="wf-paper back"></div>
              <div class="wf-paper">
                <span>投标承诺书</span><i></i>
                <p>投标人 <em>企业名称</em></p>
                <p>法定代表人 <em>人员档案</em></p>
                <i></i><i class="short"></i>
                <div class="wf-paper-stamp">
                  <Check :size="20" /> 字段已关联
                </div>
              </div>
            </div>
          </section>
          <div class="wf-upload-grid">
            <label class="wf-upload-box" :class="{ disabled: busy }"
              ><span class="wf-upload-icon"><Upload :size="27" /></span>
              <h3>上传招标文件</h3>
              <p>点击选择 DOCX 文件</p>
              <small>上限 40 MB · PDF / 扫描件暂不支持</small
              ><input
                type="file"
                accept=".docx"
                :disabled="busy"
                @change="upload"
            /></label>
            <section class="wf-card wf-sample">
              <span class="wf-kicker">快速体验</span>
              <h3>先用一份示例走完整个流程</h3>
              <p>
                内含 3
                份附件、同段多字段、财务表及合并单元格，所有业务资料均为虚构。
              </p>
              <button class="wf-primary" :disabled="busy" @click="sample">
                使用示例招标文件 <ArrowRight :size="17" /></button
              ><a href="/api/workflow/sample.docx" download
                >下载示例原件 <Download :size="14"
              /></a>
            </section>
          </div>
          <div class="wf-bottom-note">
            <CircleHelp :size="16" /> 当前使用本地规则识别，不调用大模型。配置
            AI 服务后，可在“识别要求”步骤切换。
          </div>
        </template>

        <template v-if="step === 1 && project">
          <div class="wf-two-column">
            <section class="wf-card">
              <div class="wf-card-heading">
                <FileText :size="21" />
                <h3>原文解析完成</h3>
              </div>
              <div class="wf-file-row">
                <FileText :size="30" />
                <div>
                  <strong>{{ project.title }}</strong>
                  <p>
                    {{ project.blocks.length }} 个原文块 ·
                    {{
                      project.blocks.filter((b) => b.kind === "table").length
                    }}
                    张表格
                  </p>
                </div>
              </div>
              <h4>识别方式</h4>
              <label class="wf-radio-card"
                ><input type="radio" v-model="mode" value="rules" />
                <div>
                  <strong>本地规则演示</strong>
                  <p>识别常见附件标题、【字段】和下划线占位，不调用 AI。</p>
                </div>
                <span class="wf-badge">即刻可用</span></label
              ><label
                class="wf-radio-card"
                :class="{ disabled: !settings?.ai_configured }"
                ><input
                  type="radio"
                  v-model="mode"
                  value="ai"
                  :disabled="!settings?.ai_configured"
                />
                <div>
                  <strong>AI 识别</strong>
                  <p>
                    {{
                      settings?.ai_configured
                        ? settings.ai_model
                        : "尚未配置模型服务，配置方法见项目 WORKFLOW.md"
                    }}
                  </p>
                </div></label
              >
              <p class="wf-subtle" v-if="mode === 'ai'">
                直接发送最后一个父章节的完整正文（含子章节和表格），不再筛选章节名称。AI 拆分独立模板并识别文字占位、空白单元格；后端插入字段控件。模板数量不设上限。
              </p>
              <button
                class="wf-primary"
                :disabled="busy || !!project.templates.length"
                @click="analyze"
              >
                <Search :size="17" />开始识别模板与字段</button
              ><a
                class="wf-text-link"
                :href="`/api/documents/${project.source_doc_id}/download`"
                download
                >下载上传原件</a
              >
            </section>
            <section class="wf-card wf-source">
              <div class="wf-card-heading">
                <h3>原文结构</h3>
                <span class="wf-badge">保留来源位置</span>
              </div>
              <details open>
                <summary>章节大纲 · {{ project.outline?.length || 0 }} 章</summary>
                <div class="wf-source-list" style="max-height: 260px">
                  <article v-for="c in project.outline || []" :key="c.id" :style="{ paddingLeft: `${12 + (c.level - 1) * 12}px` }">
                    <strong>{{ c.title }}</strong>
                    <p>原文块 {{ c.start + 1 }}–{{ c.end + 1 }} · {{ c.characters.toLocaleString() }} 字符 · {{ c.source === 'title-pattern' ? '标题名称推断' : '文档标题层级' }}</p>
                  </article>
                  <p v-if="!project.outline?.length">未提取到大纲，AI 模式不会发送全文。请为原文设置标题样式后重新上传。</p>
                </div>
              </details>
              <input
                class="wf-search"
                v-model="sourceQuery"
                placeholder="搜索原文…"
                aria-label="搜索原文"
              />
              <div class="wf-source-list">
                <article v-for="b in sourceBlocks" :key="b.id">
                  <span
                    >{{ String(b.id + 1).padStart(3, "0") }} ·
                    {{ b.kind === "table" ? "表格" : "段落" }}</span
                  >
                  <p>{{ b.text || "（空段落）" }}</p>
                </article>
              </div>
            </section>
          </div>
        </template>

        <template v-if="step === 2 && project">
          <div class="wf-analysis-strip">
            <Sparkles :size="20" />
            <div>
              <strong>{{
                project.analysis?.mode === "ai"
                  ? "AI 识别结果"
                  : "本地规则识别结果"
              }}</strong>
              <p>
                可修改模板名称、原文起止块和字段映射；生成后在 ONLYOFFICE
                中检查实际版式。
              </p>
            </div>
            <button
              class="wf-secondary"
              :disabled="busy || !!project.templates.length"
              @click="addTemplate"
            >
              <Plus :size="16" />添加模板
            </button>
          </div>
          <section v-if="project.analysis?.scope" class="wf-card">
            <h3>AI 读取范围</h3>
            <p v-if="project.analysis.scope.strategy === 'last_parent_direct'">直接解析最后一个父章节，未进行章节名称筛选。</p>
            <p>大纲 {{ project.analysis.scope.outline_count }} 章 · 读取 {{ project.analysis.scope.selected_chapters.length }} 章 · 正文 {{ project.analysis.scope.selected_characters.toLocaleString() }} / {{ project.analysis.scope.total_characters.toLocaleString() }} 字符 · 模型调用 {{ project.analysis.scope.model_calls }} 次</p>
            <p v-if="project.analysis.scope.checked_chapters">父章节判断顺序：{{ project.analysis.scope.checked_chapters.map(c => `${c.title}（${c.matched ? '命中' : '未命中'}）`).join(' → ') }}</p>
            <p v-for="c in project.analysis.scope.selected_chapters" :key="c.id">{{ c.title }}（原文块 {{ c.start + 1 }}–{{ c.end + 1 }}）</p>
            <p v-if="!project.analysis.scope.selected_chapters.length">未发送正文，本次分析已结束。</p>
          </section>
          <div class="wf-plan-layout">
            <div>
              <article
                class="wf-card wf-template-card"
                v-for="(t, i) in plan"
                :key="t.id"
              >
                <div class="wf-template-title">
                  <span class="wf-file-index">{{
                    String(i + 1).padStart(2, "0")
                  }}</span
                  ><input
                    v-model="t.title"
                    aria-label="模板名称"
                    :disabled="!!project.templates.length"
                  /><button
                    class="wf-icon-btn"
                    aria-label="删除模板"
                    :disabled="!!project.templates.length"
                    @click="plan.splice(i, 1)"
                  >
                    <Trash2 :size="17" />
                  </button>
                </div>
                <div class="wf-range">
                  <span>原文范围</span
                  ><label
                    >第
                    <input
                      type="number"
                      min="1"
                      :max="project.blocks.length"
                      :value="t.start + 1"
                      @change="t.start = Number($event.target.value) - 1"
                      :disabled="!!project.templates.length"
                    />
                    块</label
                  ><span>—</span
                  ><label
                    >第
                    <input
                      type="number"
                      min="1"
                      :max="project.blocks.length"
                      :value="t.end + 1"
                      @change="t.end = Number($event.target.value) - 1"
                      :disabled="!!project.templates.length"
                    />
                    块</label
                  ><button class="wf-text-link" @click="focusSource(t.start)">
                    查看依据</button
                  ><button
                    class="wf-text-link"
                    :disabled="busy || !!project.templates.length"
                    @click="detectFields(t)"
                  >
                    重新识别字段
                  </button>
                </div>
                <p class="wf-subtle">{{ t.reason }}</p>
                <div
                  class="wf-field-plan"
                  v-for="(f, j) in t.fields"
                  :key="f.id"
                >
                  <span
                    >{{ f.label
                    }}<small>块 {{ f.block + 1 }} · {{ f.kind === 'empty_cell' ? '空白单元格' : f.anchor }}</small></span
                  ><select
                    v-model="f.fieldKey"
                    aria-label="匹配数据库字段"
                    :disabled="!!project.templates.length"
                  >
                    <option value="">暂不映射 · 待人工填写</option>
                    <option v-for="c in settings?.catalog" :value="c.key">
                      {{ c.label }}
                    </option></select
                  ><button
                    class="wf-icon-btn"
                    aria-label="删除字段"
                    :disabled="!!project.templates.length"
                    @click="t.fields.splice(j, 1)"
                  >
                    <X :size="14" />
                  </button>
                </div>
                <button
                  v-if="!project.templates.length"
                  class="wf-text-link"
                  @click="addFieldFor = addFieldFor === t.id ? '' : t.id"
                >
                  <Plus :size="14" />手动标记填写位置
                </button>
                <div class="wf-manual-field" v-if="addFieldFor === t.id">
                  <label
                    >原文块<input
                      type="number"
                      min="1"
                      v-model="fieldDraft.block" /></label
                  ><label
                    >块内段落<input
                      type="number"
                      min="1"
                      v-model="fieldDraft.paragraph" /></label
                  ><label
                    >原文精确文字<input
                      v-model="fieldDraft.anchor"
                      placeholder="例如：______" /></label
                  ><label
                    >字段名称<input
                      v-model="fieldDraft.label"
                      placeholder="例如：投标人名称" /></label
                  ><select
                    v-model="fieldDraft.fieldKey"
                    aria-label="新字段映射"
                  >
                    <option value="">待人工填写</option>
                    <option v-for="c in settings?.catalog" :value="c.key">
                      {{ c.label }}
                    </option></select
                  ><button class="wf-secondary" @click="addField(t)">
                    添加字段
                  </button>
                </div>
              </article>
              <div v-if="!plan.length" class="wf-card wf-empty">
                <FileStack :size="35" />
                <h3>本次未识别到模板</h3>
                <p>
                  参照右侧原文手动指定模板的起止块，系统会按该范围生成独立文件。
                </p>
                <button class="wf-secondary" @click="addTemplate">
                  添加模板范围
                </button>
              </div>
            </div>
            <aside class="wf-card wf-source">
              <div class="wf-card-heading">
                <h3>原文依据</h3>
                <button class="wf-text-link" @click="sourceFocus = null">
                  查看全部
                </button>
              </div>
              <div class="wf-source-list">
                <article v-for="b in sourceBlocks" :key="b.id">
                  <span
                    >第 {{ b.id + 1 }} 块 ·
                    {{ b.kind === "table" ? "表格" : "段落" }}</span
                  >
                  <p v-for="p in b.paragraphs">
                    {{ b.kind === "table" ? `段落 ${p.index + 1}：` : ""
                    }}{{ p.text || "（空段落）" }}
                  </p>
                </article>
              </div>
              <details>
                <summary>识别到的格式要求</summary>
                <p
                  class="wf-subtle"
                  v-for="r in project.analysis?.requirements"
                >
                  第 {{ r.block + 1 }} 块：{{ r.quote }}
                </p>
              </details>
            </aside>
          </div>
          <div class="wf-warning" v-for="w in project.analysis?.warnings">
            {{ w }}
          </div>
          <div class="wf-actions">
            <span
              >{{ plan.length }} 份模板 ·
              {{ plan.reduce((n, t) => n + t.fields.length, 0) }}
              个填写位置</span
            ><button
              class="wf-primary"
              :disabled="busy || !plan.length || !!project.templates.length"
              @click="generate"
            >
              生成独立模板 <ArrowRight :size="17" /></button
            ><button
              v-if="project.templates.length"
              class="wf-secondary"
              @click="go(3)"
            >
              查看已生成模板
            </button>
          </div>
        </template>

        <template v-if="(step === 3 || step === 6) && current">
          <div class="wf-document-tabs">
            <button
              v-for="(t, i) in project.templates"
              :class="{ active: current.id === t.id }"
              :disabled="busy"
              @click="activeTemplate = t.id"
            >
              <FileText :size="17" /><span>{{ t.title }}</span
              ><Check
                v-if="step === 3 ? t.reviewed : project.report[t.id]?.passed"
                :size="15"
              />
            </button>
          </div>
          <div class="wf-review-toolbar">
            <span v-if="step === 3"
              ><ShieldCheck :size="17" />已审核 {{ reviewed }} /
              {{ project.templates.length }} 份<span
                v-if="current.reviewed"
                class="wf-badge"
                >已冻结审核版本</span
              ></span
            ><span v-else
              ><Database :size="17" /> 本次数据快照 ·
              {{ project.fill_run.matched }} 处已匹配 /
              {{ project.fill_run.missing }} 处缺失</span
            >
            <div v-if="step === 3">
              <button
                v-if="reviewed < project.templates.length && !project.fill_run"
                class="wf-secondary"
                :disabled="busy || !editorRef?.ready"
                @click="reviewAll"
                title="逐份保存并确认未审核模板；已审核模板自动跳过"
              >
                <CheckCheck :size="17" />一键确认所有模板
              </button>
              <button
                v-if="!project.fill_run"
                class="wf-secondary"
                :disabled="busy || !editorRef?.ready"
                @click="repairPlaceholders"
                title="保存后创建修复副本，删除匹配的占位提示并修正字段字间距，需重新确认"
              >修复此模板占位</button>
              <button
                v-if="current.reviewed && !project.fill_run"
                class="wf-secondary"
                :disabled="busy"
                @click="reopenReview"
              >
                重新编辑此模板
              </button>
              <button
                v-if="!current.reviewed"
                class="wf-primary"
                :disabled="busy || !editorRef?.ready"
                @click="review"
              >
                <CheckCheck :size="17" />保存并确认此模板</button
              ><button
                v-if="reviewed === project.templates.length"
                class="wf-primary"
                :disabled="busy"
                @click="go(4)"
              >
                下一步：匹配数据 <ArrowRight :size="16" />
              </button>
            </div>
            <div v-else>
              <button
                class="wf-primary"
                :disabled="busy || !editorRef?.ready"
                @click="saveCheck"
              >
                <FileCheck2 :size="17" />保存并检查此文档</button
              ><button
                class="wf-secondary"
                :disabled="
                  busy || !selectedReport || dirtyOutputs.has(current.id)
                "
                @click="exportPdf"
              >
                导出 PDF
              </button>
            </div>
          </div>
          <div class="wf-editor-layout">
            <WorkflowEditor
              ref="editorRef"
              :inert="batchReviewing"
              :document-id="
                step === 3 ? current.document_id : current.output_id
              "
              :version-id="
                step === 3 && current.reviewed ? current.review_version_id : ''
              "
              @change="changed"
            />
            <aside class="wf-field-sidebar">
              <div class="wf-card-heading">
                <h3>{{ step === 3 ? "字段与数据映射" : "填写结果检查" }}</h3>
                <span class="wf-badge">{{ current.fields.length }} 处</span>
              </div>
              <p class="wf-subtle">
                {{
                  step === 3
                    ? "行内控件支持同段多个字段和表格内填写。确认后使用冻结版本回填。"
                    : "检查针对保存后的版本。字段之外的固定文字变化会单独提示。"
                }}
              </p>
              <details v-if="step === 3" class="wf-review-source">
                <summary>查看原文依据与格式要求</summary>
                <p class="wf-subtle">
                  来源：原文第 {{ current.start + 1 }} 至
                  {{ current.end + 1 }} 块。
                </p>
                <p
                  v-for="rule in project.analysis?.requirements"
                  class="wf-subtle"
                >
                  第 {{ rule.block + 1 }} 块：{{ rule.quote }}
                </p>
                <p
                  v-for="block in project.blocks.slice(
                    current.start,
                    current.end + 1,
                  )"
                  class="wf-subtle"
                >
                  {{ block.text }}
                </p>
              </details>
              <div
                v-if="step === 6 && selectedReport"
                :class="[
                  'wf-check-summary',
                  { 'has-issues': selectedReport.issues.length },
                ]"
              >
                <strong>{{
                  selectedReport.passed
                    ? "必填字段检查通过"
                    : "还有字段需要处理"
                }}</strong>
                <p>
                  {{ selectedReport.issues.length }} 条提示 ·
                  {{ new Date(selectedReport.checked_at).toLocaleTimeString() }}
                </p>
                <p v-if="dirtyOutputs.has(current.id)">
                  文档又有修改，请重新保存并检查。
                </p>
              </div>
              <div v-if="step === 6 && !selectedReport" class="wf-warning">
                尚未检查此文档。请核对填写结果后点击“保存并检查”。
              </div>
              <article
                class="wf-field-detail"
                v-for="f in current.fields"
                :key="f.tag"
              >
                <div>
                  <strong>{{ f.label }}</strong
                  ><button
                    class="wf-text-link"
                    :disabled="
                      busy ||
                      !editorRef?.ready ||
                      (step === 3 && current.reviewed)
                    "
                    @click="locate(f.tag)"
                  >
                    定位
                  </button>
                </div>
                <small>{{ f.tag }}</small
                ><select
                  v-if="step === 3"
                  v-model="mappings[f.tag]"
                  :disabled="busy || current.reviewed"
                  :aria-label="f.label + '映射'"
                >
                  <option value="">待人工填写</option>
                  <option v-for="c in settings?.catalog" :value="c.key">
                    {{ c.label }}
                  </option></select
                ><template v-else
                  ><p>
                    {{
                      project.fill_run.rows.find((r) => r.tag === f.tag)
                        ?.value || "无数据库值，需人工填写"
                    }}
                  </p>
                  <span
                    v-for="issue in selectedReport?.issues.filter(
                      (i) => i.tag === f.tag,
                    )"
                    :class="['wf-issue', issue.level]"
                    >{{ issue.message }}</span
                  ></template
                >
              </article>
              <p
                v-for="issue in selectedReport?.issues.filter((i) => !i.tag)"
                class="wf-warning"
              >
                {{ issue.message }}
              </p>
              <p v-if="step === 6" class="wf-subtle">
                字体、分页、表格溢出和招标格式要求仍需人工核对。自动通过不等于版式合规。
              </p>
            </aside>
          </div>
          <div v-if="step === 6" class="wf-actions">
            <span
              >交付包包含逐份检查时的 DOCX
              版本、字段映射、数据快照与检查清单。</span
            ><button
              class="wf-primary"
              :disabled="busy || !bundleReady"
              @click="
                download(`/api/workflow/projects/${project.id}/bundle.zip`)
              "
            >
              <Download :size="17" />下载整套成果
            </button>
          </div>
        </template>

        <template v-if="step === 4 && project">
          <div class="wf-analysis-strip">
            <Database :size="22" />
            <div>
              <strong>{{ matches?.profile.title || "示范企业资料库" }}</strong>
              <p>
                这是后端 SQLite
                中的真实记录，业务数据为虚构。修改后需要点击保存，历史回填快照不受影响。
              </p>
            </div>
            <span class="wf-badge amber">{{ missing }} 处待补充</span>
          </div>
          <section class="wf-card">
            <div class="wf-card-heading">
              <h3>企业与项目资料</h3>
              <button
                class="wf-secondary"
                :disabled="busy"
                @click="saveProfile"
              >
                保存资料并重新匹配
              </button>
            </div>
            <div class="wf-profile-grid">
              <label v-for="key in knownKeys" :key="key"
                ><span>{{ catalog(key)?.label }}</span
                ><input
                  v-model="profileValues[key]"
                  :placeholder="'待补充' + catalog(key)?.label"
                /><small>{{ catalog(key)?.source }}</small></label
              >
            </div>
          </section>
          <section class="wf-card wf-match-card">
            <div class="wf-card-heading">
              <h3>填写位置与数据来源</h3>
              <span>{{ matches?.rows.length || 0 }} 处</span>
            </div>
            <div class="wf-table-scroll">
              <table class="wf-table">
                <thead>
                  <tr>
                    <th>模板 / 字段</th>
                    <th>匹配内容</th>
                    <th>来源</th>
                    <th>状态</th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-for="r in matches?.rows" :key="r.tag">
                    <td>
                      {{ r.label }}<small>{{ r.template_title }}</small>
                    </td>
                    <td>{{ r.value || "—" }}</td>
                    <td>{{ r.source }}</td>
                    <td>
                      <span
                        :class="['wf-badge', { amber: r.status === 'missing' }]"
                        >{{
                          r.status === "matched" ? "已匹配" : "待补充"
                        }}</span
                      >
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </section>
          <div class="wf-actions">
            <span>没有匹配值的必填字段会保留占位，最终检查将提示补充。</span
            ><button class="wf-primary" :disabled="busy" @click="go(5)">
              下一步：自动回填 <ArrowRight :size="17" />
            </button>
          </div>
        </template>

        <template v-if="step === 5 && project">
          <section class="wf-fill-hero">
            <div class="wf-fill-icon"><FileStack :size="36" /></div>
            <p class="wf-eyebrow">READY TO FILL</p>
            <h2>把已确认的资料，填入每一份模板。</h2>
            <p>
              读取审核时保存的模板版本，根据 Tag 回填对应字段。<br />每份模板生成一份独立成果，原模板和字段标记都会保留。
            </p>
            <div class="wf-fill-stats">
              <div>
                <strong>{{ project.templates.length }}</strong
                ><span>份审核模板</span>
              </div>
              <div>
                <strong>{{ (matches?.rows.length || 0) - missing }}</strong
                ><span>处匹配成功</span>
              </div>
              <div>
                <strong>{{ missing }}</strong
                ><span>处待人工补充</span>
              </div>
            </div>
            <button class="wf-primary" :disabled="busy" @click="fill">
              <Sparkles :size="18" />{{
                project.fill_run ? "重新生成一套填写副本" : "生成全部填写成果"
              }}<ArrowRight :size="18" />
            </button>
            <p class="wf-subtle" v-if="project.fill_run">
              会创建新一套成果；此前文件仍保留，但本项目后续检查将针对新成果。
            </p>
          </section>
        </template>
      </div>
      <footer class="wf-footer">
        <span>投标编制工坊 / 业务流程验证</span
        ><span>模板有依据 · 数据有来源 · 结果可检查</span>
      </footer>
    </main>
  </div>
</template>
