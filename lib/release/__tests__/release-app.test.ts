import { describe, expect, test } from "bun:test";
import { bumpPatch, nextPatchTag, noteSubject, notesHash, renderNotes } from "../release-app.ts";

const EM = String.fromCharCode(0x2014);
const EN = String.fromCharCode(0x2013);

describe("versions", () => {
  test("bumpPatch bumps the last numeric segment", () => {
    expect(bumpPatch("0.1.7")).toBe("0.1.8");
    expect(bumpPatch("1.1.9")).toBe("1.1.10");
  });

  test("bumpPatch refuses anything that is not X.Y.Z", () => {
    expect(() => bumpPatch("0.1")).toThrow("X.Y.Z");
    expect(() => bumpPatch("0.1.7-beta")).toThrow("X.Y.Z");
  });

  test("nextPatchTag keeps the v prefix", () => {
    expect(nextPatchTag("v2.13.1")).toBe("v2.13.2");
    expect(() => nextPatchTag("2.13.1")).toThrow("vX.Y.Z");
  });
});

describe("notes", () => {
  test("noteSubject replaces em and en dashes", () => {
    const out = noteSubject(`fix the pane ${EM} for real ${EN} again`);
    expect(out).not.toContain(EM);
    expect(out).not.toContain(EN);
    expect(out).toBe("fix the pane... for real... again");
  });

  test("noteSubject trims but otherwise leaves a subject alone", () => {
    expect(noteSubject("  board: serve a setup page (#156)  ")).toBe("board: serve a setup page (#156)");
  });

  test("renderNotes writes a lead line, one section per app, and the Full Changelog link", () => {
    const notes = renderNotes({
      lastTag: "v2.13.1",
      nextTag: "v2.13.2",
      sections: [{ app: "board", subjects: ["board: serve a setup page (#156)", "board: tidy the header"] }],
    });
    expect(notes).toBe([
      "A patch release that ships board.",
      "",
      "### board",
      "",
      "- board: serve a setup page (#156)",
      "- board: tidy the header",
      "",
      "**Full Changelog**: https://github.com/m4ttstack/rt/compare/v2.13.1...v2.13.2",
      "",
    ].join("\n"));
  });

  test("renderNotes lists every moved app in the lead and says so when an app has no subjects", () => {
    const notes = renderNotes({
      lastTag: "v2.13.1",
      nextTag: "v2.13.2",
      sections: [
        { app: "board", subjects: ["a"] },
        { app: "chat", subjects: [] },
        { app: "console", subjects: ["b"] },
      ],
    });
    expect(notes.split("\n")[0]).toBe("A patch release that ships board, chat and console.");
    expect(notes).toContain("### chat\n\n- no other commits under apps/chat\n");
  });
});

describe("approval", () => {
  test("notesHash is a stable 12-hex digest of the exact notes", () => {
    expect(notesHash("a\n")).toMatch(/^[0-9a-f]{12}$/);
    expect(notesHash("a\n")).toBe(notesHash("a\n"));
    expect(notesHash("a\n")).not.toBe(notesHash("a \n"));
  });
});
