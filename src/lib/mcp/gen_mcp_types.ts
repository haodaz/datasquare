import fs from 'fs';
import path from 'path';

interface JsonSchemaProperty {
  type?: string | string[];
  description?: string;
  items?: JsonSchemaProperty | true;
  properties?: Record<string, JsonSchemaProperty>;
  required?: string[];
  additionalProperties?: boolean;
}

interface McpToolDefinition {
  name: string;
  description: string;
  inputSchema: {
    type: string;
    properties: Record<string, JsonSchemaProperty>;
    required?: string[];
    examples?: Record<string, unknown>[];
    additionalProperties?: boolean;
  };
  outputSchema: {
    type: string;
    properties: Record<string, JsonSchemaProperty>;
    required?: string[];
    additionalProperties?: boolean;
  };
}

function toPascalCase(snake: string): string {
  return snake
    .split('_')
    .map(w => w.charAt(0).toUpperCase() + w.slice(1))
    .join('');
}

function toCamelCase(snake: string): string {
  const pascal = toPascalCase(snake);
  return pascal.charAt(0).toLowerCase() + pascal.slice(1);
}

const TS_TYPE_MAP: Record<string, string> = {
  string: 'string',
  integer: 'number',
  boolean: 'boolean',
};

function indent(level: number): string {
  return '  '.repeat(level);
}

function jsonSchemaToTs(
  schema: JsonSchemaProperty,
  requiredFields: string[] = [],
  level = 0,
): string {
  if (!schema.type) return 'unknown';

  const types = Array.isArray(schema.type) ? schema.type : [schema.type];

  const mapped = types.map(t => {
    if (t === 'null') return 'null';
    if (TS_TYPE_MAP[t]) return TS_TYPE_MAP[t];

    if (t === 'array') {
      if (!schema.items || schema.items === true) return 'unknown[]';
      const itemType = jsonSchemaToTs(schema.items, schema.items.required || [], level);
      return `${itemType}[]`;
    }

    if (t === 'object') {
      if (!schema.properties) return 'Record<string, unknown>';
      const props = Object.entries(schema.properties);
      if (props.length === 0) return 'Record<string, unknown>';

      const propRequired = schema.required || [];
      const lines = props.map(([key, prop]) => {
        const optional = !propRequired.includes(key) ? '?' : '';
        const tsType = jsonSchemaToTs(prop, prop.required || [], level + 1);
        const desc = prop.description ? `${indent(level + 2)}/** ${prop.description.replace(/\n/g, ' ')} */\n` : '';
        return `${desc}${indent(level + 2)}${key}${optional}: ${tsType}`;
      });

      // If nested, just return inline
      return `{\n${indent(level + 1)}${lines.join(';\n')}\n${indent(level + 1)}}`;
    }

    return 'unknown';
  });

  return mapped.join(' | ');
}

function getInputBusinessProperties(tool: McpToolDefinition): Record<string, JsonSchemaProperty> {
  const props = { ...tool.inputSchema.properties };
  delete props.endpoint;
  delete props.bearerToken;
  return props;
}

function hasBearerToken(tool: McpToolDefinition): boolean {
  return 'bearerToken' in tool.inputSchema.properties;
}

function hasEndpoint(tool: McpToolDefinition): boolean {
  return 'endpoint' in tool.inputSchema.properties;
}

function getInputRequired(tool: McpToolDefinition): string[] {
  const req = tool.inputSchema.required || [];
  return req.filter(r => r !== 'endpoint' && r !== 'bearerToken');
}

function formatExampleValue(v: unknown): string {
  if (typeof v === 'string') return `\`"${v}"\``;
  return `\`${JSON.stringify(v)}\``;
}

function generateInputInterface(tool: McpToolDefinition): string {
  const pascalName = toPascalCase(tool.name);
  const businessProps = getInputBusinessProperties(tool);
  const required = getInputRequired(tool);
  const entries = Object.entries(businessProps);

  if (entries.length === 0) return '';

  const lines: string[] = [];
  lines.push(`export interface ${pascalName}Input {`);

  for (const [key, prop] of entries) {
    const opt = !required.includes(key) ? '?' : '';
    const tsType = jsonSchemaToTs(prop, prop.required || [], 0);
    const desc = prop.description || '';

    if (desc || tool.inputSchema.examples?.length) {
      lines.push(`  /** ${desc} */`);
      const example = tool.inputSchema.examples?.[0] as Record<string, unknown> | undefined;
      if (example && key in example && desc) {
        lines.push(`  /** @example ${formatExampleValue(example[key])} */`);
      }
    }
    lines.push(`  ${key}${opt}: ${tsType};`);
  }

  lines.push('}');
  return lines.join('\n');
}

