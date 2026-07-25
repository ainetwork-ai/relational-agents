"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

interface GNode {
  id: string;
  label: string;
  kind: "room" | "root" | "section" | "page";
  x: number;
  y: number;
  vx: number;
  vy: number;
}
interface GEdge {
  source: string;
  target: string;
  kind: string;
}

const COLORS: Record<GNode["kind"], string> = {
  room: "#ec4899", // room (relationship) — pink
  root: "#2563eb", // relationship-doc root — blue
  section: "#737373", // section — gray
  page: "#a3a3a3",
};
const RADIUS: Record<GNode["kind"], number> = { room: 10, root: 8, section: 5, page: 4 };

/** Obsidian-style graph — canvas force-directed, zero external libraries.
 *  Node click: room → /agent-lab, page → /p/{id}. */
export function AgentGraph() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const router = useRouter();
  const [counts, setCounts] = useState<{ nodes: number; edges: number } | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let raf = 0;
    let disposed = false;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx0 = canvas.getContext("2d");
    if (!ctx0) return;
    const ctx = ctx0; // non-null (keeps the narrowing inside closures)

    let nodes: GNode[] = [];
    let edges: GEdge[] = [];
    let hover: GNode | null = null;
    let dragging: GNode | null = null;

    const size = () => {
      const rect = canvas.parentElement!.getBoundingClientRect();
      canvas.width = rect.width * devicePixelRatio;
      canvas.height = Math.max(480, rect.height) * devicePixelRatio;
      canvas.style.height = `${Math.max(480, rect.height)}px`;
    };
    size();

    const W = () => canvas.width / devicePixelRatio;
    const H = () => canvas.height / devicePixelRatio;

    fetch("/api/agent/graph")
      .then((r) => r.json())
      .then((data: { nodes: Omit<GNode, "x" | "y" | "vx" | "vy">[]; edges: GEdge[] }) => {
        if (disposed) return;
        if (!Array.isArray(data.nodes)) throw new Error("graph load failed");
        nodes = data.nodes.map((n, i) => ({
          ...n,
          x: W() / 2 + 120 * Math.cos((2 * Math.PI * i) / data.nodes.length),
          y: H() / 2 + 120 * Math.sin((2 * Math.PI * i) / data.nodes.length),
          vx: 0,
          vy: 0,
        }));
        edges = data.edges;
        setCounts({ nodes: nodes.length, edges: edges.length });
        tick();
      })
      .catch((e) => setError(e instanceof Error ? e.message : "load failed"));

    const byId = () => new Map(nodes.map((n) => [n.id, n]));

    function step() {
      const map = byId();
      // repulsion
      for (let i = 0; i < nodes.length; i++) {
        for (let j = i + 1; j < nodes.length; j++) {
          const a = nodes[i];
          const b = nodes[j];
          let dx = a.x - b.x;
          let dy = a.y - b.y;
          const d2 = Math.max(dx * dx + dy * dy, 25);
          const f = 1800 / d2;
          const d = Math.sqrt(d2);
          dx /= d;
          dy /= d;
          a.vx += dx * f;
          a.vy += dy * f;
          b.vx -= dx * f;
          b.vy -= dy * f;
        }
      }
      // springs (edges)
      for (const e of edges) {
        const a = map.get(e.source);
        const b = map.get(e.target);
        if (!a || !b) continue;
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const d = Math.max(Math.sqrt(dx * dx + dy * dy), 1);
        const rest = e.kind === "provenance" ? 160 : 90;
        const f = (d - rest) * 0.02;
        a.vx += (dx / d) * f;
        a.vy += (dy / d) * f;
        b.vx -= (dx / d) * f;
        b.vy -= (dy / d) * f;
      }
      // centering pull + damping + apply
      for (const n of nodes) {
        n.vx += (W() / 2 - n.x) * 0.002;
        n.vy += (H() / 2 - n.y) * 0.002;
        if (n === dragging) continue;
        n.vx *= 0.85;
        n.vy *= 0.85;
        n.x += n.vx;
        n.y += n.vy;
      }
    }

    function draw() {
      ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
      ctx.save();
      ctx.scale(devicePixelRatio, devicePixelRatio);
      const map = byId();
      const dark = document.documentElement.classList.contains("dark");
      for (const e of edges) {
        const a = map.get(e.source);
        const b = map.get(e.target);
        if (!a || !b) continue;
        ctx.strokeStyle =
          e.kind === "provenance" ? "rgba(236,72,153,0.35)" : dark ? "rgba(255,255,255,0.18)" : "rgba(0,0,0,0.14)";
        ctx.setLineDash(e.kind === "provenance" ? [4, 4] : []);
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
        ctx.stroke();
      }
      ctx.setLineDash([]);
      for (const n of nodes) {
        ctx.fillStyle = COLORS[n.kind];
        ctx.beginPath();
        ctx.arc(n.x, n.y, RADIUS[n.kind] + (hover === n ? 2 : 0), 0, 2 * Math.PI);
        ctx.fill();
        if (n.kind === "room" || n.kind === "root" || hover === n) {
          ctx.fillStyle = dark ? "#e5e5e5" : "#404040";
          ctx.font = `${n.kind === "room" ? 600 : 400} 11px sans-serif`;
          ctx.fillText(n.label.slice(0, 24), n.x + RADIUS[n.kind] + 4, n.y + 4);
        }
      }
      ctx.restore();
    }

    function tick() {
      step();
      draw();
      raf = requestAnimationFrame(tick);
    }

    const nodeAt = (mx: number, my: number) =>
      nodes.find((n) => (n.x - mx) ** 2 + (n.y - my) ** 2 <= (RADIUS[n.kind] + 4) ** 2) ?? null;

    const pos = (ev: MouseEvent) => {
      const r = canvas.getBoundingClientRect();
      return { mx: ev.clientX - r.left, my: ev.clientY - r.top };
    };
    const onMove = (ev: MouseEvent) => {
      const { mx, my } = pos(ev);
      if (dragging) {
        dragging.x = mx;
        dragging.y = my;
        return;
      }
      hover = nodeAt(mx, my);
      canvas.style.cursor = hover ? "pointer" : "default";
    };
    const onDown = (ev: MouseEvent) => {
      const { mx, my } = pos(ev);
      dragging = nodeAt(mx, my);
    };
    const onUp = (ev: MouseEvent) => {
      const { mx, my } = pos(ev);
      const n = nodeAt(mx, my);
      if (dragging && n === dragging && n) {
        if (n.kind === "room") router.push("/agent-lab");
        else router.push(`/p/${n.id}`);
      }
      dragging = null;
    };
    canvas.addEventListener("mousemove", onMove);
    canvas.addEventListener("mousedown", onDown);
    canvas.addEventListener("mouseup", onUp);
    window.addEventListener("resize", size);

    return () => {
      disposed = true;
      cancelAnimationFrame(raf);
      canvas.removeEventListener("mousemove", onMove);
      canvas.removeEventListener("mousedown", onDown);
      canvas.removeEventListener("mouseup", onUp);
      window.removeEventListener("resize", size);
    };
  }, [router]);

  return (
    <div className="flex h-full flex-col gap-3 p-6">
      <div className="flex items-center gap-3">
        <h1 className="text-lg font-semibold">Relationship graph</h1>
        <Link
          data-testid="agent-graph-back"
          href="/agent-lab"
          className="text-xs text-blue-600 underline"
        >
          ← Agent Lab
        </Link>
        <span data-testid="agent-graph-counts" className="text-xs text-neutral-500">
          {error ? `Error: ${error}` : counts ? `${counts.nodes} nodes · ${counts.edges} edges` : "Loading…"}
        </span>
        <span className="ml-auto flex items-center gap-3 text-xs text-neutral-500">
          <span><span className="mr-1 inline-block h-2 w-2 rounded-full" style={{ background: COLORS.room }} />Room (relationship)</span>
          <span><span className="mr-1 inline-block h-2 w-2 rounded-full" style={{ background: COLORS.root }} />Relationship doc</span>
          <span><span className="mr-1 inline-block h-2 w-2 rounded-full" style={{ background: COLORS.section }} />Section</span>
          <span className="text-pink-400">┄ Source</span>
        </span>
      </div>
      <div className="min-h-0 flex-1 rounded border border-neutral-200 dark:border-neutral-800">
        <canvas data-testid="agent-graph-canvas" ref={canvasRef} className="block w-full" />
      </div>
      <p className="text-xs text-neutral-400">
        Drag a node to rearrange the layout; click one to open that room or document.
      </p>
    </div>
  );
}
