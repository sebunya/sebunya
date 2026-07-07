import type { StatusTone } from '@goldplus/shared';

/**
 * Maps the shared, framework-agnostic status tones to the badge classes
 * used across the web app. One place, so every status badge is consistent.
 */
const TONE_CLASSES: Record<StatusTone, string> = {
  neutral: 'bg-gray-100 text-gray-700 border-gray-200',
  info: 'bg-blue-50 text-blue-700 border-blue-200',
  success: 'bg-green-50 text-green-700 border-green-200',
  warning: 'bg-orange-50 text-orange-700 border-orange-200',
  danger: 'bg-red-50 text-red-700 border-red-200',
};

export function toneClasses(tone: StatusTone): string {
  return TONE_CLASSES[tone] ?? TONE_CLASSES.neutral;
}
