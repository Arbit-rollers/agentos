export const HUB_TABS = ['all', 'connected', 'available', 'custom', 'providers'] as const;
export type HubTab = (typeof HUB_TABS)[number];
