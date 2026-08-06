interface TreeNode {
  name: string;
  children: Map<string, TreeNode>;
  isFile: boolean;
}

function buildTree(paths: string[]): TreeNode {
  const root: TreeNode = { name: '', children: new Map(), isFile: false };
  for (const p of paths) {
    const parts = p.split('/');
    let node = root;
    for (let i = 0; i < parts.length; i++) {
      const part = parts[i];
      if (!node.children.has(part)) {
        node.children.set(part, { name: part, children: new Map(), isFile: i === parts.length - 1 });
      }
      node = node.children.get(part)!;
    }
  }
  return root;
}

function renderNode(node: TreeNode, prefix: string, isLast: boolean): string {
  const connector = isLast ? '└── ' : '├── ';
  const childPrefix = prefix + (isLast ? '    ' : '│   ');

  let result = prefix + connector + node.name + (node.children.size > 0 && !node.isFile ? '/' : '') + '\n';

  const children = Array.from(node.children.values());
  // Directories first, then files
  children.sort((a, b) => {
    if (a.children.size > 0 && b.children.size === 0) return -1;
    if (a.children.size === 0 && b.children.size > 0) return 1;
    return a.name.localeCompare(b.name);
  });

  for (let i = 0; i < children.length; i++) {
    result += renderNode(children[i], childPrefix, i === children.length - 1);
  }
  return result;
}

export function generateTree(filePaths: string[]): string {
  if (filePaths.length === 0) return '';
  const root = buildTree(filePaths);
  const topNodes = Array.from(root.children.values());
  topNodes.sort((a, b) => {
    if (a.children.size > 0 && b.children.size === 0) return -1;
    if (a.children.size === 0 && b.children.size > 0) return 1;
    return a.name.localeCompare(b.name);
  });

  return topNodes.map((n, i) => renderNode(n, '', i === topNodes.length - 1)).join('');
}
