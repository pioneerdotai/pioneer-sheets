/** Zero-based spreadsheet coordinates; callers validate their own range limits. */
export function columnIndex(name: string) {
  return (
    [...name.toUpperCase()].reduce(
      (index, character) => index * 26 + character.charCodeAt(0) - 64,
      0,
    ) - 1
  );
}

export function columnName(index: number) {
  let name = "";
  for (index++; index; index = Math.floor((index - 1) / 26))
    name = String.fromCharCode(65 + ((index - 1) % 26)) + name;
  return name;
}

export function cellAddress(row: number, column: number) {
  return columnName(column) + (row + 1);
}
