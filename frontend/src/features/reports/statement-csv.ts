export interface StatementRow {
  transactionDate: string;
  description: string;
  reference: string;
  debitAmount: string;
  creditAmount: string;
}
/** Strict CSV reader supports quoted commas, escaped quotes, CRLF and UTF-8 BOM. */
export function parseStatementCsv(input: string): StatementRow[] {
  if (input.length > 2_000_000) throw new Error('Choose a CSV smaller than 2 MB.');
  const text = input.replace(/^\uFEFF/, '');
  const records: string[][] = [];
  let record: string[] = [],
    field = '',
    quoted = false,
    closed = false;
  const pushField = () => {
    record.push(field);
    field = '';
    closed = false;
  };
  const pushRow = () => {
    pushField();
    if (record.some((v) => v.trim())) records.push(record);
    record = [];
  };
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          quoted = false;
          closed = true;
        }
      } else field += c;
    } else if (c === ',') pushField();
    else if (c === '\r' || c === '\n') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      pushRow();
    } else if (c === '"' && !field && !closed) quoted = true;
    else if (closed || c === '"') throw new Error('Malformed quoted CSV field.');
    else field += c;
  }
  if (quoted) throw new Error('A quoted CSV field is not closed.');
  if (field || record.length || closed) pushRow();
  const expected = ['date', 'description', 'reference', 'debit', 'credit'];
  if (
    records
      .shift()
      ?.map((v) => v.trim().toLowerCase())
      .join(',') !== expected.join(',')
  )
    throw new Error('Use these CSV headers in order: date,description,reference,debit,credit');
  if (!records.length || records.length > 1000)
    throw new Error('Import between 1 and 1,000 lines at a time.');
  return records.map((r, i) => {
    if (r.length !== 5) throw new Error(`Row ${i + 2}: expected five columns.`);
    const [date, description, reference, debit, credit] = r.map((v) => v.trim());
    const parsed = new Date(date);
    if (
      !/^\d{4}-\d{2}-\d{2}$/.test(date) ||
      !Number.isFinite(parsed.getTime()) ||
      parsed.toISOString().slice(0, 10) !== date
    )
      throw new Error(`Row ${i + 2}: use a valid YYYY-MM-DD date.`);
    const amounts = [debit || '0', credit || '0'];
    if (amounts.some((v) => !/^\d{1,14}(\.\d{1,4})?$/.test(v)))
      throw new Error(
        `Row ${i + 2}: use non-negative amounts, without thousands separators, with up to four decimal places.`,
      );
    const positive = (s: string) => /[1-9]/.test(s);
    if (positive(amounts[0]) === positive(amounts[1]))
      throw new Error(`Row ${i + 2}: enter exactly one positive debit or credit.`);
    if (!description || description.length > 500 || reference.length > 200)
      throw new Error(`Row ${i + 2}: check description and reference lengths.`);
    return {
      transactionDate: date,
      description,
      reference,
      debitAmount: amounts[0],
      creditAmount: amounts[1],
    };
  });
}
