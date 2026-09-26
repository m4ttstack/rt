import { renderWithProviders } from '@mattstack/app-kit/test-utils';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';

import './icons';

import type { ChatMessage } from '@mattstack/rt-client';

import type { InboxCard as InboxCardData } from '../server/inbox';
import { Reader } from './Reader';
import { fetchMock, installFetchMock } from './test-utils';

const NOW = Date.UTC(2026, 8, 2, 15, 20);

const card: InboxCardData = {
  room: 'boxscore',
  kind: 'room',
  messageId: 412,
  handle: 'jay',
  postedAt: NOW - 29 * 60_000,
  excerpt: '@matt metrics-hardening is ready for review.',
  reason: 'mention',
};

const opened: ChatMessage = {
  id: 412,
  room: 'boxscore',
  handle: 'jay',
  body: '@matt metrics-hardening is ready for review: PR #12.',
  mentions: ['matt'],
  postedAt: card.postedAt,
};

const predecessor: ChatMessage = {
  id: 407,
  room: 'boxscore',
  handle: 'max',
  body: '@jay when you pick metrics-hardening up: read every knob through getSetting.',
  mentions: ['jay'],
  postedAt: card.postedAt - 70 * 60_000,
};

function jsonResponse(body: unknown): Response {
  return { ok: true, status: 200, json: async () => body } as Response;
}

function serveWindow(messages: ChatMessage[]) {
  fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.startsWith('/api/chat/messages/'))
      return jsonResponse({ messages });
    return jsonResponse({});
  });
}

function renderReader(overrides: Partial<Parameters<typeof Reader>[0]> = {}) {
  const props = {
    card,
    buddies: [{ handle: 'jay', status: 'live' as const }],
    roomMembers: ['jay'],
    onOpenRoom: vi.fn(),
    onReplied: vi.fn(),
    ...overrides,
  };
  renderWithProviders(<Reader {...props} />);
  return props;
}

beforeEach(() => {
  installFetchMock();
});

afterEach(() => {
  vi.restoreAllMocks();
});

test('the reader asks for exactly the opened message and the one before it', async () => {
  serveWindow([predecessor, opened]);
  renderReader();
  await waitFor(() =>
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/chat/messages/boxscore?before=413&limit=2'
    )
  );
});

test('the message before it renders dimmed, under a label, above the divider', async () => {
  serveWindow([predecessor, opened]);
  renderReader();
  expect(await screen.findByTestId('reader-message-412')).toHaveTextContent(
    'metrics-hardening is ready for review'
  );
  const context = screen.getByTestId('reader-context-message');
  expect(context).toHaveTextContent('read every knob through getSetting');
  expect(screen.getByTestId('reader-context-label')).toHaveTextContent(
    'earlier in #boxscore'
  );
  expect(screen.getByTestId('reader-divider')).toHaveTextContent(
    'the message you opened'
  );
});

test('the room’s first message has no predecessor, so no label and no divider', async () => {
  serveWindow([opened]);
  renderReader();
  await screen.findByTestId('reader-message-412');
  expect(screen.queryByTestId('reader-context-message')).toBeNull();
  expect(screen.queryByTestId('reader-context-label')).toBeNull();
  expect(screen.queryByTestId('reader-divider')).toBeNull();
});

test('replying posts to the card’s room with the author pre-tagged, and moves no cursor', async () => {
  serveWindow([predecessor, opened]);
  const props = renderReader();
  await screen.findByTestId('reader-message-412');

  const box = screen.getByRole('textbox');
  expect(box).toHaveValue('@jay ');
  await userEvent.type(box, 'split the dashboard out{Enter}');

  await waitFor(() =>
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/chat/post',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          room: 'boxscore',
          body: '@jay split the dashboard out',
          mentions: ['jay'],
        }),
      })
    )
  );
  expect(fetchMock).not.toHaveBeenCalledWith(
    '/api/chat/mark',
    expect.anything()
  );
  await waitFor(() => expect(props.onReplied).toHaveBeenCalled());
});

test('no composer decoration, and nothing claims a reply marks read', async () => {
  serveWindow([opened]);
  renderReader();
  await screen.findByTestId('reader-message-412');
  expect(screen.queryByTestId('reader-footer-note')).toBeNull();
  expect(screen.queryByTestId('composer-kbd')).toBeNull();
  expect(screen.queryByText(/posting as/i)).toBeNull();
  expect(screen.queryByText(/marks this read/i)).toBeNull();
});

test('open #boxscore hands the room and the message back to the caller', async () => {
  serveWindow([opened]);
  const props = renderReader();
  await screen.findByTestId('reader-message-412');
  await userEvent.click(screen.getByTestId('reader-open-room'));
  expect(props.onOpenRoom).toHaveBeenCalledTimes(1);
});

test('phone: the header is back, ctx chip, "<handle> needs you", and open-room -- no reader-strip', async () => {
  serveWindow([opened]);
  const onBack = vi.fn();
  renderReader({ phone: true, onBack });
  await screen.findByTestId('reader-message-412');
  expect(screen.queryByTestId('reader-strip')).toBeNull();
  const header = screen.getByTestId('reader-phone-header');
  expect(header).toHaveTextContent('#boxscore');
  expect(header).toHaveTextContent('jay needs you');

  await userEvent.click(screen.getByTestId('reader-back'));
  expect(onBack).toHaveBeenCalledTimes(1);
});

test('phone: open-room still hands the room and message back to the caller', async () => {
  serveWindow([opened]);
  const props = renderReader({ phone: true, onBack: vi.fn() });
  await screen.findByTestId('reader-message-412');
  await userEvent.click(screen.getByTestId('reader-open-room'));
  expect(props.onOpenRoom).toHaveBeenCalledTimes(1);
});

test('phone: no composer decoration either, and no marks-read claim', async () => {
  serveWindow([opened]);
  renderReader({ phone: true, onBack: vi.fn() });
  await screen.findByTestId('reader-message-412');
  expect(screen.queryByTestId('reader-footer-note')).toBeNull();
  expect(screen.queryByText(/posting as/i)).toBeNull();
  expect(screen.queryByText(/marks this read/i)).toBeNull();
});

test('daemon down: the composer is disabled and keeps the pre-tagged draft', async () => {
  serveWindow([predecessor, opened]);
  renderReader({ daemonReachable: false });
  await screen.findByTestId('reader-message-412');
  const box = screen.getByRole('textbox');
  expect(box).toBeDisabled();
  expect(box).toHaveValue('@jay ');
  expect(
    screen.getByText(/rt daemon unreachable\. Your draft is kept\./i)
  ).toBeInTheDocument();
});
