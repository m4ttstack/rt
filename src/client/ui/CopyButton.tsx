import { useState } from "react";
import { Icon, COPY_ICON, CHECK_ICON } from "./Icon.tsx";

/** Copies `text` to the clipboard and flashes a check for feedback. An
    optional `label` renders text beside the icon (used for the drawer action). */
function CopyButton({ text, className, title, label }: { text: string; className: string; title: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  const onClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    navigator.clipboard?.writeText(text).then(
      () => {
        setCopied(true);
        setTimeout(() => setCopied(false), 1200);
      },
      () => {},
    );
  };
  return (
    <button
      className={copied ? `${className} copied` : className}
      title={copied ? "copied" : title}
      aria-label={title}
      onClick={onClick}
    >
      <Icon d={copied ? CHECK_ICON : COPY_ICON} />
      {label && <span>{copied ? "copied" : label}</span>}
    </button>
  );
}

export { CopyButton };
