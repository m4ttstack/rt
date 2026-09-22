import { AppFileStatusKind } from './types'
import { forceUnwrap } from './fatal-error'

// File mode 160000 is used by git specifically for submodules:
// https://github.com/git/git/blob/v2.37.3/cache.h#L62-L69
const SubmoduleFileMode = '160000'

export type SubmoduleStatus = {
  readonly commitChanged: boolean
  readonly modifiedChanges: boolean
  readonly untrackedChanges: boolean
}

export type PlainFileStatus = {
  kind:
    | AppFileStatusKind.New
    | AppFileStatusKind.Modified
    | AppFileStatusKind.Deleted
  submoduleStatus?: SubmoduleStatus
}

export type CopiedOrRenamedFileStatus = {
  kind: AppFileStatusKind.Copied | AppFileStatusKind.Renamed
  oldPath: string
  renameIncludesModifications: boolean
  submoduleStatus?: SubmoduleStatus
}

export type UntrackedFileStatus = {
  kind: AppFileStatusKind.Untracked
  submoduleStatus?: SubmoduleStatus
}

export type CommittedFileStatus =
  | PlainFileStatus
  | CopiedOrRenamedFileStatus
  | UntrackedFileStatus

/** GHD's CommittedFileChange class, as a plain record. */
export interface CommittedFileChange {
  readonly path: string
  readonly status: CommittedFileStatus
  readonly commitish: string
  readonly parentCommitish: string
}

export interface IChangesetData {
  readonly files: ReadonlyArray<CommittedFileChange>
  readonly linesAdded: number
  readonly linesDeleted: number
}

export interface ITrailer {
  readonly token: string
  readonly value: string
}

/** GHD's CommitIdentity class, as a plain record. */
export interface CommitIdentity {
  readonly name: string
  readonly email: string
  readonly date: Date
  readonly tzOffset: number
}

/** GHD's GitAuthor class, as a plain record. */
export interface GitAuthor {
  readonly name: string
  readonly email: string
}

export function createLogParser<T extends Record<string, string>>(fields: T) {
  const keys: Array<keyof T> = Object.keys(fields)
  const format = Object.values(fields).join('%x00')
  const formatArgs = ['-z', `--format=${format}`]

  const parse = (value: string) => {
    const records = value.split('\0')
    const entries = new Array<{ [K in keyof T]: string }>()

    for (let i = 0; i < records.length - keys.length; i += keys.length) {
      const entry = {} as { [K in keyof T]: string }
      keys.forEach((key, ix) => (entry[key] = records[i + ix]!))
      entries.push(entry)
    }

    return entries
  }

  return { formatArgs, parse }
}

export function parseIdentity(identity: string): CommitIdentity {
  const m = identity.match(/^(.*?) <(.*?)> (\d+) (\+|-)?(\d{2})(\d{2})/)
  if (!m) {
    throw new Error(`Couldn't parse identity ${identity}`)
  }

  const name = m[1]!
  const email = m[2]!
  const date = new Date(parseInt(m[3]!, 10) * 1000)

  if (isNaN(date.valueOf())) {
    throw new Error(`Couldn't parse identity ${identity}, invalid date`)
  }

  const tzSign = m[4] === '-' ? '-' : '+'
  const tzMinutes = parseInt(m[5]!, 10) * 60 + parseInt(m[6]!, 10)
  const tzOffset = tzMinutes * (tzSign === '-' ? -1 : 1)

  return { name, email, date, tzOffset }
}

export function parseSingleUnfoldedTrailer(
  line: string,
  separators: string
): ITrailer | null {
  for (const separator of separators) {
    const ix = line.indexOf(separator)
    if (ix > 0) {
      return {
        token: line.substring(0, ix).trim(),
        value: line.substring(ix + 1).trim(),
      }
    }
  }

  return null
}

export function parseRawUnfoldedTrailers(trailers: string, separators: string) {
  const lines = trailers.split('\n')
  const parsedTrailers = new Array<ITrailer>()

  for (const line of lines) {
    const trailer = parseSingleUnfoldedTrailer(line, separators)

    if (trailer) {
      parsedTrailers.push(trailer)
    }
  }

  return parsedTrailers
}

export function isCoAuthoredByTrailer(trailer: ITrailer) {
  return trailer.token.toLowerCase() === 'co-authored-by'
}

export function parseGitAuthor(nameAddr: string): GitAuthor | null {
  const m = nameAddr.match(/^(.*?)\s+<(.*?)>/)
  return m === null ? null : { name: m[1]!, email: m[2]! }
}

export function extractCoAuthors(trailers: ReadonlyArray<ITrailer>) {
  const coAuthors = new Array<GitAuthor>()

  for (const trailer of trailers) {
    if (isCoAuthoredByTrailer(trailer)) {
      const author = parseGitAuthor(trailer.value)
      if (author) {
        coAuthors.push(author)
      }
    }
  }

  return coAuthors
}

