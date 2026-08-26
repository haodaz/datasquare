import { mcpTools } from './generated-tools';
import { cacheGetOrSet, cacheSet, cacheDel, hashToken } from '@/lib/redis';

const KB_FILE_TREE_TTL = 60; // 60s

/** 获取缓存的云端文件树（按用户隔离） */
async function getCachedMyFile(token: string) {
  return cacheGetOrSet(
    `kb:file_tree:${hashToken(token)}`,
    async () => {
      const result = await mcpTools.getMyFile(token, process.env.FLORA_HOST);
      if (result.status !== 1 && result.status !== 200) {
        throw new Error(`MCP getMyFile failed with status ${result.status}`);
      }
      return result;
    },
    KB_FILE_TREE_TTL,
  );
}

async function getLibraryConfig(token: string, folderId: number, configItemId?: number) {
  const cacheKey = `kb:config:${folderId}`;
  return cacheGetOrSet(cacheKey, async () => {
    try {
      if (!configItemId) throw new Error('No configItemId');
      const detail = await mcpTools.dashGenericGet({
        model: 'AiAgentRepository', id: configItemId,
        fields: ['repository_id.download_url', 'blob_id.download_url']
      }, token, process.env.FLORA_HOST) as Record<string, unknown>;
      
      const item = detail?.item as Record<string, unknown>;
      const downloadUrl = item?.['repository_id.download_url'] || item?.['blob_id.download_url'];
      if (downloadUrl) {
        const url = typeof downloadUrl === 'string' ? downloadUrl : 
                    Array.isArray(downloadUrl) ? downloadUrl[0] : null;
        if (url && typeof url === 'string') {
          const fetchRes = await fetch(url.startsWith('http') ? url : `https://${url}`);
          if (fetchRes.ok) {
             const json = await fetchRes.json();
             return { desc: json.desc || '', emoji: json.emoji || '📚' };
          }
        }
      }
    } catch (e) {
      console.warn(`[getLibraryConfig] fetch config error for folderId=${folderId}`, e);
    }
    // 不要抛出异常，否则会导致 Promise rejection 从而触发 cacheGetOrSet 不缓存。
    // 但是这里我们其实希望如果没取到，可以稍微缓存一下（比如 5s），防止频繁重试。
    // 但是 cacheGetOrSet 会直接缓存 1小时！
    // 为了防止死锁（一直缓存空的），如果没有读到，我们不缓存它。
    throw new Error('Config not found or failed to load');
  }, 3600).catch(() => ({ desc: '', emoji: '📚' })); // 如果报错，则返回默认值（不在 Redis 中缓存）
}

interface KbTreeNode {
  id: number;
  name: string;
  children?: KbTreeNode[];
  fileList?: KbFileItem[];
  create_date?: string;
  updated_at?: string;
  size?: number;
  name_field?: string;
  origin_filename?: string;
  extension?: string;
}

interface KbFileItem {
  id: number;
  name?: string;
  origin_filename?: string;
  size: number;
  updated_at: string;
  extension?: string;
}

