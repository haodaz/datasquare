/**
 * HTTP-based MCP Client — 替代 dash-mcp 二进制
 * 
 * 原来的 McpClient 通过 spawn 子进程 + stdin/stdout JSON-RPC 与 dash-mcp 通信，
 * dash-mcp 内部再通过 GraphQL 请求 Flora/VisionSquare API。
 * 
 * 本文件直接用 fetch + GraphQL 实现同样的功能，去掉中间的二进制进程依赖，
 * 使得代码可以在 Vercel Serverless 等环境运行。
 * 
 * 上层代码（generated-tools.ts 等）零改动：依然调用 mcpClient.callTool(name, args)。
 */

export interface JsonRpcRequest {
  jsonrpc: '2.0';
  id?: number | string;
  method: string;
  params?: Record<string, unknown>;
}

export interface JsonRpcResponse {
  jsonrpc: '2.0';
  id: number | string;
  result?: unknown;
  error?: {
    code: number;
    message: string;
    data?: unknown;
  };
}

export interface UserMeResponse {
  me?: {
    display_name?: string;
    email?: string;
    name?: string;
    nickname?: string;
    phone?: string;
    uid?: number;
    user_org_default_language?: string;
  };
  status?: number;
}

// ── GraphQL query/mutation 模板 ─────────────────────────────────────────

const GQL_QUERIES: Record<string, { query: string; extractPath: string[] }> = {
  dash_generic_search: {
    query: `query DashGenericSearch($model: String!, $condition: String, $fields: [String!], $limit: Int, $offset: Int, $order_by: String) {
  dash { generic { search(model: $model, condition: $condition, fields: $fields, limit: $limit, offset: $offset, order_by: $order_by) { status items total } } }
}`,
    extractPath: ['dash', 'generic', 'search'],
  },
  dash_generic_get: {
    query: `query DashGenericGet($model: String!, $id: Int, $flora_external_id: String, $fields: [String!]) {
  dash { generic { get(model: $model, id: $id, flora_external_id: $flora_external_id, fields: $fields) { status item } } }
}`,
    extractPath: ['dash', 'generic', 'get'],
  },
  dash_generic_get_by_flora_external_id: {
    query: `query DashGenericGetByFloraExternalID($model: String!, $flora_external_id: String!, $fields: [String!]) {
  dash { generic { getByFloraExternalId(model: $model, flora_external_id: $flora_external_id, fields: $fields) { status item } } }
}`,
    extractPath: ['dash', 'generic', 'getByFloraExternalId'],
  },
  dash_generic_save: {
    query: `mutation DashGenericSave($model: String!, $values: String!, $flora_external_id: String) {
  dash { generic { save(model: $model, values: $values, flora_external_id: $flora_external_id) { status error id } } }
}`,
    extractPath: ['dash', 'generic', 'save'],
  },
  dash_generic_delete: {
    query: `mutation DashGenericDelete($model: String!, $id: Int!) {
  dash { generic { unlink(model: $model, id: $id) { status error_msg } } }
}`,
    extractPath: ['dash', 'generic', 'unlink'],
  },
  dash_generic_fields: {
    query: `query DashGenericFields($model: String!, $fields: [String!]) {
  dash { generic { fields(model: $model, fields: $fields) { status rawFieldInfo fields { field_path field_type label description is_relation relation_model } } } }
}`,
    extractPath: ['dash', 'generic', 'fields'],
  },
  dash_generic_get_model_list: {
    query: `query DashGenericGetModelList {
  dash { generic { getModelList { status models { name display_name description } } } }
}`,
    extractPath: ['dash', 'generic', 'getModelList'],
  },
  dash_generic_allow_permission_tags: {
    query: `query DashGenericAllowPermissionTags($match_permission_tags: [String!]) {
  dash { generic { allowPermissionTags(match_permission_tags: $match_permission_tags) { status allowPermissionTags } } }
}`,
    extractPath: ['dash', 'generic', 'allowPermissionTags'],
  },
  dash_generic_relation_model_search: {
    query: `query DashGenericRelationModelSearch($model: String!, $relation_model: String!, $condition: String, $fields: [String!], $limit: Int, $offset: Int) {
  dash { generic { relationModelSearch(model: $model, relation_model: $relation_model, condition: $condition, fields: $fields, limit: $limit, offset: $offset) { status items total } } }
}`,
    extractPath: ['dash', 'generic', 'relationModelSearch'],
  },
  user_me: {
    query: `query UserMe {
  user { me { uid display_name name nickname email phone user_org_default_language } }
}`,
    extractPath: ['user', 'me'],
  },
  assist_repository_search: {
    query: `query AssistRepositorySearch($query: String, $type_ids: [Int!], $scene_key: [String!], $kind_key: [String!], $category_key: String, $label_key: [String!], $location: String, $published_start_time: String, $published_end_time: String, $release_start_time: String, $release_end_time: String, $selected_modules_only: [String!], $sortby: String, $offset: Int, $size: Int) {
  assist { repository { search(query: $query, type_ids: $type_ids, scene_key: $scene_key, kind_key: $kind_key, category_key: $category_key, label_key: $label_key, location: $location, published_start_time: $published_start_time, published_end_time: $published_end_time, release_start_time: $release_start_time, release_end_time: $release_end_time, selected_modules_only: $selected_modules_only, sortby: $sortby, offset: $offset, size: $size) { status items total } } }
}`,
    extractPath: ['assist', 'repository', 'search'],
  },
  user_client_profile_id: {
    query: `query UserClientProfileId {
  user { clientProfileId { status uid client_id } }
}`,
    extractPath: ['user', 'clientProfileId'],
  },
  user_login_by_phone: {
    query: `mutation UserLoginByPhone($phone: String!, $code: String!) {
  user { loginByPhone(phone: $phone, code: $code) { status token is_register } }
}`,
    extractPath: ['user', 'loginByPhone'],
  },
  user_send_login_sms_code: {
    query: `mutation UserSendLoginSmsCode($phone: String!) {
  user { sendLoginSmsCode(phone: $phone) { status } }
}`,
    extractPath: ['user', 'sendLoginSmsCode'],
  },
};

