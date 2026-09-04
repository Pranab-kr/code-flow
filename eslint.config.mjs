import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,

  // src/lib/ir/** must stay PORTABLE: the same module runs in a browser web
  // worker and in a Node job (Vitest today, Inngest later). One React import
  // and it stops being the single source of truth for the graph.
  {
    files: ["src/lib/ir/**/*.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: [
                "react",
                "react-*",
                "next",
                "next/*",
                "@/components/*",
                "@/app/*",
              ],
              message:
                "src/lib/ir must stay portable: it runs in a browser worker AND in a Node job. No React/Next/DOM imports.",
            },
          ],
        },
      ],
    },
  },

  globalIgnores([
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Golden/isomorphism fixtures are test DATA parsed by tree-sitter, never
    // bundled or typechecked. (.py/.cpp/.java fixtures were never lintable;
    // .js fixtures would warn unused-vars on every top-level function.)
    "src/lib/ir/__fixtures__/**",
  ]),
]);

export default eslintConfig;
