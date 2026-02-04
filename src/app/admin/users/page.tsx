'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'

type UserRole = 'super_admin' | 'org_admin'

interface Organization {
  id: string
  name: string
}

interface AppUser {
  id: string
  email: string
  name: string | null
  role: UserRole
  is_active: boolean
  created_at: string
  user_organization_access: Array<{
    organization_id: string
    organizations: Organization
  }>
}

const roleLabels: Record<UserRole, string> = {
  super_admin: 'Super Admin',
  org_admin: 'Org Admin',
}

const roleBadgeColors: Record<UserRole, string> = {
  super_admin: 'bg-purple-500/20 text-purple-400 border-purple-500/30',
  org_admin: 'bg-blue-500/20 text-blue-400 border-blue-500/30',
}

export default function UsersAdminPage() {
  const [users, setUsers] = useState<AppUser[]>([])
  const [organizations, setOrganizations] = useState<Organization[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [showCreateModal, setShowCreateModal] = useState(false)
  const [showAccessModal, setShowAccessModal] = useState<string | null>(null)

  useEffect(() => {
    fetchData()
  }, [])

  async function fetchData() {
    try {
      setLoading(true)
      const [usersRes, orgsRes] = await Promise.all([
        fetch('/api/users'),
        fetch('/api/organizations'),
      ])

      if (!usersRes.ok) throw new Error('Failed to fetch users')
      if (!orgsRes.ok) throw new Error('Failed to fetch organizations')
      setUsers(await usersRes.json())
      setOrganizations(await orgsRes.json())
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error')
    } finally {
      setLoading(false)
    }
  }

  async function updateUserRole(userId: string, role: UserRole) {
    try {
      const res = await fetch(`/api/users/${userId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ role }),
      })

      if (!res.ok) throw new Error('Failed to update user')
      fetchData()
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to update user')
    }
  }

  async function toggleUserActive(userId: string, isActive: boolean) {
    try {
      const res = await fetch(`/api/users/${userId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ is_active: isActive }),
      })

      if (!res.ok) throw new Error('Failed to update user')
      fetchData()
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to update user')
    }
  }

  async function addAccess(userId: string, id: string) {
    try {
      const res = await fetch(`/api/users/${userId}/access`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: 'organization',
          organization_id: id,
        }),
      })

      if (!res.ok) {
        const err = await res.json()
        throw new Error(err.error || 'Failed to add access')
      }

      fetchData()
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to add access')
    }
  }

  async function removeAccess(userId: string, accessId: string) {
    try {
      const res = await fetch(`/api/users/${userId}/access?type=organization&access_id=${accessId}`, {
        method: 'DELETE',
      })

      if (!res.ok) throw new Error('Failed to remove access')
      fetchData()
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to remove access')
    }
  }

  async function deleteUser(userId: string, email: string) {
    if (!confirm(`Are you sure you want to delete ${email}? This cannot be undone.`)) {
      return
    }

    try {
      const res = await fetch(`/api/users/${userId}`, {
        method: 'DELETE',
      })

      if (!res.ok) throw new Error('Failed to delete user')
      fetchData()
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to delete user')
    }
  }

  async function resetUserPassword(userId: string, email: string) {
    const newPassword = prompt(`Set a new password for ${email}`)
    if (!newPassword) return

    try {
      const res = await fetch(`/api/users/${userId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: newPassword }),
      })

      if (!res.ok) {
        const err = await res.json()
        throw new Error(err.error || 'Failed to reset password')
      }

      alert('Password updated')
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to reset password')
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-zinc-950 text-zinc-100 flex items-center justify-center">
        <p className="text-zinc-400">Loading...</p>
      </div>
    )
  }

  if (error) {
    return (
      <div className="min-h-screen bg-zinc-950 text-zinc-100 flex items-center justify-center">
        <div className="text-center">
          <p className="text-red-400 mb-4">Error: {error}</p>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100">
      <div className="max-w-6xl mx-auto px-6 py-8">
        <div className="flex items-center justify-between mb-8">
          <div>
            <Link href="/admin" className="text-zinc-500 hover:text-zinc-300 text-sm mb-2 block">
              &larr; Back to Admin
            </Link>
            <h1 className="text-3xl font-bold">User Management</h1>
          </div>
          <button
            onClick={() => setShowCreateModal(true)}
            className="px-4 py-2 bg-zinc-800 hover:bg-zinc-700 rounded-lg"
          >
            + Add User
          </button>
        </div>

        <div className="bg-zinc-900 rounded-lg border border-zinc-800 overflow-hidden">
          <table className="w-full">
            <thead className="bg-zinc-800/50">
              <tr>
                <th className="text-left px-4 py-3 text-sm font-medium text-zinc-400">User</th>
                <th className="text-left px-4 py-3 text-sm font-medium text-zinc-400">Role</th>
                <th className="text-left px-4 py-3 text-sm font-medium text-zinc-400">Access</th>
                <th className="text-left px-4 py-3 text-sm font-medium text-zinc-400">Status</th>
                <th className="text-left px-4 py-3 text-sm font-medium text-zinc-400">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-800">
              {users.map((user) => (
                <tr key={user.id} className="hover:bg-zinc-800/30">
                  <td className="px-4 py-3">
                    <div>
                      <p className="font-medium">{user.name || 'No name'}</p>
                      <p className="text-sm text-zinc-500">{user.email}</p>
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <select
                      value={user.role}
                      onChange={(e) => updateUserRole(user.id, e.target.value as UserRole)}
                      className={`px-2 py-1 rounded border text-sm ${roleBadgeColors[user.role]} bg-transparent cursor-pointer`}
                    >
                      <option value="super_admin" className="bg-zinc-900">Super Admin</option>
                      <option value="org_admin" className="bg-zinc-900">Org Admin</option>
                    </select>
                  </td>
                  <td className="px-4 py-3">
                    {user.role === 'super_admin' ? (
                      <span className="text-zinc-500 text-sm">All access</span>
                    ) : (
                      <div className="flex flex-wrap gap-1">
                        {user.user_organization_access?.map((acc) => (
                          <span
                            key={acc.organization_id}
                            className="inline-flex items-center gap-1 px-2 py-0.5 bg-blue-500/10 text-blue-400 rounded text-xs"
                          >
                            {acc.organizations?.name}
                          </span>
                        ))}
                        {(!user.user_organization_access || user.user_organization_access.length === 0) && (
                          <span className="text-zinc-500 text-sm">No orgs assigned</span>
                        )}
                      </div>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <button
                      onClick={() => toggleUserActive(user.id, !user.is_active)}
                      className={`px-2 py-1 rounded text-xs ${
                        user.is_active
                          ? 'bg-green-500/20 text-green-400'
                          : 'bg-red-500/20 text-red-400'
                      }`}
                    >
                      {user.is_active ? 'Active' : 'Inactive'}
                    </button>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-3">
                      {user.role !== 'super_admin' && (
                        <button
                          onClick={() => setShowAccessModal(user.id)}
                          className="text-sm text-zinc-400 hover:text-zinc-200"
                        >
                          Manage Access
                        </button>
                      )}
                      <button
                        onClick={() => resetUserPassword(user.id, user.email)}
                        className="text-sm text-zinc-400 hover:text-zinc-200"
                      >
                        Reset Password
                      </button>
                      <button
                        onClick={() => deleteUser(user.id, user.email)}
                        className="text-sm text-red-400 hover:text-red-300"
                      >
                        Delete
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Create User Modal */}
      {showCreateModal && (
        <CreateUserModal
          onClose={() => {
            setShowCreateModal(false)
            fetchData()
          }}
          organizations={organizations}
          onAddAccess={addAccess}
        />
      )}

      {/* Access Management Modal */}
      {showAccessModal && (
        <AccessModal
          user={users.find((u) => u.id === showAccessModal)!}
          organizations={organizations}
          onClose={() => setShowAccessModal(null)}
          onAddAccess={addAccess}
          onRemoveAccess={removeAccess}
        />
      )}
    </div>
  )
}

function CreateUserModal({
  onClose,
  organizations,
  onAddAccess,
}: {
  onClose: () => void
  organizations: Organization[]
  onAddAccess: (userId: string, id: string) => Promise<void>
}) {
  const [email, setEmail] = useState('')
  const [name, setName] = useState('')
  const [role, setRole] = useState<UserRole>('org_admin')
  const [password, setPassword] = useState('')
  const [selectedOrg, setSelectedOrg] = useState('')
  const [creating, setCreating] = useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()

    // Validate access selection for non-super_admin
    if (role === 'org_admin' && !selectedOrg) {
      alert('Please select an organization for this Org Admin')
      return
    }

    setCreating(true)
    try {
      // Create the user first
      const res = await fetch('/api/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, name, role, password: password || undefined }),
      })

      const newUser = await res.json()

      if (!res.ok) {
        throw new Error(newUser.error || 'Failed to create user')
      }

    // Add access based on role
    if (role === 'org_admin' && selectedOrg) {
      await onAddAccess(newUser.id, selectedOrg)
    }

      if (newUser.temp_password) {
        alert(`Temporary password for ${newUser.email}: ${newUser.temp_password}`)
      }

      onClose()
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to create user')
    } finally {
      setCreating(false)
    }
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-zinc-900 rounded-lg border border-zinc-800 p-6 w-full max-w-md">
        <h2 className="text-xl font-bold mb-4">Add New User</h2>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-zinc-400 mb-1">Email</label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              className="w-full px-3 py-2 bg-zinc-800 border border-zinc-700 rounded-lg focus:ring-2 focus:ring-zinc-600"
              placeholder="user@example.com"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-zinc-400 mb-1">Name</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full px-3 py-2 bg-zinc-800 border border-zinc-700 rounded-lg focus:ring-2 focus:ring-zinc-600"
              placeholder="John Doe"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-zinc-400 mb-1">Role</label>
            <select
              value={role}
              onChange={(e) => {
                setRole(e.target.value as UserRole)
                setSelectedOrg('')
              }}
              className="w-full px-3 py-2 bg-zinc-800 border border-zinc-700 rounded-lg"
            >
              <option value="org_admin">Org Admin</option>
              <option value="super_admin">Super Admin</option>
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-zinc-400 mb-1">Password (optional)</label>
            <input
              type="text"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full px-3 py-2 bg-zinc-800 border border-zinc-700 rounded-lg focus:ring-2 focus:ring-zinc-600"
              placeholder="Leave blank to auto-generate"
            />
          </div>

          {/* Organization selector for org_admin */}
          {role === 'org_admin' && (
            <div>
              <label className="block text-sm font-medium text-zinc-400 mb-1">
                Assign to Organization <span className="text-red-400">*</span>
              </label>
              <select
                value={selectedOrg}
                onChange={(e) => setSelectedOrg(e.target.value)}
                className="w-full px-3 py-2 bg-zinc-800 border border-zinc-700 rounded-lg"
                required
              >
                <option value="">Select organization...</option>
                {organizations.map((org) => (
                  <option key={org.id} value={org.id}>{org.name}</option>
                ))}
              </select>
            </div>
          )}

          <div className="flex gap-3 pt-4">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 px-4 py-2 bg-zinc-800 hover:bg-zinc-700 rounded-lg"
              disabled={creating}
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={creating}
              className="flex-1 px-4 py-2 bg-zinc-100 text-zinc-900 hover:bg-white rounded-lg disabled:opacity-50"
            >
              {creating ? 'Creating...' : 'Create User'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

function AccessModal({
  user,
  organizations,
  onClose,
  onAddAccess,
  onRemoveAccess,
}: {
  user: AppUser
  organizations: Organization[]
  onClose: () => void
  onAddAccess: (userId: string, id: string) => void
  onRemoveAccess: (userId: string, accessId: string) => void
}) {
  const [selectedOrg, setSelectedOrg] = useState('')

  const isOrgAdmin = user.role === 'org_admin'

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-zinc-900 rounded-lg border border-zinc-800 p-6 w-full max-w-lg">
        <h2 className="text-xl font-bold mb-4">Manage Access for {user.name || user.email}</h2>
        <p className="text-sm text-zinc-500 mb-4">
          Role: <span className={`px-2 py-0.5 rounded ${roleBadgeColors[user.role]}`}>{roleLabels[user.role]}</span>
        </p>

        {isOrgAdmin && (
          <>
            <h3 className="font-medium mb-2">Organization Access</h3>
            <div className="space-y-2 mb-4">
              {user.user_organization_access?.map((acc) => (
                <div key={acc.organization_id} className="flex items-center justify-between p-2 bg-zinc-800 rounded">
                  <span>{acc.organizations?.name}</span>
                  <button
                    onClick={() => onRemoveAccess(user.id, acc.organization_id)}
                    className="text-red-400 hover:text-red-300 text-sm"
                  >
                    Remove
                  </button>
                </div>
              ))}
            </div>
            <div className="flex gap-2">
              <select
                value={selectedOrg}
                onChange={(e) => setSelectedOrg(e.target.value)}
                className="flex-1 px-3 py-2 bg-zinc-800 border border-zinc-700 rounded-lg"
              >
                <option value="">Select organization...</option>
                {organizations
                  .filter((o) => !user.user_organization_access?.some((a) => a.organization_id === o.id))
                  .map((org) => (
                    <option key={org.id} value={org.id}>{org.name}</option>
                  ))}
              </select>
              <button
                onClick={() => {
                  if (selectedOrg) {
                    onAddAccess(user.id, selectedOrg)
                    setSelectedOrg('')
                  }
                }}
                disabled={!selectedOrg}
                className="px-4 py-2 bg-zinc-700 hover:bg-zinc-600 rounded-lg disabled:opacity-50"
              >
                Add
              </button>
            </div>
          </>
        )}

        <div className="mt-6">
          <button
            onClick={onClose}
            className="w-full px-4 py-2 bg-zinc-800 hover:bg-zinc-700 rounded-lg"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  )
}
