import { useMemo, useState } from 'react';

export interface TreeNode {
  id: string;
  parent: string | null;
  kind: 'self' | 'member' | 'pending' | 'deleted' | 'root';
  label?: string | null;
  color?: string;
  info?: string;
}

const GAP_X = 64;
const GAP_Y = 58;
const PAD = 30;

/**
 * Tidy top-down tree in plain SVG. Leaves are spaced evenly; parents sit over
 * the middle of their children. Tap a node to see the size of its branch.
 */
export function Tree({ nodes, height }: { nodes: TreeNode[]; height?: number }) {
  const [selected, setSelected] = useState<string | null>(null);

  const layout = useMemo(() => {
    const children = new Map<string | null, TreeNode[]>();
    const ids = new Set(nodes.map((n) => n.id));
    for (const n of nodes) {
      const p = n.parent && ids.has(n.parent) ? n.parent : null;
      if (!children.has(p)) children.set(p, []);
      children.get(p)!.push(n);
    }
    const pos = new Map<string, { x: number; y: number; size: number; depth: number }>();
    let leaf = 0;
    let maxDepth = 0;
    const place = (n: TreeNode, depth: number): { x: number; size: number } => {
      maxDepth = Math.max(maxDepth, depth);
      const kids = children.get(n.id) ?? [];
      let x: number;
      let size = n.kind === 'pending' ? 0 : 1;
      if (kids.length === 0) {
        x = leaf++ * GAP_X;
      } else {
        const placed = kids.map((k) => place(k, depth + 1));
        x = (placed[0].x + placed[placed.length - 1].x) / 2;
        size += placed.reduce((s, p) => s + p.size, 0);
      }
      pos.set(n.id, { x, y: depth * GAP_Y, size, depth });
      return { x, size };
    };
    for (const root of children.get(null) ?? []) place(root, 0);
    const width = Math.max(leaf - 1, 0) * GAP_X + PAD * 2;
    return { pos, width, height: maxDepth * GAP_Y + PAD * 2 };
  }, [nodes]);

  const sel = selected ? nodes.find((n) => n.id === selected) : null;
  const selPos = selected ? layout.pos.get(selected) : null;

  return (
    <div className="tree">
      <div className="tree-scroll" style={height ? { maxHeight: height } : undefined}>
        <svg
          width={Math.max(layout.width, 120)}
          height={layout.height}
          viewBox={`${-PAD} ${-PAD} ${Math.max(layout.width, 120)} ${layout.height}`}
          role="img"
          aria-label={`Referral tree with ${nodes.length} nodes`}
        >
          {nodes.map((n) => {
            const a = layout.pos.get(n.id);
            const b = n.parent ? layout.pos.get(n.parent) : null;
            if (!a || !b) return null;
            const midY = (a.y + b.y) / 2;
            return (
              <path
                key={`l-${n.id}`}
                // pathLength=1 lets CSS draw any link in from its parent, whatever its length.
                pathLength={n.kind === 'pending' ? undefined : 1}
                className={`tree-link ${n.kind === 'pending' ? 'is-pending' : 'is-drawn'}`}
                d={`M${b.x},${b.y} C${b.x},${midY} ${a.x},${midY} ${a.x},${a.y}`}
                style={{ animationDelay: `${a.depth * 0.18}s` }}
              />
            );
          })}
          {nodes.map((n) => {
            const p = layout.pos.get(n.id);
            if (!p) return null;
            const r = n.kind === 'self' || n.kind === 'root' ? 9 : n.kind === 'pending' ? 6 : 7;
            return (
              <g
                key={n.id}
                className={`tree-node kind-${n.kind} ${selected === n.id ? 'is-selected' : ''}`}
                transform={`translate(${p.x},${p.y})`}
                onClick={() => setSelected(selected === n.id ? null : n.id)}
                style={{ animationDelay: `${0.1 + p.depth * 0.18}s` }}
              >
                <circle r={18} className="hit" />
                <circle r={r} style={n.color ? { fill: n.color } : undefined} />
                {n.label && (
                  <text y={n.kind === 'self' || n.kind === 'root' ? -(r + 8) : r + 14} textAnchor="middle">
                    {n.label}
                  </text>
                )}
              </g>
            );
          })}
        </svg>
      </div>
      <p className="tree-caption" aria-live="polite">
        {sel && selPos
          ? sel.info ??
            (sel.kind === 'pending'
              ? 'Invitation not accepted yet'
              : `${selPos.size} ${selPos.size === 1 ? 'person' : 'people'} in this branch`)
          : 'Tap a node'}
      </p>
    </div>
  );
}
