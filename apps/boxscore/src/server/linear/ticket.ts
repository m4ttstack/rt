/**
 * Where "does this MR reference a team ticket" is defined. Depends only on shared/
 * and the store model types, so both the Linear fetch layer and the metric layer
 * share one rule.
 */
import { isRevertTitle } from '../../shared/reverts.js';
import type { NormMr } from '../store/model.js';

/** Build a regex that matches a Linear ticket ID for a specific team, e.g. "HUB-123" or "HUB:123". */
export function teamTicketRegex(team: string): RegExp | null {
  if (!team) return null;
  return new RegExp(`\\b${escapeRegex(team)}[-:]\\d+\\b`, 'i');
}

/** The MR text scanned for ticket references. */
export function mrTicketHaystack(
  mr: Pick<NormMr, 'title' | 'sourceBranch' | 'description'>
): string {
  return [mr.title, mr.sourceBranch, mr.description].filter(Boolean).join(' ');
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

const CLOSING_KEYWORD =
  'clos(?:e|es|ed|ing)|fix(?:es|ed|ing)?|resolv(?:e|es|ed|ing)|implement(?:s|ed|ing)?';

export type TextRefGrade = 'closing' | 'mention';

/**
 * Grade one MR's textual reference to a Linear identifier. Reverts cap at
 * "mention": their titles quote the original MR, so a title hit proves
 * nothing about implementing the ticket.
 */
export function textRefGrade(
  mr: Pick<NormMr, 'title' | 'sourceBranch' | 'description'>,
  identifier: string
): TextRefGrade | null {
  const [team, num] = identifier.split('-');
  if (!team || !num) return null;
  const t = escapeRegex(team);
  const idRe = new RegExp(`\\b${t}[-:]${num}\\b`, 'i');
  const branchRe = new RegExp(`\\b${t}[-_]${num}(?!\\d)`, 'i');
  const anywhere =
    idRe.test(mr.title) ||
    (mr.description !== null && idRe.test(mr.description)) ||
    (mr.sourceBranch !== null && branchRe.test(mr.sourceBranch));
  if (!anywhere) return null;
  if (isRevertTitle(mr.title)) return 'mention';
  if (idRe.test(mr.title)) return 'closing';
  if (mr.sourceBranch !== null && branchRe.test(mr.sourceBranch)) {
    return 'closing';
  }
  if (
    mr.description !== null &&
    new RegExp(
      `\\b(?:${CLOSING_KEYWORD})\\b[^\\n]{0,40}?\\b${t}[-:]${num}\\b`,
      'i'
    ).test(mr.description)
  ) {
    return 'closing';
  }
  return 'mention';
}
