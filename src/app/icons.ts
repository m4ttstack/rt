import { lucideWrapperFn, registerIcons } from '@mattstack/app-kit/icons';
import { Hash, UserPlus } from 'lucide-react'; // eslint-disable-line no-restricted-imports

registerIcons({
  hash: lucideWrapperFn(Hash),
  userPlus: lucideWrapperFn(UserPlus),
});
