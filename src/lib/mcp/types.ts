export interface DashGenericUpdateResponse {
  status: number;
  id?: number;
  item?: { id?: number };
}

export interface DashUpsertResponse {
  status?: number;
  id?: number;
  item?: { id?: number };
  data?: { id?: number };
  remoteResponse?: {
    id?: number;
    [key: string]: unknown;
  };
}

export interface AssistAIDialogueItem {
  id: number;
  title?: string;
  scene?: string;
  name?: string;
  type?: string;
  is_broadcast?: boolean;
  additional_information?: string;
  create_date?: string;
  write_date?: string;
  deleted?: boolean;
}

export interface AssistAIChatItem {
  id: number;
  ask?: string;
  ai_data?: string;
  create_date?: string;
}
