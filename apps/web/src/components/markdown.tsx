'use client';

import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

/**
 * Renders agent output as Markdown. Raw HTML is never rendered (react-markdown's default),
 * so model or tool text can't inject markup into the page.
 */
export function Markdown({ children }: { children: string }) {
  return (
    <div className="space-y-2 text-sm leading-relaxed break-words [&_a]:text-primary [&_a]:underline [&_code]:rounded [&_code]:bg-surface-3 [&_code]:px-1 [&_code]:text-xs [&_h1]:text-base [&_h1]:font-semibold [&_h2]:font-semibold [&_h3]:font-medium [&_ol]:list-decimal [&_ol]:pl-5 [&_pre]:overflow-x-auto [&_pre]:rounded-lg [&_pre]:bg-surface-3 [&_pre]:p-3 [&_strong]:font-semibold [&_table]:w-full [&_td]:border [&_td]:border-border [&_td]:px-2 [&_th]:border [&_th]:border-border [&_th]:px-2 [&_ul]:list-disc [&_ul]:pl-5">
      <ReactMarkdown remarkPlugins={[remarkGfm]} skipHtml>
        {children}
      </ReactMarkdown>
    </div>
  );
}
