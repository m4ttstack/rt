import {
  ActionIcon,
  Alert,
  Badge,
  Drawer,
  Group,
  Paper,
  Stack,
  Text,
  Tooltip,
} from '@ui/core';
import type { MantineColor } from '@ui/core';
import { useSchemeColors } from '@ui/hooks';
import { Icons } from '@ui/icons';
import { CommandProvenance } from '../runs/CommandProvenance';
import { useDrawerSurface } from './drawerSurface';
import type { BindingSite, BindingSiteKind } from './outline';
import { suffixOf } from './outline';
import { SOFT_RULE } from './SlotRow';

/** Every kind gets a colour, so a fourth (or fifth) one can never render as
    a blank badge -- `Record` over the union is what makes that a compile
    error rather than a hole in the page. */
const KIND_COLOR: Record<BindingSiteKind, MantineColor> = {
  verb: 'accent',
  stage: 'warn',
  skill: 'cyan',
  external: 'purple',
};

/** The title is what a reader would call this site: its verb where it has
    one, the plugin-qualified ref where the plugin is the point, and the bare
    suffix otherwise -- `mattstack:` repeated down the column says nothing. */
function siteTitle(site: BindingSite): string {
  if (site.verb) return site.verb;
  return site.kind === 'external' ? site.ref : suffixOf(site.ref);
}

function SiteRow({
  site,
  onShowInMap,
}: {
  site: BindingSite;
  onShowInMap: () => void;
}) {
  const { bg, text } = useSchemeColors();
  const external = site.kind === 'external';

  return (
    <Paper
      bg={bg.level3}
      radius="sm"
      style={{ border: `1px solid ${SOFT_RULE}` }}
      data-testid={`binding-site-${site.ref}:${site.slot}`}
    >
      <Group gap="sm" wrap="nowrap" px="md" py="sm">
        <Badge
          size="sm"
          variant="light"
          color={KIND_COLOR[site.kind]}
          data-testid="site-kind"
        >
          {site.kind}
        </Badge>
        <Stack gap={2} style={{ flex: 1, minWidth: 0 }}>
          {/* `lg` is the ramp step that lands on the 13.5px body size the
              design draws these at; an unsized Text is `md`, a step down. */}
          <Text fw={600} size="lg" truncate>
            {siteTitle(site)}
          </Text>
          <Text size="xs" c={text.muted} truncate>
            {external ? "another plugin's skill" : site.ref} · slot{' '}
            <Text span size="xs" c={text.normal}>
              {site.slot}
            </Text>
            {external && ' · no roster verb'}
          </Text>
        </Stack>
        <Tooltip label="Show in the map">
          <ActionIcon
            variant="subtle"
            color="gray"
            onClick={onShowInMap}
            aria-label={`show ${siteTitle(site)} in the map`}
            data-testid="show-in-map"
          >
            <Icons.externalLink size={16} />
          </ActionIcon>
        </Tooltip>
      </Group>
    </Paper>
  );
}

export interface InverseIndexProps {
  pack: string;
  /** The fill being inspected; `null` closes the drawer. */
  fill: string | null;
  /** Every site that resolves to `fill`, already ordered. Empty is a real
      answer -- "bound by nothing" -- not a loading state. */
  sites: BindingSite[];
  /** The fill's own SKILL.md. Null for a `boundTo` no fill in this pack
      answers -- there is nothing to open, so no action is offered. */
  sourcePath: string | null;
  /** `dataUpdatedAt` off the composition query that produced `sites`. */
  asOf: number | undefined;
  /** Scrolls the spine to that site's row and closes the drawer. Every ref
      the index can list has one: a binder the pipeline never names still
      lands under "Outside the pipeline". */
  onShowInMap: (site: BindingSite) => void;
  onClose: () => void;
}

/**
 * The inverse of the map: one fill, and every place in the manifest that
 * resolves to it. It is the view consulted before deleting a fill, so an
 * empty list is rendered as the plain fact it is rather than as an error --
 * and it is drawn from the same inversion the slot rows' `N sites` chip
 * counts, so the two can never disagree.
 */
export function InverseIndex({
  pack,
  fill,
  sites,
  sourcePath,
  asOf,
  onShowInMap,
  onClose,
}: InverseIndexProps) {
  const { text } = useSchemeColors();
  const surface = useDrawerSurface();

  return (
    <Drawer
      opened={fill !== null}
      onClose={onClose}
      position="right"
      size={720}
      padding="lg"
      styles={surface}
      data-testid="inverse-index"
      title={
        <Stack gap={2}>
          <Group gap="xs" wrap="nowrap">
            <Text fz="xl" fw={700}>
              {fill}
            </Text>
            {/* The fill's source moved here from the slot row, where the
                name now opens this panel. One affordance per control: the
                row answers "what binds it", this answers "where is it". */}
            {sourcePath && (
              <Tooltip label="Open source">
                <ActionIcon
                  component="a"
                  href={`vscode://file${sourcePath}`}
                  variant="subtle"
                  color="gray"
                  aria-label={`open source for ${fill}`}
                  data-testid="open-fill-source"
                >
                  <Icons.edit size={16} />
                </ActionIcon>
              </Tooltip>
            )}
          </Group>
          <CommandProvenance
            command={`rt skills composition --pack ${pack}`}
            asOf={asOf}
          />
        </Stack>
      }
    >
      <Stack gap="lg">
        <Stack gap="xs">
          <Group justify="space-between" wrap="nowrap">
            <Text fw={700} size="lg">
              What binds this
            </Text>
            <Text size="sm" c={text.muted} data-testid="site-count">
              {sites.length}
            </Text>
          </Group>
          <Text size="xs" c={text.muted}>
            Every site that resolves to this fill — a roster verb&apos;s slot, a
            pipeline stage, a mattstack skill that is neither, or another
            plugin&apos;s skill. Deleting the fill breaks every one.
          </Text>
        </Stack>

        {sites.length === 0 ? (
          <Stack gap="xs" data-testid="bound-by-nothing">
            <Group gap="xs" wrap="nowrap">
              <Badge size="sm" variant="light" color="purple">
                orphaned
              </Badge>
              <Text size="lg" truncate>
                {fill}
              </Text>
            </Group>
            <Alert
              variant="default"
              radius="md"
              icon={<Icons.info size={14} />}
              styles={{
                root: { border: `1px solid ${SOFT_RULE}` },
                icon: { color: text.muted },
              }}
            >
              <Text size="xs" c={text.muted}>
                Bound by nothing. Not an error — a fill that no verb, stage, or
                other plugin resolves to. Safe to delete unless something
                outside this pack&apos;s manifest reaches it.
              </Text>
            </Alert>
          </Stack>
        ) : (
          <Stack gap="xs">
            {sites.map(site => (
              <SiteRow
                key={`${site.ref}:${site.slot}`}
                site={site}
                onShowInMap={() => onShowInMap(site)}
              />
            ))}
          </Stack>
        )}
      </Stack>
    </Drawer>
  );
}
