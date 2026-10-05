Prebuilt tree-sitter grammars (MIT), loaded by `src/parse/treeSitter.ts` through web-tree-sitter.
Sources (npm, wasm taken as published): tree-sitter-python 0.25.0, tree-sitter-go 0.25.0,
tree-sitter-javascript 0.25.0, tree-sitter-typescript 0.23.2 (typescript + tsx), tree-sitter-rust 0.24.0, tree-sitter-java 0.23.5.
Grammar versions are pinned on purpose: parse output feeds ranking-adjacent packing, which must be deterministic.
