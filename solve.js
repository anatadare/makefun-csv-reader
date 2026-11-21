// A fast drop-in for csv-reader 1.0.0: run(input) returns {columns, rows, errors} exactly as the
// reference does, but by jumping between delimiters with indexOf instead of reading one character at a
// time. The reading policy, from the competition spec:
// - A U+FEFF at the very start is dropped. A record ends at LF or CRLF; a line left with no characters
//   is no record. Outside quotes a CR not followed by LF is dropped (stray_cr).
// - A field opening with a quote runs to the next quote that is not doubled; "" inside it is one quote,
//   and each CRLF or lone CR inside it is read as LF. What follows the closing quote, up to the next
//   comma or line break, is appended as it stands (quote_junk, when the field ends). A quote that never
//   closes is a literal character, and the text after it is read again as unquoted (unterminated_quote).
// - A quote inside an unquoted field is a literal character. Fields stay strings, never trimmed or
//   converted. columns is the first record when header is true, else null; rows holds the records after
//   it (every record when header is false), each padded with "" (short_row, with fields: its field
//   count) or cut (long_row, with extra: the cut fields) to the first record's width. Each error is
//   {code, line, row}, in the order met: line the 1-based line its record starts on, counting every LF,
//   CRLF and lone CR inside quotes, and row its record's index in rows, null for the header.
//
// How it stays fast: a record with no quote and no stray CR is split in one native call; every other
// field is located by indexOf and taken as a slice, so the hot loop never touches one character at a
// time. Only the rare broken corners (stray CRs, newlines inside quotes, doubled quotes, junk after a
// closing quote) take a slower path, and the next line break is remembered across a record's fields
// instead of searched for again on each one.

/** How a field ended: at a comma (the record goes on), at a line break, or at the end of the text. */
const AT_COMMA = 0;
const AT_BREAK = 1;
const AT_END = 2;

