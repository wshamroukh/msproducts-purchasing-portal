import { useState } from 'react';
import { downloadPdf } from '../lib/api';

/** "Download PDF" button for an order; shows progress while the Function App renders the PDF. */
export default function PdfButton({ path, filename, className = 'btn', block = false }) {
  const [state, setState] = useState('idle'); // idle | loading | waiting
  const [error, setError] = useState(null);
  const click = async () => {
    setState('loading');
    setError(null);
    try {
      await downloadPdf(path, filename, { onWaiting: () => setState('waiting') });
    } catch (err) {
      setError(err.message);
    } finally {
      setState('idle');
    }
  };
  return (
    <>
      <button className={`${className}${block ? ' btn-block' : ''}`} disabled={state !== 'idle'} onClick={click}>
        {state === 'waiting' ? 'Generating PDF…' : state === 'loading' ? 'Preparing PDF…' : 'Download PDF'}
      </button>
      {error && <div className="alert alert-error small" role="alert" style={{ marginTop: '.5rem' }}>{error}</div>}
    </>
  );
}
