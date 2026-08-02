'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';

import { cn } from '@/lib/utils';

// ============================================================
// The vault as a network.
//
// Pages are nodes, links are edges, and a force simulation settles them
// into clusters — the shape Obsidian's graph view made familiar, and
// the honest picture of what this vault is: not a list of documents but
// a thing with structure, which gets denser as the agent learns.
//
// Hand-rolled rather than pulling in d3-force, for the same reason the
// providers use raw fetch and the timezone maths has no date library:
// this is ~60 lines of physics, and a dependency for it would be a
// dependency to keep current forever.
//
// Canvas, not SVG. A few hundred nodes at 60fps means a few hundred DOM
// nodes mutating per frame otherwise, and the glow that makes this read
// as a network is a shadow blur — cheap on canvas, expensive in SVG.
// ============================================================

export interface GraphNode {
  id: string;
  slug: string;
  title: string;
  kind: string;
  status: string;
  degree: number;
}

export interface GraphLink {
  source: string;
  target: string;
  relation: string;
}

/** Simulation state per node. Kept apart from the data so a refetch can
 *  reuse positions instead of restarting the layout from chaos. */
interface Body {
  x: number;
  y: number;
  vx: number;
  vy: number;
}

/** One colour per page kind, so a cluster is readable at a glance. */
const KIND_COLORS: Record<string, string> = {
  rule: '#f59e0b', // amber — the rules the bot always obeys
  entity_customer: '#38bdf8', // sky — people
  entity_business: '#a78bfa', // violet — the shop itself
  concept: '#94a3b8', // slate — everything else
  state: '#34d399', // emerald — true for now
};

const DEFAULT_COLOR = '#94a3b8';

// Physics. Tuned for a few hundred nodes: enough repulsion to open the
// clusters, enough damping to settle in a second or two.
const REPULSION = 2400;
const SPRING = 0.02;
const SPRING_LENGTH = 70;
const CENTER_PULL = 0.004;
const DAMPING = 0.86;
/** Below this the layout has settled; stop burning frames on it. */
const SLEEP_ENERGY = 0.02;

