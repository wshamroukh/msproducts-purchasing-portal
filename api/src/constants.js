'use strict';

const CATEGORIES = ['Software', 'Hardware', 'Accessories'];

const STATUSES = ['Submitted', 'Processing', 'SentToStore', 'Delivered', 'Cancelled'];

// Allowed admin workflow transitions
const TRANSITIONS = {
  Submitted: ['Processing', 'Cancelled'],
  Processing: ['SentToStore', 'Cancelled'],
  SentToStore: ['Delivered', 'Processing', 'Cancelled'],
  Delivered: [],
  Cancelled: [],
};

module.exports = { CATEGORIES, STATUSES, TRANSITIONS };
