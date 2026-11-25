export function codeFence(line: string) {
  return line.match(/^( *)(`{3,}(?!`)(?=[^`]*$)|~{3,})(.*)$/);
}

export function closesFence(line: string, marker: string) {
  const end = line.trim();
  return end.length >= marker.length && [...end].every((char) => char === marker[0]);
}
