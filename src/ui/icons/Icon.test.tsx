import { render } from '@testing-library/react';
import { expect, test } from 'vitest';

import { Icon } from '@ui/icons';

test('renders the named registry icon, forwarding size and color', () => {
  const { container } = render(<Icon name="trash" size={32} color="red" />);
  const svg = container.querySelector('svg');

  expect(svg).toBeTruthy();
  expect(svg?.getAttribute('width')).toBe('32');
  expect(svg?.getAttribute('stroke')).toBe('red');
});
