// IPC channel 名稱，main 與 preload 共用
export const IPC = {
  vaultPick: 'vault:pick',
  vaultGetCurrent: 'vault:getCurrent',
  vaultTree: 'vault:tree',
  vaultChanged: 'vault:changed',
  notesRead: 'notes:read',
  notesWrite: 'notes:write',
  notesCreate: 'notes:create',
  notesCreateFolder: 'notes:createFolder',
  notesRename: 'notes:rename',
  notesRemove: 'notes:remove',
  notesList: 'notes:list',
  linksBacklinks: 'links:backlinks',
  searchQuery: 'search:query',
  graphGet: 'graph:get'
} as const
