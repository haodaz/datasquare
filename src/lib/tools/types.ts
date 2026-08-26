export interface ToolDefinition {
  name: string;
  description: string;
  input_schema: {
    type: string;
    properties: Record<string, any>;
    required?: string[];
  };
}

export interface ToolContext {
  skills?: any[];
  repositoryIds?: number[];
  memoryNamespace?: string;
  token?: string;
}

export type ToolExecutor = (inputs: any, context: ToolContext) => Promise<any> | any;

export interface ToolModule {
  definitions: ToolDefinition[];
  executors: Record<string, ToolExecutor>;
}
