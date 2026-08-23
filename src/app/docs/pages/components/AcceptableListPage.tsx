import { useRef, useState } from 'react';

import { AcceptableList, Button, Group, Stack, Text } from '@ui/core';
import { notifications } from '@ui/notifications';
import { ComponentDoc } from '../../ComponentDoc';
import { DocSection } from '../../DocPage';

const USAGE = [
  "import { AcceptableList } from '@ui/core';",
  '',
  '<AcceptableList',
  '  items={requests}',
  '  getItemId={request => request.id}',
  '  renderItemDetail={request => <Text>{request.summary}</Text>}',
  '  onAccept={request => acceptRequest(request)}',
  '  onDecline={request => declineRequest(request)}',
  '  onAcceptAll={() => acceptAllRequests()}',
  '  acceptingAll={acceptAllPending}',
  '  // per-row spinners while a mutation is in flight:',
  '  acceptingIds={pendingAcceptIds}',
  '  decliningIds={pendingDeclineIds}',
  '/>;',
].join('\n');

// Rows transcribed from src/ui/core/acceptable-list/AcceptableList.tsx
// (AcceptableListProps).
const PROPS_ROWS = [
  {
    name: 'items',
    type: 'T[]',
    note: 'Required. The rows. An empty array renders noItemsMessage instead.',
  },
  {
    name: 'getItemId',
    type: '(item: T) => string',
    note: 'Required. Stable identity for an item, used to key rows and look up accepting/declining state.',
  },
  {
    name: 'renderItemDetail',
    type: '(item: T) => ReactNode',
    note: "Required. Renders the row's content (left of the Accept/Decline buttons).",
  },
  {
    name: 'onAccept / onDecline',
    type: '(item: T) => void',
    note: "Required. Called with the row's item when its button is clicked.",
  },
  {
    name: 'onAcceptAll?',
    type: '() => void',
    note: 'Shows an "Accept All" button above the list when given.',
  },
  {
    name: 'acceptingAll?',
    type: 'boolean',
    note: 'Spinner on the Accept All button plus a loading overlay over the rows. Default false.',
  },
  {
    name: 'acceptAllButton?',
    type: 'ButtonProps & { label? }',
    note: "Customize the Accept All button; loading/loaderProps aren't allowed here (acceptingAll owns that).",
  },
  {
    name: 'acceptingIds? / decliningIds?',
    type: 'Set<string>',
    note: "Item ids currently mid-accept/mid-decline: that row's button shows a spinner and its sibling disables.",
  },
  {
    name: 'acceptLabel? / declineLabel?',
    type: 'string',
    note: "Row button labels. Defaults 'Accept' / 'Decline'.",
  },
  {
    name: 'noItemsMessage?',
    type: 'string',
    note: "Shown instead of the list when items is empty. Default 'No items to display'.",
  },
];

const DEMO_REQUESTS = [
  { id: 'req-1', who: 'Film club', what: 'field_camera_a for the weekend' },
  { id: 'req-2', who: 'Podcast team', what: 'podcast_mic_kit, 3 days' },
  { id: 'req-3', who: 'Photo workshop', what: 'light_panel_a + tripod_a' },
  { id: 'req-4', who: 'AV crew', what: 'projector_2 for one evening' },
];

type DemoRequest = (typeof DEMO_REQUESTS)[number];

/** Simulated-async accept/decline: each action spins for a moment (via
 * acceptingIds/decliningIds) before its row leaves the list; Accept All runs
 * the bulk overlay. */
function AcceptableListDemo() {
  const [items, setItems] = useState<DemoRequest[]>(DEMO_REQUESTS);
  const [acceptingIds, setAcceptingIds] = useState<Set<string>>(new Set());
  const [decliningIds, setDecliningIds] = useState<Set<string>>(new Set());
  const [acceptingAll, setAcceptingAll] = useState(false);
  // Demo timers survive re-renders and are irrelevant after unmount in a
  // docs page; the ref only exists so overlapping clicks don't fight.
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);

  const settle = (
    id: string,
    setPending: React.Dispatch<React.SetStateAction<Set<string>>>,
    verb: 'Accepted' | 'Declined'
  ) => {
    setPending(current => new Set(current).add(id));
    timers.current.push(
      setTimeout(() => {
        setPending(current => {
          const next = new Set(current);
          next.delete(id);
          return next;
        });
        setItems(current => current.filter(item => item.id !== id));
        if (verb === 'Accepted') notifications.success(`${verb} ${id}`);
        else notifications.info(`${verb} ${id}`);
      }, 700)
    );
  };

  const acceptAll = () => {
    setAcceptingAll(true);
    timers.current.push(
      setTimeout(() => {
        setAcceptingAll(false);
        setItems([]);
        notifications.success('Accepted every remaining request');
      }, 900)
    );
  };

  return (
    <Stack gap="sm">
      <AcceptableList
        items={items}
        getItemId={item => item.id}
        renderItemDetail={item => (
          <Stack gap={0}>
            <Text size="sm" fw={500}>
              {item.who}
            </Text>
            <Text size="sm" c="dimmed">
              {item.what}
            </Text>
          </Stack>
        )}
        onAccept={item => settle(item.id, setAcceptingIds, 'Accepted')}
        onDecline={item => settle(item.id, setDecliningIds, 'Declined')}
        onAcceptAll={acceptAll}
        acceptingAll={acceptingAll}
        acceptingIds={acceptingIds}
        decliningIds={decliningIds}
        noItemsMessage="No borrow requests waiting."
      />
      <Group justify="flex-end">
        <Button
          size="xs"
          variant="default"
          disabled={items.length === DEMO_REQUESTS.length}
          onClick={() => setItems(DEMO_REQUESTS)}
        >
          Reset demo
        </Button>
      </Group>
    </Stack>
  );
}

export function AcceptableListPage() {
  return (
    <ComponentDoc
      title="AcceptableList"
      lead="A scrollable list of items each carrying its own Accept/Decline actions, with an optional bulk Accept All -- the standard review-queue surface (borrow requests, invitations, pending changes)."
      demoIntro="Accept or decline a request (each simulates a short mutation: the clicked button spins via acceptingIds/decliningIds, its sibling disables, then the row leaves the list), or run Accept All for the bulk overlay."
      demo={<AcceptableListDemo />}
      usage={USAGE}
      usageMinHeight={330}
      propsTables={[{ title: 'Props', rows: PROPS_ROWS }]}
    >
      <DocSection title="Notes">
        <Text size="sm">
          The list is presentation only: it never removes rows itself. Your
          onAccept/onDecline handlers run the mutation and update items when it
          resolves, feeding acceptingIds/decliningIds in between so the affected
          row shows its in-flight state. The wrapping Paper sits on the
          kit&apos;s bg.level2 surface slot (with the default hairline border),
          matching SelectableList&apos;s surface, and the row area scrolls
          inside a 35dvh ScrollArea.
        </Text>
      </DocSection>
    </ComponentDoc>
  );
}
