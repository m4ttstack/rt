import { Flex, rem } from '@mantine/core';

import { MainContext } from '../context';
import { useIsInPageShell, usePageShellContext } from '../hooks';

/**
 * The shell's main column: everything that isn't the sidebar. Hosts
 * `PageShell.Header` and `PageShell.Content`, and narrows itself by the
 * sidebar width whenever a `PageShell.Sidebar` is registered (flex-grow
 * still lets it reclaim the space while the sidebar is collapsed).
 */
export const Main = ({ children }: { children: React.ReactNode }) => {
  useIsInPageShell('Main');

  const { hasSidebar, sidebarWidth } = usePageShellContext();

  const width =
    typeof sidebarWidth === 'number' ? rem(sidebarWidth) : sidebarWidth;

  return (
    <MainContext.Provider value={true}>
      <Flex
        id="page-shell-main"
        direction="column"
        w={hasSidebar ? `calc(100% - ${width})` : '100%'}
        flex={1}
      >
        {children}
      </Flex>
    </MainContext.Provider>
  );
};
