import path from "node:path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { codeInspectorPlugin } from "code-inspector-plugin";

/** 注入构建日期（yyyy-MM-dd），每次 vite build 时更新 */
function injectBuildDate() {
  const buildDate = new Date().toISOString().slice(0, 10);
  return {
    name: "inject-build-date",
    config(config) {
      config.define = {
        ...config.define,
        __BUILD_DATE__: JSON.stringify(buildDate),
      };
    },
  };
}

export default defineConfig(({ command }) => ({
  root: "src",
  plugins: [
    command === "serve" &&
      codeInspectorPlugin({
        bundler: "vite",
      }),
    react(),
    injectBuildDate(),
  ].filter(Boolean),
  base: "./",
  build: {
    outDir: "../dist",
    emptyOutDir: true,
    rollupOptions: {
      // 托盘面板是单独的入口，不加载主界面
      input: {
        main: path.resolve(__dirname, "src/index.html"),
        "tray-panel": path.resolve(__dirname, "src/tray-panel.html"),
      },
    },
  },
  server: {
    port: 3000,
    strictPort: true,
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  clearScreen: false,
  envPrefix: ["VITE_", "TAURI_"],
}));
