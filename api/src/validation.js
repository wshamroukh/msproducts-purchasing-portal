'use strict';

class ValidationError extends Error {
  constructor(message) {
    super(message);
    this.status = 400;
  }
}

function str(value, field, { required = false, max = 200, min = 0 } = {}) {
  if (value === undefined || value === null || String(value).trim() === '') {
    if (required) throw new ValidationError(`${field} is required`);
    return null;
  }
  const s = String(value).trim();
  if (s.length < min) throw new ValidationError(`${field} must be at least ${min} characters`);
  if (s.length > max) throw new ValidationError(`${field} must be at most ${max} characters`);
  return s;
}

function int(value, field, { required = false, min = -Infinity, max = Infinity } = {}) {
  if (value === undefined || value === null || value === '') {
    if (required) throw new ValidationError(`${field} is required`);
    return null;
  }
  const n = Number(value);
  if (!Number.isInteger(n) || n < min || n > max) throw new ValidationError(`${field} must be a whole number between ${min} and ${max}`);
  return n;
}

function money(value, field, { required = false } = {}) {
  if (value === undefined || value === null || value === '') {
    if (required) throw new ValidationError(`${field} is required`);
    return null;
  }
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0 || n > 99999999) throw new ValidationError(`${field} must be a valid amount`);
  return Math.round(n * 100) / 100;
}

function url(value, field) {
  const s = str(value, field, { max: 500 });
  if (s === null) return null;
  if (!/^https:\/\/[^\s]+$/i.test(s)) throw new ValidationError(`${field} must be an https:// URL`);
  return s;
}

function oneOf(value, field, allowed, { required = false } = {}) {
  if (value === undefined || value === null || value === '') {
    if (required) throw new ValidationError(`${field} is required`);
    return null;
  }
  if (!allowed.includes(value)) throw new ValidationError(`${field} must be one of: ${allowed.join(', ')}`);
  return value;
}

module.exports = { ValidationError, str, int, money, url, oneOf };
