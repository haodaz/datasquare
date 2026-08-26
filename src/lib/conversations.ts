import { Message } from '@/lib/ai/types';

export interface Conversation {
  id: string;
  charId: string;
  charName: string;
  avatar?: string;
  history: Message[];
  lastMsg: string;
  updatedAt: string;
  title: string;
}

export const getConversations = async (): Promise<Conversation[]> => {
  if (typeof window === 'undefined') return [];
  try {
    const res = await fetch('/api/conversations');
    return await res.json();
  } catch (e) {
    console.error('Failed to fetch conversations', e);
    return [];
  }
};

export const getConversation = async (id: string): Promise<Conversation | undefined> => {
  try {
    const res = await fetch(`/api/conversations/${id}`);
    if (!res.ok) return undefined;
    return await res.json();
  } catch (e) {
    return undefined;
  }
};

export const updateConversation = async (conv: Conversation): Promise<Conversation | undefined> => {
  try {
    const res = await fetch('/api/conversations', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(conv)
    });
    const data = await res.json();
    if (data.data) {
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new Event('conversationsUpdated'));
      }
      return data.data;
    }
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new Event('conversationsUpdated'));
    }
    return conv; // fallback to original if no data returned
  } catch (e) {
    console.error('Failed to update conversation', e);
    return undefined;
  }
};

export const deleteConversation = async (id: string) => {
  try {
    await fetch(`/api/conversations/${id}`, { method: 'DELETE' });
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new Event('conversationsUpdated'));
    }
  } catch (e) {
    console.error('Failed to delete conversation', e);
  }
};

export const createConversation = async (charId: string, charName: string): Promise<Conversation> => {
  const newConv: Conversation = {
    id: `conv_${Date.now()}`,
    charId,
    charName,
    history: [],
    lastMsg: '',
    updatedAt: new Date().toISOString(),
    title: charName
  };
  const updatedConv = await updateConversation(newConv);
  return updatedConv || newConv;
};
