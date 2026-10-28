const currency = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });
export const money = (n) => currency.format(Number(n || 0));

export const dateTime = (d) =>
  d ? new Date(d.endsWith && !d.endsWith('Z') && !/[+-]\d\d:\d\d$/.test(d) ? `${d}Z` : d).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }) : '';

export const STATUS_LABELS = {
  Submitted: 'Submitted',
  Processing: 'Processing',
  SentToStore: 'Sent to store',
  Delivered: 'Delivered',
  Cancelled: 'Cancelled',
};
