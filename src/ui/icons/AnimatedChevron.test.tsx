import { render } from '@testing-library/react';
import { expect, test } from 'vitest';

import { AnimatedChevron } from '@ui/icons';

test('adds the rotation class only when opened', () => {
  const { container, rerender } = render(<AnimatedChevron opened={false} />);
  expect(container.querySelector('svg')?.getAttribute('class')).not.toMatch(
    /opened/
  );

  rerender(<AnimatedChevron opened />);
  expect(container.querySelector('svg')?.getAttribute('class')).toMatch(
    /opened/
  );
});
