import { useCallback, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { circularLabel } from '../config/experiment';
import { Button } from './ui';

// Geometry in SVG units (the SVG scales to the screen).
const SIZE = 320;
const C = SIZE / 2;
const R = 128;
const GRAB_RADIUS = 40; // generous touch target around the node
const MAX_STEP = 25; // ignore pointer jumps larger than this (in %) between two moves

const pointOnCircle = (pct: number) => {
  const a = (pct / 100) * 2 * Math.PI;
  return { x: C + R * Math.sin(a), y: C - R * Math.cos(a) };
};

/**
 * Experiment D: a circular connection-strength slider (0–100%).
 *
 * The node starts at the top and is dragged clockwise; a full turn is 100%.
 * Ratings are only changed by dragging the node itself (or the keyboard /
 * assistive technology via the native range input underneath), so a higher
 * rating takes more physical movement. Movement is tracked incrementally so
 * crossing the top can't jump between 0% and 100%. Releasing never submits:
 * the participant confirms with Continue, which is enabled after their first
 * interaction (even if they leave it at 0%).
 */
export function CircularSlider({
  name,
  question,
  onInteract,
  onConfirm,
}: {
  name: string;
  question: string;
  onInteract?: (elapsedMs: number) => void;
  onConfirm: (value: number, elapsedMs: number) => void;
}) {
  const [value, setValue] = useState(0); // continuous, 0–100
  const [touched, setTouched] = useState(false);
  const [dragging, setDragging] = useState(false);
  const svgRef = useRef<SVGSVGElement>(null);
  const started = useRef(performance.now());
  const valueRef = useRef(0);
  const touchedRef = useRef(false);

  const pct = Math.round(value);
  const node = pointOnCircle(value);

  const markInteracted = useCallback(() => {
    if (touchedRef.current) return;
    touchedRef.current = true;
    setTouched(true);
    onInteract?.(Math.round(performance.now() - started.current));
  }, [onInteract]);

  const set = (v: number) => {
    const clamped = Math.min(100, Math.max(0, v));
    valueRef.current = clamped;
    setValue(clamped);
  };

  /** Pointer position → SVG coordinates. */
  const toSvg = (e: ReactPointerEvent) => {
    const rect = svgRef.current!.getBoundingClientRect();
    const scale = SIZE / rect.width;
    return { x: (e.clientX - rect.left) * scale, y: (e.clientY - rect.top) * scale };
  };

  const onPointerDown = (e: ReactPointerEvent<SVGSVGElement>) => {
    const p = toSvg(e);
    const n = pointOnCircle(valueRef.current);
    // Only the node can be grabbed: tapping elsewhere on the ring never jumps the value.
    if (Math.hypot(p.x - n.x, p.y - n.y) > GRAB_RADIUS) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    setDragging(true);
    markInteracted();
  };

  const onPointerMove = (e: ReactPointerEvent<SVGSVGElement>) => {
    if (!dragging) return;
    const p = toSvg(e);
    const dx = p.x - C;
    const dy = p.y - C;
    if (Math.hypot(dx, dy) < R * 0.35) return; // too close to the centre: angle is unstable
    const angle = ((Math.atan2(dx, -dy) / (2 * Math.PI)) * 100 + 100) % 100; // 0 at top, clockwise
    // Shortest signed step from the current position, so crossing the top
    // can't flip between 0% and 100%; the ends simply hold.
    let delta = angle - valueRef.current;
    if (delta > 50) delta -= 100;
    if (delta < -50) delta += 100;
    if (Math.abs(delta) > MAX_STEP) return;
    set(valueRef.current + delta);
  };

  const endDrag = (e: ReactPointerEvent<SVGSVGElement>) => {
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
    setDragging(false);
  };

  const glow = value / 100;

  return (
    <div className="circular" style={{ ['--g' as string]: glow.toFixed(3) }} data-value={pct}>
      <h1 className="question circular-question">{question}</h1>
      <div className={`circular-dial ${dragging ? 'is-dragging' : ''} ${touched ? 'is-touched' : ''}`}>
        <div className="circular-halo" aria-hidden="true" />
        <svg
          ref={svgRef}
          viewBox={`0 0 ${SIZE} ${SIZE}`}
          className="circular-svg"
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={endDrag}
          onPointerCancel={endDrag}
          aria-hidden="true"
        >
          <circle className="circular-track" cx={C} cy={C} r={R} />
          {value > 0.3 && (
            <circle
              className="circular-progress"
              cx={C}
              cy={C}
              r={R}
              pathLength={100}
              strokeDasharray={`${value} 100`}
              transform={`rotate(-90 ${C} ${C})`}
            />
          )}
          <circle className="circular-node-hit" cx={node.x} cy={node.y} r={GRAB_RADIUS} />
          <circle className="circular-node" cx={node.x} cy={node.y} r={11} />
        </svg>
        <div className="circular-readout" aria-hidden="true">
          <span className="circular-pct">{pct}<small>%</small></span>
          <span className="circular-label">{circularLabel(pct)}</span>
        </div>
        {/* The accessible control: arrow keys, Page Up/Down, Home/End, and screen-reader adjustments. */}
        <input
          className="circular-input sr-only"
          type="range"
          min={0}
          max={100}
          step={1}
          value={pct}
          aria-label={`How well do you know ${name}? 0 to 100 percent`}
          aria-valuetext={`${pct}% — ${circularLabel(pct)}`}
          onChange={(e) => {
            markInteracted();
            set(Number(e.target.value));
          }}
          onKeyDown={(e) => {
            if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End', 'PageUp', 'PageDown'].includes(e.key)) markInteracted();
          }}
        />
      </div>
      <p className={`circular-hint ${touched ? 'is-hidden' : ''}`}>Drag the dot clockwise</p>
      <Button
        onClick={() => onConfirm(Math.round(valueRef.current), Math.round(performance.now() - started.current))}
        disabled={!touched}
      >
        Continue
      </Button>
    </div>
  );
}