/** csv-reader 1.0.0's answer for one case's input, {text, header}: {columns, rows, errors}. */
export function run(input) {
  const text = String(input.text);
  const header = input.header === true;
  const n = text.length;
  const errors = [];
  const rows = [];
  let columns = null;
  let width = -1;

  let pos = text.charCodeAt(0) === 0xfeff ? 1 : 0; // the next character to read
  let line = 1; // the line that character is on
  let recordLine = 1; // the line the record being read starts on
  let recordRow = null; // its index in rows (null: the header)
  // The next LF at or after the current field's start, -1 when there is none, -2 when unknown.
  let lineEnd = -2;
  // The stretch of the record already checked for a stray CR, and whether it holds none: an
  // unquoted field inside a CR-free stretch skips its own check. The stretch ends at the next
  // line break; a field past it refreshes both (after a quoted field spanning lines).
  let segLimit = 0;
  let segNoCR = false;
  // The field just scanned: its value and how it ended.
  let fval = '';
  let fend = AT_END;

  /** Records an error for the record being read, at the line it starts on. */
  function note(code) {
    errors.push({ code, line: recordLine, row: recordRow });
  }

  /**
   * Scans an unquoted field starting at p, with `prefix` already in front of it (the literal quote
   * of a field whose opening quote never closed, or ''), and sets fval/fend. A CR not followed by
   * LF is dropped (stray_cr). The field's end is the nearer of the next comma and the next line
   * break; a CR just before that line break belongs to the break (CRLF), not to the field.
   */
  function scanPlain(p, prefix) {
    const c = text.indexOf(',', p);
    if (lineEnd === -2 || (lineEnd !== -1 && lineEnd < p)) lineEnd = text.indexOf('\n', p);
    let end;
    if (c !== -1 && (lineEnd === -1 || c < lineEnd)) {
      end = c;
      fend = AT_COMMA;
    } else if (lineEnd !== -1) {
      end = lineEnd;
      fend = AT_BREAK;
    } else {
      end = n;
      fend = AT_END;
    }
    let fieldEnd = end;
    if (fend === AT_BREAK && end > p && text.charCodeAt(end - 1) === 13) fieldEnd = end - 1;
    let seg = text.slice(p, fieldEnd);
    // A stray CR can only hide where the record's checked stretch has one: refresh the stretch
    // once a field starts past it, then check the field only when the stretch holds a CR.
    if (p > segLimit) {
      segLimit = lineEnd === -1 ? n : lineEnd;
      segNoCR = text.slice(p, segLimit).indexOf('\r') === -1;
    }
    if (!segNoCR && seg.indexOf('\r') !== -1) {
      const parts = seg.split('\r');
      for (let i = 1; i < parts.length; i++) note('stray_cr');
      seg = parts.join('');
    }
    fval = prefix === '' ? seg : prefix + seg;
    pos = fend === AT_END ? n : end + 1;
    if (fend === AT_BREAK) {
      line += 1;
      lineEnd = -2;
    }
  }

  /** Pads or cuts a finished record to the first record's width, or keeps it as the header. */
  function finishRecord(fields) {
    if (width < 0) width = fields.length;
    if (header && columns === null) {
      columns = fields;
      return;
    }
    if (fields.length < width) {
      errors.push({ code: 'short_row', line: recordLine, row: recordRow, fields: fields.length });
      while (fields.length < width) fields.push('');
    } else if (fields.length > width) {
      errors.push({ code: 'long_row', line: recordLine, row: recordRow, extra: fields.splice(width) });
    }
    rows.push(fields);
  }

  while (pos < n) {
    // Lines with no characters are no records.
    while (pos < n) {
      const ch = text.charCodeAt(pos);
      if (ch === 10) {
        pos += 1;
        line += 1;
      } else if (ch === 13 && text.charCodeAt(pos + 1) === 10) {
        pos += 2;
        line += 1;
      } else {
        break;
      }
    }
    if (pos >= n) break;

    recordLine = line;
    recordRow = header && columns === null ? null : rows.length;

    // Fast path: a record holding no quote and no stray CR splits in one native call. Its end is
    // the next LF (a CR just before it belongs to the CRLF break, not to the record).
    const nl = text.indexOf('\n', pos);
    let segEnd = nl === -1 ? n : nl;
    // A CR just before the LF belongs to the CRLF break; a CR at the end of the text, with no LF
    // after it, is a stray CR and stays in the record (the slow path reports it).
    if (nl !== -1 && segEnd > pos && text.charCodeAt(segEnd - 1) === 13) segEnd -= 1;
    const q = text.indexOf('"', pos);
    if (q === -1 || q >= segEnd) {
      const r = text.indexOf('\r', pos);
      if (r === -1 || r >= segEnd) {
        finishRecord(text.slice(pos, segEnd).split(','));
        pos = nl === -1 ? n : nl + 1;
        if (nl !== -1) line += 1;
        lineEnd = -2;
        continue;
      }
    }

    // Slow path: the record holds a quote or a stray CR; read it field by field. The checked
    // stretch starts as the record's first line (its CRLF break excluded, as segEnd has it).
    lineEnd = nl;
    segLimit = segEnd;
    segNoCR = text.slice(pos, segEnd).indexOf('\r') === -1;
    const fields = [];
    let quoted = false;
    do {
      const fs = pos;
      if (text.charCodeAt(fs) === 34) {
        quoted = true;
        // A quoted field: find the quote that closes it, stepping over doubled quotes.
        let j = text.indexOf('"', fs + 1);
        let parts = null;
        let segStart = fs + 1;
        while (j !== -1 && text.charCodeAt(j + 1) === 34) {
          if (parts === null) parts = [];
          parts.push(text.slice(segStart, j));
          segStart = j + 2;
          j = text.indexOf('"', segStart);
        }
        if (j === -1) {
          // The quote never closes: it is a literal character, and the text after it is read
          // again as unquoted. No line was counted for the failed scan, so none is undone.
          note('unterminated_quote');
          scanPlain(fs + 1, '"');
        } else {
          let content;
          if (parts === null) {
            content = text.slice(segStart, j);
          } else {
            parts.push(text.slice(segStart, j));
            content = parts.join('"');
          }
          // Each CRLF or lone CR inside quotes is one LF, and every line break inside quotes
          // counts toward the line the next record starts on. A line break shows in the
          // next-LF hint: when the hint falls before the closing quote, the content holds
          // one; a lone CR is caught by the check on the content itself.
          if (lineEnd === -2 || (lineEnd !== -1 && lineEnd < fs)) lineEnd = text.indexOf('\n', fs);
          if ((lineEnd !== -1 && lineEnd < j) || content.indexOf('\r') !== -1) {
            const flat = content.replaceAll('\r\n', '\n').replaceAll('\r', '\n');
            let breaks = 0;
            let at = -1;
            while ((at = flat.indexOf('\n', at + 1)) !== -1) breaks += 1;
            line += breaks;
            content = flat;
          }
          pos = j + 1;
          if (pos >= n) {
            fval = content;
            fend = AT_END;
          } else {
            const ch = text.charCodeAt(pos);
            if (ch === 44) {
              pos += 1;
              fval = content;
              fend = AT_COMMA;
            } else if (ch === 10) {
              pos += 1;
              line += 1;
              lineEnd = -2;
              fval = content;
              fend = AT_BREAK;
            } else if (ch === 13 && text.charCodeAt(pos + 1) === 10) {
              pos += 2;
              line += 1;
              lineEnd = -2;
              fval = content;
              fend = AT_BREAK;
            } else {
              // What follows the closing quote is appended as it stands, up to the next comma
              // or line break (quote_junk, when the field ends with anything appended).
              scanPlain(pos, content);
              if (fval.length > content.length) note('quote_junk');
            }
          }
        }
      } else {
        quoted = false;
        scanPlain(fs, '');
      }
      fields.push(fval);
    } while (fend === AT_COMMA);

    // A line that held only stray CRs is left with no characters: no record (its errors stay).
    if (fields.length === 1 && fields[0] === '' && !quoted) continue;
    finishRecord(fields);
  }
  return { columns: header ? (columns ?? []) : null, rows, errors };
}