// Detect if output matches common patterns and use shared types
function generateOutputType(tool: McpToolDefinition): string {
  const pascalName = toPascalCase(tool.name);
  const props = tool.outputSchema.properties;
  const propKeys = Object.keys(props);

  // Pattern: { items: array, total: number, status: number }
  if (propKeys.includes('items') && propKeys.includes('total')) {
    return `DashGenericSearchResponse<T>`;
  }

  // Pattern: { item: object, status: number }
  if (propKeys.includes('item') && !propKeys.includes('items')) {
    return `DashGenericGetResponse<T>`;
  }

  // For complex nested output schemas, auto-generate
  const required = tool.outputSchema.required || [];
  const entries = Object.entries(tool.outputSchema.properties);
  const lines: string[] = [];
  lines.push(`export interface ${pascalName}Output {`);

  for (const [key, prop] of entries) {
    const opt = !required.includes(key) ? '?' : '';
    const tsType = jsonSchemaToTs(prop, prop.required || [], 0);
    lines.push(`  ${key}${opt}: ${tsType};`);
  }

  lines.push('}');

  // If output has recursive/self-referencing structure (like children in folder),
  // we need special handling. For now, check if any property has `items: true`
  const hasRecursiveRef = entries.some(([, prop]) => prop.items === true);
  if (hasRecursiveRef) {
    return lines.join('\n') + '\n// ⚠️ 包含自引用结构，可能需要手动调整';
  }

  return lines.join('\n');
}

function isSimpleOutput(tool: McpToolDefinition): boolean {
  const propKeys = Object.keys(tool.outputSchema.properties);
  return propKeys.includes('items') && propKeys.includes('total');
}

function isGetOutput(tool: McpToolDefinition): boolean {
  const propKeys = Object.keys(tool.outputSchema.properties);
  return propKeys.includes('item') && !propKeys.includes('items');
}

function generateMethod(tool: McpToolDefinition): string {
  const camelName = toCamelCase(tool.name);
  const pascalName = toPascalCase(tool.name);
  const hasBt = hasBearerToken(tool);
  const hasEp = hasEndpoint(tool);
  const businessProps = getInputBusinessProperties(tool);
  const hasBusinessParams = Object.keys(businessProps).length > 0;

  // Output type determination
  let returnType: string;
  let isGeneric = false;

  if (isSimpleOutput(tool)) {
    returnType = `DashGenericSearchResponse<T>`;
    isGeneric = true;
  } else if (isGetOutput(tool)) {
    returnType = `DashGenericGetResponse<T>`;
    isGeneric = true;
  } else {
    returnType = `${pascalName}Output`;
  }

  const genericParam = isGeneric ? '<T = Record<string, unknown>>' : '';
  const paramsLine = hasBusinessParams ? `params: ${pascalName}Input,` : '';

  const extraParams: string[] = [];
  if (hasBt) extraParams.push('bearerToken?: string');
  if (hasEp) extraParams.push('endpoint?: string');

  const allParams = [paramsLine, ...extraParams].filter(Boolean).join('\n    ');
  const hasAnyExtra = hasBt || hasEp;

  // Build the invoke call
  let invokeCall: string;
  if (hasAnyExtra || !hasBusinessParams) {
    const buildParts: string[] = [];
    if (hasBusinessParams) buildParts.push('...params');
    if (hasBt) buildParts.push('...(bearerToken ? { bearerToken } : {})');
    if (hasEp) buildParts.push('...(endpoint ? { endpoint } : {})');

    if (buildParts.length > 0) {
      invokeCall = `{\n      ${buildParts.join(',\n      ')},\n    }`;
    } else {
      invokeCall = '{}';
    }
  } else {
    invokeCall = 'params as unknown as Record<string, unknown>';
  }

  const desc = tool.description;

  const lines: string[] = [];
  lines.push(`  /** ${desc} */`);
  if (isGeneric) {
    lines.push(`  async ${camelName}${genericParam}(`);
  } else {
    lines.push(`  async ${camelName}(`);
  }
  if (hasBusinessParams) {
    lines.push(`    params: ${pascalName}Input,`);
  }
  if (hasBt) {
    lines.push(`    bearerToken?: string,`);
  }
  if (hasEp) {
    lines.push(`    endpoint?: string,`);
  }
  lines.push(`  ): Promise<${returnType}> {`);

  if (hasAnyExtra || !hasBusinessParams) {
    lines.push(`    return this.invoke<${returnType}>('${tool.name}', ${invokeCall});`);
  } else {
    lines.push(`    return this.invoke<${returnType}>('${tool.name}', params as unknown as Record<string, unknown>);`);
  }

  lines.push('  }');
  return lines.join('\n');
}

