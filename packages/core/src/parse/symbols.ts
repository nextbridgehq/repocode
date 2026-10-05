import type { Node } from 'web-tree-sitter';
import { withTree } from './treeSitter.js';

export interface CodeSymbol {
  name: string;
  kind: 'function' | 'method' | 'class' | 'interface';
  /** Enclosing class (or Go receiver type) for a method; null at top level. */
  parent: string | null;
  /** 1-based, inclusive. Covers decorators and `export`. */
  startLine: number;
  endLine: number;
  /** First line after the signature: lines startLine..bodyStartLine-1 are the declaration. */
  bodyStartLine: number;
}

const FUNCTION_VALUE = new Set(['arrow_function', 'function_expression', 'function']);

function make(
  wrapper: Node, name: string, kind: CodeSymbol['kind'], parent: string | null,
  body: Node | null, braces: boolean,
): CodeSymbol {
  const startLine = wrapper.startPosition.row + 1;
  const endLine = wrapper.endPosition.row + 1;
  const bodyRow = body ? body.startPosition.row + (braces ? 1 : 0) + 1 : startLine;
  return { name, kind, parent, startLine, endLine, bodyStartLine: Math.min(Math.max(bodyRow, startLine), endLine) };
}

/** The definition under a wrapper that only adds decorators or `export`. */
function unwrap(node: Node): Node {
  if (node.type === 'decorated_definition') return node.childForFieldName('definition') ?? node;
  if (node.type === 'export_statement') return node.childForFieldName('declaration') ?? node;
  return node;
}

function receiverType(method: Node): string | null {
  const text = method.childForFieldName('receiver')?.text ?? '';
  return /([A-Za-z_]\w*)\s*(?:\[[^\]]*\])?\s*\)\s*$/.exec(text)?.[1] ?? null;
}

function collect(node: Node, parent: string | null, out: CodeSymbol[], inClass: boolean): void {
  const def = unwrap(node);
  const name = def.childForFieldName('name')?.text;
  const body = def.childForFieldName('body');
  switch (def.type) {
    case 'function_definition': // python
      if (name) out.push(make(node, name, inClass ? 'method' : 'function', parent, body, false));
      return;
    case 'function_item': // rust
      if (name) out.push(make(node, name, inClass ? 'method' : 'function', parent, body, true));
      return;
    case 'struct_item': // rust
    case 'enum_item':
      if (name) out.push(make(node, name, 'class', parent, body, true));
      return;
    case 'trait_item': // rust
      if (!name) return;
      out.push(make(node, name, 'interface', parent, body, true));
      for (const c of body?.namedChildren ?? []) collect(c, name, out, true);
      return;
    case 'impl_item': { // rust: not a symbol itself; its functions belong to the implemented type
      const type = def.childForFieldName('type')?.text.replace(/<.*$/s, '').trim();
      for (const c of body?.namedChildren ?? []) collect(c, type ?? null, out, true);
      return;
    }
    case 'class_definition': // python
      if (!name) return;
      out.push(make(node, name, 'class', parent, body, false));
      for (const c of body?.namedChildren ?? []) collect(c, name, out, true);
      return;
    case 'function_declaration': // ts, js, go
    case 'generator_function_declaration':
      if (name) out.push(make(node, name, 'function', parent, body, true));
      return;
    case 'method_definition': // ts, js
      if (name) out.push(make(node, name, 'method', parent, body, true));
      return;
    case 'method_declaration': // go (receiver) and java (inside a class)
    case 'constructor_declaration': // java
      if (name) out.push(make(node, name, 'method', def.childForFieldName('receiver') ? receiverType(def) : parent, body, true));
      return;
    case 'class_declaration':
    case 'abstract_class_declaration':
      if (!name) return;
      out.push(make(node, name, 'class', parent, body, true));
      for (const c of body?.namedChildren ?? []) collect(c, name, out, true);
      return;
    case 'interface_declaration':
      if (!name) return;
      out.push(make(node, name, 'interface', parent, body, true));
      for (const c of body?.namedChildren ?? []) collect(c, name, out, true);
      return;
    case 'public_field_definition': { // class field holding an arrow function
      const value = def.childForFieldName('value');
      if (name && value && FUNCTION_VALUE.has(value.type)) {
        out.push(make(node, name, 'method', parent, value.childForFieldName('body'), true));
      }
      return;
    }
    case 'lexical_declaration':
    case 'variable_declaration':
      for (const d of def.namedChildren) {
        const value = d.childForFieldName('value');
        const vname = d.childForFieldName('name')?.text;
        if (d.type === 'variable_declarator' && vname && value && FUNCTION_VALUE.has(value.type)) {
          out.push(make(node, vname, 'function', parent, value.childForFieldName('body'), true));
        }
      }
      return;
    case 'type_declaration': // go
      for (const spec of def.namedChildren) {
        const type = spec.childForFieldName('type');
        const tname = spec.childForFieldName('name')?.text;
        if (spec.type !== 'type_spec' || !tname || !type) continue;
        if (type.type === 'struct_type') out.push(make(node, tname, 'class', parent, type, true));
        else if (type.type === 'interface_type') out.push(make(node, tname, 'interface', parent, type, true));
      }
      return;
  }
}

/** Top-level definitions and class members of `content`, in source order. Null when the file type
 *  has no grammar or cannot be parsed. Functions nested inside functions are not reported. */
export function extractSymbols(content: string, filePath: string): Promise<CodeSymbol[] | null> {
  return withTree(content, filePath, tree => {
    const out: CodeSymbol[] = [];
    for (const child of tree.rootNode.namedChildren) collect(child, null, out, false);
    return out.sort((a, b) => a.startLine - b.startLine || a.endLine - b.endLine);
  });
}
