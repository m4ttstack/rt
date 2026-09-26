import {
  ArrowDown,
  ArrowLeft,
  ArrowLeftToLine,
  ArrowRight,
  ArrowUp,
  Beaker,
  Bell,
  BookOpen,
  Calendar,
  Check,
  CheckCheck,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronsUpDown,
  ChevronUp,
  CircleCheckBig,
  CircleHelp,
  CircleX,
  Clock,
  Copy,
  Download,
  Ellipsis,
  EllipsisVertical,
  ExternalLink,
  Eye,
  EyeOff,
  Filter,
  FlaskConical,
  Info,
  Layers,
  Link,
  Lock,
  LogOut,
  Mail,
  Maximize2,
  Menu,
  Minimize2,
  Moon,
  Package,
  PanelLeft,
  PanelLeftOpen,
  Pencil,
  Pin,
  Plus,
  Printer,
  RefreshCw,
  RotateCcw,
  RotateCw,
  Save,
  Search,
  Send,
  Settings,
  Shield,
  Star,
  Sun,
  Terminal,
  ThumbsDown,
  ThumbsUp,
  Trash2,
  TriangleAlert,
  Undo,
  Upload,
  User,
  Users,
  Wrench,
  X,
  Zap,
} from 'lucide-react';

import { BrandIcons } from './brand-icons';
import { lucideWrapperFn } from './lucideWrapperFn';

// Common actions: trash, edit, copy, plus, download, upload, save, refresh,
// undo, search, filter, logout, print, send.
const ActionIcons = {
  trash: /* @__PURE__ */ lucideWrapperFn(Trash2),
  edit: /* @__PURE__ */ lucideWrapperFn(Pencil),
  copy: /* @__PURE__ */ lucideWrapperFn(Copy),
  plus: /* @__PURE__ */ lucideWrapperFn(Plus),
  download: /* @__PURE__ */ lucideWrapperFn(Download),
  upload: /* @__PURE__ */ lucideWrapperFn(Upload),
  save: /* @__PURE__ */ lucideWrapperFn(Save),
  refresh: /* @__PURE__ */ lucideWrapperFn(RefreshCw),
  undo: /* @__PURE__ */ lucideWrapperFn(Undo),
  search: /* @__PURE__ */ lucideWrapperFn(Search),
  filter: /* @__PURE__ */ lucideWrapperFn(Filter),
  logout: /* @__PURE__ */ lucideWrapperFn(LogOut),
  print: /* @__PURE__ */ lucideWrapperFn(Printer),
  send: /* @__PURE__ */ lucideWrapperFn(Send),
};

// Directional navigation: chevrons for disclosure/pagination controls,
// arrows for directional actions.
const NavigationIcons = {
  chevronDown: /* @__PURE__ */ lucideWrapperFn(ChevronDown),
  chevronUp: /* @__PURE__ */ lucideWrapperFn(ChevronUp),
  chevronLeft: /* @__PURE__ */ lucideWrapperFn(ChevronLeft),
  chevronRight: /* @__PURE__ */ lucideWrapperFn(ChevronRight),
  chevronsUpDown: /* @__PURE__ */ lucideWrapperFn(ChevronsUpDown),
  arrowLeft: /* @__PURE__ */ lucideWrapperFn(ArrowLeft),
  arrowLeftToLine: /* @__PURE__ */ lucideWrapperFn(ArrowLeftToLine),
  arrowRight: /* @__PURE__ */ lucideWrapperFn(ArrowRight),
  arrowUp: /* @__PURE__ */ lucideWrapperFn(ArrowUp),
  arrowDown: /* @__PURE__ */ lucideWrapperFn(ArrowDown),
};

// Chrome/controls: dismiss, resize, visibility toggles, theme, settings.
const UIControlIcons = {
  close: /* @__PURE__ */ lucideWrapperFn(X),
  settings: /* @__PURE__ */ lucideWrapperFn(Settings),
  maximize: /* @__PURE__ */ lucideWrapperFn(Maximize2),
  minimize: /* @__PURE__ */ lucideWrapperFn(Minimize2),
  eye: /* @__PURE__ */ lucideWrapperFn(Eye),
  eyeOff: /* @__PURE__ */ lucideWrapperFn(EyeOff),
  moreHorizontal: /* @__PURE__ */ lucideWrapperFn(Ellipsis),
  moreVertical: /* @__PURE__ */ lucideWrapperFn(EllipsisVertical),
  sun: /* @__PURE__ */ lucideWrapperFn(Sun),
  moon: /* @__PURE__ */ lucideWrapperFn(Moon),
  rotateCw: /* @__PURE__ */ lucideWrapperFn(RotateCw),
  rotateCcw: /* @__PURE__ */ lucideWrapperFn(RotateCcw),
  sidebar: /* @__PURE__ */ lucideWrapperFn(PanelLeft),
  panelLeftOpen: /* @__PURE__ */ lucideWrapperFn(PanelLeftOpen),
  menu: /* @__PURE__ */ lucideWrapperFn(Menu),
};

