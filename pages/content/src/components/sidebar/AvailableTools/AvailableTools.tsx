import type React from 'react';
import { useState, useEffect, useMemo } from 'react';
import type { Tool } from '@src/types/mcp';
import { useAvailableTools, useToolEnablement } from '../../../hooks';
import { logMessage } from '@src/utils/helpers';
import { Typography, Icon, Button, ResourceRow } from '../ui';
import { cn } from '@src/lib/utils';
import { createLogger } from '@extension/shared/lib/logger';


const logger = createLogger('AvailableTools');

interface ExtendedTool extends Tool {
  displayName?: string;
  originalName?: string;
}

// ponytail: defensive schema stringifier — preserves the original try/parse/catch
// behavior (JSON.parse for string schemas, "No schema available" / "Invalid schema
// format" fallbacks, logger.error on failure). tool.schema is typed string on the
// mcp type; tool.input_schema is the any-typed store shape. Read both defensively.
const renderToolSchema = (tool: ExtendedTool): string => {
  try {
    const schema = (tool as any).schema || (tool as any).input_schema;
    if (!schema) return 'No schema available';

    const schemaObject = typeof schema === 'string' ? JSON.parse(schema) : schema;
    return JSON.stringify(schemaObject, null, 2);
  } catch (error) {
    logger.error('Error processing tool schema:', error);
    const schema = (tool as any).schema || (tool as any).input_schema;
    return typeof schema === 'string' ? schema : 'Invalid schema format';
  }
};

interface AvailableToolsProps {
  tools: Tool[];
  onExecute: (tool: Tool) => void;
  onRefresh: () => void;
  isRefreshing: boolean;
}

