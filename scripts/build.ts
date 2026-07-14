import { build } from "vite-plus";
import { isAllowedExternal, readDistributionContract } from "./distribution-contract.ts";

const contract = readDistributionContract();

await build({
  configFile: false,
  root: contract.root,
  ssr: {
    noExternal: true,
  },
  build: {
    ssr: "extensions/weixin.ts",
    target: "node22",
    outDir: contract.distDirectory,
    emptyOutDir: true,
    minify: false,
    sourcemap: false,
    rolldownOptions: {
      external: isAllowedExternal,
      output: {
        entryFileNames: contract.outputFileName,
        format: "esm",
      },
    },
  },
});
