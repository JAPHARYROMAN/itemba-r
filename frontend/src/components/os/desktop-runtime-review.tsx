'use client';
import { useEffect, useRef, useState } from 'react';

/** Opt-in QA surface (?uiReview=performance). No observers run in normal sessions. */
export default function DesktopRuntimeReview() {
  const [running, setRunning] = useState(false);
  const [report, setReport] = useState('Open the windows to review, then start sampling.');
  const stop = useRef<(() => void) | null>(null);
  useEffect(() => {
    if (!running) return;
    const intervals: number[] = [];
    let frame = 0,
      previous = 0,
      elapsed = 0,
      longest = 0,
      tasks = 0;
    const supportsTasks =
      typeof PerformanceObserver !== 'undefined' &&
      PerformanceObserver.supportedEntryTypes.includes('longtask');
    const observer = supportsTasks
      ? new PerformanceObserver((list) => {
          for (const task of list.getEntries()) {
            tasks++;
            longest = Math.max(longest, task.duration);
          }
        })
      : null;
    observer?.observe({ type: 'longtask' });
    const sample = (time: number) => {
      if (document.visibilityState === 'hidden') previous = 0;
      else {
        if (previous) {
          const delta = time - previous;
          intervals.push(delta);
          elapsed += delta;
        }
        previous = time;
      }
      frame = requestAnimationFrame(sample);
    };
    const publish = () => {
      const ordered = [...intervals].sort((a, b) => a - b);
      const p95 = ordered[Math.max(0, Math.ceil(ordered.length * 0.95) - 1)] ?? 0;
      const windows = document.querySelectorAll('.desktop-window').length;
      const visible = document.querySelectorAll('.desktop-window[aria-hidden="false"]').length;
      setReport(
        windows +
          ' windows (' +
          visible +
          ' visible)\n' +
          (elapsed / 1000).toFixed(1) +
          ' seconds · ' +
          intervals.length +
          ' frames\n' +
          (elapsed ? (intervals.length * 1000) / elapsed : 0).toFixed(1) +
          ' average fps\n' +
          p95.toFixed(1) +
          ' ms p95 frame interval\n' +
          (supportsTasks
            ? tasks + ' long tasks · ' + longest.toFixed(1) + ' ms longest'
            : 'Long-task timing unavailable'),
      );
    };
    frame = requestAnimationFrame(sample);
    const timer = window.setInterval(publish, 1000);
    stop.current = publish;
    return () => {
      cancelAnimationFrame(frame);
      clearInterval(timer);
      observer?.disconnect();
      stop.current = null;
    };
  }, [running]);
  return (
    <aside className="desktop-runtime-review" aria-label="UI performance review">
      <strong>UI performance review</strong>
      <p>Local timing only. Includes browser, app and review overhead.</p>
      <output>{report}</output>
      <button
        onClick={() => {
          if (running) stop.current?.();
          setRunning(!running);
        }}
      >
        {running ? 'Stop sampling' : 'Start sampling'}
      </button>
    </aside>
  );
}
