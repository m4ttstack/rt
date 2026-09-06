import { lucideWrapperFn, registerIcons } from '@mattstack/app-kit/icons';
// The app's one sanctioned lucide import site, per app-kit's AGENTS.md §8
// registration contract.
// eslint-disable-next-line no-restricted-imports
import {
  FoldVertical,
  Hash,
  Inbox,
  MessageSquare,
  UnfoldVertical,
  UserPlus,
} from 'lucide-react';

registerIcons({
  hash: lucideWrapperFn(Hash),
  userPlus: lucideWrapperFn(UserPlus),
  unfoldVertical: lucideWrapperFn(UnfoldVertical),
  foldVertical: lucideWrapperFn(FoldVertical),
  inbox: lucideWrapperFn(Inbox),
  messageSquare: lucideWrapperFn(MessageSquare),
});