// ── REST fallback 映射（少数工具用 REST 而非 GraphQL）───────────────────

const REST_TOOLS: Record<string, { method: string; pathBuilder: (args: Record<string, unknown>) => string }> = {
  auth_request_login_token: {
    method: 'POST',
    pathBuilder: () => '/api/auth/v1/request-login-token',
  },
  auth_request_login_token_v2: {
    method: 'POST',
    pathBuilder: () => '/api/auth/v2/get-login-token',
  },
  auth_get_user_token_with_token_v2: {
    method: 'POST',
    pathBuilder: () => '/api/auth/v2/get-user-token-with-token',
  },
};

// ── HTTP MCP Client ─────────────────────────────────────────────────────

export class McpClient {
  private isInitialized = false;

  async start() {
    // HTTP 模式不需要启动子进程
    this.isInitialized = true;
  }

  async getTools() {
    // 返回空 — 工具列表已经在 generated-tools.ts 中硬编码
    return [];
  }

  async callTool<T = unknown>(name: string, args: Record<string, unknown> = {}): Promise<T> {
    console.log(`[MCP HTTP] ${name} args:`, JSON.stringify(args));

    // 提取 endpoint 和 bearerToken（由 McpToolsService 注入）
    const endpoint = (args.endpoint as string) || process.env.FLORA_HOST || 'https://polarise-ss-alpha.nx1.applysquare.net';
    const bearerToken = (args.bearerToken as string) || process.env.FLORA_AUTH_BEARER || '';

    // 从 args 中移除 endpoint/bearerToken（不传给 GraphQL）
    const cleanArgs = { ...args };
    delete cleanArgs.endpoint;
    delete cleanArgs.bearerToken;

    // REST 工具走 REST 路径
    if (REST_TOOLS[name]) {
      return this.callRest<T>(name, endpoint, bearerToken, cleanArgs);
    }

    // GraphQL 工具
    return this.callGraphQL<T>(name, endpoint, bearerToken, cleanArgs);
  }

  private async callGraphQL<T>(
    toolName: string,
    endpoint: string,
    bearerToken: string,
    variables: Record<string, unknown>,
  ): Promise<T> {
    const gql = GQL_QUERIES[toolName];
    if (!gql) {
      throw new Error(`[MCP HTTP] Unknown tool: ${toolName}. Add it to GQL_QUERIES.`);
    }

    const url = `${endpoint}/gql/endpoint`;
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(bearerToken ? { 'X-Token': bearerToken } : {}),
      },
      body: JSON.stringify({ query: gql.query, variables }),
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`[MCP HTTP] GraphQL request failed (${res.status}): ${text.substring(0, 200)}`);
    }

    const json = await res.json();

    if (json.errors?.length) {
      const msg = json.errors.map((e: any) => e.message).join('; ');
      throw new Error(`[MCP HTTP] GraphQL error: ${msg}`);
    }

    // 按 extractPath 提取嵌套数据
    let data = json.data;
    for (const key of gql.extractPath) {
      data = data?.[key];
    }

    // 特殊处理 user_me：包裹成 { me: ..., status: 200 } 格式（兼容上层代码）
    if (toolName === 'user_me') {
      return { me: data, status: 200 } as T;
    }

    return (data ?? json.data) as T;
  }

  private async callRest<T>(
    toolName: string,
    endpoint: string,
    bearerToken: string,
    body: Record<string, unknown>,
  ): Promise<T> {
    const rest = REST_TOOLS[toolName];
    const url = `${endpoint}${rest.pathBuilder(body)}`;

    const res = await fetch(url, {
      method: rest.method,
      headers: {
        'Content-Type': 'application/json',
        ...(bearerToken ? { 'X-Token': bearerToken } : {}),
      },
      body: rest.method !== 'GET' ? JSON.stringify(body) : undefined,
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`[MCP HTTP] REST request failed (${res.status}): ${text.substring(0, 200)}`);
    }

    return res.json() as Promise<T>;
  }

  stop() {
    // HTTP 模式无需清理
  }
}

declare global {
  // eslint-disable-next-line no-var
  var _globalMcpClient: McpClient | undefined;
}

export const mcpClient = global._globalMcpClient || new McpClient();

if (process.env.NODE_ENV !== 'production') {
  global._globalMcpClient = mcpClient;
}
