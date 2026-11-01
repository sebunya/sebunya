import type { APIRoute } from 'astro';
import { SKILL_MD } from '../../../../lib/agentSkill';

/** The skill file itself: byte-for-byte the string the index's digest is computed over. */
export const GET: APIRoute = () =>
  new Response(SKILL_MD, {
    headers: { 'Content-Type': 'text/markdown; charset=utf-8', 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'public, max-age=3600' },
  });
