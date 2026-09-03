import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import { mattstackVite } from "@mattstack/app-kit/vite";

// "@/..." resolves to src/app: mattstackVite() ships no alias of its own,
// and the existing app source (Task 6 rewrites it) still imports through it.
export default defineConfig({
  ...mattstackVite({ apiPort: 11005 }),
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src/app", import.meta.url)) },
  },
});
