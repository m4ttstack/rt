/**
 * Where "does this MR reference a team ticket" is defined. Depends only on shared/
 * and the store model types, so both the Linear fetch layer and the metric layer
 * share one rule.
 */
import { isRevertTitle } from '../../shared/reverts.js';
import type { NormMr } from '../store/model.js';

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
  // An identifier continuing as a kebab slug (acme-8010-reason-for-calling) is a
  // feature-flag or branch NAME, not a ticket reference; only branches may
  // earn closing grade from that shape.
  const plainRef = `\\b${t}[-:]${num}(?![-_]\\w)`;
  const anywhere =
    idRe.test(mr.title) ||
    (mr.description !== null && idRe.test(mr.description)) ||
    (mr.sourceBranch !== null && branchRe.test(mr.sourceBranch));
  if (!anywhere) return null;
  if (isRevertTitle(mr.title)) return 'mention';
  if (new RegExp(plainRef, 'i').test(mr.title)) return 'closing';
  if (mr.sourceBranch !== null && branchRe.test(mr.sourceBranch)) {
    return 'closing';
  }
  if (
    mr.description !== null &&
    new RegExp(
      `\\b(?:${CLOSING_KEYWORD})\\b[^\\n]{0,40}?${plainRef}`,
      'i'
    ).test(mr.description)
  ) {
    return 'closing';
  }
  return 'mention';
}
