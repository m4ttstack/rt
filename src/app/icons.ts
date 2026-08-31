import { lucideWrapperFn, registerIcons } from '@mattstack/app-kit/icons';
import { FoldVertical, Hash, UnfoldVertical, UserPlus } from 'lucide-react'; // eslint-disable-line no-restricted-imports

registerIcons({
  hash: lucideWrapperFn(Hash),
  userPlus: lucideWrapperFn(UserPlus),
  unfoldVertical: lucideWrapperFn(UnfoldVertical),
  foldVertical: lucideWrapperFn(FoldVertical),
});
