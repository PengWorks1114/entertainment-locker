import { readFile } from "fs/promises";
import { fileURLToPath } from "url";
import ts from "typescript";

const TS_EXTENSIONS = new Set([".ts", ".tsx"]);

export async function load(url, context, defaultLoad) {
  const extIndex = url.lastIndexOf(".");
  const ext = extIndex === -1 ? "" : url.slice(extIndex);
  if (!TS_EXTENSIONS.has(ext)) {
    return defaultLoad(url, context, defaultLoad);
  }

  const filePath = fileURLToPath(url);
  const source = await readFile(filePath, "utf8");
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2018,
      jsx: ts.JsxEmit.Preserve,
      esModuleInterop: true,
      moduleResolution: ts.ModuleResolutionKind.NodeNext,
      allowSyntheticDefaultImports: true,
    },
    fileName: filePath,
  });

  return {
    format: "module",
    source: outputText,
    shortCircuit: true,
  };
}
