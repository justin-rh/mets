import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkBreaks from 'remark-breaks';

/**
 * Shared Markdown renderer for ticket descriptions, comments, and KB
 * articles. Sanitized by construction: raw HTML is never rendered
 * (react-markdown escapes it unless rehype-raw is added — it isn't).
 * remark-breaks keeps legacy plain-text content looking right: single
 * newlines stay line breaks instead of joining into one paragraph.
 */
export function Md({ children }: { children: string }) {
  return (
    <div className="md">
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkBreaks]}
        components={{
          a: ({ href, children: kids }) => (
            <a href={href} target="_blank" rel="noreferrer">{kids}</a>
          ),
        }}
      >
        {children}
      </ReactMarkdown>
    </div>
  );
}
