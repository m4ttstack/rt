import { render } from '@testing-library/react';
import { expect, test } from 'vitest';

import { MattstackMark } from './MattstackMark';

test('renders an accessible svg with the plum canvas and pink mark', () => {
  const { getByRole, container } = render(<MattstackMark />);
  const svg = getByRole('img', { name: 'mattstack' });
  expect(svg.tagName.toLowerCase()).toBe('svg');
  expect(container.querySelector('rect')).toHaveAttribute('fill', '#161224');
  expect(container.querySelector('text')).toHaveTextContent('m');
  expect(container.querySelector('text')).toHaveAttribute('fill', '#FF6B9D');
});

test('honors the size prop on the svg element', () => {
  const { getByRole } = render(<MattstackMark size={40} />);
  const svg = getByRole('img', { name: 'mattstack' });
  expect(svg).toHaveAttribute('width', '40');
  expect(svg).toHaveAttribute('height', '40');
});

test('decorative mode hides the svg from accessibility tree', () => {
  const { container, queryByRole } = render(<MattstackMark decorative />);
  expect(queryByRole('img')).toBeNull();
  const svg = container.querySelector('svg');
  expect(svg).toHaveAttribute('aria-hidden', 'true');
});
