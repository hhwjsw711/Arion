console.log('[Preload Script] Preload script starting to execute. CONSOLE LOG')
process.stderr.write('[Preload Script] Preload script executing.\n')

// REMOVED: throw new Error('[Preload Script] INTENTIONAL CRASH TO TEST EXECUTION')

import { contextBridge, ipcRenderer } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'
// Import IPC types from the shared directory
import {
  IpcChannels,
  type OpenAIConfig,
  type GoogleConfig,
  type AzureConfig,
  type AnthropicConfig,
  type VertexConfig,
  type OllamaConfig,
  type LLMProviderType,
  type AllLLMConfigurations,
  type McpServerConfig,
  type SettingsApi,
  type ChatApi,
  type Chat,
  type Message as DbMessage,
  type DbApi,
  type AddMapFeaturePayload,
  type SetPaintPropertiesPayload,
  type RemoveSourceAndLayersPayload,
  type SetMapViewPayload,
  type ExposedMapApi,
  type SystemPromptConfig,
  type SetMapSidebarVisibilityPayload,
  type AddGeoreferencedImageLayerPayload,
  type KnowledgeBaseApi,
  type KBAddDocumentPayload,
  type KBAddDocumentResult,
  type ExposedShellApi,
  type McpPermissionApi,
  type McpPermissionRequest,
  type PostgreSQLApi,
  type PostgreSQLConfig,
  type PostgreSQLConnectionResult,
  type PostgreSQLQueryResult,
  type PostgreSQLConnectionInfo
} from '../shared/ipc-types' // Corrected relative path

// This ChatRequestBody is specific to preload, using @ai-sdk/react Message
import type { Message as AiSdkReactMessage } from '@ai-sdk/react'
interface PreloadChatRequestBody {
  messages: AiSdkReactMessage[]
  // other potential fields from useChat body
}

// Add EventEmitter for streaming support
import { EventEmitter } from 'events'

// Define MapApi type for preload
// export interface MapApi { // This local interface can be removed if ExposedMapApi is used directly for typing ctgApi.map
//   onAddFeature: (callback: (payload: AddMapFeaturePayload) => void) => () => void;
//   onSetPaintProperties: (callback: (payload: SetPaintPropertiesPayload) => void) => () => void;
// }

// Store active stream emitters
const streamEmitters = new Map<string, EventEmitter>()

