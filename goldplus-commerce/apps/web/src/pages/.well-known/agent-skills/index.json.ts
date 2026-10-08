import type { APIRoute } from 'astro';
import { SKILL_DESCRIPTION, SKILL_DIGEST, SKILL_NAME } from '../../../lib/agentSkill';

/** /.well-known/agent-skills/index.json — Agent Skills Discovery v0.2.0. */
export const GET: APIRoute = () =>
  new Response(
    JSON.stringify(
      {
        $schema: 'https://schemas.agentskills.io/discovery/0.2.0/schema.json',
        skills: [{ name: SKILL_NAME, type: 'skill-md', description: SKILL_DESCRIPTION, url: `/.well-known/agent-skills/${SKILL_NAME}/SKILL.md`, digest: SKILL_DIGEST }],
      },
      null,
      2,
    ),
    { headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'public, max-age=3600' } },
  );