const AvailableTools: React.FC<AvailableToolsProps> = ({ tools, onExecute, onRefresh, isRefreshing }) => {
  // Use Zustand hooks for tool management
  const { tools: storeTools } = useAvailableTools();
  const { enabledTools, enableTool, disableTool, enableAllTools, disableAllTools, isToolEnabled, loadToolEnablementState, isLoadingEnablement } = useToolEnablement();

  const [searchTerm, setSearchTerm] = useState('');
  const [expandedTools, setExpandedTools] = useState<Set<string>>(new Set());
  const [isExpanded, setIsExpanded] = useState(true);
  const [isLoaded, setIsLoaded] = useState(false);
  const [pendingChanges, setPendingChanges] = useState<Set<string>>(new Set());
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);

  // Use tools from store if available, fallback to props
  const effectiveTools = storeTools.length > 0 ? storeTools : tools;

  // Memoize effective tools length to prevent excessive logging
  const effectiveToolsCount = useMemo(() => effectiveTools.length, [effectiveTools.length]);

  // Reduced debug logging - only log when tool count changes significantly
  useEffect(() => {
    if (effectiveToolsCount > 0) {
      logMessage(`[AvailableTools] ${effectiveToolsCount} tools available`);
    }
  }, [effectiveToolsCount]);

  // Mark component as loaded after initial render
  useEffect(() => {
    const timeoutId = setTimeout(() => {
      setIsLoaded(true);
    }, 300);

    return () => clearTimeout(timeoutId);
  }, []);

  // Load tool enablement state on component mount
  useEffect(() => {
    if (effectiveTools.length > 0) {
      loadToolEnablementState();
    }
  }, [effectiveTools.length, loadToolEnablementState]);

  const handleSearchChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setSearchTerm(e.target.value);
  };

  const toggleToolExpansion = (toolName: string) => {
    const newExpandedTools = new Set(expandedTools);
    if (newExpandedTools.has(toolName)) {
      newExpandedTools.delete(toolName);
    } else {
      newExpandedTools.add(toolName);
    }
    setExpandedTools(newExpandedTools);
  };

  const toggleComponentExpansion = () => {
    setIsExpanded(!isExpanded);
    logMessage(`[AvailableTools] Component ${!isExpanded ? 'expanded' : 'collapsed'}`);
  };

  // Group tools by server name and filter - memoized to prevent unnecessary recalculations
  const { groupedTools, ungroupedTools } = useMemo(() => {
    const filtered = (effectiveTools || []).filter(
      tool =>
        tool.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
        (tool.description && tool.description.toLowerCase().includes(searchTerm.toLowerCase())),
    );

    const grouped: Record<string, ExtendedTool[]> = {};
    const ungrouped: ExtendedTool[] = [];

    filtered.forEach(tool => {
      const dotIndex = tool.name.indexOf('.');
      if (dotIndex > 0) {
        const serverName = tool.name.substring(0, dotIndex);
        const toolName = tool.name.substring(dotIndex + 1);
        
        if (!grouped[serverName]) {
          grouped[serverName] = [];
        }
        grouped[serverName].push({
          ...tool,
          displayName: toolName, // Store the short name for display
          originalName: tool.name // Keep original for functionality
        } as ExtendedTool);
      } else {
        ungrouped.push(tool as ExtendedTool);
      }
    });

    // Sort tools within each group
    Object.keys(grouped).forEach(serverName => {
      grouped[serverName].sort((a, b) => {
        if (!hasUnsavedChanges) {
          const aEnabled = isToolEnabled(a.originalName || a.name);
          const bEnabled = isToolEnabled(b.originalName || b.name);
          
          if (aEnabled && !bEnabled) return -1;
          if (!aEnabled && bEnabled) return 1;
        }
        
        const aName = a.displayName || a.name;
        const bName = b.displayName || b.name;
        return aName.localeCompare(bName);
      });
    });

    // Sort ungrouped tools
    ungrouped.sort((a, b) => {
      if (!hasUnsavedChanges) {
        const aEnabled = isToolEnabled(a.name);
        const bEnabled = isToolEnabled(b.name);
        
        if (aEnabled && !bEnabled) return -1;
        if (!aEnabled && bEnabled) return 1;
      }
      
      return a.name.localeCompare(b.name);
    });

    return { groupedTools: grouped, ungroupedTools: ungrouped };
  }, [effectiveTools, searchTerm, enabledTools, hasUnsavedChanges]);

  const handleExecute = (tool: Tool) => {
    logMessage(`[AvailableTools] Executing tool: ${tool.name}`);
    onExecute(tool);
  };

  const handleRefresh = () => {
    logMessage('[AvailableTools] Refreshing available tools');
    onRefresh();
  };

  const handleToggleTool = (toolName: string) => {
    setHasUnsavedChanges(true);
    setPendingChanges(prev => {
      const newPending = new Set(prev);
      if (newPending.has(toolName)) {
        newPending.delete(toolName);
      } else {
        newPending.add(toolName);
      }
      return newPending;
    });
    
    if (isToolEnabled(toolName)) {
      disableTool(toolName);
      logMessage(`[AvailableTools] Tool disabled: ${toolName}`);
    } else {
      enableTool(toolName);
      logMessage(`[AvailableTools] Tool enabled: ${toolName}`);
    }
  };

  const handleSaveChanges = () => {
    setHasUnsavedChanges(false);
    setPendingChanges(new Set());
    logMessage('[AvailableTools] Tool changes saved and sorted');
  };

  const handleDiscardChanges = () => {
    // Revert all pending changes
    pendingChanges.forEach(toolName => {
      if (isToolEnabled(toolName)) {
        disableTool(toolName);
      } else {
        enableTool(toolName);
      }
    });
    
    setHasUnsavedChanges(false);
    setPendingChanges(new Set());
    logMessage('[AvailableTools] Tool changes discarded');
  };

  const handleEnableAll = () => {
    setHasUnsavedChanges(true);
    enableAllTools();
    logMessage('[AvailableTools] All tools enabled');
  };

  const handleDisableAll = () => {
    setHasUnsavedChanges(true);
    disableAllTools();
    logMessage('[AvailableTools] All tools disabled');
  };

  // Group-level operations
  const handleToggleGroup = (serverName: string, tools: ExtendedTool[]) => {
    setHasUnsavedChanges(true);
    const allEnabled = tools.every(tool => isToolEnabled(tool.originalName || tool.name));
    
    tools.forEach(tool => {
      const toolName = tool.originalName || tool.name;
      if (allEnabled) {
        disableTool(toolName);
      } else {
        enableTool(toolName);
      }
    });
    
    logMessage(`[AvailableTools] Group ${serverName} ${allEnabled ? 'disabled' : 'enabled'}`);
  };

  // Calculate total tools count
  const totalToolsCount = useMemo(() => {
    const groupedCount = Object.values(groupedTools).reduce((acc, tools) => acc + tools.length, 0);
    return groupedCount + ungroupedTools.length;
  }, [groupedTools, ungroupedTools]);

  const isGroupEnabled = (tools: ExtendedTool[]) => {
    return tools.every(tool => isToolEnabled(tool.originalName || tool.name));
  };

  const isGroupPartiallyEnabled = (tools: ExtendedTool[]) => {
    const enabledCount = tools.filter(tool => isToolEnabled(tool.originalName || tool.name)).length;
    return enabledCount > 0 && enabledCount < tools.length;
  };

  return (
    <div className="rounded-card border border-line bg-surface shadow-soft">
      <div className="p-4 pb-2 border-b border-line">
        <div className="flex items-center justify-between">
          <div className="flex items-center">
            <button
              onClick={toggleComponentExpansion}
              className="p-1 mr-2 rounded transition-colors bg-ground hover:bg-off-soft"
              aria-label={isExpanded ? 'Collapse tools' : 'Expand tools'}>
              <Icon
                name="chevron-right"
                size="sm"
                className={cn('text-muted transition-transform', isExpanded ? 'rotate-90' : '')}
              />
            </button>
            <Typography variant="h3" className="text-ink">Available Tools</Typography>
          </div>
          <Button
            onClick={handleRefresh}
            disabled={isRefreshing}
            size="sm"
            variant="outline"
            className={cn(
              'h-9 w-9 p-0 border-line bg-ground hover:bg-off-soft',
              isRefreshing && 'opacity-50',
            )}
            aria-label="Refresh tools">
            <Icon
              name="refresh"
              size="sm"
              className={cn('text-muted', isRefreshing ? 'animate-spin' : '')}
            />
          </Button>
        </div>
        
        {isExpanded && (
          <div className="flex items-center justify-between mt-3 pt-3 border-t border-line">
            <div className="flex items-center gap-2">
              <Typography variant="small" className="text-muted">
                {enabledTools.size} of {totalToolsCount} tools enabled
              </Typography>
            </div>
            <div className="flex items-center gap-2">
              <Button
                onClick={handleEnableAll}
                size="sm"
                variant="outline"
                disabled={isRefreshing || isLoadingEnablement || totalToolsCount === 0}
                className="h-8 px-3 text-xs border-line bg-ok-soft hover:bg-ok-soft text-ok">
                Enable All
              </Button>
              <Button
                onClick={handleDisableAll}
                size="sm"
                variant="outline"
                disabled={isRefreshing || isLoadingEnablement || totalToolsCount === 0}
                className="h-8 px-3 text-xs border-line bg-err-soft hover:bg-err-soft text-err">
                Disable All
              </Button>
              {hasUnsavedChanges && (
                <>
                  <Button
                    onClick={handleSaveChanges}
                    size="sm"
                    variant="outline"
                    className="h-8 px-3 text-xs border-ink bg-ink text-surface hover:bg-ink">
                    Save Changes
                  </Button>
                  <Button
                    onClick={handleDiscardChanges}
                    size="sm"
                    variant="outline"
                    className="h-8 px-3 text-xs border-line bg-off-soft hover:bg-off-soft text-off">
                    Discard
                  </Button>
                </>
              )}
            </div>
          </div>
        )}
      </div>

      {isExpanded && (
        <div className="p-4 pt-4">
          <div className="mb-4">
            <div className="relative">
              <input
                type="text"
                placeholder="Search tools..."
                value={searchTerm}
                onChange={handleSearchChange}
                className="w-full px-3 py-2 pl-10 border border-line rounded text-sm bg-ground text-ink placeholder:text-muted"
              />
              <div className="absolute left-3 top-2.5">
                <Icon name="search" size="sm" className="text-muted" />
              </div>
            </div>
          </div>

          {(isRefreshing || isLoadingEnablement) && (
            <div className="flex items-center justify-center py-8 text-muted">
              <Icon name="refresh" className="w-8 h-8 animate-spin mr-3" />
              <Typography variant="body" className="text-lg">
                {isRefreshing ? 'Refreshing tools...' : 'Loading tool preferences...'}
              </Typography>
            </div>
          )}

          {!isRefreshing && !isLoadingEnablement && totalToolsCount === 0 && (
            <div className="text-center py-8 text-muted">
              {searchTerm ? (
                <>
                  <Icon name="search" className="w-12 h-12 mx-auto mb-3" />
                  <Typography variant="body" className="text-lg">
                    No tools match your search
                  </Typography>
                  <Typography variant="small" className="mt-1">
                    Try a different search term
                  </Typography>
                </>
              ) : (
                <>
                  <svg
                    className="w-12 h-12 mx-auto mb-3"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                    xmlns="http://www.w3.org/2000/svg">
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M9.172 16.172a4 4 0 015.656 0M9 10h.01M15 10h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
                    />
                  </svg>
                  <Typography variant="body" className="text-lg">
                    {!isLoaded ? 'Loading tools...' : 'No tools available'}
                  </Typography>
                  <Typography variant="small" className="mt-1">
                    {isLoaded ? (
                      <>
                        Check your server connection or{' '}
                        <button
                          onClick={handleRefresh}
                          className="text-ink hover:text-muted underline">
                          refresh
                        </button>
                      </>
                    ) : (
                      'Please wait while we connect to the server'
                    )}
                  </Typography>
                </>
              )}
            </div>
          )}

          {!isRefreshing && !isLoadingEnablement && totalToolsCount > 0 && (
            <div className="space-y-4">
              {/* Render grouped tools */}
              {Object.entries(groupedTools).map(([serverName, tools]) => {
                const groupEnabled = isGroupEnabled(tools);
                const groupPartiallyEnabled = isGroupPartiallyEnabled(tools);
                const groupExpanded = expandedTools.has(serverName);
                
                return (
                  <div key={serverName} className="border border-slate-200 dark:border-slate-700 rounded-lg overflow-hidden">
                    {/* Group Header */}
                    <div className="bg-slate-100 dark:bg-slate-800 border-b border-slate-200 dark:border-slate-700 p-3">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center">
                          <button
                            onClick={() => toggleToolExpansion(serverName)}
                            className="p-1 mr-2 rounded transition-colors hover:bg-slate-200 dark:hover:bg-slate-700"
                            aria-label={groupExpanded ? 'Collapse group' : 'Expand group'}>
                            <Icon
                              name="chevron-right"
                              size="sm"
                              className={cn(
                                'text-slate-600 dark:text-slate-400 transition-transform',
                                groupExpanded ? 'rotate-90' : ''
                              )}
                            />
                          </button>
                          <input
                            type="checkbox"
                            checked={groupEnabled}
                            ref={(el) => {
                              if (el) el.indeterminate = groupPartiallyEnabled;
                            }}
                            onChange={() => handleToggleGroup(serverName, tools)}
                            className="w-4 h-4 mr-3 text-blue-600 bg-white border-slate-300 rounded focus:ring-blue-500 dark:focus:ring-blue-600 dark:ring-offset-slate-800 focus:ring-2 dark:bg-slate-700 dark:border-slate-600"
                          />
                          <Typography variant="subtitle" className="text-slate-800 dark:text-slate-200 font-semibold">
                            {serverName}
                          </Typography>
                          <Typography variant="small" className="ml-2 text-slate-500 dark:text-slate-400">
                            ({tools.length} tools)
                          </Typography>
                        </div>
                        <div className="flex items-center gap-2">
                          {groupPartiallyEnabled && (
                            <span className="px-2 py-1 text-xs bg-yellow-100 dark:bg-yellow-900/30 text-yellow-700 dark:text-yellow-300 rounded">
                              Partial
                            </span>
                          )}
                          {!groupEnabled && !groupPartiallyEnabled && (
                            <span className="px-2 py-1 text-xs bg-slate-200 dark:bg-slate-700 text-slate-600 dark:text-slate-400 rounded">
                              Disabled
                            </span>
                          )}
                        </div>
                      </div>
                    </div>

                    {/* Group Tools */}
                    {groupExpanded && (
                      <div className="bg-white dark:bg-slate-900 p-2 divide-y divide-line">
                        {tools.map(tool => {
                          const toolName = tool.originalName || tool.name;
                          
                          return (
                            <ResourceRow
                              key={toolName}
                              name={tool.displayName || tool.name}
                              description={tool.description}
                              isEnabled={isToolEnabled(toolName)}
                              onToggle={() => handleToggleTool(toolName)}
                              kindLabel="tool"
                              renderDetail={() => (
                                <pre className="mt-1 overflow-x-auto rounded-row bg-ground p-1.5 text-[10px] text-muted">
                                  {renderToolSchema(tool)}
                                </pre>
                              )}
                            />
                          );
                        })}
                      </div>
                    )}
                  </div>
                );
              })}

              {/* Render ungrouped tools */}
              {ungroupedTools.length > 0 && (
                <div className="border border-slate-200 dark:border-slate-700 rounded-lg overflow-hidden">
                  <div className="bg-slate-100 dark:bg-slate-800 border-b border-slate-200 dark:border-slate-700 p-3">
                    <Typography variant="body" className="text-slate-800 dark:text-slate-200 font-semibold">
                      Individual Tools
                    </Typography>
                    <Typography variant="small" className="text-slate-500 dark:text-slate-400">
                      ({ungroupedTools.length} tools)
                    </Typography>
                  </div>
                  <div className="bg-white dark:bg-slate-900 p-2 divide-y divide-line">
                    {ungroupedTools.map(tool => (
                      <ResourceRow
                        key={tool.name}
                        name={tool.name}
                        description={tool.description}
                        isEnabled={isToolEnabled(tool.name)}
                        onToggle={() => handleToggleTool(tool.name)}
                        kindLabel="tool"
                        renderDetail={() => (
                          <pre className="mt-1 overflow-x-auto rounded-row bg-ground p-1.5 text-[10px] text-muted">
                            {renderToolSchema(tool)}
                          </pre>
                        )}
                      />
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default AvailableTools;
