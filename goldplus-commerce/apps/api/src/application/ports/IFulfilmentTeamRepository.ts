export interface FulfilmentTeam {
  id: string;
  name: string;
  slug: string;
  active: boolean;
  memberCount?: number;
}

export interface FulfilmentTeamMember {
  userId: string;
  active: boolean;
}

export interface IFulfilmentTeamRepository {
  createTeam(input: { name: string; slug: string }): Promise<{ ok: true; team: FulfilmentTeam } | { ok: false; code: 'DUPLICATE' }>;
  listTeams(): Promise<FulfilmentTeam[]>;
  findById(teamId: string): Promise<FulfilmentTeam | null>;
  addMember(teamId: string, userId: string): Promise<{ added: boolean }>;
  removeMember(teamId: string, userId: string): Promise<{ removed: boolean }>;
  listMembers(teamId: string): Promise<FulfilmentTeamMember[]>;
  /** True when the user is an active member of the team. */
  isMember(teamId: string, userId: string): Promise<boolean>;
  /** Active team leads (is_lead) for escalation routing. */
  listLeads(teamId: string): Promise<string[]>;
  /** Set or clear a member's team-lead flag. */
  setLead(teamId: string, userId: string, isLead: boolean): Promise<{ updated: boolean }>;
}
