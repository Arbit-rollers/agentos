// Curated connection templates for the MCP Hub "Available" tab. They pre-fill the name and
// sign-in method only; the user pastes the server URL from the provider's own MCP docs, so
// no endpoint here is guessed.
export const MCP_TEMPLATES = [
  { key: 'google_workspace', initials: 'G', color: '#4285f4' },
  { key: 'github', initials: 'GH', color: '#6e7681' },
  { key: 'notion', initials: 'N', color: '#9b9a97' },
  { key: 'slack', initials: 'S', color: '#e01e5a' },
  { key: 'linear', initials: 'L', color: '#5e6ad2' },
  { key: 'instagram', initials: 'IG', color: '#d62976' },
  { key: 'youtube', initials: 'YT', color: '#ff0000' },
] as const;

export type McpTemplateKey = (typeof MCP_TEMPLATES)[number]['key'];

export const templateFor = (key: string) => MCP_TEMPLATES.find((t) => t.key === key);