export const kbManager = {
  TARGET_FOLDER_NAME: '知己知识库',

  /**
   * 确保「知己知识库」文件夹存在，并返回其 ID
   */
  async ensureCompanionFolder(token: string): Promise<number | null> {
    try {
      const res = await getCachedMyFile(token) as unknown as Record<string, unknown> | null;
      const rootFolder = (res?.folder || (res?.item as Record<string, unknown>)?.folder) as KbTreeNode | undefined;
      if (!rootFolder) {
        return null;
      }

      const findFolder = (node: KbTreeNode): number | null => {
        if (node.name === this.TARGET_FOLDER_NAME) return node.id;
        if (node.children && Array.isArray(node.children)) {
          for (const child of node.children) {
            const found = findFolder(child);
            if (found) return found;
          }
        }
        return null;
      };

      let folderId = findFolder(rootFolder);

      if (!folderId) {
        const createRes = await mcpTools.repositoryFolderManage({
          action: 'create',
          name: this.TARGET_FOLDER_NAME,
          parent_id: rootFolder.id,
        }, token, process.env.FLORA_HOST) as unknown as Record<string, unknown>;
        folderId = createRes?.id as number || ((createRes?.item as Record<string, unknown>)?.id as number);
      }

      return folderId ? Number(folderId) : null;
    } catch (error) {
      return null;
    }
  },

  /**
   * 获取云端知识库中的所有“库”（即子文件夹）
   * 兼容旧数据：同时查找根文件夹子文件夹和“知己知识库”下的子文件夹
   */
  async getLibraries(token: string) {
    try {
      const res = await getCachedMyFile(token) as unknown as { folder?: KbTreeNode } | null;
      const rootFolder = res?.folder;
      
      if (!rootFolder) return [];

      // 收集所有知识库文件夹：根目录子文件夹 + 知己知识库下的子文件夹
      const allLibFolders: KbTreeNode[] = [];

      // 1. 根目录的直接子文件夹（排除“知己知识库”自身）
      const rootChildren = rootFolder.children || [];
      for (const child of rootChildren) {
        if (child.name === this.TARGET_FOLDER_NAME) {
          // 2. “知己知识库”下的子文件夹（兼容旧数据）
          const companionChildren = child.children || [];
          allLibFolders.push(...companionChildren);
        } else {
          allLibFolders.push(child);
        }
      }

      const libraries = await Promise.all(allLibFolders
        .map(async (child: KbTreeNode) => {
          const fileList: KbFileItem[] = child.fileList || [];
          const files = fileList.filter(f => {
            const fname = (f.name || f.origin_filename) ?? '';
            return fname !== 'config.json' && !/\.extracted\.txt$/.test(fname) && !/\.chunks\.json$/.test(fname);
          });
          
          let desc = '';
          let emoji = '📚';
          const configItem = fileList.find(f => (f.name || f.origin_filename) === 'config.json');
          
          try {
            const conf = await getLibraryConfig(token, child.id, configItem?.id);
            desc = conf.desc;
            emoji = conf.emoji;
          } catch (e) {
            // Already handled by catch fallback in getLibraryConfig
          }

          return {
            id: String(child.id),
            name: child.name,
            desc,
            emoji,
            createdAt: child.create_date || child.updated_at || new Date().toISOString(),
            fileCount: files.length,
            ctxBytes: files.reduce((acc: number, f: KbFileItem) => acc + (f.size || 0), 0),
          };
        }));

      return libraries;
    } catch (error) {
      return [];
    }
  },

  /**
   * 创建云端知识库（子文件夹）
   */
  async createLibrary(token: string, name: string, desc?: string, emoji?: string) {
    try {
      const res = await getCachedMyFile(token) as unknown as { folder?: KbTreeNode } | null;
      const rootFolder = res?.folder;
      if (!rootFolder) return null;

      // 创建前先检查是否有同名知识库
      const existing = await this.getLibraries(token);
      if (existing && existing.some((lib: any) => lib.name === name)) {
        throw new Error(`知识库「${name}」已存在，请使用其他名称`);
      }

      const createRes = await mcpTools.repositoryFolderManage({
        action: 'create',
        name: name,
        parent_id: rootFolder.id,
      }, token, process.env.FLORA_HOST) as unknown as Record<string, unknown>;
      const folderId = createRes?.id || (createRes?.item as Record<string, unknown>)?.id;

      if (folderId) {
        const configBase64 = Buffer.from(JSON.stringify({ desc, emoji })).toString('base64');
        const uploadRes = await mcpTools.fileUpload({
          fileContent: configBase64,
          fileName: 'config.json',
          public: false,
        }, token, process.env.FLORA_HOST) as unknown as Record<string, unknown>;
        const blobId = uploadRes?.id || (uploadRes?.blob as Record<string, unknown>)?.id;
        if (blobId) {
          await mcpTools.repositoryFileManage({
          action: 'create',
          name: 'config.json',
          folder_id: folderId,
          blob_id: blobId,
        }, token, process.env.FLORA_HOST) as unknown as Record<string, unknown>;
        }

        await cacheDel(`kb:file_tree:${hashToken(token)}`);
        await cacheSet(`kb:config:${folderId}`, { desc: desc || '', emoji: emoji || '📚' }, 3600);

        return {
          id: String(folderId),
          name,
          desc: desc || '',
          emoji: emoji || '📚',
          fileCount: 0,
          createdAt: new Date().toISOString()
        };
      }
      return null;
    } catch (error: any) {
      throw error;
    }
  },

  /**
   * 更新知识库（名称、简介、Emoji）
   */
  async updateLibrary(token: string, id: string | number, name: string, desc?: string, emoji?: string) {
    try {
      const folderId = Number(id);
      
      // 1. 修改文件夹名称
      await mcpTools.repositoryFolderManage({
        action: 'update',
        id: folderId,
        name: name,
      }, token, process.env.FLORA_HOST);

      // 2. 更新 config.json
      const configBase64 = Buffer.from(JSON.stringify({ desc, emoji })).toString('base64');
      const uploadRes = await mcpTools.fileUpload({
        fileContent: configBase64,
        fileName: 'config.json',
        public: false,
      }, token, process.env.FLORA_HOST) as unknown as Record<string, unknown>;
      const blobId = uploadRes?.id || (uploadRes?.blob as Record<string, unknown>)?.id;
      
      if (blobId) {
        const res = await getCachedMyFile(token) as unknown as { folder?: KbTreeNode } | null;
        const rootFolder = res?.folder;
        let configItemId: number | undefined;
        
        if (rootFolder) {
          const findNode = (node: KbTreeNode, tId: number): KbTreeNode | null => {
            if (node.id === tId) return node;
            if (node.children && Array.isArray(node.children)) {
              for (const child of node.children) {
                const found = findNode(child, tId);
                if (found) return found;
              }
            }
            return null;
          };
          const targetFolder = findNode(rootFolder, folderId);
          const configItem = targetFolder?.fileList?.find((f: any) => (f.name || f.origin_filename) === 'config.json');
          if (configItem) {
            configItemId = configItem.id;
          }
        }
        
        if (configItemId) {
          // 先删除旧的 config.json
          await mcpTools.repositoryFileManage({
            action: 'delete',
            id: configItemId,
          }, token, process.env.FLORA_HOST);
        }

        // 创建新的 config.json
        await mcpTools.repositoryFileManage({
          action: 'create',
          name: 'config.json',
          folder_id: folderId,
          blob_id: blobId as number,
        }, token, process.env.FLORA_HOST);
      }

      // 清除文件树缓存（确保下次请求重新获取）
      await cacheDel(`kb:file_tree:${hashToken(token)}`);
      
      // 清除 config 缓存，防止返回旧数据（MCP 文件树可能有延迟，不缓存旧的 config）
      await cacheDel(`kb:config:${folderId}`);
      
      // 设置新的 config 缓存（立即生效）
      await cacheSet(`kb:config:${folderId}`, { desc: desc || '', emoji: emoji || '📚' }, 3600);

      return true;
    } catch (error: any) {
      throw error;
    }
  },

  /**
   * 删除云端知识库（子文件夹）
   */
  async deleteLibrary(token: string, id: string | number) {
    try {
      await mcpTools.repositoryFolderManage({
        action: 'delete',
        id: Number(id),
      }, token, process.env.FLORA_HOST);
      await cacheDel(`kb:file_tree:${hashToken(token)}`);
      return true;
    } catch (error) {
      return false;
    }
  },

  /**
   * 获取特定库内的文件列表
   */
  async getFiles(token: string, libraryId?: string) {
    try {
      const folderId = libraryId ? Number(libraryId) : await this.ensureCompanionFolder(token);
      if (!folderId) return [];

      const res = await getCachedMyFile(token) as unknown as { folder?: KbTreeNode; status?: number; error?: string } | null;
      if (!res || res.status === 0) {
        console.warn('[getFiles] getCachedMyFile returned empty or failed');
        return [];
      }

      const rootFolder = res?.folder;
      if (!rootFolder) {
        console.warn('[getFiles] rootFolder not found in response');
        return [];
      }

      const findNode = (node: KbTreeNode, id: number): KbTreeNode | null => {
        if (node.id === id) return node;
        if (node.children && Array.isArray(node.children)) {
          for (const child of node.children) {
            const found = findNode(child, id);
            if (found) return found;
          }
        }
        return null;
      };

      const targetFolder = findNode(rootFolder, folderId);
      if (!targetFolder) {
        console.warn('[getFiles] targetFolder not found for folderId:', folderId);
        return [];
      }

      const fileList: KbFileItem[] = targetFolder.fileList || [];
      const filtered = fileList
        .filter((item: KbFileItem) => {
          const fname = (item.name || item.origin_filename) ?? '';
          return fname !== 'config.json' && !/\.extracted\.txt$/.test(fname) && !/\.chunks\.json$/.test(fname);
        })
        .map((item: KbFileItem) => ({
          name: String(item.name || item.origin_filename || ''),
          size: item.size || 0,
          updatedAt: item.updated_at || new Date().toISOString(),
          type: item.extension || item.name?.split('.').pop() || 'unknown',
          id: item.id
        }));
      return filtered;
    } catch (error) {
      console.warn('[getFiles] error:', error);
      return [];
    }
  },

  /**
   * 上传文件到特定库
   */
  async saveFile(token: string, filename: string, content: Buffer, libraryId?: string) {
    try {
      const folderId = libraryId ? Number(libraryId) : await this.ensureCompanionFolder(token);
      if (!folderId) {
        return null;
      }

      const uploadRes = await mcpTools.fileUpload({
        fileContent: content.toString('base64'),
        fileName: filename,
        public: false,
      }, token, process.env.FLORA_HOST) as unknown as Record<string, unknown>;
      const blobId = uploadRes?.id || (uploadRes?.blob as Record<string, unknown>)?.id;
      if (!blobId) return null;

      const repoRes = await mcpTools.repositoryFileManage({
        action: 'create',
        name: filename,
        folder_id: folderId,
        blob_id: blobId,
      }, token, process.env.FLORA_HOST);
      
      await cacheDel(`kb:file_tree:${hashToken(token)}`);
      return (repoRes as Record<string, unknown>)?.item || repoRes;
    } catch (error) {
      return null;
    }
  },

  /**
   * 删除云端文件
   */
  async deleteFile(token: string, fileId: number) {
    try {
      await mcpTools.repositoryFileManage({
        action: 'delete',
        id: fileId,
      }, token, process.env.FLORA_HOST);
      await cacheDel(`kb:file_tree:${hashToken(token)}`);
      return true;
    } catch (error) {
      return false;
    }
  },

  /**
   * 重命名云端文件
   */
  async renameFile(token: string, fileId: number, newName: string) {
    try {
      await mcpTools.repositoryFileManage({
        action: 'update',
        id: fileId,
        name: newName,
      }, token, process.env.FLORA_HOST);
      await cacheDel(`kb:file_tree:${hashToken(token)}`);
      return true;
    } catch (error) {
      return false;
    }
  }
};
