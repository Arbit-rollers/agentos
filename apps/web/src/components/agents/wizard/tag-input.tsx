'use client';

import { X } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState, type KeyboardEvent } from 'react';
import { inputClassName } from '@agentos/ui';

/** Chip-style tag editor; submits the tags as a JSON array in a hidden input. */
export function TagInput({ name, id, initial }: { name: string; id: string; initial: string[] }) {
  const t = useTranslations('wizard');
  const [tags, setTags] = useState(initial);
  const [draft, setDraft] = useState('');

  const add = () => {
    const tag = draft.trim().replace(/,$/, '');
    if (tag && !tags.some((existing) => existing.toLowerCase() === tag.toLowerCase())) {
      setTags([...tags, tag]);
    }
    setDraft('');
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter' || event.key === ',') {
      event.preventDefault();
      add();
    } else if (event.key === 'Backspace' && !draft && tags.length > 0) {
      setTags(tags.slice(0, -1));
    }
  };

  return (
    <div>
      <input type="hidden" name={name} value={JSON.stringify(tags)} />
      {tags.length > 0 && (
        <ul className="mb-2 flex flex-wrap gap-1.5">
          {tags.map((tag) => (
            <li
              key={tag}
              className="flex items-center gap-1 rounded-full bg-surface-3 py-0.5 pr-1 pl-2.5 text-xs"
            >
              {tag}
              <button
                type="button"
                aria-label={t('removeTag', { tag })}
                onClick={() => setTags(tags.filter((existing) => existing !== tag))}
                className="rounded-full p-0.5 text-text-muted hover:bg-surface-2 hover:text-text"
              >
                <X aria-hidden className="size-3" />
              </button>
            </li>
          ))}
        </ul>
      )}
      <input
        id={id}
        value={draft}
        maxLength={32}
        onChange={(event) => setDraft(event.target.value)}
        onKeyDown={onKeyDown}
        onBlur={add}
        placeholder={t('tagPlaceholder')}
        className={inputClassName}
      />
    </div>
  );
}
