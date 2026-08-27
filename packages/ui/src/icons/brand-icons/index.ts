import type { IconComponent } from '../types';

// add your product's brand icons here
//
// This registry starts empty on purpose -- the kit ships no brand marks.
// Wrap each brand SVG so it satisfies the same IconComponent contract as
// the lucide-backed entries in Icons.ts (size/color/className, size
// defaulting to 16), then spread this object into Icons there.
//
// Example:
//
// import type { IconProps } from '../types';
// import { MyLogo } from './MyLogo';
//
// export const BrandIcons = {
//   myLogo: ({ size = 16, ...rest }: IconProps) => (
//     <MyLogo width={size} height={size} {...rest} />
//   ),
// } satisfies Record<string, IconComponent>;

// `satisfies` (rather than a type annotation) keeps the inferred type as
// the empty object literal `{}` -- no index signature -- so spreading this
// into Icons doesn't widen `IconName` to `string`.
export const BrandIcons = {} satisfies Record<string, IconComponent>;
