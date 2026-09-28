<script setup>
import { ref, watch, onBeforeUnmount, nextTick } from "vue";
import { api, post } from "./api";
import { method } from "./office";

const props = defineProps({
  documentId: String,
  versionId: { type: String, default: "" },
});
const emit = defineEmits(["change"]);
const ready = ref(false),
  status = ref("正在连接文档服务"),
  error = ref("");
let editor,
  connector,
  generation = 0,
  unsynced = false,
  modified = false;
let scriptPromise;
function loadScript(url) {
  if (window.DocsAPI) return Promise.resolve();
  if (!scriptPromise)
    scriptPromise = new Promise((resolve, reject) => {
      const s = document.createElement("script");
      s.src = url + "/web-apps/apps/api/documents/api.js";
      s.onload = resolve;
      s.onerror = () => {
        scriptPromise = null;
        s.remove();
        reject(new Error("无法加载 ONLYOFFICE 脚本"));
      };
      document.head.appendChild(s);
    });
  return scriptPromise;
}
function destroy() {
  ready.value = false;
  connector?.disconnect();
  connector = null;
  editor?.destroyEditor();
  editor = null;
}
async function open() {
  const seq = ++generation;
  destroy();
  error.value = "";
  unsynced = false;
  modified = false;
  if (!props.documentId) return;
  status.value = "正在连接文档服务";
  try {
    const data = await api(
      `/documents/${props.documentId}/config${props.versionId ? "?version=" + props.versionId : ""}`,
    );
    await loadScript(data.documentServerUrl);
    if (seq !== generation) return;
    await nextTick();
    editor = new window.DocsAPI.DocEditor("workflow-document-editor", {
      ...data.config,
      events: {
        onDocumentReady() {
          if (seq !== generation) return;
          try {
            if (!props.versionId) connector = editor.createConnector();
            ready.value = true;
            status.value = props.versionId ? "审核版本 · 只读" : "文档已就绪";
          } catch (e) {
            error.value = "Automation 连接失败：" + e.message;
          }
        },
        onDocumentStateChange(e) {
          if (seq !== generation) return;
          unsynced = Boolean(e.data);
          if (unsynced) {
            modified = true;
            emit("change");
          }
          status.value = unsynced
            ? "正在同步到文档服务…"
            : "已同步到文档服务 · 文件落盘请点击保存";
        },
        onError(e) {
          if (seq === generation)
            error.value = "ONLYOFFICE：" + JSON.stringify(e.data);
        },
      },
    });
  } catch (e) {
    if (seq === generation) error.value = e.message;
  }
}
const delay = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitReady(documentId) {
  for (let i = 0; i < 120; i++) {
    if (props.documentId !== documentId) throw new Error("文档已切换，批量确认已停止");
    if (error.value) throw new Error(error.value);
    if (ready.value && !props.versionId) return;
    await delay(500);
  }
  throw new Error("文档加载超时，请重新连接后继续确认");
}
async function save(label = "业务工作台保存") {
  if (!ready.value || props.versionId)
    throw new Error("请等待可编辑文档加载完成");
  const seq = generation,
    id = props.documentId;
  for (let i = 0; unsynced && i < 30; i++) await delay(500);
  if (unsynced) throw new Error("编辑器尚未同步，请稍后重试保存");
  for (let attempt = 0; attempt < 4; attempt++) {
    if (seq !== generation) throw new Error("文档已切换，请重新保存");
    const request = await post(`/documents/${id}/save`, { label });
    for (let i = 0; i < 60; i++) {
      if (seq !== generation) throw new Error("文档已切换，请重新保存");
      const state = await api("/save-requests/" + request.id);
      if (state.state === "failed") throw new Error(state.error);
      if (state.state === "saved") {
        modified = false;
        status.value = "保存回调已完成 · 文件已落盘";
        return state.version_id;
      }
      if (state.state === "unchanged") {
        if (!modified) {
          status.value = "已保存当前落盘版本";
          return state.version_id;
        }
        break;
      }
      await delay(800);
    }
    await delay(1200);
  }
  throw new Error(
    "尚未确认本次编辑的保存回调，请稍后重新保存；未将旧文件当作新成果",
  );
}
async function locate(tag) {
  if (!connector || !ready.value) throw new Error("请等待编辑器就绪");
  const controls = await method(connector, "GetAllContentControls");
  const c = controls?.find((c) => c.Tag === tag);
  if (!c) throw new Error("找不到该字段控件，可能已被删除");
  await method(connector, "SelectContentControl", [c.InternalId]);
}
watch(() => [props.documentId, props.versionId], open, { immediate: true });
onBeforeUnmount(() => {
  generation++;
  destroy();
});
defineExpose({ save, locate, ready, waitReady });
</script>

<template>
  <div class="wf-editor-wrap">
    <div class="wf-editor-status">
      <span :class="['wf-dot', { online: ready }]"></span>{{ status
      }}<button v-if="error" @click="open">重新连接</button>
    </div>
    <p v-if="error" class="wf-error" role="alert">{{ error }}</p>
    <div class="wf-editor-canvas">
      <div id="workflow-document-editor"></div>
    </div>
  </div>
</template>
