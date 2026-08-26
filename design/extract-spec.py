#!/usr/bin/env python3
"""Regenerate spec.json from build.py's shared CSS block.

The artboards are the design contract. Hand-copying their values into a
checklist is how a checklist goes stale, so the audit reads this instead and
this reads build.py. Run it whenever build.py changes.
"""
import json
import re
from pathlib import Path

HERE = Path(__file__).parent
css = (HERE / "build.py").read_text().split('CSS = r"""', 1)[1].split('"""', 1)[0]

rules = {}
for m in re.finditer(r"^\s*([.#][^{]+?)\s*\{([^}]*)\}", css, re.M):
    sel = m.group(1).strip()
    # A selector may be declared more than once (`.app` carries the palette in
    # one block and the typography in another). MERGE rather than overwrite:
    # the naive dict assignment silently dropped the entire light palette,
    # which made every colour in the spec unresolvable.
    decls = rules.setdefault(sel, {})
    for d in m.group(2).strip().split(";"):
        if ":" in d:
            k, v = d.split(":", 1)
            decls[k.strip()] = v.strip()

(HERE / "spec.json").write_text(json.dumps(rules, indent=2, sort_keys=True) + "\n")
print(f"spec.json: {len(rules)} selectors")
