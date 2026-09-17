import parser from "gitdiff-parser";
import type { ClientContext } from "./client.ts";
import type { DiffHunk, DiffLine, FileDiff } from "./types.ts";
import { rawGit } from "./exec.ts";

type ParsedFile = ReturnType<typeof parser.parse>[number];

function mapLines(hunk: ParsedFile["hunks"][number]): DiffLine[] {
  return hunk.changes.map((c): DiffLine => {
    if (c.type === "insert") {
      return { type: "add", content: c.content, oldLineNo: null, newLineNo: c.lineNumber };
    }
    if (c.type === "delete") {
      return { type: "del", content: c.content, oldLineNo: c.lineNumber, newLineNo: null };
    }
    return {
      type: "context",
      content: c.content,
      oldLineNo: c.oldLineNumber,
      newLineNo: c.newLineNumber,
    };
  });
}

function mapHunks(file: ParsedFile): DiffHunk[] {
  return file.hunks.map((h) => ({
    oldStart: h.oldStart,
    oldLines: h.oldLines,
    newStart: h.newStart,
    newLines: h.newLines,
    header: h.content,
    lines: mapLines(h),
  }));
}

export async function getFileDiff(
  ctx: ClientContext,
  path: string,
  opts: { staged?: boolean } = {},
): Promise<FileDiff> {
  const status = await ctx.git.status();
  const untracked = status.not_added.includes(path);

  let text: string;
  if (untracked) {
    text = await rawGit(ctx.dir, ["diff", "--no-index", "--", "/dev/null", path], { okCodes: [1] });
  } else {
    const args = opts.staged ? ["--cached", "--", path] : ["--", path];
    text = await ctx.git.diff(args);
  }

  if (text.trim() === "") return { path, kind: "text", hunks: [] };
  if (/^Binary files .* differ$/m.test(text) || text.includes("GIT binary patch")) {
    return { path, kind: "binary", hunks: [] };
  }
  if (/^[+-]Subproject commit /m.test(text)) {
    return { path, kind: "submodule", hunks: [] };
  }

  const files = parser.parse(text);
  const hunks = files.length > 0 ? mapHunks(files[0]!) : [];
  return { path, kind: "text", hunks };
}
