import ReactMarkdown, { defaultUrlTransform } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { memo } from 'react';
import { isImageRef } from '@deepclaw/core';
import { imageSrc } from '@/components/component-utils';

/** A stored image arrives as dcimg://, a scheme the sanitizer drops, so it is resolved by hand. */
function transformUrl(url: string): string {
  return isImageRef(url) ? imageSrc(url) : defaultUrlTransform(url);
}

export const Markdown = memo(function Markdown({ content }: { content: string }) {
  return (
    <div className="prose prose-sm max-w-none break-words">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        urlTransform={transformUrl}
        components={{
          // A link is something to follow beside the app, not somewhere to take the app itself:
          // a report opened over the page loses the page it was read from.
          a: ({children, ...props}) => <a {...props} target="_blank" rel="noreferrer">{children}</a>,
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
});
