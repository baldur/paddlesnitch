import ReactMarkdown, { type Components } from 'react-markdown'
import remarkGfm from 'remark-gfm'

// A post's Markdown, styled with the site's tokens. react-markdown builds React
// elements and ignores raw HTML in the source, so a post can't inject markup.
const components: Components = {
  h1: ({ children }) => <h2 className="text-base font-bold text-fg mt-6">{children}</h2>,
  h2: ({ children }) => <h2 className="text-base font-bold text-fg mt-6">{children}</h2>,
  h3: ({ children }) => <h3 className="text-sm font-bold text-fg mt-4">{children}</h3>,
  p: ({ children }) => <p className="text-sm text-fg leading-relaxed">{children}</p>,
  a: ({ href, children }) => {
    const external = !!href && /^https?:\/\//.test(href)
    return <a href={href} className="tt-link" {...(external ? { target: '_blank', rel: 'noopener noreferrer' } : {})}>{children}</a>
  },
  ul: ({ children }) => <ul className="list-disc pl-5 flex flex-col gap-1 text-sm text-fg">{children}</ul>,
  ol: ({ children }) => <ol className="list-decimal pl-5 flex flex-col gap-1 text-sm text-fg">{children}</ol>,
  blockquote: ({ children }) => <blockquote className="border-l-2 border-primary pl-4 text-muted [&_p]:text-muted">{children}</blockquote>,
  code: ({ children }) => <code className="bg-surface px-1 text-split">{children}</code>,
  pre: ({ children }) => <pre className="bg-surface border border-border p-3 overflow-x-auto text-xs">{children}</pre>,
  hr: () => <hr className="border-border" />,
  // eslint-disable-next-line @next/next/no-img-element -- files in public/blog-media, served as they are
  img: ({ src, alt }) => <img src={typeof src === 'string' ? src : undefined} alt={alt ?? ''} loading="lazy" className="w-full border border-border" />,
  table: ({ children }) => <div className="overflow-x-auto"><table className="text-sm text-fg border-collapse tabular">{children}</table></div>,
  th: ({ children }) => <th className="border-b border-border px-3 py-1.5 text-left text-xs text-muted tracking-widest uppercase">{children}</th>,
  td: ({ children }) => <td className="border-b border-border px-3 py-1.5">{children}</td>,
}

export default function PostBody({ markdown }: { markdown: string }) {
  return (
    <div className="flex flex-col gap-4">
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>{markdown}</ReactMarkdown>
    </div>
  )
}
