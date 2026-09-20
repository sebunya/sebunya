/**
 * The Mustache subset the email templates actually use: variables, sections,
 * inverted sections and loops over arrays of objects.
 *
 * Written rather than pulled in because the surface is small and a money-path
 * dependency should be readable in one sitting. It is deliberately strict: a
 * variable with no value throws instead of rendering an empty space, because a
 * receipt that says "Your payment of  is confirmed" is worse than one that
 * never sends and alarms.
 */
export type TemplateValue = string | number | boolean | null | undefined | TemplateData | TemplateValue[];
export interface TemplateData { [key: string]: TemplateValue }

const ESCAPES: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const escapeHtml = (v: string) => v.replace(/[&<>"']/g, (c) => ESCAPES[c]);

function lookup(stack: TemplateData[], path: string): TemplateValue {
  if (path === '.') return stack[stack.length - 1] as TemplateValue;
  const [head, ...rest] = path.split('.');
  for (let i = stack.length - 1; i >= 0; i--) {
    const scope = stack[i];
    if (scope && typeof scope === 'object' && head in scope) {
      let value: TemplateValue = scope[head];
      for (const part of rest) {
        if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
        value = (value as TemplateData)[part];
      }
      return value;
    }
  }
  return undefined;
}

const truthy = (v: TemplateValue): boolean =>
  Array.isArray(v) ? v.length > 0 : v !== undefined && v !== null && v !== false && v !== '';

export interface RenderOptions {
  /** HTML escaping is right for an HTML body and wrong for a plain-text one. */
  escape?: boolean;
}

export function renderTemplate(template: string, data: TemplateData, options: RenderOptions = {}): string {
  const escape = options.escape !== false;
  const missing: string[] = [];

  function walk(input: string, stack: TemplateData[]): string {
    let out = '';
    let i = 0;
    const tag = /\{\{([#^/]?)([a-zA-Z0-9_.]+)\}\}/g;
    tag.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = tag.exec(input))) {
      out += input.slice(i, m.index);
      const [full, sigil, name] = m;
      if (sigil === '#' || sigil === '^') {
        // Find this section's matching close, allowing the same name to nest.
        const close = `{{/${name}}}`;
        let depth = 1;
        let cursor = tag.lastIndex;
        let end = -1;
        const scan = new RegExp(`\\{\\{([#^/])${name}\\}\\}`, 'g');
        scan.lastIndex = cursor;
        let s: RegExpExecArray | null;
        while ((s = scan.exec(input))) {
          depth += s[1] === '/' ? -1 : 1;
          if (depth === 0) { end = s.index; cursor = s.index + close.length; break; }
        }
        if (end === -1) throw new Error(`TEMPLATE_UNCLOSED_SECTION: {{${sigil}${name}}} has no {{/${name}}}`);
        const inner = input.slice(tag.lastIndex, end);
        const value = lookup(stack, name);
        if (sigil === '#') {
          if (Array.isArray(value)) {
            for (const item of value) {
              out += walk(inner, [...stack, (typeof item === 'object' && item !== null ? item : { '.': item }) as TemplateData]);
            }
          } else if (truthy(value)) {
            out += walk(inner, typeof value === 'object' && value !== null && !Array.isArray(value) ? [...stack, value as TemplateData] : stack);
          }
        } else if (!truthy(value)) {
          out += walk(inner, stack);
        }
        i = cursor;
        tag.lastIndex = cursor;
        continue;
      }
      const value = lookup(stack, name);
      if (value === undefined || value === null) missing.push(name);
      const asString = value === undefined || value === null ? '' : String(value);
      out += escape ? escapeHtml(asString) : asString;
      i = tag.lastIndex;
    }
    return out + input.slice(i);
  }

  const result = walk(template, [data]);
  if (missing.length) {
    // Loud, not blank: an email with a hole in it reaches a customer looking broken.
    throw new Error(`TEMPLATE_MISSING_VALUES: ${[...new Set(missing)].join(', ')}`);
  }
  return result;
}
