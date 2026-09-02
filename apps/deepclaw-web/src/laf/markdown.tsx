'use client';

import ReactMarkdown, { defaultUrlTransform } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { memo, useCallback, useEffect, useState } from 'react';
import { Check, Copy } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { isImageRef } from '@deepclaw/core';
import { imageSrc } from '@/components/component-utils';
import { copyText } from '@/lib/browser-file-utils';
import { useToastStore } from '@/lib/toast-store';
import { getLogger } from '@/lib/logger';

const logger = getLogger('Markdown');

/** How long the button says it copied, which is long enough to be seen and no longer. */
const COPIED_MS = 1500;

/** A stored image arrives as dcimg://, a scheme the sanitizer drops, so it is resolved by hand. */
function transformUrl(url: string): string {
  return isImageRef(url) ? imageSrc(url) : defaultUrlTransform(url);
}

/**
 * cursor-auto against the arrow the app sets on everything: a body of text is the one thing on a
 * page worth taking away, and the I-beam is what says so. The furniture around it -- names, counts,
 * labels -- offers a selection nobody wants and keeps the arrow.
 *
 * What the button takes away is the markdown as it was written, not the text as it is drawn: a table
 * or a piece of code dragged out of the page by hand arrives with its shape gone, and the shape is
 * most of what it says. It sits outside the prose rather than inside it: inside, it would be the
 * first child and take the first line's margin off the top of every block. It shows on hover where
 * there is such a thing, and always on a narrow screen, where a finger has no way to ask for it,
 * and it is there to be pressed on exactly the terms it is there to be seen on.
 */
export const Markdown = memo(function Markdown({ content }: { content: string }) {
  const [copied, setCopied] = useState(false);
  const showToast = useToastStore(s => s.show);
  const {t} = useTranslation();

  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), COPIED_MS);
    return () => clearTimeout(timer);
  }, [copied]);

  /**
   * Said out loud, not written to the log alone. A page read over http from another machine has no
   * clipboard of its own and the way around it can be refused as well: failing quietly leaves a
   * button that does nothing when pressed, and the phone where this is likeliest has no console to
   * find the reason in.
   */
  const copy = useCallback(() => {
    copyText(content)
      .then(() => setCopied(true))
      .catch(error => {
        logger.warn(`Nothing was copied: ${error}`);
        showToast({type: 'error', message: t('web.common.copyFailed')});
      });
  }, [content, showToast, t]);

  const label = t(`web.common.${copied ? 'copied' : 'copy'}`);

  return (
    <div className="group">
      {/* Nothing of the flow: a row of no height, there to hold the button in the corner and to
          keep it within reach of a long report, which is read by scrolling past where it began.
          Being reachable throughout means it travels down the block as that is scrolled, so it
          takes the pointer only while it can be seen: a corner that looks like text is text, and a
          selection dragged from it would come away holding a button nobody could see. */}
      {!!content && <div className="sticky top-0 z-10 flex h-0 items-start justify-end">
        <button
          type="button"
          onClick={copy}
          title={label}
          aria-label={label}
          className="-mt-1.5 -mr-2 rounded p-1 bg-white/80 ring-1 ring-black/5
            text-gray-400 opacity-0 pointer-events-none transition-opacity
            hover:bg-white hover:text-gray-600
            group-hover:opacity-100 group-hover:pointer-events-auto
            focus-visible:opacity-100 focus-visible:pointer-events-auto
            max-md:opacity-100 max-md:pointer-events-auto"
        >
          {copied ? <Check size={14} className="text-green-600" /> : <Copy size={14} />}
        </button>
        {/* The check mark is for eyes. This is the same word for a page that is heard instead. */}
        <span className="sr-only" aria-live="polite">{copied ? t('web.common.copied') : ''}</span>
      </div>}
      <div className="prose prose-sm max-w-none wrap-anywhere cursor-auto">
        <ReactMarkdown
          remarkPlugins={[remarkGfm]}
          urlTransform={transformUrl}
          components={{
            // A link is something to follow beside the app, not somewhere to take the app itself:
            // a report opened over the page loses the page it was read from.
            a: ({children, ...props}) => <a {...props} target="_blank" rel="noreferrer">{children}</a>,
            // Code lines and table columns refuse to wrap, so each gets its own scroll box.
            // Without one their full width becomes the minimum width of every flex ancestor,
            // and a single long line widens the whole chat panel.
            pre: ({children, ...props}) => (
              <pre {...props} className="max-w-full overflow-x-auto">{children}</pre>
            ),
            table: ({children, ...props}) => (
              <div className="max-w-full overflow-x-auto">
                <table {...props}>{children}</table>
              </div>
            ),
          }}
        >
          {content}
        </ReactMarkdown>
      </div>
    </div>
  );
});