// Status/feedback.
const FeedbackIcons = {
  info: /* @__PURE__ */ lucideWrapperFn(Info),
  warning: /* @__PURE__ */ lucideWrapperFn(TriangleAlert),
  error: /* @__PURE__ */ lucideWrapperFn(CircleX),
  check: /* @__PURE__ */ lucideWrapperFn(Check),
  checkCheck: /* @__PURE__ */ lucideWrapperFn(CheckCheck),
  checkCircle: /* @__PURE__ */ lucideWrapperFn(CircleCheckBig),
  questionCircle: /* @__PURE__ */ lucideWrapperFn(CircleHelp),
};

// General-purpose, domain-agnostic icons that don't fit a category above.
const MiscIcons = {
  layers: /* @__PURE__ */ lucideWrapperFn(Layers),
  package: /* @__PURE__ */ lucideWrapperFn(Package),
  wrench: /* @__PURE__ */ lucideWrapperFn(Wrench),
  // Dev tools / experimental sections, which otherwise land on `wrench` or
  // `layers` and read as settings or stacking.
  flask: /* @__PURE__ */ lucideWrapperFn(FlaskConical),
  beaker: /* @__PURE__ */ lucideWrapperFn(Beaker),
  lock: /* @__PURE__ */ lucideWrapperFn(Lock),
  shield: /* @__PURE__ */ lucideWrapperFn(Shield),
  terminal: /* @__PURE__ */ lucideWrapperFn(Terminal),
  zap: /* @__PURE__ */ lucideWrapperFn(Zap),
  mail: /* @__PURE__ */ lucideWrapperFn(Mail),
  link: /* @__PURE__ */ lucideWrapperFn(Link),
  externalLink: /* @__PURE__ */ lucideWrapperFn(ExternalLink),
  calendar: /* @__PURE__ */ lucideWrapperFn(Calendar),
  clock: /* @__PURE__ */ lucideWrapperFn(Clock),
  star: /* @__PURE__ */ lucideWrapperFn(Star),
  user: /* @__PURE__ */ lucideWrapperFn(User),
  users: /* @__PURE__ */ lucideWrapperFn(Users),
  bell: /* @__PURE__ */ lucideWrapperFn(Bell),
  bookOpen: /* @__PURE__ */ lucideWrapperFn(BookOpen),
  thumbsUp: /* @__PURE__ */ lucideWrapperFn(ThumbsUp),
  thumbsDown: /* @__PURE__ */ lucideWrapperFn(ThumbsDown),
  pin: /* @__PURE__ */ lucideWrapperFn(Pin),
};

// Semantic aliases: names that describe the icon's ROLE rather than its
// glyph, mapped onto the same wrapped components. Both vocabularies
// autocomplete (e.g. `Icons.delete` and `Icons.trash` are the same icon).
// PURE-wrapped: the property reads (ActionIcons.trash, ...) are top-level
// side effects to the bundler and would pin this module into every consumer
// bundle even when no icon is used.
const SemanticAliases = /* @__PURE__ */ (() => ({
  delete: ActionIcons.trash,
  add: ActionIcons.plus,
  cancel: UIControlIcons.close,
  passwordShow: UIControlIcons.eye,
  passwordHide: UIControlIcons.eyeOff,
  help: FeedbackIcons.questionCircle,
  success: FeedbackIcons.checkCircle,
}))();

// The full icon registry. `IconName` (types.ts) is derived from this, so
// every key here becomes a valid `<Icon name="..." />` value.
//
// `...BrandIcons` starts empty (see ./brand-icons) -- spread last so a
// product's brand icons can shadow a generic name if it ever needs to.
export const Icons = /* @__PURE__ */ (() => ({
  ...ActionIcons,
  ...NavigationIcons,
  ...UIControlIcons,
  ...FeedbackIcons,
  ...MiscIcons,
  ...SemanticAliases,
  ...BrandIcons,
}))();

/**
 * The registry grouped by category, exported for icon galleries and docs
 * that want to present icons by group rather than one flat list.
 */
export const ICON_CATEGORIES = {
  Actions: ActionIcons,
  Navigation: NavigationIcons,
  Controls: UIControlIcons,
  Feedback: FeedbackIcons,
  Misc: MiscIcons,
} as const;

/**
 * Every registry name as a runtime list (typed as the `IconName` union) --
 * for icon pickers, galleries, and tests that enumerate the registry
 * instead of naming entries one by one. Derived from `Icons` itself, so it
 * can never drift from the registry.
 */
export const ICON_NAMES = /* @__PURE__ */ (() =>
  Object.keys(Icons) as (keyof typeof Icons)[])();
