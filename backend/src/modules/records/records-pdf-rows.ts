/** Bound each physical row so long notes/receipt lists continue across pages without clipping. */
export function recordsPdfRows(rows: string[][]): string[][] {
  const chunks = (text: string) => {
    const result: string[] = [];
    let part = '',
      lines = 0;
    for (const char of text) {
      part += char;
      if (char === '\n') lines++;
      if (part.length >= 180 || lines >= 6) {
        // Keep ordinary words together while retaining every source character.
        const lastSpace = Math.max(
          part.lastIndexOf(' '),
          part.lastIndexOf('\n'),
          part.lastIndexOf('\t'),
        );
        const end = lastSpace > 0 ? lastSpace + 1 : part.length;
        result.push(part.slice(0, end));
        part = part.slice(end);
        lines = (part.match(/\n/g) || []).length;
      }
    }
    if (part || !result.length) result.push(part);
    return result;
  };
  return rows.flatMap((row) => {
    const cells = row.map(chunks);
    return Array.from({ length: Math.max(...cells.map((cell) => cell.length)) }, (_, i) =>
      cells.map((cell) => cell[i] ?? ''),
    );
  });
}
