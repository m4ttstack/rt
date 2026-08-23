import { Box } from '@ui/core';
import { Icon } from '@ui/icons';

/** Small gradient logo mark -- intentionally generic (an icon on a gradient
 * tile), so it survives the template's rename without redesign. Shared by
 * the marketing header and the app chrome's wordmark. */
export function LogoMark() {
  return (
    <Box
      w={26}
      h={26}
      aria-hidden
      style={{
        flexShrink: 0,
        display: 'grid',
        placeItems: 'center',
        borderRadius: 8,
        background:
          'linear-gradient(135deg, var(--mantine-color-indigo-5), var(--mantine-color-grape-5))',
        color: 'var(--mantine-color-white)',
      }}
    >
      <Icon name="layers" size={15} />
    </Box>
  );
}
