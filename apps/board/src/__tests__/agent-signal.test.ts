import { describe, expect, test } from 'bun:test';

import {
  AGENT_STATUS_TOPIC_PREFIX,
  agentStatusTopic,
  isSignalKind,
  parseAgentSignal,
  parseAgentStatusPayload,
  signalEmoji,
  type AgentSignal,
  type AgentStatusPayload,
} from '../agent-signal.ts';

const noLookup = (): number => {
  throw new Error('lookupIid should not be called on the /agent/status path');
};

/** The CLI's payload rides the bus as JSON and comes back out of the journal
    the same way, so round-tripping through JSON here is exactly what the feed
    parses -- these tests break if either side of the contract drifts. */
function wireBody(signal: AgentSignal): unknown {
  return JSON.parse(JSON.stringify(signal));
}

/** A workspace convention with a custom emoji, like the one this board grew up in. */
const EMOJI = {
  looking: 'eyes',
  commented: 'comment',
  approved: 'white_check_mark',
};

describe('signalEmoji', () => {
  test('a review that has started gets the looking emoji', () => {
    expect(signalEmoji('review', 'reviewing', EMOJI)).toBe('eyes');
  });

  test('a review that landed as a comment gets the configured commented emoji', () => {
    expect(signalEmoji('review', 'done', EMOJI, 'comment')).toBe('comment');
    expect(
      signalEmoji(
        'review',
        'done',
        { ...EMOJI, commented: 'speech_balloon' },
        'comment'
      )
    ).toBe('speech_balloon');
  });

  test('a review that landed as an approval gets the check', () => {
    expect(signalEmoji('review', 'done', EMOJI, 'approve')).toBe(
      'white_check_mark'
    );
  });

  test('done without an outcome signals nothing -- the human never answered the gate', () => {
    expect(signalEmoji('review', 'done', EMOJI)).toBeNull();
    expect(signalEmoji('review', 'done', EMOJI, '')).toBeNull();
  });

  test('an unknown outcome signals nothing rather than guessing', () => {
    expect(signalEmoji('review', 'done', EMOJI, 'approved')).toBeNull();
  });

  test('queued and error signal nothing', () => {
    expect(signalEmoji('review', 'queued', EMOJI)).toBeNull();
    expect(signalEmoji('review', 'error', EMOJI)).toBeNull();
  });

  test('respond and doctor have no policy yet', () => {
    expect(signalEmoji('respond', 'drafting', EMOJI)).toBeNull();
    expect(signalEmoji('respond', 'done', EMOJI)).toBeNull();
    expect(signalEmoji('doctor', 'watching', EMOJI)).toBeNull();
    expect(signalEmoji('doctor', 'done', EMOJI)).toBeNull();
  });
});

describe('isSignalKind', () => {
  test('accepts the three launch kinds', () => {
    expect(isSignalKind('review')).toBe(true);
    expect(isSignalKind('respond')).toBe(true);
    expect(isSignalKind('doctor')).toBe(true);
  });

  test('rejects anything else', () => {
    expect(isSignalKind('reviews')).toBe(false);
    expect(isSignalKind('')).toBe(false);
    expect(isSignalKind(undefined)).toBe(false);
    expect(isSignalKind(3)).toBe(false);
  });
});

describe('agentStatusTopic', () => {
  test('one segment per launch kind under the shared prefix', () => {
    expect(AGENT_STATUS_TOPIC_PREFIX).toBe('board/agent-status/');
    expect(agentStatusTopic('review')).toBe('board/agent-status/review');
    expect(agentStatusTopic('respond')).toBe('board/agent-status/respond');
    expect(agentStatusTopic('doctor')).toBe('board/agent-status/doctor');
  });
});

describe('parseAgentStatusPayload', () => {
  const full: AgentStatusPayload = {
    mrUrl: 'https://gitlab.com/acme/webapp/-/merge_requests/4821',
    iid: 4821,
    kind: 'review',
    status: 'done',
    outcome: 'comment',
    appRoot: '/Users/dev/board',
  };

  test('accepts exactly what the journal hands back for a done+comment signal', () => {
    expect(parseAgentStatusPayload(wireBody(full))).toEqual(full);
  });

  test('a payload with no outcome parses with outcome undefined', () => {
    const { outcome: _outcome, ...noOutcome } = full;
    expect(parseAgentStatusPayload(wireBody(noOutcome))).toEqual({
      ...noOutcome,
      outcome: undefined,
    });
  });

  test('rejects a missing or empty appRoot -- the pre-bus shape is not a bus payload', () => {
    const { appRoot: _appRoot, ...legacy } = full;
    expect(parseAgentStatusPayload(legacy)).toBeNull();
    expect(parseAgentStatusPayload({ ...full, appRoot: '' })).toBeNull();
    expect(parseAgentStatusPayload({ ...full, appRoot: 7 })).toBeNull();
  });

  test('rejects a missing or empty mrUrl', () => {
    expect(parseAgentStatusPayload({ ...full, mrUrl: undefined })).toBeNull();
    expect(parseAgentStatusPayload({ ...full, mrUrl: '' })).toBeNull();
  });

  test('rejects a kind that is not one of the three', () => {
    expect(parseAgentStatusPayload({ ...full, kind: 'deploy' })).toBeNull();
  });

  test('rejects a missing or empty status', () => {
    expect(parseAgentStatusPayload({ ...full, status: undefined })).toBeNull();
    expect(parseAgentStatusPayload({ ...full, status: '' })).toBeNull();
  });

  test('rejects a non-numeric or non-finite iid', () => {
    expect(parseAgentStatusPayload({ ...full, iid: '4821' })).toBeNull();
    expect(parseAgentStatusPayload({ ...full, iid: Infinity })).toBeNull();
    expect(parseAgentStatusPayload({ ...full, iid: NaN })).toBeNull();
  });

  test('rejects a non-string outcome', () => {
    expect(parseAgentStatusPayload({ ...full, outcome: 1 })).toBeNull();
  });

  test('rejects a non-object body', () => {
    expect(parseAgentStatusPayload(null)).toBeNull();
    expect(parseAgentStatusPayload('nope')).toBeNull();
    expect(parseAgentStatusPayload(42)).toBeNull();
  });
});

