/**
 * A tiny Paradox-script tree parser: `key = value` and `key = { ... }` blocks, `#` comments,
 * quoted strings kept whole. Enough to walk nested definitions such as `common/landed_titles`.
 */
export type Node = Array<[string, string | Node]>;

export function tokenize(text: string): string[] {
  const out: string[] = [];
  for (const rawLine of text.split("\n")) {
    const line = rawLine.replace(/#.*$/, "");
    // Quoted strings are kept whole; operators other than "=" are irrelevant here.
    for (const m of line.matchAll(/"[^"]*"|[{}=]|[^\s{}=]+/g)) out.push(m[0]);
  }
  return out;
}

export function parseBlock(tokens: string[], pos: { i: number }): Node {
  const node: Node = [];
  while (pos.i < tokens.length) {
    const tok = tokens[pos.i++]!;
    if (tok === "}") return node;
    if (tok === "{") {
      // Anonymous block, e.g. the list after `rgb` in `color = rgb { 1 2 3 }`: skip it whole
      // so its closing brace is not mistaken for the end of the enclosing block.
      parseBlock(tokens, pos);
      continue;
    }
    if (tokens[pos.i] === "=") {
      pos.i++;
      if (tokens[pos.i] === "{") {
        pos.i++;
        node.push([tok, parseBlock(tokens, pos)]);
      } else {
        node.push([tok, tokens[pos.i++] ?? ""]);
      }
    }
  }
  return node;
}
