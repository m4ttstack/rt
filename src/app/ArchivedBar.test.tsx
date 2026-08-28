import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, test, vi } from 'vitest';

import { renderWithProviders } from '@ui/storybook/test-utils';
import { ArchivedBar } from './ArchivedBar';

test('the archived bar says when, reassures, and reopens on its one button', async () => {
  const onReopen = vi.fn();
  renderWithProviders(
    <ArchivedBar archivedAt={Date.now() - 86_400_000} onReopen={onReopen} />
  );
  expect(screen.getByTestId('archived-bar')).toHaveTextContent(
    'Archived Yesterday · everyone keeps their place'
  );
  await userEvent.click(screen.getByTestId('archived-reopen'));
  expect(onReopen).toHaveBeenCalledTimes(1);
});
