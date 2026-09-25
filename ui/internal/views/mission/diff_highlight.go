// Whole-file diff highlighting: a lexer sees the real old/new file text
// (so a multi-line construct like a block comment tokenizes correctly)
// and each diff line is looked up by its line number, falling back to
// tokenizing the surrounding hunk block when the source has moved on.
package mission

import (
	"hash/maphash"
	"slices"
	"strings"
)

// Every model push re-sends the sources, so each cache only has to span a
// few selections. Sources and hunk blocks are cached apart so a fallback
// that tokenizes many blocks can never evict the sources.
const (
	diffSourceCacheCap = 8
	diffBlockCacheCap  = 16
)

type tokenCache struct {
	seed  maphash.Seed
	lines map[uint64][][]span
}

type diffHighlighter struct {
	sources   tokenCache
	blocks    tokenCache
	tokenized int
	lastKey   *DiffLine
	lastN     int
	last      [][]span
}

func (h *diffHighlighter) tokenize(c *tokenCache, capacity int, lang, src string) [][]span {
	if c.lines == nil {
		c.seed = maphash.MakeSeed()
		c.lines = map[uint64][][]span{}
	}
	key := maphash.String(c.seed, lang+"\x00"+src)
	if lines, ok := c.lines[key]; ok {
		return lines
	}
	if len(c.lines) >= capacity {
		c.lines = map[uint64][][]span{}
	}
	lines := tokenizeLines(lang, src)
	c.lines[key] = lines
	h.tokenized++
	return lines
}

// forDiff keys on the decoded Lines backing array: each model push decodes
// a fresh one, so a repeat frame of the same model reuses the result.
// Holding &Lines[0] keeps that array alive, so its address cannot be reused
// by a later push while it is cached.
func (h *diffHighlighter) forDiff(d DiffModel) [][]span {
	if d.Lang == "" || d.Kind != "text" || len(d.Lines) == 0 {
		return nil
	}
	if h.lastKey == &d.Lines[0] && h.lastN == len(d.Lines) {
		return h.last
	}
	var oldLines, newLines [][]span
	if d.OldSource != nil {
		oldLines = h.tokenize(&h.sources, diffSourceCacheCap, d.Lang, *d.OldSource)
	}
	if d.NewSource != nil {
		newLines = h.tokenize(&h.sources, diffSourceCacheCap, d.Lang, *d.NewSource)
	}
	out := make([][]span, len(d.Lines))
	missing := false
	for i, l := range d.Lines {
		if l.Kind == "hunk" {
			continue
		}
		src, no := newLines, l.NewNo
		if l.Kind == "del" {
			src, no = oldLines, l.OldNo
		}
		if s, ok := sourceLine(src, no, l.Text); ok {
			out[i] = s
			continue
		}
		missing = true
	}
	if missing {
		h.fillHunkBlocks(d, out)
	}
	h.lastKey, h.lastN, h.last = &d.Lines[0], len(d.Lines), out
	return out
}

func sourceLine(lines [][]span, no int, want string) ([]span, bool) {
	if no < 1 || no > len(lines) {
		return nil, false
	}
	s := lines[no-1]
	return s, spansText(s) == strings.TrimSuffix(want, "\r")
}

// fillHunkBlocks tokenizes each hunk's new side (context + add) and old side
// (context + del) as one text apiece, only where a line no source could
// answer sits in that block.
func (h *diffHighlighter) fillHunkBlocks(d DiffModel, out [][]span) {
	flush := func(idx []int, texts []string) {
		if !slices.ContainsFunc(idx, func(i int) bool { return out[i] == nil }) {
			return
		}
		// chroma reads a lone \r as a line break, which would split one
		// line in two and hand every later line in the block its
		// neighbour's spans; as a space it stays inside its own line.
		for j, t := range texts {
			texts[j] = strings.ReplaceAll(strings.TrimSuffix(t, "\r"), "\r", " ")
		}
		lines := h.tokenize(&h.blocks, diffBlockCacheCap, d.Lang, strings.Join(texts, "\n")+"\n")
		for j, i := range idx {
			if out[i] == nil && j < len(lines) {
				out[i] = lines[j]
			}
		}
	}
	var newIdx, oldIdx []int
	var newTxt, oldTxt []string
	end := func() {
		flush(newIdx, newTxt)
		flush(oldIdx, oldTxt)
		newIdx, oldIdx, newTxt, oldTxt = nil, nil, nil, nil
	}
	for i, l := range d.Lines {
		switch l.Kind {
		case "hunk":
			end()
		case "del":
			oldIdx, oldTxt = append(oldIdx, i), append(oldTxt, l.Text)
		case "add":
			newIdx, newTxt = append(newIdx, i), append(newTxt, l.Text)
		default:
			newIdx, newTxt = append(newIdx, i), append(newTxt, l.Text)
			oldIdx, oldTxt = append(oldIdx, i), append(oldTxt, l.Text)
		}
	}
	end()
}
