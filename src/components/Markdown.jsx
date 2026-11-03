import { useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeHighlight from 'rehype-highlight';
import { copyText } from '../lib/api.js';
import { Icon } from './Icon.jsx';

function CodeBlock({ inline, children, className, ...rest }) {
  const [copied, setCopied] = useState(false);
  if (inline) {
    return (
      <code className={className} {...rest}>
        {children}
      </code>
    );
  }
  const text = String(children).replace(/\n$/, '');
  return (
    <div className="code-block">
      <div className="code-head">
        <span>{(className || 'code').replace('hljs language-', '').replace('language-', '')}</span>
        <button
          type="button"
          className="mini-btn"
          onClick={async () => {
            if (await copyText(text)) {
              setCopied(true);
              setTimeout(() => setCopied(false), 1600);
            }
          }}
        >
          <Icon name={copied ? 'check' : 'copy'} size={14} /> {copied ? 'Copied' : 'Copy'}
        </button>
      </div>
      <pre>
        <code className={className} {...rest}>
          {children}
        </code>
      </pre>
    </div>
  );
}

/** Renders AI output with markdown, tables and syntax-highlighted code. */
export function Markdown({ children }) {
  return (
    <div className="md">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[rehypeHighlight]}
        components={{
          code: CodeBlock,
          pre: ({ children }) => <>{children}</>,
          a: ({ href, children: label }) => (
            <a href={href} target="_blank" rel="noreferrer noopener">
              {label}
            </a>
          ),
        }}
      >
        {String(children || '')}
      </ReactMarkdown>
    </div>
  );
}

export default Markdown;
