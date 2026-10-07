// Shared by the server page and the client filters ('use client' files can't export values
// that server code reads).
export const MEMORY_FILTERS = ['all', 'procedural', 'semantic', 'episodic', 'disabled'] as const;
export type MemoryFilter = (typeof MEMORY_FILTERS)[number];
