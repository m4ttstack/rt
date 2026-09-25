# Input: deps.lock. A helper row carrying "serve" is a bundled app, any other
# helper row a tool. Parity twin: parseDepsLock in lib/bundle-layout.ts,
# pinned by scripts/lib/__tests__/vm-served-catalog.test.ts.
[.tools[] | select(.kind == "helper")] as $helpers
| { apps: ([$helpers[] | select((.serve | type) == "object")
            | { name, status, port: .serve.port, args: (.serve.args // []) }]
           | sort_by(.name)),
    tools: ([$helpers[] | select((.serve | type) != "object") | .name] | sort) }
