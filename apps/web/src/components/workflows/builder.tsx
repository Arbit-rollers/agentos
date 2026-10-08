'use client';

import {
  Background,
  Controls,
  Handle,
  Position,
  ReactFlow,
  addEdge,
  useEdgesState,
  useNodesState,
  type Connection,
  type Edge,
  type Node,
  type NodeProps,
  type ReactFlowInstance,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import {
  Bot,
  Clock,
  Cpu,
  FileOutput,
  GitBranch,
  Play,
  Save,
  ShieldCheck,
  Trash2,
  Wand2,
  Wrench,
} from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from 'react';
import type { WorkflowGraph, WorkflowNodeType } from '@agentos/db';
import { Button, Field, Input, Select, StatusBadge, Textarea, cn } from '@agentos/ui';
import { runWorkflowAction, saveWorkflowAction } from '@/app/(app)/workflows/actions';
import { useErrorText } from '@/components/error-text';
import { WorkflowSettings, type WorkflowScheduleView } from './workflow-settings';

export type BuilderCatalog = {
  agents: { id: string; name: string; role: string }[];
  tools: {
    id: string;
    name: string;
    server: string;
    permission: string;
    arguments: string[];
  }[];
  providers: { id: string; name: string; models: string[] }[];
};

type StepData = {
  type: WorkflowNodeType;
  label: string;
  config: Record<string, unknown>;
  index: number;
  subtitle: string;
  invalid: boolean;
};
type StepNode = Node<StepData, 'step'>;

const ICONS: Record<WorkflowNodeType, typeof Bot> = {
  agent: Bot,
  tool: Wrench,
  model: Cpu,
  condition: GitBranch,
  approval: ShieldCheck,
  transform: Wand2,
  delay: Clock,
  output: FileOutput,
};

const DEFAULTS: Record<WorkflowNodeType, Record<string, unknown>> = {
  agent: { prompt: '{{previous}}' },
  tool: { arguments: {} },
  model: { prompt: '{{previous}}' },
  condition: { subject: '{{previous}}', operator: 'contains', value: '' },
  approval: { message: 'Approve this? {{previous}}' },
  transform: { template: '{{previous}}' },
  delay: { minutes: 60 },
  output: { template: '{{previous}}' },
};

/** One step card on the canvas (Screen 9): number, icon, name, what it does. */
function StepCard({ data, selected }: NodeProps<StepNode>) {
  const t = useTranslations('workflows');
  const Icon = ICONS[data.type];
  return (
    <div
      className={cn(
        'w-60 rounded-xl border bg-surface px-3 py-2.5 text-text shadow-sm',
        selected ? 'border-primary ring-2 ring-primary/40' : 'border-border',
        data.invalid && 'border-danger',
      )}
      data-step={data.label}
    >
      <Handle type="target" position={Position.Top} className="!bg-border-strong" />
      <div className="flex items-center gap-2.5">
        <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-primary/15 text-primary">
          <Icon className="size-4" aria-hidden />
        </span>
        <div className="min-w-0">
          <p className="truncate text-sm font-medium">
            {data.index}. {data.label}
          </p>
          <p className="truncate text-xs text-text-muted">
            {data.subtitle || t(`types.${data.type}`)}
          </p>
        </div>
      </div>
      {data.type === 'condition' ? (
        <>
          <Handle
            type="source"
            id="true"
            position={Position.Bottom}
            style={{ left: '30%' }}
            className="!bg-success"
          />
          <Handle
            type="source"
            id="false"
            position={Position.Bottom}
            style={{ left: '70%' }}
            className="!bg-danger"
          />
          <div className="mt-1 flex justify-between px-8 text-[10px] text-text-subtle">
            <span>{t('yes')}</span>
            <span>{t('no')}</span>
          </div>
        </>
      ) : (
        data.type !== 'output' && (
          <Handle type="source" position={Position.Bottom} className="!bg-border-strong" />
        )
      )}
    </div>
  );
}

const nodeTypes = { step: StepCard };

/** Workflow Builder (PRD §16, Screen 9). */
export function WorkflowBuilder({
  workflow,
  graph,
  catalog,
  initialIssues,
  canManage,
  schedules,
}: {
  workflow: {
    id: string;
    name: string;
    description: string;
    active: boolean;
    version: number | null;
  };
  graph: WorkflowGraph;
  catalog: BuilderCatalog;
  initialIssues: { nodeId?: string; code: string }[];
  canManage: boolean;
  schedules: WorkflowScheduleView[];
}) {
  const t = useTranslations('workflows');
  const errorText = useErrorText();
  const router = useRouter();
  const [name, setName] = useState(workflow.name);
  const [description, setDescription] = useState(workflow.description);
  const [nodes, setNodes, onNodesChange] = useNodesState<StepNode>(
    graph.nodes.map((n) => ({
      id: n.id,
      type: 'step',
      position: n.position,
      data: {
        type: n.type,
        label: n.label,
        config: n.config,
        index: 0,
        subtitle: '',
        invalid: false,
      },
    })),
  );
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>(
    graph.edges.map((e) => ({
      id: e.id,
      source: e.source,
      target: e.target,
      ...(e.branch && { sourceHandle: e.branch, label: e.branch === 'true' ? t('yes') : t('no') }),
    })),
  );
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [issues, setIssues] = useState(initialIssues);
  const [version, setVersion] = useState(workflow.version);
  const [dirty, setDirty] = useState(false);
  const [error, setError] = useState<string>();
  const [pending, start] = useTransition();
  const [testInput, setTestInput] = useState('');

  // Keep every step in view as the workflow grows.
  const flow = useRef<ReactFlowInstance<StepNode, Edge> | null>(null);
  useEffect(() => {
    const id = requestAnimationFrame(
      () => void flow.current?.fitView({ maxZoom: 1, duration: 200 }),
    );
    return () => cancelAnimationFrame(id);
  }, [nodes.length]);

  const subtitleOf = useCallback(
    (type: WorkflowNodeType, config: Record<string, unknown>) => {
      if (type === 'agent') return catalog.agents.find((a) => a.id === config.agentId)?.name ?? '';
      if (type === 'tool') {
        const tool = catalog.tools.find((x) => x.id === config.toolId);
        return tool ? `${tool.server} · ${tool.name}` : '';
      }
      if (type === 'model') return String(config.model ?? '');
      if (type === 'delay') return t('delayMinutes', { minutes: Number(config.minutes ?? 0) });
      return '';
    },
    [catalog, t],
  );

  // Number steps top to bottom, as on Screen 9, and flag the ones with problems.
  const shown = useMemo(() => {
    const order = [...nodes].sort(
      (a, b) => a.position.y - b.position.y || a.position.x - b.position.x,
    );
    const invalid = new Set(issues.flatMap((i) => (i.nodeId ? [i.nodeId] : [])));
    return nodes.map((n) => ({
      ...n,
      data: {
        ...n.data,
        index: order.findIndex((o) => o.id === n.id) + 1,
        subtitle: subtitleOf(n.data.type, n.data.config),
        invalid: invalid.has(n.id),
      },
    }));
  }, [nodes, issues, subtitleOf]);

  const selected = nodes.find((n) => n.id === selectedId);
  const touch = () => setDirty(true);

  const updateStep = (id: string, patch: Partial<Pick<StepData, 'label' | 'config'>>) => {
    setNodes((all) => all.map((n) => (n.id === id ? { ...n, data: { ...n.data, ...patch } } : n)));
    touch();
  };

  const addStep = (
    type: WorkflowNodeType,
    config: Record<string, unknown> = {},
    label?: string,
  ) => {
    const base = label ?? t(`types.${type}`);
    const taken = new Set(nodes.map((n) => n.data.label.toLowerCase()));
    let unique = base;
    for (let i = 2; taken.has(unique.toLowerCase()); i += 1) unique = `${base} ${i}`;
    const from = selected ?? [...nodes].sort((a, b) => b.position.y - a.position.y)[0];
    const id = `${type}-${crypto.randomUUID().slice(0, 8)}`;
    const data: StepData = {
      type,
      label: unique,
      config: { ...DEFAULTS[type], ...config },
      index: 0,
      subtitle: '',
      invalid: false,
    };
    const branchFrom = (source: StepNode) =>
      source.data.type === 'condition'
        ? edges.some((e) => e.source === source.id && e.sourceHandle === 'true')
          ? 'false'
          : 'true'
        : undefined;
    const link = (source: string, target: string, branch?: string): Edge => ({
      id: `${source}-${target}`,
      source,
      target,
      ...(branch && { sourceHandle: branch, label: branch === 'true' ? t('yes') : t('no') }),
    });

    // First place at or below `at` that no step occupies (steps are 240×~70).
    const freeSpot = (at: { x: number; y: number }) => {
      const spot = { ...at };
      while (
        nodes.some(
          (n) => Math.abs(n.position.x - spot.x) < 250 && Math.abs(n.position.y - spot.y) < 90,
        )
      )
        spot.y += 120;
      return spot;
    };
    const below = (y: number) => (n: StepNode) =>
      n.position.y >= y ? { ...n, position: { x: n.position.x, y: n.position.y + 120 } } : n;
    // A condition's outgoing arrows always carry a branch; a new condition takes over Yes.
    const asSourceOf = (e: Edge, source: string): Edge =>
      type === 'condition'
        ? { ...e, id: `${source}-${e.target}`, source, sourceHandle: 'true', label: t('yes') }
        : { ...e, id: `${source}-${e.target}`, source, sourceHandle: undefined, label: undefined };
    if (!from) {
      setNodes((all) => [...all, { id, type: 'step', position: { x: 0, y: 0 }, data }]);
    } else if (from.data.type === 'output' && type !== 'output') {
      // Output stays last: the new step takes its place and everything from there moves down.
      setNodes((all) => [
        ...all.map(below(from.position.y)),
        { id, type: 'step', position: from.position, data },
      ]);
      setEdges((all) => [
        ...all.map((e) =>
          e.target === from.id ? { ...e, id: `${e.source}-${id}`, target: id } : e,
        ),
        link(id, from.id),
      ]);
    } else if (from.data.type === 'condition') {
      // Yes goes below, No to the right; with both taken the step is added unconnected.
      const branch = branchFrom(from);
      const used = edges.filter((e) => e.source === from.id).length >= 2;
      const position = freeSpot({
        x: from.position.x + (used ? 600 : branch === 'false' ? 300 : 0),
        y: from.position.y + 120,
      });
      setNodes((all) => [
        ...(branch === 'true' ? all.map(below(position.y)) : all),
        { id, type: 'step', position, data },
      ]);
      if (!used) setEdges((all) => [...all, link(from.id, id, branch)]);
    } else if (edges.some((e) => e.source === from.id)) {
      // In the middle of a chain: insert right after `from`, keeping what came next.
      const position = { x: from.position.x, y: from.position.y + 120 };
      setNodes((all) => [...all.map(below(position.y)), { id, type: 'step', position, data }]);
      setEdges((all) => [
        ...all.map((e) => (e.source === from.id ? asSourceOf(e, id) : e)),
        link(from.id, id),
      ]);
    } else {
      const position = { x: from.position.x, y: from.position.y + 120 };
      setNodes((all) => [...all, { id, type: 'step', position, data }]);
      if (from.data.type !== 'output') setEdges((all) => [...all, link(from.id, id)]);
    }
    setSelectedId(id);
    touch();
  };

  const onConnect = (connection: Connection) => {
    const branch =
      connection.sourceHandle === 'true' || connection.sourceHandle === 'false'
        ? connection.sourceHandle
        : undefined;
    setEdges((all) =>
      addEdge(
        {
          ...connection,
          id: `${connection.source}-${connection.target}-${branch ?? 'next'}`,
          ...(branch && { label: branch === 'true' ? t('yes') : t('no') }),
        },
        all,
      ),
    );
    touch();
  };

  const removeStep = (id: string) => {
    setNodes((all) => all.filter((n) => n.id !== id));
    setEdges((all) => all.filter((e) => e.source !== id && e.target !== id));
    setSelectedId(null);
    touch();
  };

  const toGraph = (): WorkflowGraph => ({
    nodes: nodes.map((n) => ({
      id: n.id,
      type: n.data.type,
      label: n.data.label,
      position: { x: Math.round(n.position.x), y: Math.round(n.position.y) },
      config: n.data.config,
    })),
    edges: edges.map((e) => ({
      id: e.id,
      source: e.source,
      target: e.target,
      ...((e.sourceHandle === 'true' || e.sourceHandle === 'false') && { branch: e.sourceHandle }),
    })),
  });

  const save = () =>
    start(async () => {
      const result = await saveWorkflowAction(workflow.id, { name, description, graph: toGraph() });
      setError(result.error ?? result.fieldErrors?.graph?.[0] ?? result.fieldErrors?.name?.[0]);
      if (result.ok) {
        setIssues(result.issues ?? []);
        setVersion(result.version ?? version);
        setDirty(false);
        router.refresh();
      }
    });

  const run = (trigger: 'test' | 'manual') =>
    start(async () => {
      const result = await runWorkflowAction(workflow.id, testInput, trigger);
      setError(result.error ?? result.fieldErrors?.graph?.[0] ?? result.fieldErrors?.workflow?.[0]);
      if (result.runId) router.push(`/workflows/${workflow.id}?tab=runs&run=${result.runId}`);
    });

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-end gap-2">
        {version !== null && (
          <span className="mr-auto text-sm text-text-muted">
            {t('version', { version })}
            {dirty && <span className="ml-2 text-warning">{t('unsaved')}</span>}
          </span>
        )}
        {canManage && (
          <>
            <Input
              aria-label={t('testInput')}
              placeholder={t('testInput')}
              value={testInput}
              onChange={(e) => setTestInput(e.target.value)}
              className="w-56"
            />
            <Button
              variant="secondary"
              disabled={pending || dirty}
              onClick={() => run('test')}
              title={dirty ? t('saveFirst') : undefined}
            >
              <Play aria-hidden />
              {t('testRun')}
            </Button>
            {workflow.active && (
              <Button variant="secondary" disabled={pending || dirty} onClick={() => run('manual')}>
                {t('runNow')}
              </Button>
            )}
            <Button disabled={pending} onClick={save}>
              <Save aria-hidden />
              {pending ? t('saving') : t('save')}
            </Button>
          </>
        )}
      </div>
      {error && (
        <p role="alert" className="rounded-lg bg-danger/15 px-3 py-2 text-sm text-danger">
          {errorText(error)}
        </p>
      )}
      <div className="grid gap-4 lg:grid-cols-[13rem_minmax(0,1fr)_19rem]">
        <Palette catalog={catalog} disabled={!canManage} onAdd={addStep} />
        <div
          className="h-[34rem] overflow-hidden rounded-(--radius-card) border border-border bg-bg"
          data-testid="workflow-canvas"
        >
          <ReactFlow
            nodes={shown}
            edges={edges}
            nodeTypes={nodeTypes}
            onNodesChange={(changes) => {
              onNodesChange(changes);
              if (changes.some((c) => c.type === 'position' || c.type === 'remove')) touch();
            }}
            onEdgesChange={(changes) => {
              onEdgesChange(changes);
              if (changes.some((c) => c.type === 'remove')) touch();
            }}
            onConnect={onConnect}
            onInit={(instance) => {
              flow.current = instance;
            }}
            onNodeClick={(_, node) => setSelectedId(node.id)}
            onPaneClick={() => setSelectedId(null)}
            nodesDraggable={canManage}
            nodesConnectable={canManage}
            elementsSelectable
            deleteKeyCode={canManage ? ['Backspace', 'Delete'] : null}
            colorMode="dark"
            fitView
            fitViewOptions={{ maxZoom: 1 }}
          >
            <Background gap={20} size={1} />
            <Controls showInteractive={false} />
          </ReactFlow>
        </div>
        <div className="space-y-4">
          {selected ? (
            <StepSettings
              key={selected.id}
              node={selected}
              catalog={catalog}
              disabled={!canManage}
              onChange={(patch) => updateStep(selected.id, patch)}
              onRemove={() => removeStep(selected.id)}
              issues={issues.filter((i) => i.nodeId === selected.id).map((i) => i.code)}
            />
          ) : (
            <WorkflowSettings
              id={workflow.id}
              name={name}
              description={description}
              onName={(v) => (setName(v), touch())}
              onDescription={(v) => (setDescription(v), touch())}
              active={workflow.active}
              canManage={canManage}
              schedules={schedules}
            />
          )}
          {issues.length > 0 && (
            <section
              aria-label={t('issues')}
              className="rounded-lg border border-warning/40 bg-warning/5 p-3"
            >
              <h3 className="mb-1 text-sm font-medium">{t('issues')}</h3>
              <ul className="space-y-1 text-xs">
                {issues.map((issue, i) => (
                  <li key={i}>
                    {issue.nodeId ? (
                      <button
                        type="button"
                        className="text-left hover:text-primary"
                        onClick={() => setSelectedId(issue.nodeId!)}
                      >
                        {nodes.find((n) => n.id === issue.nodeId)?.data.label}:{' '}
                        {errorText(issue.code)}
                      </button>
                    ) : (
                      errorText(issue.code)
                    )}
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>
      </div>
    </div>
  );
}

/** Left column: agents, tools and the other step types (Screen 9). */
function Palette({
  catalog,
  disabled,
  onAdd,
}: {
  catalog: BuilderCatalog;
  disabled: boolean;
  onAdd: (type: WorkflowNodeType, config?: Record<string, unknown>, label?: string) => void;
}) {
  const t = useTranslations('workflows');
  const item = (
    key: string,
    label: string,
    onClick: () => void,
    Icon: typeof Bot,
    hint?: string,
  ) => (
    <li key={key}>
      <button
        type="button"
        disabled={disabled}
        onClick={onClick}
        className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm hover:bg-surface-2 disabled:opacity-50"
        aria-label={`${t('add')}: ${label}`}
      >
        <Icon className="size-4 shrink-0 text-text-muted" aria-hidden />
        <span className="min-w-0">
          <span className="block truncate">{label}</span>
          {hint && <span className="block truncate text-xs text-text-subtle">{hint}</span>}
        </span>
      </button>
    </li>
  );
  return (
    <aside
      className="space-y-4 rounded-(--radius-card) border border-border bg-surface p-3"
      aria-label={t('palette')}
    >
      <div>
        <h3 className="mb-1 px-2 text-xs font-medium tracking-wide text-text-muted uppercase">
          {t('agents')}
        </h3>
        <ul>
          {catalog.agents.map((a) =>
            item(a.id, a.name, () => onAdd('agent', { agentId: a.id }, a.name), Bot, a.role),
          )}
        </ul>
        {catalog.agents.length === 0 && (
          <p className="px-2 text-xs text-text-subtle">{t('noAgents')}</p>
        )}
      </div>
      <div>
        <h3 className="mb-1 px-2 text-xs font-medium tracking-wide text-text-muted uppercase">
          {t('tools')}
        </h3>
        <ul className="max-h-48 overflow-y-auto">
          {catalog.tools.map((tool) =>
            item(
              tool.id,
              tool.name,
              () => onAdd('tool', { toolId: tool.id, arguments: {} }, tool.name),
              Wrench,
              tool.server,
            ),
          )}
        </ul>
      </div>
      <div>
        <h3 className="mb-1 px-2 text-xs font-medium tracking-wide text-text-muted uppercase">
          {t('logic')}
        </h3>
        <ul>
          {(['model', 'condition', 'approval', 'transform', 'delay', 'output'] as const).map(
            (type) => item(type, t(`types.${type}`), () => onAdd(type), ICONS[type]),
          )}
        </ul>
      </div>
    </aside>
  );
}

/** Right column when a step is selected: its name and settings. */
function StepSettings({
  node,
  catalog,
  disabled,
  onChange,
  onRemove,
  issues,
}: {
  node: StepNode;
  catalog: BuilderCatalog;
  disabled: boolean;
  onChange: (patch: Partial<Pick<StepData, 'label' | 'config'>>) => void;
  onRemove: () => void;
  issues: string[];
}) {
  const t = useTranslations('workflows');
  const errorText = useErrorText();
  const { type, config, label } = node.data;
  const set = (key: string, value: unknown) => onChange({ config: { ...config, [key]: value } });
  const text = (key: string) => (typeof config[key] === 'string' ? (config[key] as string) : '');
  const tool = catalog.tools.find((x) => x.id === config.toolId);
  const provider = catalog.providers.find((p) => p.id === config.connectionId);
  const args = (config.arguments ?? {}) as Record<string, unknown>;

  return (
    <section
      aria-label={t('stepSettings')}
      className="space-y-4 rounded-(--radius-card) border border-border bg-surface p-4"
    >
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold">{t(`types.${type}`)}</h3>
        {!disabled && (
          <Button size="sm" variant="ghost" onClick={onRemove} aria-label={t('removeStep')}>
            <Trash2 aria-hidden />
          </Button>
        )}
      </div>
      {issues.map((code) => (
        <p key={code} className="text-xs text-danger">
          {errorText(code)}
        </p>
      ))}
      <fieldset disabled={disabled} className="space-y-4">
        <Field
          label={t('stepName')}
          htmlFor="step-label"
          hint={t('stepNameHint', { label: label || '…' })}
        >
          <Input
            id="step-label"
            value={label}
            maxLength={60}
            onChange={(e) => onChange({ label: e.target.value })}
          />
        </Field>
        {type === 'agent' && (
          <>
            <Field label={t('agent')} htmlFor="step-agent">
              <Select
                id="step-agent"
                value={text('agentId')}
                onValueChange={(v) => set('agentId', v)}
                placeholder="—"
                options={catalog.agents.map((a) => ({ value: a.id, label: a.name }))}
              />
            </Field>
            <Field label={t('prompt')} htmlFor="step-prompt" hint={t('templateHint')}>
              <Textarea
                id="step-prompt"
                rows={4}
                value={text('prompt')}
                onChange={(e) => set('prompt', e.target.value)}
              />
            </Field>
          </>
        )}
        {type === 'tool' && (
          <>
            <Field label={t('tool')} htmlFor="step-tool">
              <Select
                id="step-tool"
                value={text('toolId')}
                onValueChange={(v) => onChange({ config: { toolId: v, arguments: {} } })}
                placeholder="—"
                options={catalog.tools.map((x) => ({
                  value: x.id,
                  label: `${x.server} · ${x.name}`,
                }))}
              />
            </Field>
            {tool && tool.permission !== 'AUTO_ALLOW' && (
              <StatusBadge tone={tool.permission === 'BLOCKED' ? 'danger' : 'warning'}>
                {t(`toolPermission.${tool.permission as 'BLOCKED'}`)}
              </StatusBadge>
            )}
            {tool?.arguments.map((arg) => (
              <Field key={arg} label={arg} htmlFor={`arg-${arg}`}>
                <Input
                  id={`arg-${arg}`}
                  value={typeof args[arg] === 'string' ? (args[arg] as string) : ''}
                  onChange={(e) => set('arguments', { ...args, [arg]: e.target.value })}
                  className="font-mono text-xs"
                />
              </Field>
            ))}
            {tool && <p className="text-xs text-text-muted">{t('templateHint')}</p>}
          </>
        )}
        {type === 'model' && (
          <>
            <Field label={t('provider')} htmlFor="step-provider">
              <Select
                id="step-provider"
                value={text('connectionId')}
                onValueChange={(v) => set('connectionId', v)}
                placeholder="—"
                options={catalog.providers.map((p) => ({ value: p.id, label: p.name }))}
              />
            </Field>
            <Field label={t('model')} htmlFor="step-model">
              {provider && provider.models.length > 0 ? (
                <Select
                  id="step-model"
                  value={text('model')}
                  onValueChange={(v) => set('model', v)}
                  placeholder="—"
                  options={provider.models.map((m) => ({ value: m, label: m }))}
                />
              ) : (
                <Input
                  id="step-model"
                  value={text('model')}
                  onChange={(e) => set('model', e.target.value)}
                />
              )}
            </Field>
            <Field label={t('prompt')} htmlFor="step-prompt" hint={t('templateHint')}>
              <Textarea
                id="step-prompt"
                rows={4}
                value={text('prompt')}
                onChange={(e) => set('prompt', e.target.value)}
              />
            </Field>
          </>
        )}
        {type === 'condition' && (
          <>
            <Field label={t('subject')} htmlFor="step-subject" hint={t('templateHint')}>
              <Input
                id="step-subject"
                value={text('subject')}
                onChange={(e) => set('subject', e.target.value)}
                className="font-mono text-xs"
              />
            </Field>
            <Field label={t('operator')} htmlFor="step-operator">
              <Select
                id="step-operator"
                value={text('operator') || 'contains'}
                onValueChange={(v) => set('operator', v)}
                options={(
                  ['contains', 'not_contains', 'equals', 'matches', 'not_empty'] as const
                ).map((value) => ({
                  value,
                  label: t(`operators.${value}`),
                }))}
              />
            </Field>
            {config.operator !== 'not_empty' && (
              <Field label={t('value')} htmlFor="step-value">
                <Input
                  id="step-value"
                  value={text('value')}
                  onChange={(e) => set('value', e.target.value)}
                />
              </Field>
            )}
            <p className="text-xs text-text-muted">{t('branchesHint')}</p>
          </>
        )}
        {type === 'approval' && (
          <Field label={t('message')} htmlFor="step-message" hint={t('templateHint')}>
            <Textarea
              id="step-message"
              rows={4}
              value={text('message')}
              onChange={(e) => set('message', e.target.value)}
            />
          </Field>
        )}
        {(type === 'transform' || type === 'output') && (
          <Field label={t('template')} htmlFor="step-template" hint={t('templateHint')}>
            <Textarea
              id="step-template"
              rows={5}
              value={text('template')}
              onChange={(e) => set('template', e.target.value)}
              className="font-mono text-xs"
            />
          </Field>
        )}
        {type === 'delay' && (
          <Field label={t('minutes')} htmlFor="step-minutes">
            <Input
              id="step-minutes"
              type="number"
              min={1}
              max={10080}
              value={String(config.minutes ?? '')}
              onChange={(e) => set('minutes', Number(e.target.value))}
            />
          </Field>
        )}
      </fieldset>
    </section>
  );
}