describe('parseAgentSignal', () => {
  test('accepts exactly the body notifyBoard posts for a reviewing signal (no outcome)', () => {
    const signal: AgentSignal = {
      mrUrl: 'https://gitlab.com/acme/webapp/-/merge_requests/4821',
      iid: 4821,
      kind: 'review',
      status: 'reviewing',
    };
    const parsed = parseAgentSignal(
      wireBody(signal),
      '/agent/status',
      noLookup
    );
    expect(parsed?.mrUrl).toBe(signal.mrUrl);
    expect(parsed?.iid).toBe(signal.iid);
    expect(parsed?.kind).toBe(signal.kind);
    expect(parsed?.status).toBe(signal.status);
    expect(parsed?.outcome).toBeUndefined();
  });

  test('accepts exactly the body notifyBoard posts for a done+approve signal', () => {
    const signal: AgentSignal = {
      mrUrl: 'https://gitlab.com/acme/webapp/-/merge_requests/4821',
      iid: 4821,
      kind: 'review',
      status: 'done',
      outcome: 'approve',
    };
    const parsed = parseAgentSignal(
      wireBody(signal),
      '/agent/status',
      noLookup
    );
    expect(parsed?.mrUrl).toBe(signal.mrUrl);
    expect(parsed?.iid).toBe(signal.iid);
    expect(parsed?.kind).toBe(signal.kind);
    expect(parsed?.status).toBe(signal.status);
    expect(parsed?.outcome).toBe('approve');
  });

  test('a body with no outcome parses -- the common case for most transitions', () => {
    const parsed = parseAgentSignal(
      {
        mrUrl: 'https://gitlab.com/acme/webapp/-/merge_requests/1',
        iid: 1,
        kind: 'doctor',
        status: 'rebasing',
      },
      '/agent/status',
      noLookup
    );
    expect(parsed).toEqual({
      mrUrl: 'https://gitlab.com/acme/webapp/-/merge_requests/1',
      iid: 1,
      kind: 'doctor',
      status: 'rebasing',
      outcome: undefined,
    });
  });

  const base = {
    mrUrl: 'https://gitlab.com/acme/webapp/-/merge_requests/1',
    iid: 1,
    kind: 'review',
    status: 'reviewing',
  };

  test('rejects a missing or empty mrUrl', () => {
    expect(
      parseAgentSignal({ ...base, mrUrl: undefined }, '/agent/status', noLookup)
    ).toBeNull();
    expect(
      parseAgentSignal({ ...base, mrUrl: '' }, '/agent/status', noLookup)
    ).toBeNull();
  });

  test('rejects a non-string mrUrl', () => {
    expect(
      parseAgentSignal({ ...base, mrUrl: 123 }, '/agent/status', noLookup)
    ).toBeNull();
  });

  test('rejects a kind that is not one of the three', () => {
    expect(
      parseAgentSignal({ ...base, kind: 'deploy' }, '/agent/status', noLookup)
    ).toBeNull();
  });

  test('rejects a missing or empty status', () => {
    expect(
      parseAgentSignal(
        { ...base, status: undefined },
        '/agent/status',
        noLookup
      )
    ).toBeNull();
    expect(
      parseAgentSignal({ ...base, status: '' }, '/agent/status', noLookup)
    ).toBeNull();
  });

  test('rejects a non-numeric or non-finite iid', () => {
    expect(
      parseAgentSignal({ ...base, iid: '4821' }, '/agent/status', noLookup)
    ).toBeNull();
    expect(
      parseAgentSignal({ ...base, iid: Infinity }, '/agent/status', noLookup)
    ).toBeNull();
    expect(
      parseAgentSignal({ ...base, iid: NaN }, '/agent/status', noLookup)
    ).toBeNull();
  });

  test('rejects a non-string outcome', () => {
    expect(
      parseAgentSignal({ ...base, outcome: 1 }, '/agent/status', noLookup)
    ).toBeNull();
  });

  test('rejects a non-object body', () => {
    expect(parseAgentSignal(null, '/agent/status', noLookup)).toBeNull();
    expect(parseAgentSignal('nope', '/agent/status', noLookup)).toBeNull();
    expect(parseAgentSignal(42, '/agent/status', noLookup)).toBeNull();
  });

  test('the /review/outcome alias fills kind, status, and the iid from the injected lookup', () => {
    const lookup = (mrUrl: string): number => {
      expect(mrUrl).toBe(
        'https://gitlab.com/acme/webapp/-/merge_requests/4821'
      );
      return 4821;
    };
    const parsed = parseAgentSignal(
      {
        mrUrl: 'https://gitlab.com/acme/webapp/-/merge_requests/4821',
        outcome: 'comment',
      },
      '/review/outcome',
      lookup
    );
    expect(parsed).toEqual({
      mrUrl: 'https://gitlab.com/acme/webapp/-/merge_requests/4821',
      iid: 4821,
      kind: 'review',
      status: 'done',
      outcome: 'comment',
    });
  });
});
