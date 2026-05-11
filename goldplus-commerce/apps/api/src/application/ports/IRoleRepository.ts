export interface IRoleRepository {
  /**
   * Returns every permission code (`"orders.read"`, `"products.publish"`, …)
   * granted to this user through their role assignments.
   * Empty array means the user has no admin access.
   */
  findPermissionsForUser(userId: string): Promise<string[]>;
}
