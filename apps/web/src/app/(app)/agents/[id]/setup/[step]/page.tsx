import type { Metadata } from 'next';
import { notFound, redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { findAgent, listAgentToolGrants, listMcpConnections, listMcpTools } from '@agentos/db';
import { normalizeTraits } from '@agentos/personality';
import { BasicsForm } from '@/components/agents/wizard/basics-form';
import { PermissionsStep } from '@/components/agents/wizard/permissions-step';
import { PersonalityEditor } from '@/components/agents/wizard/personality-editor';
import { Review } from '@/components/agents/wizard/review';
import { WIZARD_STEPS, type WizardStep } from '@/components/agents/wizard/steps';
import { ToolsStep } from '@/components/agents/wizard/tools-step';
import { WizardFrame } from '@/components/agents/wizard/wizard-frame';
import { loadAgentOr404, parentOptionsByType } from '@/server/agents';
import { brainOptions, brainValue } from '@/server/models';
import { requireSession } from '@/server/session';
import { getServices } from '@/server/services';

type Params = { params: Promise<{ id: string; step: string }> };

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations('wizard'))('title') };
}

export default async function AgentSetupPage({ params }: Params) {
  const { id, step } = await params;
  if (!WIZARD_STEPS.includes(step as WizardStep)) notFound();
  const { ctx } = await requireSession();
  const agent = await loadAgentOr404(ctx, id);
  if (agent.status === 'archived') redirect(`/agents/${id}`);

  let body;
  switch (step as WizardStep) {
    case 'basic':
      body = <BasicsForm agent={agent} parentOptions={await parentOptionsByType(ctx, id)} />;
      break;
    case 'personality':
      body = (
        <PersonalityEditor
          agentId={id}
          initial={normalizeTraits(agent.personality?.traitScores)}
          connections={await brainOptions(ctx)}
          brain={await brainValue(ctx, id)}
        />
      );
      break;
    case 'tools': {
      const [connections, tools, grants] = await Promise.all([
        listMcpConnections(getServices().db, ctx),
        listMcpTools(getServices().db, ctx),
        listAgentToolGrants(getServices().db, ctx, id),
      ]);
      // Only tools that can actually run are offered; existing grants stay visible.
      body = (
        <ToolsStep
          agentId={id}
          initial={grants.map((g) => g.tool.id)}
          servers={connections
            .filter((c) => c.enabled)
            .map((c) => ({
              id: c.id,
              name: c.name,
              serverType: c.serverType,
              connected: c.status === 'connected',
              tools: tools
                .filter((tool) => tool.connectionId === c.id && tool.enabled && tool.available)
                .map((tool) => ({ id: tool.id, name: tool.name, description: tool.description })),
            }))}
        />
      );
      break;
    }
    case 'permissions': {
      const grants = await listAgentToolGrants(getServices().db, ctx, id);
      body = (
        <PermissionsStep
          agentId={id}
          approvalPolicy={agent.approvalPolicy}
          grants={grants.map((g) => ({
            toolId: g.tool.id,
            name: g.tool.name,
            description: g.tool.description,
            serverName: g.connection.name,
            mode: g.permissionMode,
            workspaceDefault: g.tool.defaultPermission,
          }))}
        />
      );
      break;
    }
    case 'review': {
      const parent = agent.parentAgentId
        ? await findAgent(getServices().db, ctx, agent.parentAgentId)
        : undefined;
      body = <Review agent={agent} parentName={parent?.name} />;
      break;
    }
  }

  return (
    <WizardFrame step={step as WizardStep} agent={agent}>
      {body}
    </WizardFrame>
  );
}