// Custom APIs for renderer
const ctgApi = {
  settings: {
    getSetting: async (key: string): Promise<unknown> => {
      try {
        const result = await ipcRenderer.invoke('ctg:settings:get', key)
        return result
      } catch (error) {
        console.error(`[Preload Script] Error invoking 'ctg:settings:get' for key ${key}:`, error)
        throw error
      }
    },
    setSetting: async (
      key: string,
      value: unknown
    ): Promise<{ success: boolean; error?: string }> => {
      try {
        const result = await ipcRenderer.invoke('ctg:settings:set', key, value)
        return result
      } catch (error) {
        console.error(`[Preload Script] Error invoking 'ctg:settings:set' for key ${key}:`, error)
        throw error
      }
    },
    setOpenAIConfig: (config: OpenAIConfig): Promise<void> =>
      ipcRenderer.invoke(IpcChannels.setOpenAIConfig, config),
    getOpenAIConfig: (): Promise<OpenAIConfig | null> =>
      ipcRenderer.invoke(IpcChannels.getOpenAIConfig),
    setGoogleConfig: (config: GoogleConfig): Promise<void> =>
      ipcRenderer.invoke(IpcChannels.setGoogleConfig, config),
    getGoogleConfig: (): Promise<GoogleConfig | null> =>
      ipcRenderer.invoke(IpcChannels.getGoogleConfig),
    setAzureConfig: (config: AzureConfig): Promise<void> =>
      ipcRenderer.invoke(IpcChannels.setAzureConfig, config),
    getAzureConfig: (): Promise<AzureConfig | null> =>
      ipcRenderer.invoke(IpcChannels.getAzureConfig),
    setAnthropicConfig: (config: AnthropicConfig): Promise<void> =>
      ipcRenderer.invoke(IpcChannels.setAnthropicConfig, config),
    getAnthropicConfig: (): Promise<AnthropicConfig | null> =>
      ipcRenderer.invoke(IpcChannels.getAnthropicConfig),
    setVertexConfig: (config: VertexConfig): Promise<void> =>
      ipcRenderer.invoke(IpcChannels.setVertexConfig, config),
    getVertexConfig: (): Promise<VertexConfig | null> =>
      ipcRenderer.invoke(IpcChannels.getVertexConfig),
    setOllamaConfig: (config: OllamaConfig): Promise<void> =>
      ipcRenderer.invoke(IpcChannels.setOllamaConfig, config),
    getOllamaConfig: (): Promise<OllamaConfig | null> =>
      ipcRenderer.invoke(IpcChannels.getOllamaConfig),
    setActiveLLMProvider: (provider: LLMProviderType | null): Promise<void> =>
      ipcRenderer.invoke(IpcChannels.setActiveLLMProvider, provider),
    getActiveLLMProvider: (): Promise<LLMProviderType | null> =>
      ipcRenderer.invoke(IpcChannels.getActiveLLMProvider),
    getAllLLMConfigs: (): Promise<AllLLMConfigurations> =>
      ipcRenderer.invoke(IpcChannels.getAllLLMConfigs),
    getMcpServerConfigs: (): Promise<McpServerConfig[]> =>
      ipcRenderer.invoke(IpcChannels.getMcpServerConfigs),
    addMcpServerConfig: (config: Omit<McpServerConfig, 'id'>): Promise<McpServerConfig | null> =>
      ipcRenderer.invoke(IpcChannels.addMcpServerConfig, config),
    updateMcpServerConfig: (
      configId: string,
      updates: Partial<Omit<McpServerConfig, 'id'>>
    ): Promise<McpServerConfig | null> =>
      ipcRenderer.invoke(IpcChannels.updateMcpServerConfig, configId, updates),
    deleteMcpServerConfig: (configId: string): Promise<boolean> =>
      ipcRenderer.invoke(IpcChannels.deleteMcpServerConfig, configId),
    getSystemPromptConfig: (): Promise<SystemPromptConfig> =>
      ipcRenderer.invoke(IpcChannels.getSystemPromptConfig),
    setSystemPromptConfig: (config: SystemPromptConfig): Promise<void> =>
      ipcRenderer.invoke(IpcChannels.setSystemPromptConfig, config)
  } as SettingsApi,
  chat: {
    sendMessageStream: async (body: PreloadChatRequestBody | undefined): Promise<Uint8Array[]> => {
      if (!body) {
        const errorMsg = '[Preload Chat] Request body is undefined in sendMessageStream'
        console.error(errorMsg)
        const textEncoder = new TextEncoder()
        return [textEncoder.encode(JSON.stringify({ streamError: errorMsg }))]
      }
      try {
        console.log(
          '[Preload Chat] Invoking ctg:chat:sendMessageStreamHandler with body:',
          JSON.stringify(body).substring(0, 200) + '...'
        )

        // This will still collect all chunks and return them at once
        const responseChunks = (await ipcRenderer.invoke(
          'ctg:chat:sendMessageStreamHandler',
          body
        )) as Uint8Array[]

        if (Array.isArray(responseChunks)) {
          console.log(
            '[Preload Chat] Received responseChunks (should be Uint8Array[]):',
            responseChunks
          )
          return responseChunks
        } else {
          console.error(
            '[Preload Chat] Expected Uint8Array[] from main process, but received:',
            responseChunks
          )
          const errorMsg = 'Invalid data structure received from main process.'
          const textEncoder = new TextEncoder()
          return [textEncoder.encode(JSON.stringify({ streamError: errorMsg }))]
        }
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error)
        console.error('[Preload Chat] Error in sendMessageStream:', errorMsg)
        const textEncoder = new TextEncoder()
        return [textEncoder.encode(JSON.stringify({ streamError: errorMsg }))]
      }
    },

    // NEW API METHOD: Uses event-based streaming instead of Promise-based
    startMessageStream: async (body: PreloadChatRequestBody | undefined): Promise<string> => {
      if (!body) {
        throw new Error('[Preload Chat] Request body is undefined in startMessageStream')
      }

      // Create a unique ID for this stream
      const streamId = `stream_${Date.now()}_${Math.random().toString(36).substr(2, 8)}`
      console.log(
        '[Preload Chat] Invoking ctg:chat:startMessageStream with body:',
        JSON.stringify(body).substring(0, 200) + '...'
      )

      // Create an event emitter for this stream
      const emitter = new EventEmitter()
      streamEmitters.set(streamId, emitter)

      // Register listeners for this stream
      ipcRenderer.on(`ctg:chat:stream:chunk:${streamId}`, (_event, chunk: Uint8Array) => {
        try {
          if (chunk instanceof Uint8Array) {
            emitter.emit('chunk', chunk)
          } else {
            console.error('[Preload Chat] Invalid chunk type:', typeof chunk)
            emitter.emit('error', new Error('Invalid chunk type received'))
          }
        } catch (error) {
          console.error('[Preload Chat] Error processing stream chunk:', error)
          emitter.emit('error', error)
        }
      })

      ipcRenderer.on(`ctg:chat:stream:error:${streamId}`, (_event, error: string) => {
        console.error('[Preload Chat] Stream error for stream:', streamId, error)
        emitter.emit('error', new Error(error))
      })

      ipcRenderer.on(`ctg:chat:stream:start:${streamId}`, () => {
        console.log('[Preload Chat] Stream started:', streamId)
        emitter.emit('start')
      })

      ipcRenderer.on(`ctg:chat:stream:end:${streamId}`, () => {
        console.log('[Preload Chat] Stream ended:', streamId)
        emitter.emit('end')
      })

      // Start the stream on the main process side
      ipcRenderer
        .invoke('ctg:chat:startMessageStream', streamId, JSON.stringify(body))
        .catch((error) => {
          console.error('[Preload Chat] Failed to start stream:', error)
          emitter.emit('error', error)
        })

      console.log('[Preload Chat] Real-time stream started with ID:', streamId)
      return streamId
    },

    // Methods to subscribe/unsubscribe from stream events
    subscribeToStream: (
      streamId: string,
      callbacks: {
        onChunk: (chunk: Uint8Array) => void
        onError?: (error: Error) => void
        onStart?: () => void
        onEnd?: () => void
      }
    ): (() => void) => {
      const emitter = streamEmitters.get(streamId)
      if (!emitter) {
        throw new Error(`No stream found with ID ${streamId}`)
      }

      console.log('[Preload Chat] Subscribing to stream events for ID:', streamId)

      // Add listeners
      emitter.on('chunk', callbacks.onChunk)
      if (callbacks.onError) emitter.on('error', callbacks.onError)
      if (callbacks.onStart) emitter.on('start', callbacks.onStart)
      if (callbacks.onEnd) emitter.on('end', callbacks.onEnd)

      // Return unsubscribe function
      return () => {
        console.log('[Preload Chat] Unsubscribing from stream events for ID:', streamId)
        emitter.removeListener('chunk', callbacks.onChunk)
        if (callbacks.onError) emitter.removeListener('error', callbacks.onError)
        if (callbacks.onStart) emitter.removeListener('start', callbacks.onStart)
        if (callbacks.onEnd) emitter.removeListener('end', callbacks.onEnd)

        // Check if all listeners are gone and clean up the emitter
        if (
          emitter.listenerCount('chunk') === 0 &&
          emitter.listenerCount('error') === 0 &&
          emitter.listenerCount('start') === 0 &&
          emitter.listenerCount('end') === 0
        ) {
          streamEmitters.delete(streamId)

          // Remove IPC listeners
          ipcRenderer.removeAllListeners(`ctg:chat:stream:chunk:${streamId}`)
          ipcRenderer.removeAllListeners(`ctg:chat:stream:error:${streamId}`)
          ipcRenderer.removeAllListeners(`ctg:chat:stream:start:${streamId}`)
          ipcRenderer.removeAllListeners(`ctg:chat:stream:end:${streamId}`)
        }
      }
    }
  } as ChatApi,
  db: {
    createChat: async (
      chatData: Pick<Chat, 'id'> & Partial<Omit<Chat, 'id' | 'created_at' | 'updated_at'>>
    ): Promise<{ success: boolean; data?: Chat; error?: string }> => {
      return ipcRenderer.invoke(IpcChannels.dbCreateChat, chatData)
    },
    getChatById: async (
      id: string
    ): Promise<{ success: boolean; data?: Chat | null; error?: string }> => {
      return ipcRenderer.invoke(IpcChannels.dbGetChatById, id)
    },
    getAllChats: async (
      orderBy?: 'created_at' | 'updated_at',
      order?: 'ASC' | 'DESC'
    ): Promise<{ success: boolean; data?: Chat[]; error?: string }> => {
      return ipcRenderer.invoke(IpcChannels.dbGetAllChats, orderBy, order)
    },
    updateChat: async (
      id: string,
      updates: Partial<Omit<Chat, 'id' | 'created_at' | 'updated_at'>>
    ): Promise<{ success: boolean; data?: Chat; error?: string }> => {
      return ipcRenderer.invoke(IpcChannels.dbUpdateChat, id, updates)
    },
    deleteChat: async (id: string): Promise<{ success: boolean; error?: string }> => {
      return ipcRenderer.invoke(IpcChannels.dbDeleteChat, id)
    },
    addMessage: async (
      messageData: Pick<DbMessage, 'id' | 'chat_id' | 'role' | 'content'> &
        Partial<Omit<DbMessage, 'id' | 'chat_id' | 'role' | 'content' | 'created_at'>>
    ): Promise<{ success: boolean; data?: DbMessage; error?: string }> => {
      return ipcRenderer.invoke(IpcChannels.dbAddMessage, messageData)
    },
    getMessageById: async (
      id: string
    ): Promise<{ success: boolean; data?: DbMessage | null; error?: string }> => {
      return ipcRenderer.invoke(IpcChannels.dbGetMessageById, id)
    },
    getMessagesByChatId: async (
      chat_id: string,
      orderBy?: 'created_at',
      order?: 'ASC' | 'DESC'
    ): Promise<{ success: boolean; data?: DbMessage[]; error?: string }> => {
      return ipcRenderer.invoke(IpcChannels.dbGetMessagesByChatId, chat_id, orderBy, order)
    },
    deleteMessage: async (id: string): Promise<{ success: boolean; error?: string }> => {
      return ipcRenderer.invoke(IpcChannels.dbDeleteMessage, id)
    },
    // Plugin specific DB operations
    dbGetAllPlugins: () => ipcRenderer.invoke(IpcChannels.dbGetAllPlugins),
    dbAddPlugin: (plugin) => ipcRenderer.invoke(IpcChannels.dbAddPlugin, plugin),
    dbUpdatePlugin: (id, plugin) => ipcRenderer.invoke(IpcChannels.dbUpdatePlugin, id, plugin),
    dbDeletePlugin: (id) => ipcRenderer.invoke(IpcChannels.dbDeletePlugin)
  } as DbApi,
  knowledgeBase: {
    addDocument: (payload: KBAddDocumentPayload): Promise<KBAddDocumentResult> => {
      console.log(
        `[Preload KB] Invoking ${IpcChannels.kbAddDocument} with docId: ${payload.documentId}, filePath: ${payload.filePath}`
      )
      // Ensure documentId is set if not provided by the frontend,
      // though the new flow might always provide it from the store.
      // const fullPayload = { ...payload, documentId: payload.documentId || nanoid() };
      // The nanoid generation was moved to the main process if truly needed,
      // but with the PGlite refactor, the ID is critical and should come from the UI store
      // which gets it from the main process upon creation or is already known.
      // For addDocument, it's better if the frontend store initiates with a UUID.
      // However, knowledge-base.handlers.ts uses payload.documentId directly which is good.
      return ipcRenderer.invoke(IpcChannels.kbAddDocument, payload)
    },
    findSimilar: (query: string, limit?: number) =>
      ipcRenderer.invoke(IpcChannels.kbFindSimilar, query, limit),
    getChunkCount: () => ipcRenderer.invoke(IpcChannels.kbGetChunkCount),
    getAllDocuments: () => ipcRenderer.invoke(IpcChannels.kbGetAllDocuments),
    deleteDocument: (documentId: string) =>
      ipcRenderer.invoke(IpcChannels.kbDeleteDocument, documentId)
  } as KnowledgeBaseApi,
  shell: {
    openPath: (filePath: string): Promise<{ success: boolean; error?: string }> =>
      ipcRenderer.invoke(IpcChannels.shellOpenPath, filePath)
  } as ExposedShellApi,
  mcp: {
    requestPermission: (request: McpPermissionRequest): Promise<boolean> =>
      ipcRenderer.invoke(IpcChannels.mcpRequestPermission, request),
    showPermissionDialog: (request: McpPermissionRequest): Promise<boolean> =>
      ipcRenderer.invoke(IpcChannels.mcpShowPermissionDialog, request),
    permissionResponse: (requestId: string, granted: boolean): Promise<void> =>
      ipcRenderer.invoke(IpcChannels.mcpPermissionResponse, requestId, granted),
    onShowPermissionDialog: (callback: (payload: McpPermissionRequest) => void) => {
      const handler = (_event: Electron.IpcRendererEvent, payload: McpPermissionRequest) =>
        callback(payload)
      ipcRenderer.on('ctg:mcp:showPermissionDialog', handler)
      return () => {
        ipcRenderer.removeListener('ctg:mcp:showPermissionDialog', handler)
      }
    }
  } as McpPermissionApi,
  map: {
    onAddFeature: (callback: (payload: AddMapFeaturePayload) => void) => {
      const handler = (_event: Electron.IpcRendererEvent, payload: AddMapFeaturePayload) =>
        callback(payload)
      ipcRenderer.on('ctg:map:addFeature', handler)
      // Return a cleanup function to remove the listener
      return () => {
        ipcRenderer.removeListener('ctg:map:addFeature', handler)
      }
    },
    onSetPaintProperties: (callback: (payload: SetPaintPropertiesPayload) => void) => {
      const handler = (_event: Electron.IpcRendererEvent, payload: SetPaintPropertiesPayload) =>
        callback(payload)
      ipcRenderer.on('ctg:map:setPaintProperties', handler)
      return () => {
        ipcRenderer.removeListener('ctg:map:setPaintProperties', handler)
      }
    },
    onRemoveSourceAndLayers: (callback: (payload: RemoveSourceAndLayersPayload) => void) => {
      const handler = (_event: Electron.IpcRendererEvent, payload: RemoveSourceAndLayersPayload) =>
        callback(payload)
      ipcRenderer.on('ctg:map:removeSourceAndLayers', handler)
      return () => {
        ipcRenderer.removeListener('ctg:map:removeSourceAndLayers', handler)
      }
    },
    onSetView: (callback: (payload: SetMapViewPayload) => void) => {
      const handler = (_event: Electron.IpcRendererEvent, payload: SetMapViewPayload) =>
        callback(payload)
      ipcRenderer.on('ctg:map:setView', handler)
      return () => {
        ipcRenderer.removeListener('ctg:map:setView', handler)
      }
    },
    // Handler for adding georeferenced image layer
    onAddGeoreferencedImageLayer: (
      callback: (payload: AddGeoreferencedImageLayerPayload) => void
    ) => {
      const handler = (
        _event: Electron.IpcRendererEvent,
        payload: AddGeoreferencedImageLayerPayload
      ) => callback(payload)
      ipcRenderer.on('ctg:map:addGeoreferencedImageLayer', handler)
      return () => ipcRenderer.removeListener('ctg:map:addGeoreferencedImageLayer', handler)
    }
  },
  ui: {
    onSetMapSidebarVisibility: (callback: (payload: SetMapSidebarVisibilityPayload) => void) => {
      const handler = (
        _event: Electron.IpcRendererEvent,
        payload: SetMapSidebarVisibilityPayload
      ) => callback(payload)
      ipcRenderer.on('ctg:ui:setMapSidebarVisibility', handler)
      return () => {
        ipcRenderer.removeListener('ctg:ui:setMapSidebarVisibility', handler)
      }
    }
  },
  postgresql: {
    testConnection: (config: PostgreSQLConfig): Promise<PostgreSQLConnectionResult> =>
      ipcRenderer.invoke(IpcChannels.postgresqlTestConnection, config),
    createConnection: (id: string, config: PostgreSQLConfig): Promise<PostgreSQLConnectionResult> =>
      ipcRenderer.invoke(IpcChannels.postgresqlCreateConnection, id, config),
    closeConnection: (id: string): Promise<void> =>
      ipcRenderer.invoke(IpcChannels.postgresqlCloseConnection, id),
    executeQuery: (id: string, query: string, params?: any[]): Promise<PostgreSQLQueryResult> =>
      ipcRenderer.invoke(IpcChannels.postgresqlExecuteQuery, id, query, params),
    executeTransaction: (id: string, queries: string[]): Promise<PostgreSQLQueryResult> =>
      ipcRenderer.invoke(IpcChannels.postgresqlExecuteTransaction, id, queries),
    getActiveConnections: (): Promise<string[]> =>
      ipcRenderer.invoke(IpcChannels.postgresqlGetActiveConnections),
    getConnectionInfo: (id: string): Promise<PostgreSQLConnectionInfo> =>
      ipcRenderer.invoke(IpcChannels.postgresqlGetConnectionInfo, id)
  } as PostgreSQLApi,
  getAppVersion: (): Promise<string> => ipcRenderer.invoke('ctg:get-app-version')
}

// Use `contextBridge` APIs to expose Electron APIs to
// renderer only if context isolation is enabled, otherwise
// just add to the DOM global.
if (process.contextIsolated) {
  process.stderr.write('[Preload Script] Context isolation is ON. STDERR WRITE\n')
  try {
    contextBridge.exposeInMainWorld('electron', electronAPI)
    process.stderr.write(
      '[Preload Script] Attempting to expose ctg API via contextBridge. STDERR WRITE\n'
    )
    contextBridge.exposeInMainWorld('ctg', ctgApi)
    process.stderr.write('[Preload Script] ctg API exposure call completed. STDERR WRITE\n')
  } catch (error) {
    process.stderr.write(`[Preload Script] Error exposing API: ${error}\n`)
    console.error('[Preload Script] Error exposing API:', error) // Keep console.error for richer object logging if it works
  }
} else {
  process.stderr.write(
    '[Preload Script] Context isolation is OFF. APIs will be exposed on global window directly. STDERR WRITE\n'
  )
  // @ts-ignore (define in dts)
  window.electron = electronAPI
  // @ts-ignore (define in dts)
  window.ctg = ctgApi
}

console.log('[Preload Script] Preload script finished execution.')
