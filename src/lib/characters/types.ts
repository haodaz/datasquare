import type { Character } from '@/lib/ai/types';

export type { Character };

export interface Banner {
  id: string;
  img: string;
  linkType: 'ai' | 'theme';
  linkValue: string;
}

export interface HomeConfig {
  banners: Banner[];
  recommendedIds: string[];
  hotIds?: string[];
  themes: string[];
  themeOrder?: string[];
}

export interface Theme {
  id: string;
  name: string;
  description?: string;
  icon?: string;
}

export interface RoundtableRoom {
  id: string;
  name: string;
  topic?: string;
  characters: string[];
  updatedAt: string;
  lastMsg?: { role: string; content: string; charName: string };
  is_broadcast?: boolean;
  creator_id?: string;
  broadcast_start_idx?: number;
}

export interface RoomMessage {
  role: 'user' | 'ai' | 'system';
  content: string;
  charId?: string;
  charName?: string;
  timestamp: number;
}

export interface AudienceMessage {
  type: 'system' | 'user';
  text?: string;
  content?: string;
  username?: string;
  isCreator?: boolean;
  timestamp: number;
}

export interface Room {
  id: string;
  name: string;
  topic?: string;
  characters: string[];
  messages: RoomMessage[];
  isLive?: boolean;
  is_broadcast?: boolean;
  creator_id?: string;
  broadcast_start_idx?: number;
}

export interface KbLibrary {
  id: string;
  name: string;
  emoji: string;
  desc?: string;
  fileCount: number;
  updatedAt?: string;
}

export interface CharacterListResponse {
  characters: Character[];
  total: number;
}
