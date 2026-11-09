/**
 * E1 多租户、角色权限与伦理墙 / 利益冲突隔离。
 * 原则：权限继承项目级名单，不另配一套独立权限表；
 * 被排除的用户即使角色再高也不能访问该 matter。
 */

export type Role = 'owner' | 'admin' | 'lawyer' | 'viewer';
export type Action = 'read' | 'write' | 'export' | 'manage';

const PERMISSIONS: Record<Role, Action[]> = {
  owner: ['read', 'write', 'export', 'manage'],
  admin: ['read', 'write', 'export'],
  lawyer: ['read', 'write'],
  viewer: ['read'],
};

export interface Matter {
  id: string;
  name: string;
  allowedUsers: string[];
  blockedUsers?: string[];
}

export interface Tenant {
  id: string;
  name: string;
  members: { userId: string; role: Role }[];
  matters: Matter[];
}

export class PermissionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PermissionError';
  }
}

export class TenancyGuard {
  private tenants = new Map<string, Tenant>();

  addTenant(tenant: Tenant): Tenant {
    this.tenants.set(tenant.id, tenant);
    return tenant;
  }

  getTenant(id: string): Tenant | undefined {
    return this.tenants.get(id);
  }

  list(): Tenant[] {
    return [...this.tenants.values()];
  }

  can(userId: string, tenantId: string, action: Action, matterId?: string): boolean {
    const tenant = this.tenants.get(tenantId);
    if (!tenant) return false;
    const member = tenant.members.find((m) => m.userId === userId);
    if (!member || !PERMISSIONS[member.role].includes(action)) return false;
    if (!matterId) return true;
    const matter = tenant.matters.find((m) => m.id === matterId);
    if (!matter) return false;
    if (matter.blockedUsers?.includes(userId)) return false;
    return matter.allowedUsers.includes(userId);
  }

  assert(userId: string, tenantId: string, action: Action, matterId?: string): void {
    if (!this.can(userId, tenantId, action, matterId)) {
      throw new PermissionError(
        `用户 ${userId} 无权在租户 ${tenantId}${matterId ? ` 的项目 ${matterId}` : ''} 执行 ${action}（角色不足或触发伦理墙）`,
      );
    }
  }

  /** 只返回该用户可见的项目，被隔离的项目根本不出现在列表里 */
  listMatters(userId: string, tenantId: string): Matter[] {
    const tenant = this.tenants.get(tenantId);
    if (!tenant) return [];
    return tenant.matters.filter((m) => this.can(userId, tenantId, 'read', m.id));
  }
}

export function demoTenancy(): TenancyGuard {
  const guard = new TenancyGuard();
  guard.addTenant({
    id: 'tenant-demo',
    name: '示例律所（演示）',
    members: [
      { userId: '张律师', role: 'owner' },
      { userId: '李律师', role: 'lawyer' },
      { userId: '王助理', role: 'viewer' },
      { userId: '赵律师', role: 'admin' },
    ],
    matters: [
      { id: 'matter-a', name: '甲公司并购尽调（演示）', allowedUsers: ['张律师', '李律师', '赵律师'], blockedUsers: ['王助理'] },
      { id: 'matter-b', name: '乙公司合同纠纷（演示）', allowedUsers: ['张律师', '王助理', '赵律师'], blockedUsers: ['李律师'] },
    ],
  });
  return guard;
}