function mapSubmoduleStatusFileModes(
  status: string,
  srcMode: string,
  dstMode: string
): SubmoduleStatus | undefined {
  return srcMode === SubmoduleFileMode &&
    dstMode === SubmoduleFileMode &&
    status === 'M'
    ? {
        commitChanged: true,
        untrackedChanges: false,
        modifiedChanges: false,
      }
    : (srcMode === SubmoduleFileMode && status === 'D') ||
      (dstMode === SubmoduleFileMode && status === 'A')
    ? {
        commitChanged: false,
        untrackedChanges: false,
        modifiedChanges: false,
      }
    : undefined
}

export function mapStatus(
  rawStatus: string,
  oldPath: string | undefined,
  srcMode: string,
  dstMode: string
): CommittedFileStatus {
  const status = rawStatus.trim()
  const submoduleStatus = mapSubmoduleStatusFileModes(status, srcMode, dstMode)

  if (status === 'M') {
    return { kind: AppFileStatusKind.Modified, submoduleStatus }
  } // modified
  if (status === 'A') {
    return { kind: AppFileStatusKind.New, submoduleStatus }
  } // added
  if (status === '?') {
    return { kind: AppFileStatusKind.Untracked, submoduleStatus }
  } // untracked
  if (status === 'D') {
    return { kind: AppFileStatusKind.Deleted, submoduleStatus }
  } // deleted
  if (status === 'R' && oldPath != null) {
    return {
      kind: AppFileStatusKind.Renamed,
      oldPath,
      submoduleStatus,
      renameIncludesModifications: false,
    }
  } // renamed
  if (status === 'C' && oldPath != null) {
    return {
      kind: AppFileStatusKind.Copied,
      oldPath,
      submoduleStatus,
      renameIncludesModifications: false,
    }
  } // copied

  // git log -M --name-status will return a RXXX - where XXX is a percentage
  if (status.match(/R[0-9]+/) && oldPath != null) {
    return {
      kind: AppFileStatusKind.Renamed,
      oldPath,
      submoduleStatus,
      renameIncludesModifications: status !== 'R100',
    }
  }

  // git log -C --name-status will return a CXXX - where XXX is a percentage
  if (status.match(/C[0-9]+/) && oldPath != null) {
    return {
      kind: AppFileStatusKind.Copied,
      oldPath,
      submoduleStatus,
      renameIncludesModifications: false,
    }
  }

  return { kind: AppFileStatusKind.Modified, submoduleStatus }
}

const isCopyOrRename = (
  status: CommittedFileStatus
): status is CopiedOrRenamedFileStatus =>
  status.kind === AppFileStatusKind.Copied ||
  status.kind === AppFileStatusKind.Renamed

export function parseRawLogWithNumstat(
  stdout: string,
  sha: string,
  parentCommitish: string
): IChangesetData {
  const files = new Array<CommittedFileChange>()
  let linesAdded = 0
  let linesDeleted = 0
  let numStatCount = 0
  const lines = stdout.split('\0')

  for (let i = 0; i < lines.length - 1; i++) {
    const line = lines[i]!
    if (line.startsWith(':')) {
      const lineComponents = line.split(' ')
      const srcMode = forceUnwrap(
        'Invalid log output (srcMode)',
        lineComponents[0]?.replace(':', '')
      )
      const dstMode = forceUnwrap(
        'Invalid log output (dstMode)',
        lineComponents[1]
      )
      const status = forceUnwrap(
        'Invalid log output (status)',
        lineComponents.at(-1)
      )
      const oldPath = /^R|C/.test(status)
        ? forceUnwrap('Missing old path', lines.at(++i))
        : undefined

      const path = forceUnwrap('Missing path', lines.at(++i))

      files.push({
        path,
        status: mapStatus(status, oldPath, srcMode, dstMode),
        commitish: sha,
        parentCommitish,
      })
    } else {
      const match = /^(\d+|-)\t(\d+|-)\t/.exec(line)
      const [, added, deleted] = forceUnwrap('Invalid numstat line', match)
      linesAdded += added === '-' ? 0 : parseInt(added!, 10)
      linesDeleted += deleted === '-' ? 0 : parseInt(deleted!, 10)

      // If this entry denotes a rename or copy the old and new paths are on
      // two separate fields (separated by \0). Otherwise they're on the same
      // line as the added and deleted lines.
      const file = forceUnwrap('Numstat entry without a raw entry', files[numStatCount])
      if (isCopyOrRename(file.status)) {
        i += 2
      }
      numStatCount++
    }
  }

  return { files, linesAdded, linesDeleted }
}
