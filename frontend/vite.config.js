import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";
export default defineConfig({
  plugins: [
    vue({ template: { transformAssetUrls: { includeAbsolute: false } } }),
  ],
  build: { minify: false },
  server: { proxy: { "/api": "http://127.0.0.1:8010" } },
});
