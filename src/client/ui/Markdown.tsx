import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

/** Thin wrapper over ReactMarkdown + remarkGfm. `linkTargetBlank` renders
    markdown links to open in a new tab (used for comment bodies; review
    write-ups render links inline). */
function Markdown({ children, linkTargetBlank }: { children: string; linkTargetBlank?: boolean }) {
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      components={
        linkTargetBlank
          ? { a: ({ node, ...props }) => <a {...props} target="_blank" rel="noopener noreferrer" /> }
          : undefined
      }
    >
      {children}
    </ReactMarkdown>
  );
}

export { Markdown };
