const prettier = {
    printWidth: 140,
    tabWidth: 4,
    trailingComma: "all",
    overrides: [{ files: ["*.yaml", "*.yml"], options: { tabWidth: 2 } }],
} as const;

export default prettier;
