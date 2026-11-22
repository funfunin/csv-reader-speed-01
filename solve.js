// solve.js — CSV parser with csv-reader 1.0.0 semantics, implemented from the prose spec.
// Single pass, driven by indexOf. Fields are sliced, never split wholesale.
// A U+FEFF at the very start is dropped. Records end at LF or CRLF; empty lines
// are skipped. A CR outside quotes that is not followed by LF is dropped and is
// a stray_cr error. A field opening with a quote runs to the next non-doubled
// quote ("" is one quote; CRLF / lone CR inside is read as LF); junk after the
// closing quote is appended as it stands and is a quote_junk error. A quote
// that never closes is literal and the rest is re-read as unquoted
// (unterminated_quote). A quote inside an unquoted field is literal. Rows are
// padded (short_row) or cut (long_row) to the first record's width. Every
// error carries the line its record starts on and the record's index in rows
// (null for the header).
//
// Speed: a quote-free line takes a tight indexOf(',') loop (no per-field
// function call, no per-field return object); only lines that actually
// contain a quote drop to the field-by-field scanner. The field readers
// return just the field string and report where the field ended through
// lastEnd / lastEndPos, so no object is allocated per field.

export function run(input) {
  const text = input.text;
  const header = input.header === true;
  const n = text.length;
  let pos = 0;
  if (n > 0 && text.charCodeAt(0) === 0xFEFF) pos = 1;
  let line = 1;
  let nextCR = text.indexOf('\r', pos);
  let width = -1;
  const records = [];
  const errors = [];
  let recLine = 1;
  let row = null;
  let lastEnd = 'eof';
  let lastEndPos = n;

  const syncCR = (from) => {
    while (nextCR !== -1 && nextCR < from) nextCR = text.indexOf('\r', nextCR + 1);
  };

  // Normalize text[a..b): CRLF and lone CR become LF; count the line breaks.
  const normalizeRange = (a, b) => {
    let out = '';
    let breaks = 0;
    let s = a;
    for (let k = a; k < b; k++) {
      const c = text.charCodeAt(k);
      if (c === 13) {
        out += text.slice(s, k) + '\n';
        breaks++;
        if (k + 1 < b && text.charCodeAt(k + 1) === 10) k++;
        s = k + 1;
      } else if (c === 10) {
        out += text.slice(s, k) + '\n';
        breaks++;
        s = k + 1;
      }
    }
    out += text.slice(s, b);
    return { value: out, breaks };
  };

  const normalizeIfNeeded = (a, b) => {
    syncCR(a);
    const lf = text.indexOf('\n', a);
    if ((lf === -1 || lf >= b) && (nextCR === -1 || nextCR >= b)) {
      return { value: text.slice(a, b), breaks: 0 };
    }
    return normalizeRange(a, b);
  };

  // Read an unquoted field starting at `from`, with `prefix` prepended to the
  // value. Returns the field string; sets lastEnd ('comma' | 'lf' | 'crlf' |
  // 'eof') and lastEndPos (the delimiter's position, or n).
  const readUnquoted = (from, prefix) => {
    let fpos = from;
    let parts = prefix ? [prefix] : null;
    for (;;) {
      const comma = text.indexOf(',', fpos);
      const lf = text.indexOf('\n', fpos);
      syncCR(fpos);
      const cr = nextCR;
      let end = Infinity;
      let kind = 'eof';
      if (comma !== -1 && comma < end) { end = comma; kind = 'comma'; }
      if (lf !== -1 && lf < end) { end = lf; kind = 'lf'; }
      if (cr !== -1 && cr < end) { end = cr; kind = 'cr'; }
      if (kind === 'eof') {
        const tail = text.slice(fpos, n);
        lastEnd = 'eof'; lastEndPos = n;
        return parts ? parts.join('') + tail : tail;
      }
      if (kind === 'comma' || kind === 'lf') {
        const seg = text.slice(fpos, end);
        lastEnd = kind; lastEndPos = end;
        return parts ? parts.join('') + seg : seg;
      }
      // kind === 'cr'
      if (end + 1 < n && text.charCodeAt(end + 1) === 10) {
        const seg = text.slice(fpos, end);
        lastEnd = 'crlf'; lastEndPos = end;
        return parts ? parts.join('') + seg : seg;
      }
      // Stray CR: drop it, record the error, keep reading the field.
      errors.push({ code: 'stray_cr', line: recLine, row });
      (parts || (parts = [])).push(text.slice(fpos, end));
      fpos = end + 1;
      nextCR = text.indexOf('\r', end + 1);
    }
  };

  // Parse a quoted field starting at `start` (text[start] === '"').
  // Returns the field string; sets lastEnd / lastEndPos like readUnquoted.
  const parseQuoted = (start) => {
    let i = start + 1;
    let segStart = i;
    let parts = null;
    for (;;) {
      const q = text.indexOf('"', i);
      if (q === -1) {
        errors.push({ code: 'unterminated_quote', line: recLine, row });
        return readUnquoted(start + 1, '"');
      }
      if (q + 1 < n && text.charCodeAt(q + 1) === 34) {
        const norm = normalizeIfNeeded(segStart, q);
        (parts || (parts = [])).push(norm.value, '"');
        line += norm.breaks;
        i = q + 2;
        segStart = i;
        continue;
      }
      const norm = normalizeIfNeeded(segStart, q);
      (parts || (parts = [])).push(norm.value);
      line += norm.breaks;
      const content = parts.length === 1 ? parts[0] : parts.join('');
      const junk = readUnquoted(q + 1, '');
      if (junk !== '') {
        errors.push({ code: 'quote_junk', line: recLine, row });
      }
      return content + junk;
    }
  };

  const finishRecord = (fields) => {
    if (width === -1) {
      width = fields.length;
    } else if (fields.length < width) {
      errors.push({ code: 'short_row', line: recLine, row, fields: fields.length });
      while (fields.length < width) fields.push('');
    } else if (fields.length > width) {
      errors.push({ code: 'long_row', line: recLine, row, extra: fields.slice(width) });
      fields.length = width;
    }
    records.push(fields);
  };

  while (pos < n) {
    recLine = line;
    const recIdx = records.length;
    row = header ? (recIdx === 0 ? null : recIdx - 1) : recIdx;
    const ch0 = text.charCodeAt(pos);
    if (ch0 === 10) { pos++; line++; continue; }
    if (ch0 === 13) {
      if (pos + 1 < n && text.charCodeAt(pos + 1) === 10) { pos += 2; line++; continue; }
      errors.push({ code: 'stray_cr', line: recLine, row });
      pos++;
      continue;
    }

    // Fast path: if this line holds no quote, the record ends at this line.
    const lineEnd = text.indexOf('\n', pos);
    const spanEnd = lineEnd === -1 ? n : lineEnd;
    const qPos = text.indexOf('"', pos);
    if (qPos === -1 || qPos >= spanEnd) {
      let contentEnd = spanEnd;
      // Only a CR right before a LF is a CRLF; a trailing CR at EOF is stray.
      if (lineEnd !== -1 && contentEnd > pos && text.charCodeAt(contentEnd - 1) === 13) contentEnd--;
      syncCR(pos);
      if (nextCR === -1 || nextCR >= contentEnd) {
        const fields = [];
        let f = pos;
        for (;;) {
          const c = text.indexOf(',', f);
          if (c === -1 || c >= contentEnd) { fields.push(text.slice(f, contentEnd)); break; }
          fields.push(text.slice(f, c));
          f = c + 1;
        }
        finishRecord(fields);
        pos = lineEnd === -1 ? n : lineEnd + 1;
        line++;
        continue;
      }
      // Line holds stray CRs: drop them (each is an error), then split.
      const parts = [];
      let seg = pos;
      let cr = nextCR;
      while (cr !== -1 && cr < contentEnd) {
        parts.push(text.slice(seg, cr));
        errors.push({ code: 'stray_cr', line: recLine, row });
        seg = cr + 1;
        cr = text.indexOf('\r', cr + 1);
      }
      nextCR = cr;
      parts.push(text.slice(seg, contentEnd));
      finishRecord(parts.join('').split(','));
      pos = lineEnd === -1 ? n : lineEnd + 1;
      line++;
      continue;
    }

    // General path: the line contains a quote; scan field by field.
    const fields = [];
    let recDone = false;
    while (!recDone) {
      const value = text.charCodeAt(pos) === 34 ? parseQuoted(pos) : readUnquoted(pos, '');
      fields.push(value);
      if (lastEnd === 'comma') { pos = lastEndPos + 1; continue; }
      if (lastEnd === 'lf') { pos = lastEndPos + 1; line++; recDone = true; }
      else if (lastEnd === 'crlf') { pos = lastEndPos + 2; line++; recDone = true; }
      else { pos = n; recDone = true; }
    }
    finishRecord(fields);
  }

  const columns = header ? (records.length > 0 ? records[0] : null) : null;
  const rows = header ? records.slice(1) : records;
  return { columns, rows, errors };
}
