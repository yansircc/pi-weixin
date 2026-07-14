import { defineConfig } from "vite-plus";

export default defineConfig({
  fmt: {
    ignorePatterns: ["dist/**"],
  },
  lint: {
    ignorePatterns: ["dist/**"],
    options: {
      typeAware: true,
      // tsc owns Effect language-service diagnostics.
      typeCheck: false,
    },
  },
  test: {
    include: ["test/**/*.test.ts"],
  },
  run: {
    tasks: {
      "ci:build": {
        command: "node scripts/build.ts",
        cache: false,
      },
      "ci:bundle": {
        command: "node scripts/verify-distribution.ts bundle",
        cache: false,
      },
      "ci:distribution": {
        command: "node scripts/verify-distribution.ts package",
        cache: false,
      },
      "ci:typecheck": {
        command: "tsc --noEmit",
        cache: false,
      },
      "ci:effect": {
        command: "effect-skill-scan . --strict --output raw-json --profile",
        cache: false,
      },
      "ci:verify": {
        command: [
          "vp check",
          "vp run ci:typecheck",
          "vp test",
          "vp run ci:effect",
          "vp run ci:build",
          "vp run ci:distribution",
        ],
        cache: false,
      },
    },
  },
});
