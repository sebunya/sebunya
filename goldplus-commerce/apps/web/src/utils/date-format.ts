const displayDateTime = new Intl.DateTimeFormat('en-UG', {
  dateStyle: 'medium',
  timeStyle: 'short',
  timeZone: 'Africa/Kampala',
});

export function formatDisplayDateTime(
  value: string | number | Date | null | undefined,
  fallback = 'Not recorded',
): string {
  if (value === null || value === undefined || value === '') return fallback;

  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return fallback;

  return displayDateTime.format(date);
}
