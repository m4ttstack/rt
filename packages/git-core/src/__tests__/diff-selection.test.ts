import { describe, expect, test } from "bun:test";
import {
  DiffSelection,
  DiffSelectionType,
} from "../vendor/ghd/diff-selection.ts";

describe("DiffSelection", () => {
  test("fromInitialSelection(All) reports All and selects any line", () => {
    const s = DiffSelection.fromInitialSelection(DiffSelectionType.All);
    expect(s.getSelectionType()).toBe(DiffSelectionType.All);
    expect(s.isSelected(0)).toBe(true);
    expect(s.isSelected(41)).toBe(true);
  });

  test("fromInitialSelection(None) reports None and selects nothing", () => {
    const s = DiffSelection.fromInitialSelection(DiffSelectionType.None);
    expect(s.getSelectionType()).toBe(DiffSelectionType.None);
    expect(s.isSelected(7)).toBe(false);
  });

  test("withLineSelection diverges a single line to Partial", () => {
    const s = DiffSelection.fromInitialSelection(DiffSelectionType.All)
      .withLineSelection(3, false);
    expect(s.getSelectionType()).toBe(DiffSelectionType.Partial);
    expect(s.isSelected(3)).toBe(false);
    expect(s.isSelected(2)).toBe(true);
  });

  test("withToggleLineSelection twice restores the original state", () => {
    const s = DiffSelection.fromInitialSelection(DiffSelectionType.All)
      .withToggleLineSelection(5)
      .withToggleLineSelection(5);
    expect(s.getSelectionType()).toBe(DiffSelectionType.All);
  });

  test("withRangeSelection selects [from, from+length)", () => {
    const s = DiffSelection.fromInitialSelection(DiffSelectionType.None)
      .withRangeSelection(10, 3, true);
    expect(s.isSelected(9)).toBe(false);
    expect(s.isSelected(10)).toBe(true);
    expect(s.isSelected(12)).toBe(true);
    expect(s.isSelected(13)).toBe(false);
    expect(s.isRangeSelected(10, 3)).toBe(DiffSelectionType.All);
    expect(s.isRangeSelected(9, 3)).toBe(DiffSelectionType.Partial);
    expect(s.isRangeSelected(20, 2)).toBe(DiffSelectionType.None);
  });

  test("withSelectAll / withSelectNone collapse divergence", () => {
    const base = DiffSelection.fromInitialSelection(DiffSelectionType.All)
      .withLineSelection(1, false);
    expect(base.withSelectAll().getSelectionType()).toBe(DiffSelectionType.All);
    expect(base.withSelectNone().getSelectionType()).toBe(DiffSelectionType.None);
  });

  test("withSelectableLines: deselecting every selectable line reads as None", () => {
    const s = DiffSelection.fromInitialSelection(DiffSelectionType.All)
      .withSelectableLines(new Set([2, 4]))
      .withLineSelection(2, false)
      .withLineSelection(4, false);
    expect(s.getSelectionType()).toBe(DiffSelectionType.None);
  });

  test("withSelectableLines: isSelectable gates non-listed indices", () => {
    const s = DiffSelection.fromInitialSelection(DiffSelectionType.All)
      .withSelectableLines(new Set([2, 4]));
    expect(s.isSelectable(2)).toBe(true);
    expect(s.isSelectable(3)).toBe(false);
  });

  test("selection is immutable: with* returns a new object", () => {
    const a = DiffSelection.fromInitialSelection(DiffSelectionType.All);
    const b = a.withLineSelection(0, false);
    expect(a.isSelected(0)).toBe(true);
    expect(b.isSelected(0)).toBe(false);
  });
});
