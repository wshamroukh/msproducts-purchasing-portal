import { STATUS_LABELS } from '../lib/format';

export function StatusBadge({ status }) {
  return <span className={`badge badge-${status}`}>{STATUS_LABELS[status] || status}</span>;
}

export function Spinner({ label = 'Loading…' }) {
  return (
    <div className="spinner-wrap" role="status">
      <div className="spinner" />
      <span>{label}</span>
    </div>
  );
}

export function ErrorBox({ error, onRetry }) {
  if (!error) return null;
  return (
    <div className="alert alert-error" role="alert">
      <strong>Something went wrong.</strong> {error.message || String(error)}
      {onRetry && <button className="btn btn-link" onClick={onRetry}>Try again</button>}
    </div>
  );
}

export function Empty({ title, children }) {
  return (
    <div className="empty">
      <h3>{title}</h3>
      {children}
    </div>
  );
}

const STEPS = ['Submitted', 'Processing', 'SentToStore', 'Delivered'];

export function StatusTracker({ status }) {
  if (status === 'Cancelled') {
    return <div className="alert alert-warn">This order was cancelled.</div>;
  }
  const current = STEPS.indexOf(status);
  return (
    <ol className="tracker">
      {STEPS.map((s, i) => (
        <li key={s} className={i < current ? 'done' : i === current ? 'current' : ''}>
          <span className="dot">{i < current ? '✓' : i + 1}</span>
          <span className="label">{STATUS_LABELS[s]}</span>
        </li>
      ))}
    </ol>
  );
}
