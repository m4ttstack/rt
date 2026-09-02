import { useRef } from 'react';
import { render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';

import { stubTextareaScrollHeight } from './test-utils';
import { useAutoGrowTextarea } from './use-auto-grow-textarea';

function Draft({ text }: { text: string }) {
  const ref = useRef<HTMLTextAreaElement>(null);
  useAutoGrowTextarea(ref, text);
  return <textarea ref={ref} value={text} readOnly />;
}

beforeEach(() => {
  stubTextareaScrollHeight(20);
});

afterEach(() => {
  vi.restoreAllMocks();
});

test('the textarea takes the height of its content as the text grows', () => {
  const { rerender } = render(<Draft text="one" />);
  expect(screen.getByRole('textbox')).toHaveStyle({ height: '20px' });

  rerender(<Draft text={'one\ntwo\nthree'} />);
  expect(screen.getByRole('textbox')).toHaveStyle({ height: '60px' });
});

test('the textarea shrinks again when lines are deleted', () => {
  const { rerender } = render(<Draft text={'one\ntwo\nthree'} />);
  expect(screen.getByRole('textbox')).toHaveStyle({ height: '60px' });

  rerender(<Draft text="one" />);
  expect(screen.getByRole('textbox')).toHaveStyle({ height: '20px' });
});
