/**
 * RFC 4180 CSV serializer. Handles quoting + escaping for commas,
 * quotes, and newlines. When the report has groups, group keys are
 * emitted as a leading column so the user sees grouping in the file
 * even when their spreadsheet tool ignores blank-row separators.
 *
 * Security: any cell beginning with a spreadsheet formula trigger
 * (=, +, -, @, tab, CR) is prefixed with a single apostrophe so
 * spreadsheet software imports it as inert text, never as an
 * executable formula (KNOXNET-FIXES Source_Fix_Item 1).
 */

import type { ReportResult } from "../engine";
import { formatCell } from "../engine";
import { getByPath } from "../paths";

/**
 * First characters that spreadsheet applications treat as the start of
 * a formula when they import a CSV cell (Formula_Trigger).
 */
const FORMULA_TRIGGERS = new Set(["=", "+", "-", "@", "\t", "\r"]);

/**
 * Prefix a single apostrophe to a value that begins with a formula
 * trigger so spreadsheet software imports the cell as inert text
 * rather than an executable formula (Formula_Neutralization).
 */
export function neutralizeFormulaTrigger(value: string): string {
  const first = value[0];
  if (!first || !FORMULA_TRIGGERS.has(first)) return value;
  return "'" + value;
}

export function csvCell(value: string): string {
  if (value === "") return "";
  // Neutralize before quoting so the apostrophe prefix lands inside
  // the quoted cell.
  const safe = neutralizeFormulaTrigger(value);
  // Quote if the value contains any of the special chars, doubling
  // any embedded quotes per the RFC.
  if (/[",\r\n]/.test(safe)) {
    return '"' + safe.replace(/"/g, '""') + '"';
  }
  return safe;
}

export function reportToCsv(result: ReportResult): string {
  const groupHeaders = result.meta.template.groupBy ?? [];
  const groupCols = groupHeaders.map((g) => `Group: ${g}`);
  const headers = [...groupCols, ...result.columns.map((c) => c.header)];
  const lines: string[] = [headers.map(csvCell).join(",")];
  for (const group of result.groups) {
    for (const row of group.rows) {
      const cells: string[] = [];
      for (const key of group.key) cells.push(csvCell(key));
      for (const col of result.columns) {
        cells.push(csvCell(formatCell(getByPath(row, col.field), col.format)));
      }
      lines.push(cells.join(","));
    }
  }
  return lines.join("\r\n");
}