function generateFile(tools: McpToolDefinition[]): string {
  const lines: string[] = [];

  lines.push('// ⚠️ AUTO-GENERATED by gen_mcp_types.ts — DO NOT EDIT');
  lines.push('// 运行 npm run mcp:fetch-tools 后执行 npm run mcp:gen-types 重新生成');
  lines.push('');
  lines.push("import { mcpClient } from './client';");
  lines.push('');
  lines.push('export interface DashGenericSearchResponse<T> {');
  lines.push('  items: T[];');
  lines.push('  status: number;');
  lines.push('  total: number;');
  lines.push('}');
  lines.push('');
  lines.push('export interface DashGenericGetResponse<T> {');
  lines.push('  item?: T;');
  lines.push('  status: number;');
  lines.push('}');
  lines.push('');

  // Collect output types that need to be generated
  const outputTypeDefs: string[] = [];
  for (const tool of tools) {
    if (!isSimpleOutput(tool) && !isGetOutput(tool)) {
      const def = generateOutputType(tool);
      if (def) outputTypeDefs.push(def);
    }
  }

  // Input interfaces
  const inputInterfaces: string[] = [];
  for (const tool of tools) {
    const def = generateInputInterface(tool);
    if (def) inputInterfaces.push(def);
  }

  // Write all output types first
  for (const def of outputTypeDefs) {
    lines.push(def);
    lines.push('');
  }

  // Write all input interfaces
  for (const def of inputInterfaces) {
    lines.push(def);
    lines.push('');
  }

  // Write McpToolsService class
  lines.push('/**');
  lines.push(' * MCP 工具调用服务 — 所有方法均从 mcp_tools_list.json 自动生成。');
  lines.push(' * 业务参数与基础设施参数（bearerToken / endpoint）分离。');
  lines.push(' */');
  lines.push('export class McpToolsService {');
  lines.push('  private defaultBearerToken?: string;');
  lines.push('  private defaultEndpoint?: string;');
  lines.push('');
  lines.push('  constructor(options?: { bearerToken?: string; endpoint?: string }) {');
  lines.push('    this.defaultBearerToken = options?.bearerToken;');
  lines.push('    this.defaultEndpoint = options?.endpoint;');
  lines.push('  }');
  lines.push('');

  // invoke helper
  lines.push('  private invoke<T>(');
  lines.push('    toolName: string,');
  lines.push('    buildArgs: Record<string, unknown>,');
  lines.push('  ): Promise<T> {');
  lines.push('    // 数据平台场景：强制使用环境变量覆盖 bearerToken 和 endpoint');
  lines.push('    if (this.defaultBearerToken !== undefined) {');
  lines.push('      buildArgs = { ...buildArgs, bearerToken: this.defaultBearerToken };');
  lines.push('    }');
  lines.push('    if (this.defaultEndpoint !== undefined) {');
  lines.push('      buildArgs = { ...buildArgs, endpoint: this.defaultEndpoint };');
  lines.push('    }');
  lines.push('    return mcpClient.callTool<T>(toolName, buildArgs as unknown as Record<string, unknown>);');
  lines.push('  }');
  lines.push('');

  // Methods
  for (const tool of tools) {
    lines.push(generateMethod(tool));
    lines.push('');
  }

  lines.push('}');
  lines.push('');
  lines.push('export const mcpTools = new McpToolsService();');
  lines.push('');
  lines.push('/** 数据平台专用 MCP 工具实例，强制使用 VISIONSQUARE_DATA_HOST 作为 endpoint、VISIONSQUARE_AUTH_BEARER 作为 bearerToken */');
  lines.push('export const mcpToolsDataPlatform = new McpToolsService({');
  lines.push('  endpoint: process.env.VISIONSQUARE_DATA_HOST,');
  lines.push('  bearerToken: process.env.VISIONSQUARE_AUTH_BEARER,');
  lines.push('});');
  lines.push('');

  return lines.join('\n');
}

function main() {
  const jsonPath = path.join(__dirname, 'mcp_tools_list.json');
  const outPath = path.join(__dirname, 'generated-tools.ts');

  const raw = fs.readFileSync(jsonPath, 'utf-8');
  const tools: McpToolDefinition[] = JSON.parse(raw);

  const code = generateFile(tools);
  fs.writeFileSync(outPath, code, 'utf-8');

  console.log(`✅ 已生成 ${tools.length} 个工具的封装方法 → ${outPath}`);
}

main();
