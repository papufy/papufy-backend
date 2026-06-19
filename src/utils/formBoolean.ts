import { z } from "zod";

/** Interpreta booleans vindos de multipart/form-data ("false" ≠ true). */
export function formBoolean(defaultValue = false) {
  return z.preprocess((value) => {
    if (value === undefined || value === null || value === "") {
      return defaultValue;
    }
    if (value === true || value === "true" || value === "1") return true;
    if (value === false || value === "false" || value === "0") return false;
    return Boolean(value);
  }, z.boolean());
}

export function optionalFormBoolean() {
  return z.preprocess((value) => {
    if (value === undefined || value === null || value === "") return undefined;
    if (value === true || value === "true" || value === "1") return true;
    if (value === false || value === "false" || value === "0") return false;
    return Boolean(value);
  }, z.boolean().optional());
}
