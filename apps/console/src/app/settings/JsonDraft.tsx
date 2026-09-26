import { useMemo } from 'react';
import { CodeMirror } from '@mattstack/app-kit/lazy';
import { checkValue, type JsonSchema } from '@mattstack/settings-kit/shapes';

const LINE_PX = 20;
const PADDING_PX = 20;
const MIN_HEIGHT_PX = 60;
const MAX_HEIGHT_PX = 260;

/** A short value gets a short well, not the same fixed box as a long one; a
    long value still caps and scrolls rather than pushing the row open. */
function heightFor(text: string): string {
  const lines = text.split('\n').length;
  const px = Math.min(
    MAX_HEIGHT_PX,
    Math.max(MIN_HEIGHT_PX, lines * LINE_PX + PADDING_PX)
  );
  return `${px}px`;
}

/** The JSON text of a draft, completed and linted against the same schema
    the Save button checks, so an underline and the issue line agree. */
export function JsonDraft({
  text,
  onText,
  schema,
}: {
  text: string;
  onText: (t: string) => void;
  schema: JsonSchema | undefined;
}) {
  const check = useMemo(
    () => (schema ? (v: unknown) => checkValue(schema, v) : undefined),
    [schema]
  );
  return (
    <CodeMirror
      value={text}
      onChange={onText}
      language="json"
      height={heightFor(text)}
      jsonSchema={schema}
      jsonCheck={check}
    />
  );
}
