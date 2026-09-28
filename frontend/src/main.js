import { createApp } from "vue";
if (location.pathname.startsWith("/workflow")) {
  document.title = "投标编制工坊 · 多模板业务 Demo";
  Promise.all([import("./Workflow.vue"), import("./workflow.css")]).then(
    ([{ default: App }]) => createApp(App).mount("#app"),
  );
} else {
  Promise.all([import("./App.vue"), import("./style.css")]).then(
    ([{ default: App }]) => createApp(App).mount("#app"),
  );
}
