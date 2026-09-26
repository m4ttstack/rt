/** The three review-signal reactions by role, as Slack emoji names (no colons).
    Adapt these to your workspace's convention — e.g. a custom `comment` emoji
    instead of the standard `speech_balloon`. */
export interface SlackEmojiConfig {
  looking: string;
  commented: string;
  approved: string;
}

/** Shared by the server config and the client (row marks, config modal
    placeholders) so the fallback the board applies is the one it displays. */
export const DEFAULT_SLACK_EMOJI: SlackEmojiConfig = {
  looking: 'eyes',
  commented: 'speech_balloon',
  approved: 'white_check_mark',
};
