import { defineCommand } from "citty";
import { resolveToken } from "../../lib/config.js";
import { formatError, outputError } from "../../lib/error.js";
import type {
  FigmaLocalVariablesResponse,
  FigmaPublishedVariablesResponse,
  FigmaVariable,
  FigmaVariableCollection,
  FigmaVariableValue,
} from "../../lib/figma-client.js";
import { parseFigmaFileUrl } from "../../lib/figma-url.js";
import { getVariables } from "./variables.js";

export default defineCommand({
  meta: {
    name: "variables",
    description: "Figma ファイルの変数（デザイントークン）を取得する",
  },
  args: {
    url: {
      type: "positional",
      required: true,
      description: 'Figma のファイル URL（引用符で囲んでください 例: "https://..."）',
    },
    pretty: {
      type: "boolean",
      default: false,
      description: "人間向けのテキスト形式で出力",
    },
    published: {
      type: "boolean",
      default: false,
      description: "公開済み変数を取得する（デフォルトはローカル変数）",
    },
  },
  async run({ args }) {
    const urlResult = parseFigmaFileUrl(args.url);
    if (urlResult.isErr()) {
      outputError(args.pretty, formatError(urlResult.error));
      return process.exit(1);
    }

    const tokenResult = await resolveToken();
    if (tokenResult.isErr()) {
      outputError(args.pretty, formatError(tokenResult.error));
      return process.exit(1);
    }

    const { fileKey } = urlResult.value;

    const variablesResult = await getVariables({
      fileKey,
      token: tokenResult.value,
      published: args.published,
    });

    if (variablesResult.isErr()) {
      outputError(args.pretty, formatError(variablesResult.error));
      return process.exit(1);
    }

    const response = variablesResult.value;

    if (args.pretty) {
      formatVariablesResponse(response, args.published);
    } else {
      console.log(JSON.stringify(response));
    }
  },
});

function formatVariablesResponse(
  response: FigmaLocalVariablesResponse | FigmaPublishedVariablesResponse,
  isPublished: boolean,
): void {
  const { variables, variableCollections } = response.meta;

  const varCount = Object.keys(variables).length;
  const collectionCount = Object.keys(variableCollections).length;
  console.log(`Variables: ${varCount}, Collections: ${collectionCount}`);
  console.log("");

  if (!isPublished) {
    formatLocalVariables(response as FigmaLocalVariablesResponse);
  } else {
    formatPublishedVariables(response as FigmaPublishedVariablesResponse);
  }
}

function formatLocalVariables(response: FigmaLocalVariablesResponse): void {
  const { variables, variableCollections } = response.meta;

  for (const collection of Object.values(variableCollections)) {
    formatCollection(collection, variables);
  }
}

function formatCollection(
  collection: FigmaVariableCollection,
  variables: Record<string, FigmaVariable>,
): void {
  const modeNames = collection.modes.map((m) => m.name).join(", ");
  console.log(`Collection: ${collection.name} (modes: ${modeNames})`);

  for (const varId of collection.variableIds) {
    const variable = variables[varId];
    if (!variable) continue;

    console.log(`  ${variable.name}  ${variable.resolvedType}`);
    for (const mode of collection.modes) {
      const value = variable.valuesByMode[mode.modeId];
      if (value !== undefined) {
        console.log(`    ${mode.name}: ${formatValue(value)}`);
      }
    }
  }

  console.log("");
}

function formatValue(value: FigmaVariableValue): string {
  if (typeof value === "object" && value !== null) {
    if ("type" in value && value.type === "VARIABLE_ALIAS") {
      return `-> alias(${value.id})`;
    }
    // カラー値
    if ("r" in value) {
      return `rgba(${value.r.toFixed(2)}, ${value.g.toFixed(2)}, ${value.b.toFixed(2)}, ${value.a.toFixed(2)})`;
    }
  }
  return String(value);
}

function formatPublishedVariables(response: FigmaPublishedVariablesResponse): void {
  for (const variable of Object.values(response.meta.variables)) {
    console.log(`  ${variable.name}  ${variable.resolvedType}  (updated: ${variable.updatedAt})`);
  }
}
