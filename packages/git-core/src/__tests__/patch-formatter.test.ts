import { describe, expect, test } from 'bun:test'
import { DiffParser } from '../vendor/ghd/diff-parser'
import {
  DiffSelection,
  DiffSelectionType,
} from '../vendor/ghd/diff-selection'
import { AppFileStatusKind } from '../vendor/ghd/types'
import {
  formatPatch,
  formatPatchToDiscardChanges,
} from '../vendor/ghd/patch-formatter'

function parse(text: string) {
  return { hunks: new DiffParser().parse(text).hunks }
}

function target(
  path: string,
  kind: AppFileStatusKind,
  selection: DiffSelection
) {
  return { path, status: { kind }, selection }
}

describe('patch-formatter', () => {
  test('1. unselected deletions become context', () => {
    const diffText = [
      '--- a/file.md',
      '+++ b/file.md',
      '@@ -10,2 +10,4 @@',
      ' context',
      '-deleted line 1',
      '-deleted line 2',
      '+added line',
      ' context',
    ].join('\n')

    const diff = parse(diffText)
    let selection = DiffSelection.fromInitialSelection(DiffSelectionType.None)
    selection = selection.withLineSelection(4, true)

    const file = target('file.md', AppFileStatusKind.Modified, selection)
    const patch = formatPatch(file, diff)

    expect(patch).toBe('--- a/file.md\n+++ b/file.md\n@@ -10,4 +10,5 @@\n context\n deleted line 1\n deleted line 2\n+added line\n context\n')
  })

  test("2. unselected added lines are dropped entirely", () => {
    const diffText = [
      '--- a/file.md',
      '+++ b/file.md',
      '@@ -10,2 +10,4 @@',
      ' context',
      '+added line 1',
      '+added line 2',
      ' context',
    ].join('\n')

    const diff = parse(diffText)
    let selection = DiffSelection.fromInitialSelection(DiffSelectionType.None)
    selection = selection.withLineSelection(3, true)

    const file = target('file.md', AppFileStatusKind.Modified, selection)
    const patch = formatPatch(file, diff)

    const expected = `--- a/file.md
+++ b/file.md
@@ -10,2 +10,3 @@
 context
+added line 2
 context
`
    expect(patch).toBe(expected)
  })

  test('3. new-file header rewrite', () => {
    const diffText = [
      '--- /dev/null',
      '+++ b/file.md',
      '@@ -0,0 +1,2 @@',
      '+added line 1',
      '+added line 2',
    ].join('\n')

    const diff = parse(diffText)
    let selection = DiffSelection.fromInitialSelection(DiffSelectionType.None)
    selection = selection.withLineSelection(2, true)

    const file = target('file.md', AppFileStatusKind.New, selection)
    const patch = formatPatch(file, diff)

    const expected = `--- /dev/null
+++ b/file.md
@@ -0,0 +1 @@
+added line 2
`
    expect(patch).toBe(expected)
  })

  test('4. empty context line survives as bare space line', () => {
    const diffText = [
      '--- a/file.md',
      '+++ b/file.md',
      '@@ -1 +1,2 @@',
      ' ',
      '+added line 2',
    ].join('\n')

    const diff = parse(diffText)
    let selection = DiffSelection.fromInitialSelection(DiffSelectionType.None)
    selection = selection.withLineSelection(2, true)

    const file = target('file.md', AppFileStatusKind.Modified, selection)
    const patch = formatPatch(file, diff)

    expect(patch).toBe('--- a/file.md\n+++ b/file.md\n@@ -1 +1,2 @@\n \n+added line 2\n')
  })

  test('5. no-newline marker is re-emitted', () => {
    const diffText = [
      '--- a/file.md',
      '+++ b/file.md',
      '@@ -23,5 +24,5 @@ and more stuff',
      ' ',
      ' ',
      ' ',
      '-',
      '-and fun stuff? I dnno',
      '\\ No newline at end of file',
      '+and fun stuff? I dnno',
      '+it could be,',
    ].join('\n')

    const diff = parse(diffText)
    let selection = DiffSelection.fromInitialSelection(DiffSelectionType.None)
    selection = selection.withLineSelection(7, true)

    const file = target('file.md', AppFileStatusKind.Modified, selection)
    const patch = formatPatch(file, diff)

    expect(patch).toBe('--- a/file.md\n+++ b/file.md\n@@ -23,5 +24,6 @@\n \n \n \n \n and fun stuff? I dnno\n\\ No newline at end of file\n+it could be,\n')
  })

  test('6. hunk 2 of 2 selected, header renumbered', () => {
    const diffText = [
      '--- a/file.md',
      '+++ b/file.md',
      '@@ -1,2 +1,2 @@',
      ' a',
      ' b',
      '@@ -5,1 +5,3 @@',
      ' x',
      '+y2',
      '+z',
    ].join('\n')

    const diff = parse(diffText)
    let selection = DiffSelection.fromInitialSelection(DiffSelectionType.All)
    selection = selection.withRangeSelection(0, 2, false)
    selection = selection.withLineSelection(3, true)

    const file = target('file.md', AppFileStatusKind.Modified, selection)
    const patch = formatPatch(file, diff)

    expect(patch).toBe('--- a/file.md\n+++ b/file.md\n@@ -5 +5,3 @@\n x\n+y2\n+z\n')
  })

  test('7. empty selection throws for formatPatch and returns null for discard', () => {
    const diffText = [
      '--- a/file.md',
      '+++ b/file.md',
      '@@ -1 +1,2 @@',
      ' a',
      '+b',
    ].join('\n')

    const diff = parse(diffText)
    const selection = DiffSelection.fromInitialSelection(DiffSelectionType.None)

    const file = target('file.md', AppFileStatusKind.Modified, selection)

    expect(() => {
      formatPatch(file, diff)
    }).toThrow('Could not generate a patch, no changes')

    const discardResult = formatPatchToDiscardChanges('file.md', diff, selection)
    expect(discardResult).toBeNull()
  })

  test('8. discard patch is pre-reversed', () => {
    const diffText = [
      '--- a/file.md',
      '+++ b/file.md',
      '@@ -1 +1 @@',
      '-old',
      '+new',
    ].join('\n')

    const diff = parse(diffText)
    const selection = DiffSelection.fromInitialSelection(DiffSelectionType.All)

    const discardPatch = formatPatchToDiscardChanges('file.md', diff, selection)

    const expected = `--- a/file.md
+++ b/file.md
@@ -1 +1 @@
+old
-new
`
    expect(discardPatch).toBe(expected)
  })
})
