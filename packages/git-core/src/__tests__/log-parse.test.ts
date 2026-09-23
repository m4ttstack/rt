import { describe, expect, it } from "bun:test";
import {
  createLogParser,
  extractCoAuthors,
  isCoAuthoredByTrailer,
  parseGitAuthor,
  parseIdentity,
  parseRawLogWithNumstat,
  parseRawUnfoldedTrailers,
} from "../vendor/ghd/log-parse.ts";
import { AppFileStatusKind } from "../vendor/ghd/types.ts";

describe("vendored GHD log parsers", () => {
  it("createLogParser splits NUL-terminated records into named fields", () => {
    const { formatArgs, parse } = createLogParser({ sha: "%H", summary: "%s" });
    expect(formatArgs).toEqual(["-z", "--format=%H%x00%s"]);
    expect(parse("aaa\0first\0bbb\0second\0")).toEqual([
      { sha: "aaa", summary: "first" },
      { sha: "bbb", summary: "second" },
    ]);
    expect(parse("")).toEqual([]);
  });

  it("parseIdentity reads git's raw date and timezone", () => {
    const id = parseIdentity("Pat Doe <pat@example.com> 1700000000 -0530");
    expect(id.name).toBe("Pat Doe");
    expect(id.email).toBe("pat@example.com");
    expect(id.date.getTime()).toBe(1700000000 * 1000);
    expect(id.tzOffset).toBe(-330);
    expect(() => parseIdentity("garbage")).toThrow();
  });

  it("parses unfolded trailers and picks co-authors case-insensitively", () => {
    const trailers = parseRawUnfoldedTrailers("Co-authored-by: Sam <sam@example.com>\nSigned-off-by: Pat <pat@example.com>\n", ":");
    expect(trailers).toEqual([
      { token: "Co-authored-by", value: "Sam <sam@example.com>" },
      { token: "Signed-off-by", value: "Pat <pat@example.com>" },
    ]);
    expect(trailers.filter(isCoAuthoredByTrailer).length).toBe(1);
    expect(extractCoAuthors(trailers)).toEqual([{ name: "Sam", email: "sam@example.com" }]);
    expect(parseGitAuthor("no brackets")).toBeNull();
  });

  it("parseRawLogWithNumstat reads plain, renamed, and submodule entries", () => {
    const stdout = [
      ":100644 100644 5716ca5 db3c77d M", "a.txt",
      ":100644 100644 0835e4f 28096ea R087", "old.md", "new.md",
      ":000000 160000 0000000 28096ea A", "sub",
      "3\t1\ta.txt",
      "2\t2\t", "old.md", "new.md",
      "1\t0\tsub",
      "",
    ].join("\0");
    const data = parseRawLogWithNumstat(stdout, "abc", "abc^");
    expect(data.linesAdded).toBe(6);
    expect(data.linesDeleted).toBe(3);
    expect(data.files.map((f) => f.path)).toEqual(["a.txt", "new.md", "sub"]);
    expect(data.files[0]!.status).toEqual({ kind: AppFileStatusKind.Modified, submoduleStatus: undefined });
    expect(data.files[1]!.status).toEqual({
      kind: AppFileStatusKind.Renamed,
      oldPath: "old.md",
      submoduleStatus: undefined,
      renameIncludesModifications: true,
    });
    expect(data.files[2]!.status.submoduleStatus).toEqual({ commitChanged: false, untrackedChanges: false, modifiedChanges: false });
    expect(data.files[0]!.commitish).toBe("abc");
    expect(data.files[0]!.parentCommitish).toBe("abc^");
  });

  it("a binary numstat entry ('-') counts as zero lines", () => {
    const stdout = [":100644 100644 aaa bbb M", "img.png", "-\t-\timg.png", ""].join("\0");
    const data = parseRawLogWithNumstat(stdout, "s", "s^");
    expect(data.linesAdded).toBe(0);
    expect(data.linesDeleted).toBe(0);
  });
});
