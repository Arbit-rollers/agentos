export const WIZARD_STEPS = ['basic', 'personality', 'tools', 'permissions', 'review'] as const;
export type WizardStep = (typeof WIZARD_STEPS)[number];

export const stepHref = (agentId: string, step: WizardStep) => `/agents/${agentId}/setup/${step}`;
