// Every data-lucide name used in board.html must appear here: this bundle is a
// curated subset, and lucide silently leaves the <i> empty for a name it wasn't
// given. The empty tag still takes its slot in the button's flex gap, so a
// missing icon reads as text that will not centre rather than as an error.
// core/board-assets.test.ts pins the two lists together.
import {
  CircleCheck,
  ExternalLink,
  FileWarning,
  LockKeyhole,
  Pencil,
  Plus,
  RefreshCw,
  RotateCcw,
  Trash2,
  TriangleAlert,
  UserRoundCheck,
  createIcons,
} from "lucide";

createIcons({
  icons: {
    CircleCheck,
    ExternalLink,
    FileWarning,
    LockKeyhole,
    Pencil,
    Plus,
    RefreshCw,
    RotateCcw,
    Trash2,
    TriangleAlert,
    UserRoundCheck,
  },
  attrs: {
    width: 14,
    height: 14,
    "stroke-width": 2,
    style: "max-width: none",
  },
  inTemplates: true,
});
