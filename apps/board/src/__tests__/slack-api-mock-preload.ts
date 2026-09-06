// Preloaded (via `bun --preload`) into the subprocess server.ts boots by
// server-slack-post-channel.test.ts, so slack.ts's real `https://slack.com/api/*`
// calls resolve locally instead of over the network. Each mocked channel name
// maps to its own distinguishable channel id, so a test can tell which channel
// name the caller resolved purely from the id embedded in the response.
const realFetch = globalThis.fetch;

const CHANNEL_IDS: Record<string, string> = {
  'code-review': 'C_DEFAULT',
  'acme-channel': 'C_ACME',
  'other-channel': 'C_OTHER',
};

function ok(data: Record<string, unknown>): Response {
  return new Response(JSON.stringify({ ok: true, ...data }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

function slackApi(method: string, params: Record<string, string>): Response {
  switch (method) {
    case 'auth.test':
      return ok({ url: 'https://mockteam.slack.com/' });
    case 'conversations.list':
      return ok({
        channels: Object.entries(CHANNEL_IDS).map(([name, id]) => ({
          id,
          name,
        })),
        response_metadata: { next_cursor: '' },
      });
    case 'conversations.history': {
      // SLACK_MOCK_MR_URL: the one MR url this test's channel index should
      // already show a review-request message for.
      const mrUrl = process.env.SLACK_MOCK_MR_URL;
      return ok({
        messages: mrUrl
          ? [{ ts: '100.000001', user: 'U1', text: `please review ${mrUrl}` }]
          : [],
        has_more: false,
      });
    }
    case 'reactions.get':
      return ok({ message: { reactions: [] } });
    case 'chat.postMessage':
      return ok({ ts: '200.000001' });
    default:
      return ok({});
  }
}

globalThis.fetch = (async (
  input: Parameters<typeof fetch>[0],
  init?: Parameters<typeof fetch>[1]
) => {
  const url =
    typeof input === 'string'
      ? input
      : input instanceof URL
        ? input.href
        : (input as Request).url;
  if (!url.startsWith('https://slack.com/api/'))
    return realFetch(input as never, init);
  const method = url.slice('https://slack.com/api/'.length).split('?')[0]!;
  const params: Record<string, string> = init?.body
    ? (JSON.parse(init.body as string) as Record<string, string>)
    : Object.fromEntries(new URL(url).searchParams);
  return slackApi(method, params);
}) as typeof fetch;