export function VaultGraph({
  nodes,
  links,
  onSelect,
  className,
}: {
  nodes: GraphNode[];
  links: GraphLink[];
  onSelect?: (node: GraphNode) => void;
  className?: string;
}) {
  const t = useTranslations('Agents.vault.graph');
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const bodiesRef = useRef<Map<string, Body>>(new Map());
  const frameRef = useRef<number>(0);
  const viewRef = useRef({ scale: 1, offsetX: 0, offsetY: 0 });
  const dragRef = useRef<{ x: number; y: number } | null>(null);
  const [hovered, setHovered] = useState<GraphNode | null>(null);

  // Adjacency, for highlighting a node's neighbourhood on hover.
  const neighbours = useMemo(() => {
    const map = new Map<string, Set<string>>();
    for (const link of links) {
      if (!map.has(link.source)) map.set(link.source, new Set());
      if (!map.has(link.target)) map.set(link.target, new Set());
      map.get(link.source)!.add(link.target);
      map.get(link.target)!.add(link.source);
    }
    return map;
  }, [links]);

  // Seed positions on a circle rather than at random: a ring unfolds
  // into clusters, where random points spend the first second untangling
  // and look like a glitch.
  useEffect(() => {
    const bodies = bodiesRef.current;
    const existing = new Set(bodies.keys());
    nodes.forEach((node, i) => {
      existing.delete(node.id);
      if (bodies.has(node.id)) return;
      const angle = (i / Math.max(nodes.length, 1)) * Math.PI * 2;
      const radius = 120 + (i % 7) * 18;
      bodies.set(node.id, {
        x: Math.cos(angle) * radius,
        y: Math.sin(angle) * radius,
        vx: 0,
        vy: 0,
      });
    });
    // Drop bodies for pages that went away.
    for (const gone of existing) bodies.delete(gone);
  }, [nodes]);

  const radiusOf = useCallback(
    (node: GraphNode) => 3.5 + Math.min(node.degree, 24) * 0.55,
    [],
  );

  /** Screen point → simulation space, for hit-testing under the cursor. */
  const toWorld = useCallback((canvas: HTMLCanvasElement, clientX: number, clientY: number) => {
    const rect = canvas.getBoundingClientRect();
    const view = viewRef.current;
    return {
      x: (clientX - rect.left - rect.width / 2 - view.offsetX) / view.scale,
      y: (clientY - rect.top - rect.height / 2 - view.offsetY) / view.scale,
    };
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    function step() {
      const bodies = bodiesRef.current;
      let energy = 0;

      // Repulsion, every pair. O(n²) is honest at this size — a
      // quadtree would be the right call past a couple of thousand
      // pages, and a vault that big has other problems first.
      const list = nodes.map((n) => bodies.get(n.id)).filter(Boolean) as Body[];
      for (let i = 0; i < list.length; i++) {
        for (let j = i + 1; j < list.length; j++) {
          const a = list[i];
          const b = list[j];
          let dx = b.x - a.x;
          let dy = b.y - a.y;
          let distSq = dx * dx + dy * dy;
          if (distSq < 1) {
            // Two nodes exactly on top of each other produce infinite
            // force; nudge them apart deterministically instead.
            dx = (i % 2 === 0 ? 1 : -1) * 0.5;
            dy = (j % 2 === 0 ? 1 : -1) * 0.5;
            distSq = 1;
          }
          const dist = Math.sqrt(distSq);
          const force = REPULSION / distSq;
          const fx = (dx / dist) * force;
          const fy = (dy / dist) * force;
          a.vx -= fx;
          a.vy -= fy;
          b.vx += fx;
          b.vy += fy;
        }
      }

      // Springs along the links — what pulls a cluster together.
      for (const link of links) {
        const a = bodies.get(link.source);
        const b = bodies.get(link.target);
        if (!a || !b) continue;
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const dist = Math.sqrt(dx * dx + dy * dy) || 1;
        const force = (dist - SPRING_LENGTH) * SPRING;
        const fx = (dx / dist) * force;
        const fy = (dy / dist) * force;
        a.vx += fx;
        a.vy += fy;
        b.vx -= fx;
        b.vy -= fy;
      }

      for (const body of list) {
        body.vx -= body.x * CENTER_PULL;
        body.vy -= body.y * CENTER_PULL;
        body.vx *= DAMPING;
        body.vy *= DAMPING;
        body.x += body.vx;
        body.y += body.vy;
        energy += Math.abs(body.vx) + Math.abs(body.vy);
      }

      return list.length === 0 ? 0 : energy / list.length;
    }

    function draw() {
      const canvasEl = canvasRef.current;
      if (!canvasEl || !ctx) return;

      // Match the backing store to the CSS size so lines stay crisp on
      // a HiDPI screen instead of rendering at half resolution.
      const dpr = window.devicePixelRatio || 1;
      const rect = canvasEl.getBoundingClientRect();
      if (
        canvasEl.width !== Math.floor(rect.width * dpr) ||
        canvasEl.height !== Math.floor(rect.height * dpr)
      ) {
        canvasEl.width = Math.floor(rect.width * dpr);
        canvasEl.height = Math.floor(rect.height * dpr);
      }

      const view = viewRef.current;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, rect.width, rect.height);
      ctx.translate(rect.width / 2 + view.offsetX, rect.height / 2 + view.offsetY);
      ctx.scale(view.scale, view.scale);

      const bodies = bodiesRef.current;
      const active = hovered ? neighbours.get(hovered.id) : null;

      for (const link of links) {
        const a = bodies.get(link.source);
        const b = bodies.get(link.target);
        if (!a || !b) continue;
        const lit =
          hovered && (link.source === hovered.id || link.target === hovered.id);
        ctx.strokeStyle = lit
          ? 'rgba(148, 163, 184, 0.85)'
          : hovered
            ? 'rgba(148, 163, 184, 0.10)'
            : 'rgba(148, 163, 184, 0.28)';
        ctx.lineWidth = lit ? 1.4 : 0.8;
        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
        ctx.stroke();
      }

      for (const node of nodes) {
        const body = bodies.get(node.id);
        if (!body) continue;
        const isHovered = hovered?.id === node.id;
        const isNeighbour = active?.has(node.id) ?? false;
        const dimmed = hovered && !isHovered && !isNeighbour;
        const color = KIND_COLORS[node.kind] ?? DEFAULT_COLOR;
        const r = radiusOf(node);

        // The glow is what makes this read as a network rather than a
        // scatter plot. Only on the focused node — everywhere would be
        // both slow and unreadable.
        if (isHovered) {
          ctx.shadowColor = color;
          ctx.shadowBlur = 18;
        } else {
          ctx.shadowBlur = 0;
        }

        ctx.globalAlpha = dimmed ? 0.25 : 1;
        // A draft is hollow: visibly not yet part of what the shop knows.
        if (node.status === 'draft') {
          ctx.strokeStyle = color;
          ctx.lineWidth = 1.5;
          ctx.beginPath();
          ctx.arc(body.x, body.y, r, 0, Math.PI * 2);
          ctx.stroke();
        } else {
          ctx.fillStyle = color;
          ctx.beginPath();
          ctx.arc(body.x, body.y, r, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.shadowBlur = 0;

        // Labels only where they can be read: the hovered node, its
        // neighbours, and the hubs. Everything labelled is a wall of text.
        const labelled = isHovered || isNeighbour || (!hovered && node.degree >= 4);
        if (labelled && view.scale > 0.5) {
          ctx.globalAlpha = dimmed ? 0.25 : isHovered ? 1 : 0.7;
          ctx.fillStyle = '#e2e8f0';
          ctx.font = `${isHovered ? 12 : 10}px ui-sans-serif, system-ui, sans-serif`;
          ctx.textAlign = 'center';
          ctx.fillText(node.title.slice(0, 32), body.x, body.y - r - 5);
        }
        ctx.globalAlpha = 1;
      }
    }

    let sleeping = false;
    function loop() {
      if (!sleeping) {
        const energy = step();
        // Stop simulating once it settles, but keep drawing on demand —
        // a graph that runs a physics loop forever is a laptop fan.
        if (energy < SLEEP_ENERGY) sleeping = true;
      }
      draw();
      frameRef.current = requestAnimationFrame(loop);
    }
    frameRef.current = requestAnimationFrame(loop);

    // Any interaction wakes the layout: dragging a view does not need
    // physics, but a resize or a new page does.
    const wake = () => {
      sleeping = false;
    };
    window.addEventListener('resize', wake);

    function onPointerMove(event: PointerEvent) {
      const canvasEl = canvasRef.current;
      if (!canvasEl) return;

      if (dragRef.current) {
        viewRef.current.offsetX += event.clientX - dragRef.current.x;
        viewRef.current.offsetY += event.clientY - dragRef.current.y;
        dragRef.current = { x: event.clientX, y: event.clientY };
        return;
      }

      const world = toWorld(canvasEl, event.clientX, event.clientY);
      let found: GraphNode | null = null;
      for (const node of nodes) {
        const body = bodiesRef.current.get(node.id);
        if (!body) continue;
        const r = radiusOf(node) + 4;
        if ((body.x - world.x) ** 2 + (body.y - world.y) ** 2 <= r * r) {
          found = node;
          break;
        }
      }
      setHovered((prev) => (prev?.id === found?.id ? prev : found));
      canvasEl.style.cursor = found ? 'pointer' : 'grab';
    }

    function onPointerDown(event: PointerEvent) {
      if (hovered) return; // clicking a node is a selection, not a pan
      dragRef.current = { x: event.clientX, y: event.clientY };
    }
    function onPointerUp() {
      dragRef.current = null;
    }
    function onClick() {
      if (hovered && onSelect) onSelect(hovered);
    }
    function onWheel(event: WheelEvent) {
      event.preventDefault();
      const next = viewRef.current.scale * (event.deltaY < 0 ? 1.12 : 0.89);
      viewRef.current.scale = Math.min(4, Math.max(0.25, next));
    }

    canvas.addEventListener('pointermove', onPointerMove);
    canvas.addEventListener('pointerdown', onPointerDown);
    window.addEventListener('pointerup', onPointerUp);
    canvas.addEventListener('click', onClick);
    canvas.addEventListener('wheel', onWheel, { passive: false });

    return () => {
      cancelAnimationFrame(frameRef.current);
      window.removeEventListener('resize', wake);
      canvas.removeEventListener('pointermove', onPointerMove);
      canvas.removeEventListener('pointerdown', onPointerDown);
      window.removeEventListener('pointerup', onPointerUp);
      canvas.removeEventListener('click', onClick);
      canvas.removeEventListener('wheel', onWheel);
    };
  }, [nodes, links, neighbours, hovered, onSelect, radiusOf, toWorld]);

  return (
    <div className={cn('relative overflow-hidden rounded-xl border border-border bg-card', className)}>
      <canvas ref={canvasRef} className="block h-full w-full touch-none" />

      {nodes.length === 0 && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <p className="max-w-xs text-center text-sm text-muted-foreground">
            {t('empty')}
          </p>
        </div>
      )}

      {/* Legend. Without it the colours are decoration. */}
      <div className="pointer-events-none absolute bottom-3 left-3 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
        {Object.entries(KIND_COLORS).map(([kind, color]) => (
          <span key={kind} className="flex items-center gap-1.5">
            <span
              className="inline-block h-2 w-2 rounded-full"
              style={{ backgroundColor: color }}
            />
            {t(`kind.${kind}`)}
          </span>
        ))}
      </div>

      {hovered && (
        <div className="pointer-events-none absolute right-3 top-3 max-w-[16rem] rounded-lg border border-border bg-popover/95 px-3 py-2 text-xs shadow-md">
          <p className="font-medium text-popover-foreground">{hovered.title}</p>
          <p className="mt-0.5 text-muted-foreground">
            {t(`kind.${hovered.kind}`)} ·{' '}
            {t('connections', { count: hovered.degree })}
          </p>
        </div>
      )}
    </div>
  );
}
