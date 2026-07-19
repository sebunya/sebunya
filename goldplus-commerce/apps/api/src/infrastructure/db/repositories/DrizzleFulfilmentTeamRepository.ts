import { db } from '../client';
import { fulfilmentTeams, fulfilmentTeamMembers } from '../schema/fulfilment';
import { and, eq, count } from 'drizzle-orm';
import {
  IFulfilmentTeamRepository,
  FulfilmentTeam,
  FulfilmentTeamMember,
} from '../../../application/ports/IFulfilmentTeamRepository';

export class DrizzleFulfilmentTeamRepository implements IFulfilmentTeamRepository {
  async createTeam(input: { name: string; slug: string }) {
    const inserted = await db
      .insert(fulfilmentTeams)
      .values({ name: input.name, slug: input.slug })
      .onConflictDoNothing({ target: fulfilmentTeams.slug })
      .returning();
    if (inserted.length === 0) return { ok: false as const, code: 'DUPLICATE' as const };
    const t = inserted[0];
    return { ok: true as const, team: { id: t.id, name: t.name, slug: t.slug, active: t.active } };
  }

  async listTeams(): Promise<FulfilmentTeam[]> {
    const teams = await db.select().from(fulfilmentTeams).orderBy(fulfilmentTeams.name);
    const counts = await db
      .select({ teamId: fulfilmentTeamMembers.teamId, value: count() })
      .from(fulfilmentTeamMembers)
      .where(eq(fulfilmentTeamMembers.active, true))
      .groupBy(fulfilmentTeamMembers.teamId);
    const byTeam = new Map(counts.map((c) => [c.teamId, Number(c.value)]));
    return teams.map((t) => ({ id: t.id, name: t.name, slug: t.slug, active: t.active, memberCount: byTeam.get(t.id) ?? 0 }));
  }

  async findById(teamId: string): Promise<FulfilmentTeam | null> {
    const [t] = await db.select().from(fulfilmentTeams).where(eq(fulfilmentTeams.id, teamId)).limit(1);
    return t ? { id: t.id, name: t.name, slug: t.slug, active: t.active } : null;
  }

  async addMember(teamId: string, userId: string): Promise<{ added: boolean }> {
    const inserted = await db
      .insert(fulfilmentTeamMembers)
      .values({ teamId, userId, active: true })
      .onConflictDoUpdate({
        target: [fulfilmentTeamMembers.teamId, fulfilmentTeamMembers.userId],
        set: { active: true },
      })
      .returning({ id: fulfilmentTeamMembers.id });
    return { added: inserted.length > 0 };
  }

  async removeMember(teamId: string, userId: string): Promise<{ removed: boolean }> {
    const updated = await db
      .update(fulfilmentTeamMembers)
      .set({ active: false })
      .where(and(eq(fulfilmentTeamMembers.teamId, teamId), eq(fulfilmentTeamMembers.userId, userId), eq(fulfilmentTeamMembers.active, true)))
      .returning({ id: fulfilmentTeamMembers.id });
    return { removed: updated.length > 0 };
  }

  async listMembers(teamId: string): Promise<FulfilmentTeamMember[]> {
    const rows = await db
      .select()
      .from(fulfilmentTeamMembers)
      .where(and(eq(fulfilmentTeamMembers.teamId, teamId), eq(fulfilmentTeamMembers.active, true)));
    return rows.map((r) => ({ userId: r.userId, active: r.active }));
  }

  async isMember(teamId: string, userId: string): Promise<boolean> {
    const [row] = await db
      .select({ id: fulfilmentTeamMembers.id })
      .from(fulfilmentTeamMembers)
      .where(and(eq(fulfilmentTeamMembers.teamId, teamId), eq(fulfilmentTeamMembers.userId, userId), eq(fulfilmentTeamMembers.active, true)))
      .limit(1);
    return !!row;
  }

  async listLeads(teamId: string): Promise<string[]> {
    const rows = await db
      .select({ userId: fulfilmentTeamMembers.userId })
      .from(fulfilmentTeamMembers)
      .where(and(eq(fulfilmentTeamMembers.teamId, teamId), eq(fulfilmentTeamMembers.active, true), eq(fulfilmentTeamMembers.isLead, true)));
    return rows.map((r) => r.userId);
  }

  async setLead(teamId: string, userId: string, isLead: boolean): Promise<{ updated: boolean }> {
    const updated = await db
      .update(fulfilmentTeamMembers)
      .set({ isLead })
      .where(and(eq(fulfilmentTeamMembers.teamId, teamId), eq(fulfilmentTeamMembers.userId, userId), eq(fulfilmentTeamMembers.active, true)))
      .returning({ id: fulfilmentTeamMembers.id });
    return { updated: updated.length > 0 };
  }
}
