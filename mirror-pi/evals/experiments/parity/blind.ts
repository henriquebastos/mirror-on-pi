// Blind grading: an answer without the layout that names an arm. Mirror Mind's mode banner, box borders, and quotation
// marks go; the text inside boxes and cards stays.
export function blind(answer: string): string {
  const boxes = answer.replace(/╭[^╯]*?MODE ACTIVE[^╯]*?available lenses[^╯]*?╯/gs, "");
  return boxes
    .replace(/<<<(?:ARIAD|END):[^>]*>>>/g, "")
    .replace(/[╭╮╰╯│─━┃┌┐└┘├┤┬┴┼═║╔╗╚╝]/g, " ")
    .split("\n")
    .map((line) => line.replace(/^\s*>\s?/, "").replace(/[ \t]+/g, " ").trim())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
