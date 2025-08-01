import React, { useEffect, useState } from 'react'
import { McpServerConfig } from '../../../../../shared/ipc-types' // Adjust path as necessary
import { Button } from '@/components/ui/button' // Assuming you have a Button component
import { Input } from '@/components/ui/input' // Assuming you have an Input component
import { Label } from '@/components/ui/label' // Assuming you have a Label component
import { Checkbox } from '@/components/ui/checkbox' // Assuming you have a Checkbox component
import { Textarea } from '@/components/ui/textarea' // Correcting import path for Textarea
import { ScrollArea } from '@/components/ui/scroll-area' // Added import
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { HelpTooltip } from '@/components/ui/help-tooltip'
import { ConfirmationDialog } from '@/components/ui/confirmation-dialog'

// Default empty state for a new/editing config
const initialFormState: Omit<McpServerConfig, 'id'> = {
  name: '',
  command: '',
  args: [],
  url: '',
  enabled: true
}

export function McpSettingsManager(): React.JSX.Element {
  const [configs, setConfigs] = useState<McpServerConfig[]>([])
  const [editingConfig, setEditingConfig] = useState<
    McpServerConfig | Omit<McpServerConfig, 'id'> | null
  >(null)
  const [isEditingExistingServer, setIsEditingExistingServer] = useState(false)
  const [editedServerId, setEditedServerId] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [inputMode, setInputMode] = useState<'form' | 'json'>('form')
  const [jsonString, setJsonString] = useState(() => JSON.stringify(initialFormState, null, 2))
  const [connectionType, setConnectionType] = useState<'stdio' | 'http'>('stdio')
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false)
  const [serverToDelete, setServerToDelete] = useState<{ id: string; name: string } | null>(null)

  const loadConfigs = async () => {
    setIsLoading(true)
    setError(null)
    try {
      const fetchedConfigs = await window.ctg.settings.getMcpServerConfigs()
      setConfigs(fetchedConfigs || [])
    } catch (err) {
      console.error('Error fetching MCP server configs:', err)
      setError('Failed to load configurations.')
      setConfigs([]) // Ensure configs is an array on error
    }
    setIsLoading(false)
  }

  useEffect(() => {
    loadConfigs()
  }, [])

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    if (!editingConfig) return
    const { name, value, type } = e.target
    const val = type === 'checkbox' ? (e.target as HTMLInputElement).checked : value

    setEditingConfig((prev) => {
      if (!prev) return null
      // Explicitly type prev to help TypeScript with key access
      const currentConfig: McpServerConfig | Omit<McpServerConfig, 'id'> = { ...prev }

      if (name === 'argsString') {
        currentConfig.args = value
          .split(/[,\n]+/)
          .map((s) => s.trim())
          .filter((s) => s)
      } else if (name in currentConfig) {
        // Type assertion to satisfy TypeScript for dynamic key assignment
        ;(currentConfig as any)[name] = val
      }
      return currentConfig
    })
  }

  const handleJsonInputChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const newJsonString = e.target.value
    setJsonString(newJsonString)
    // Attempt to parse and update editingConfig to keep form state somewhat in sync
    // This helps if user saves directly from JSON mode.
    try {
      const parsedJson = JSON.parse(newJsonString)
      if (isEditingExistingServer && editingConfig && 'id' in editingConfig) {
        // Preserve original ID if editing existing
        const { id: idFromJson, ...restOfParsedJson } = parsedJson
        setEditingConfig({ ...restOfParsedJson, id: editingConfig.id })
      } else {
        // Adding new: strip ID from parsedJson before setting editingConfig
        const { id, ...restOfParsedJson } = parsedJson
        setEditingConfig(restOfParsedJson)
      }
      setError(null) // Clear previous JSON errors
    } catch (jsonError) {
      setError(
        'Invalid JSON format. Form data may not be in sync until valid JSON is entered or mode is switched.'
      )
    }
  }

  const handleSave = async () => {
    if (!editingConfig) return
    setIsLoading(true)
    setError(null)

    // If in JSON mode and JSON is invalid, prevent saving stale editingConfig
    if (inputMode === 'json') {
      try {
        JSON.parse(jsonString) // Just to validate
      } catch (jsonError) {
        setError('Cannot save: JSON is invalid. Please correct it or switch to Form mode.')
        setIsLoading(false)
        return
      }
      // Ensure editingConfig is updated from potentially modified jsonString one last time
      // This handles the case where user types in JSON and immediately saves.
      try {
        const parsedJson = JSON.parse(jsonString)
        if (isEditingExistingServer && 'id' in editingConfig) {
          const { id: idFromJson, ...restOfParsedJson } = parsedJson
          // Use the id from the stateful editingConfig, not from user's JSON.
          setEditingConfig({ ...restOfParsedJson, id: editingConfig.id })
        } else {
          const { id, ...restOfParsedJson } = parsedJson
          setEditingConfig(restOfParsedJson)
        }
      } catch (e) {
        /* Should have been caught above, but defensive */
      }
    }

    // Re-check editingConfig after potential update from JSON string
    if (!editingConfig) {
      // Should not happen
      setIsLoading(false)
      setError('An unexpected error occurred before saving.')
      return
    }

    try {
      if (isEditingExistingServer && 'id' in editingConfig) {
        // Editing existing server
        const { id, ...updates } = editingConfig
        const result = await window.ctg.settings.updateMcpServerConfig(id, updates)
        if (!result) {
          throw new Error('Failed to update configuration.')
        }
      } else {
        // Adding new server. Ensure no 'id' is passed.
        // editingConfig should be Omit<McpServerConfig, 'id'>
        const { id, ...newConfigData } = editingConfig as any // Cast to allow stripping 'id'
        const result = await window.ctg.settings.addMcpServerConfig(newConfigData)
        if (!result) {
          throw new Error('Failed to add configuration.')
        }
      }
      setEditingConfig(null)
      setIsEditingExistingServer(false)
      setJsonString(JSON.stringify(initialFormState, null, 2)) // Reset JSON input
      setEditedServerId(null)
      await loadConfigs() // Refresh list
    } catch (err) {
      console.error('Error saving MCP server config:', err)
      setError(err instanceof Error ? err.message : 'Failed to save configuration.')
    }
    setIsLoading(false)
  }

  const handleDeleteClick = (id: string, name: string) => {
    setServerToDelete({ id, name })
    setDeleteDialogOpen(true)
  }

  const handleDeleteConfirm = async () => {
    if (!serverToDelete) return
    
    const { id } = serverToDelete
    if (editedServerId === id) {
      setEditingConfig(null)
      setIsEditingExistingServer(false)
      setEditedServerId(null)
      setJsonString(JSON.stringify(initialFormState, null, 2))
      setError(null)
    }
    setIsLoading(true)
    setError(null)
    try {
      const success = await window.ctg.settings.deleteMcpServerConfig(id)
      if (!success) {
        throw new Error('Failed to delete configuration on the server.')
      }
      await loadConfigs() // Refresh list
    } catch (err) {
      console.error('Error deleting MCP server config:', err)
      setError(err instanceof Error ? err.message : 'Failed to delete configuration.')
    }
    setIsLoading(false)
    setServerToDelete(null)
  }

  const handleDeleteCancel = () => {
    setServerToDelete(null)
  }

  const handleEdit = (config: McpServerConfig) => {
    setEditingConfig({ ...config })
    setIsEditingExistingServer(true)
    setEditedServerId(config.id)
    setJsonString(JSON.stringify(config, null, 2))
    setInputMode('form')
    setConnectionType(config.url ? 'http' : 'stdio')
    setError(null)
  }

  const handleAddNew = () => {
    setEditingConfig({ ...initialFormState })
    setIsEditingExistingServer(false)
    setEditedServerId(null)
    setJsonString(JSON.stringify(initialFormState, null, 2))
    setInputMode('form')
    setConnectionType('stdio')
    setError(null)
  }

  const toggleInputMode = () => {
    if (inputMode === 'form') {
      // Switching FROM Form TO JSON
      // jsonString should be updated based on the current editingConfig state
      if (editingConfig) {
        setJsonString(JSON.stringify(editingConfig, null, 2))
      } else {
        // If no active form, show initial state in JSON
        setJsonString(JSON.stringify(initialFormState, null, 2))
      }
      setInputMode('json')
    } else {
      // Switching FROM JSON TO Form
      try {
        const parsedJson = JSON.parse(jsonString)
        if (isEditingExistingServer && editingConfig && 'id' in editingConfig) {
          // Editing existing: preserve original ID from editingConfig, take other fields from JSON.
          // User might have changed other fields in JSON, or even tried to change the ID. We ignore ID changes from JSON for an existing item.
          const { id: idFromUserJson, ...dataFromUserJson } = parsedJson
          setEditingConfig({ ...dataFromUserJson, id: editingConfig.id })
        } else {
          // Adding new: strip any ID from JSON before setting editingConfig.
          const { id, ...newConfigData } = parsedJson
          setEditingConfig(newConfigData)
          // isEditingExistingServer should already be false if we are in "add new" flow.
        }
        setError(null) // Clear JSON parse errors
        setInputMode('form')
      } catch (parseError) {
        setError('Cannot switch to form mode: Invalid JSON content. Form fields may not update.')
        // Optionally, do not switch mode if JSON is invalid: return;
      }
    }
  }

  const handleCancel = () => {
    setEditingConfig(null)
    setIsEditingExistingServer(false)
    setEditedServerId(null)
    setJsonString(JSON.stringify(initialFormState, null, 2))
    setConnectionType('stdio')
    setError(null)
    // Consider resetting inputMode to 'form' or leave as is.
    // Leaving as is allows canceling from JSON view without forcing back to form.
  }

  const renderConfigForm = () => {
    if (!editingConfig) return null
    const currentArgsString = Array.isArray(editingConfig.args) ? editingConfig.args.join(', ') : ''

    return (
      <div className="p-4 border rounded-md mt-4 space-y-4">
        <h3 className="text-lg font-semibold">
          {isEditingExistingServer ? 'Edit' : 'Add New'} MCP Server Configuration
        </h3>
        <Button onClick={toggleInputMode} variant="outline" className="mb-4">
          Switch to {inputMode === 'form' ? 'JSON' : 'Form'} Input
        </Button>

        {inputMode === 'form' ? (
          <>
            <div>
              <Label htmlFor="name" className="mb-1 block">
                Name
              </Label>
              <Input
                id="name"
                name="name"
                value={editingConfig.name || ''}
                onChange={handleInputChange}
                placeholder="My Local GDAL Server"
              />
            </div>
            
            <div>
              <div className="flex items-center gap-2 mb-1">
                <Label htmlFor="connectionType">
                  Connection Type
                </Label>
                <HelpTooltip>
                  <div className="space-y-2">
                    <p className="font-medium">Connection Methods:</p>
                    <div className="text-xs space-y-2">
                      <div>
                        <p><strong>Local Process (stdio):</strong></p>
                        <p>For Python scripts, executables, or local MCP servers that run as separate processes</p>
                      </div>
                      <div>
                        <p><strong>Remote Server (HTTP):</strong></p>
                        <p>For web-based MCP servers accessible via HTTP endpoints</p>
                      </div>
                    </div>
                  </div>
                </HelpTooltip>
              </div>
              <Select
                value={connectionType}
                onValueChange={(value: 'stdio' | 'http') => setConnectionType(value)}
              >
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="Select connection type" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="stdio">Local Process (stdio)</SelectItem>
                  <SelectItem value="http">Remote Server (HTTP)</SelectItem>
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground mt-1">
                Choose how to connect to your MCP server
              </p>
            </div>
            
            {connectionType === 'stdio' && (
            <>
            <div>
              <div className="flex items-center gap-2 mb-1">
                <Label htmlFor="command">
                  Executable Path
                </Label>
                <HelpTooltip>
                  <div className="space-y-2">
                    <p className="font-medium">Examples:</p>
                    <div className="text-xs space-y-1">
                      <p><strong>Python:</strong> /usr/bin/python or C:\Python39\python.exe</p>
                      <p><strong>Binary:</strong> /usr/local/bin/gdal_mcp_server</p>
                      <p><strong>Windows:</strong> C:\mcp\server.exe</p>
                    </div>
                  </div>
                </HelpTooltip>
              </div>
              <Input
                id="command"
                name="command"
                value={editingConfig.command || ''}
                onChange={handleInputChange}
                placeholder="e.g., /usr/bin/python, /usr/local/bin/gdal_mcp_server, or C:\\Python39\\python.exe"
              />
              <p className="text-xs text-muted-foreground mt-1">
                Full path to the MCP server executable file. Use this for local servers that run as
                separate processes.
              </p>
            </div>
            <div>
              <div className="flex items-center gap-2 mb-1">
                <Label htmlFor="argsString">
                  Command Arguments
                </Label>
                <HelpTooltip>
                  <div className="space-y-2">
                    <p className="font-medium">Examples:</p>
                    <div className="text-xs space-y-1">
                      <p><strong>Python script:</strong> server.py --port 8080</p>
                      <p><strong>With options:</strong> --verbose --config /path/config.json</p>
                      <p><strong>Multiple args:</strong> script.py, --host, localhost, --debug</p>
                    </div>
                  </div>
                </HelpTooltip>
              </div>
              <Input
                id="argsString"
                name="argsString"
                value={currentArgsString}
                onChange={handleInputChange}
                placeholder="server.py, --port, 8080, --verbose"
              />
              <p className="text-xs text-muted-foreground mt-1">
                Command-line arguments to pass to the executable. Separate multiple arguments with
                commas or new lines.
              </p>
            </div>
            </>
            )}
            
            {connectionType === 'http' && (
            <div>
              <div className="flex items-center gap-2 mb-1">
                <Label htmlFor="url">
                  Server URL
                </Label>
                <HelpTooltip>
                  <div className="space-y-2">
                    <p className="font-medium">Examples:</p>
                    <div className="text-xs space-y-1">
                      <p><strong>Local:</strong> http://localhost:8000/mcp</p>
                      <p><strong>Custom port:</strong> http://127.0.0.1:3000/api/mcp</p>
                      <p><strong>Remote:</strong> https://api.example.com/mcp</p>
                    </div>
                  </div>
                </HelpTooltip>
              </div>
              <Input
                id="url"
                name="url"
                value={editingConfig.url || ''}
                onChange={handleInputChange}
                placeholder="e.g., http://localhost:8000/mcp"
              />
              <p className="text-xs text-muted-foreground mt-1">
                HTTP endpoint for remote MCP servers. Use this instead of executable path for
                web-based servers.
              </p>
            </div>
            )}
            
            <div className="flex items-center space-x-2">
              <Checkbox
                id="enabled"
                name="enabled"
                checked={editingConfig.enabled}
                onCheckedChange={(checkedState) => {
                  if (!editingConfig) return
                  setEditingConfig({ ...editingConfig, enabled: !!checkedState })
                }}
              />
              <Label htmlFor="enabled">Enabled</Label>
            </div>
          </>
        ) : (
          <div>
            <Label htmlFor="jsonConfig" className="mb-1 block">
              JSON Configuration
            </Label>
            <ScrollArea className="w-full h-72 rounded-md border p-2 whitespace-pre overflow-auto">
              <Textarea
                id="jsonConfig"
                name="jsonConfig"
                value={jsonString}
                onChange={handleJsonInputChange}
                placeholder='{
  "name": "My JSON MCP Server",
  "command": "path/to/server",
  "args": ["--port", "8081"],
  "url": "http://localhost:8081/mcp",
  "enabled": true
}'
                rows={15}
                className="font-mono w-full h-full resize-none border-none focus:outline-none focus:ring-0"
              />
            </ScrollArea>
          </div>
        )}
        {/* Responsive Save/Cancel buttons */}
        <div className="flex flex-col space-y-2 sm:flex-row sm:space-y-0 sm:space-x-2">
          <Button onClick={handleSave} disabled={isLoading} className="w-full sm:w-auto">
            {isLoading ? 'Saving...' : 'Save Configuration'}
          </Button>
          <Button
            variant="outline"
            onClick={handleCancel}
            disabled={isLoading}
            className="w-full sm:w-auto"
          >
            Cancel
          </Button>
        </div>
      </div>
    )
  }

  return (
    <div className="px-2 sm:px-4 pt-4 pb-4 max-w-4xl">
      <h2 className="text-xl font-semibold mb-4">Manage MCP Server Configurations</h2>
      {error && <p className="text-red-500 bg-red-100 p-2 rounded-md">Error: {error}</p>}
      <Button onClick={handleAddNew} disabled={!!editingConfig || isLoading}>
        Add New MCP Server
      </Button>

      {editingConfig && !isEditingExistingServer && !editedServerId && (
        <div className="mt-4">{renderConfigForm()}</div>
      )}

      {isLoading && !configs.length && !editingConfig && <p>Loading configurations...</p>}

      <ScrollArea className="mt-6 max-h-[60vh] pr-4">
        <div className="space-y-3">
          {configs.length === 0 && !isLoading && !error && !editingConfig && (
            <p>No MCP server configurations found.</p>
          )}
          {configs.map((config) =>
            editedServerId === config.id && editingConfig && isEditingExistingServer ? (
              <div key={`${config.id}-edit-form`} className="my-3">
                {renderConfigForm()}
              </div>
            ) : (
              <div
                key={config.id}
                className="p-3 border rounded-md flex flex-col space-y-3 sm:flex-row sm:flex-wrap sm:justify-between sm:items-start sm:gap-3"
              >
                <div className="flex-grow">
                  <p className="font-medium">
                    {config.name}{' '}
                    <span
                      className={`text-sm ${
                        config.enabled ? 'text-green-600' : 'text-muted-foreground'
                      }`}
                    >
                      ({config.enabled ? 'Enabled' : 'Disabled'})
                    </span>
                  </p>
                  {config.command && (
                    <p 
                      className="text-xs text-muted-foreground truncate max-w-xs sm:max-w-sm md:max-w-md mt-2"
                      title={`${config.command} ${config.args?.join(' ') || ''}`}
                    >
                      <span className="font-semibold">Command:</span> {config.command} {config.args?.join(' ')}
                    </p>
                  )}
                  {config.url && (
                    <p 
                      className="text-xs text-muted-foreground truncate max-w-xs sm:max-w-sm md:max-w-md mt-2"
                      title={config.url}
                    >
                      <span className="font-semibold">URL:</span> {config.url}
                    </p>
                  )}
                  {config.command && config.args && config.args.length > 0 && (
                    <p 
                      className="text-xs text-muted-foreground truncate max-w-xs sm:max-w-sm md:max-w-md mt-1"
                      title={config.args[0]}
                    >
                      <span className="font-semibold">Server Path:</span> {config.args[0]}
                    </p>
                  )}
                </div>
                <div className="flex flex-col space-y-2 sm:flex-row sm:flex-wrap sm:gap-2 flex-shrink-0">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => handleEdit(config)}
                    disabled={
                      isLoading || !!(editingConfig && !isEditingExistingServer && !editedServerId)
                    }
                    className="w-full sm:w-auto"
                  >
                    Edit
                  </Button>
                  <Button
                    variant="destructive"
                    size="sm"
                    onClick={() => handleDeleteClick(config.id, config.name)}
                    disabled={
                      isLoading || !!(editingConfig && !isEditingExistingServer && !editedServerId)
                    }
                    className="w-full sm:w-auto"
                  >
                    Delete
                  </Button>
                </div>
              </div>
            )
          )}
        </div>
      </ScrollArea>
      
      <ConfirmationDialog
        isOpen={deleteDialogOpen}
        onOpenChange={setDeleteDialogOpen}
        title="Delete MCP Server"
        description={`Are you sure you want to delete the MCP server "${serverToDelete?.name}"? This action cannot be undone.`}
        confirmText="Delete"
        cancelText="Cancel"
        onConfirm={handleDeleteConfirm}
        onCancel={handleDeleteCancel}
        variant="destructive"
      />
    </div>
  )
}
