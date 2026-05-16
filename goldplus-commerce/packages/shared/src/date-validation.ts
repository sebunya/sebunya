export type DateRangeValidationInput = {
  start?: string | Date | null;
  end?: string | Date | null;
  allowOpenStart?: boolean;
  allowOpenEnd?: boolean;
  allowSameDay?: boolean;
  mode?: "date" | "datetime";
  fieldNames?: {
    start?: string;
    end?: string;
  };
};

export type DateRangeValidationResult = {
  ok: boolean;
  start?: Date | null;
  end?: Date | null;
  errorCode?: string;
  message?: string;
};

/**
 * Checks if value represents a valid date-only string in YYYY-MM-DD format.
 */
export function isValidDateOnly(value: string | Date | null | undefined): boolean {
  if (!value) return false;
  if (value instanceof Date) return !isNaN(value.getTime());
  if (typeof value !== "string") return false;
  
  const match = value.trim().match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return false;
  
  const year = parseInt(match[1], 10);
  const month = parseInt(match[2], 10) - 1;
  const day = parseInt(match[3], 10);
  
  const date = new Date(Date.UTC(year, month, day));
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month &&
    date.getUTCDate() === day
  );
}

/**
 * Checks if value can be parsed as a valid date or datetime.
 */
export function isValidDateTime(value: string | Date | null | undefined): boolean {
  if (!value) return false;
  if (value instanceof Date) return !isNaN(value.getTime());
  if (typeof value !== "string") return false;
  
  const timestamp = Date.parse(value.trim());
  return !isNaN(timestamp);
}

/**
 * Parses YYYY-MM-DD string into a Date object at UTC midnight.
 */
export function parseIsoDateOnly(value: string | Date | null | undefined): Date | null {
  if (!value) return null;
  if (value instanceof Date) return isNaN(value.getTime()) ? null : value;
  if (typeof value !== "string") return null;
  
  const normalized = value.trim();
  if (!isValidDateOnly(normalized)) return null;
  
  return new Date(normalized);
}

/**
 * Parses any ISO datetime string or Date object into a Date object.
 */
export function parseIsoDateTime(value: string | Date | null | undefined): Date | null {
  if (!value) return null;
  if (value instanceof Date) return isNaN(value.getTime()) ? null : value;
  if (typeof value !== "string") return null;
  
  const timestamp = Date.parse(value.trim());
  return isNaN(timestamp) ? null : new Date(timestamp);
}

/**
 * Normalizes input date range, parsing empty strings to null.
 */
export function normalizeDateRange(input: {
  start?: string | Date | null;
  end?: string | Date | null;
}): { start: string | Date | null; end: string | Date | null } {
  return {
    start: input.start === "" ? null : (input.start ?? null),
    end: input.end === "" ? null : (input.end ?? null),
  };
}

/**
 * Validates a date range based on configurable chronological and format rules.
 */
export function validateDateRange(input: DateRangeValidationInput): DateRangeValidationResult {
  const mode = input.mode ?? "date";
  const allowOpenStart = input.allowOpenStart ?? false;
  const allowOpenEnd = input.allowOpenEnd ?? false;
  const allowSameDay = input.allowSameDay ?? true;
  
  // Normalize empty strings
  const rawStart = input.start === "" ? null : (input.start ?? null);
  const rawEnd = input.end === "" ? null : (input.end ?? null);
  
  // 1. Mandatory check
  if (!allowOpenStart && rawStart === null) {
    return {
      ok: false,
      errorCode: "START_REQUIRED",
      message: "Start date is required.",
    };
  }
  
  if (!allowOpenEnd && rawEnd === null) {
    return {
      ok: false,
      errorCode: "END_REQUIRED",
      message: "End date is required.",
    };
  }
  
  // 2. Format / Validity check
  let start: Date | null = null;
  let end: Date | null = null;
  
  if (rawStart !== null) {
    if (mode === "date") {
      start = parseIsoDateOnly(rawStart);
    } else {
      start = parseIsoDateTime(rawStart);
    }
    
    if (!start) {
      return {
        ok: false,
        errorCode: "INVALID_START_DATE",
        message: "Enter a valid start date.",
      };
    }
  }
  
  if (rawEnd !== null) {
    if (mode === "date") {
      end = parseIsoDateOnly(rawEnd);
    } else {
      end = parseIsoDateTime(rawEnd);
    }
    
    if (!end) {
      return {
        ok: false,
        errorCode: "INVALID_END_DATE",
        message: "Enter a valid end date.",
      };
    }
  }
  
  // 3. Chronological checks
  if (start !== null && end !== null) {
    const startTime = start.getTime();
    const endTime = end.getTime();
    
    if (endTime < startTime) {
      return {
        ok: false,
        errorCode: "END_BEFORE_START",
        message: "End date cannot be earlier than start date.",
      };
    }
    
    if (startTime === endTime && !allowSameDay) {
      return {
        ok: false,
        errorCode: "SAME_DAY_NOT_ALLOWED",
        message: "Same day is not allowed.",
      };
    }
  }
  
  return {
    ok: true,
    start,
    end,
  };
}

/**
 * Validates a range where both endpoints are fully optional (e.g. filters or open rules).
 */
export function validateOptionalDateRange(input: Omit<DateRangeValidationInput, "allowOpenStart" | "allowOpenEnd">): DateRangeValidationResult {
  return validateDateRange({
    ...input,
    allowOpenStart: true,
    allowOpenEnd: true,
  });
}
