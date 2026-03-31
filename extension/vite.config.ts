import { resolve } from "node:path";
import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import { createExtensionManifest } from "./src/shared/configuration";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");

  return {
    plugins: [
      react(),
      {
        name: "emit-extension-manifest",
        generateBundle() {
          this.emitFile({
            type: "asset",
            fileName: "manifest.json",
            source: JSON.stringify(createExtensionManifest(env, mode), null, 2)
          });
        }
      }
    ],
    publicDir: false,
    build: {
      outDir: "dist",
      emptyOutDir: true,
      rollupOptions: {
        input: {
          sidepanel: resolve(__dirname, "sidepanel.html"),
          background: resolve(__dirname, "src/background/index.ts"),
          content: resolve(__dirname, "src/content/index.ts")
        },
        output: {
          entryFileNames: (chunkInfo) => {
            if (chunkInfo.name === "background" || chunkInfo.name === "content") {
              return "[name].js";
            }

            return "assets/[name].js";
          },
          chunkFileNames: "assets/[name]-[hash].js",
          assetFileNames: "assets/[name][extname]"
        }
      }
    }
  };
});
