import globals from "globals";
import tseslint from "typescript-eslint";
import eslintPluginUnicorn from "eslint-plugin-unicorn";
import eslintConfigPrettier from "eslint-config-prettier/flat";
import eslint from "@eslint/js";

export default tseslint.config(
    { ignores: ["dist", "node_modules"] },
    {
        files: ["src/**/*.{ts,tsx}"],
        extends: [
            eslint.configs.recommended,
            tseslint.configs.recommendedTypeChecked,
            tseslint.configs.stylisticTypeChecked,
            eslintPluginUnicorn.configs.recommended,
            eslintConfigPrettier
        ],
        languageOptions: {
            ecmaVersion: 2022,
            globals: globals.builtin,
            parserOptions: {
                projectService: true,
                tsconfigRootDir: import.meta.dirname
            }
        },
        rules: {
            eqeqeq: "error",
            "no-fallthrough": ["error", { allowEmptyCase: true }],
            "@typescript-eslint/no-unused-vars": "error",
            "@typescript-eslint/explicit-member-accessibility": "error",
            "@typescript-eslint/no-deprecated": "error",
            "capitalized-comments": [
                "error",
                "always",
                {
                    ignorePattern: "noinspection|prettier"
                }
            ],
            "@typescript-eslint/no-misused-promises": [
                "error",
                {
                    checksVoidReturn: false
                }
            ],
            // Used by libs
            "unicorn/no-null": "off",
            // TODO add proper rules for this later
            "unicorn/prevent-abbreviations": "off",
        }
    },
    {
        files: ["examples/**/*.ts", "tests/**/*.ts"],
        languageOptions: {
            ecmaVersion: 2022,
            globals: globals.builtin,
            parserOptions: {
                projectService: true,
                tsconfigRootDir: import.meta.dirname
            }
        },
        rules: {
            "unicorn/no-process-exit": "off"
        }
    }
);
