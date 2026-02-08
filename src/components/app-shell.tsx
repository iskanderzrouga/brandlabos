'use client'

import { createContext, useContext, useState, useEffect, ReactNode } from 'react'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'

// ============================================================================
// CONTEXT - Global state for selected org/brand/product
// ============================================================================

interface AppContextType {
  organizations: Org[]
  brands: Brand[]
  products: Product[]
  selectedOrg: string | null
  selectedBrand: string | null
  selectedProduct: string | null
  setSelectedOrg: (id: string | null) => void
  setSelectedBrand: (id: string | null) => void
  setSelectedProduct: (id: string | null) => void
  loading: boolean
  user: AuthUser | null
  signOut: () => Promise<void>
  openContextDrawer: () => void
  refreshProducts: () => void
  setContextDrawerExtra: (extra: ReactNode | null) => void
  setTopBarExtra: (extra: ReactNode | null) => void
}

interface Org { id: string; name: string; slug: string }
interface Brand { id: string; organization_id: string; name: string; slug: string }
interface Product { id: string; brand_id: string; name: string; slug: string }
interface AuthUser { id: string; email: string; name?: string | null; role?: string }

const AppContext = createContext<AppContextType | null>(null)

export function useAppContext() {
  const ctx = useContext(AppContext)
  if (!ctx) throw new Error('useAppContext must be used within AppShell')
  return ctx
}

// ============================================================================
// APP SHELL COMPONENT - Joinco-lite Studio
// ============================================================================

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname()
  const router = useRouter()
  const [organizations, setOrganizations] = useState<Org[]>([])
  const [brands, setBrands] = useState<Brand[]>([])
  const [products, setProducts] = useState<Product[]>([])
  const [selectedOrg, setSelectedOrgRaw] = useState<string | null>(() => {
    if (typeof window === 'undefined') return null
    return localStorage.getItem('bl_selected_org') || null
  })
  const [selectedBrand, setSelectedBrandRaw] = useState<string | null>(() => {
    if (typeof window === 'undefined') return null
    return localStorage.getItem('bl_selected_brand') || null
  })
  const [selectedProduct, setSelectedProductRaw] = useState<string | null>(() => {
    if (typeof window === 'undefined') return null
    return localStorage.getItem('bl_selected_product') || null
  })

  const setSelectedOrg = (id: string | null) => {
    setSelectedOrgRaw(id)
    if (id) localStorage.setItem('bl_selected_org', id)
    else localStorage.removeItem('bl_selected_org')
  }
  const setSelectedBrand = (id: string | null) => {
    setSelectedBrandRaw(id)
    if (id) localStorage.setItem('bl_selected_brand', id)
    else localStorage.removeItem('bl_selected_brand')
  }
  const setSelectedProduct = (id: string | null) => {
    setSelectedProductRaw(id)
    if (id) localStorage.setItem('bl_selected_product', id)
    else localStorage.removeItem('bl_selected_product')
  }
  const [loading, setLoading] = useState(true)
  const [user, setUser] = useState<AuthUser | null>(null)

  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => {
    if (typeof window === 'undefined') return false
    const saved = localStorage.getItem('sidebar_collapsed')
    return saved === null ? false : saved === '1'
  })
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [contextDrawerOpen, setContextDrawerOpen] = useState(false)
  const [contextDrawerExtra, setContextDrawerExtra] = useState<ReactNode | null>(null)
  const [topBarExtra, setTopBarExtra] = useState<ReactNode | null>(null)

  // Fetch user on mount
  useEffect(() => {
    let active = true
    const loadUser = async () => {
      try {
        const res = await fetch('/api/auth/me')
        if (!res.ok) {
          if (active) setUser(null)
          return
        }
        const data = await res.json()
        if (active) setUser(data)
      } catch {
        if (active) setUser(null)
      }
    }
    loadUser()
    return () => {
      active = false
    }
  }, [])

  const signOut = async () => {
    await fetch('/api/auth/logout', { method: 'POST' })
    router.push('/login')
    router.refresh()
  }

  // Fetch organizations on mount
  useEffect(() => {
    fetch('/api/organizations')
      .then(r => r.json())
      .then(data => {
        setOrganizations(data)
        if (data.length > 0 && !selectedOrg) {
          setSelectedOrg(data[0].id)
        } else if (selectedOrg && data.length > 0 && !data.some((o: Org) => o.id === selectedOrg)) {
          // Saved org no longer exists — fall back to first
          setSelectedOrg(data[0].id)
        }
      })
      .finally(() => setLoading(false))
  }, [])

  // Fetch brands when org changes
  useEffect(() => {
    if (!selectedOrg) {
      setBrands([])
      setSelectedBrand(null)
      return
    }
    fetch(`/api/brands?organization_id=${selectedOrg}`)
      .then(r => r.json())
      .then(data => {
        setBrands(data)
        if (data.length > 0) {
          const savedBrand = selectedBrand || localStorage.getItem('bl_selected_brand')
          if (savedBrand && data.some((b: Brand) => b.id === savedBrand)) {
            setSelectedBrand(savedBrand)
          } else {
            setSelectedBrand(data[0].id)
          }
        } else {
          setSelectedBrand(null)
        }
      })
  }, [selectedOrg])

  // Refresh product list without changing selection (for use after create/update/delete)
  const refreshProducts = () => {
    if (!selectedBrand) return
    fetch(`/api/products?brand_id=${selectedBrand}`)
      .then(r => r.json())
      .then(data => setProducts(data))
  }

  // Fetch products when brand changes
  useEffect(() => {
    if (!selectedBrand) {
      setProducts([])
      setSelectedProduct(null)
      return
    }
    fetch(`/api/products?brand_id=${selectedBrand}`)
      .then(r => r.json())
      .then(data => {
        setProducts(data)
        if (data.length > 0) {
          const savedProduct = selectedProduct || localStorage.getItem('bl_selected_product')
          if (savedProduct && data.some((p: Product) => p.id === savedProduct)) {
            setSelectedProduct(savedProduct)
          } else {
            setSelectedProduct(data[0].id)
          }
        } else {
          setSelectedProduct(null)
        }
      })
  }, [selectedBrand])

  const selectedProductName = products.find((p) => p.id === selectedProduct)?.name || null
  const selectedBrandName = brands.find((b) => b.id === selectedBrand)?.name || null

  const navItems = [
    { label: 'Agent', href: '/studio', icon: <SparkIcon /> },
    { label: 'Avatars', href: '/studio/avatars', icon: <AvatarIcon /> },
    { label: 'Agents', href: '/studio/agents', icon: <AgentsIcon />, adminOnly: true },
    { label: 'Positioning', href: '/studio/pitches', icon: <TargetIcon /> },
    { label: 'Research', href: '/studio/research', icon: <SearchIcon /> },
    { label: 'Swipes', href: '/studio/swipes', icon: <FilmIcon /> },
    { label: 'Library', href: '/studio/library', icon: <LibraryIcon /> },
    { label: 'Skills', href: '/studio/skills', icon: <WandIcon /> },
  ]

  const settingsItems = [
    { label: 'Organizations', href: '/studio/settings/organizations', icon: <OrgIcon /> },
    { label: 'Brands', href: '/studio/settings/brands', icon: <TagIcon /> },
    { label: 'Products', href: '/studio/settings/products', icon: <BoxIcon /> },
    { label: 'API Keys', href: '/studio/settings/api-keys', icon: <KeyIcon /> },
    { label: 'Users', href: '/admin/users', icon: <UsersIcon />, adminOnly: true },
  ]

  const isSuperAdmin = user?.role === 'super_admin'
  const filteredNav = navItems.filter(item => !item.adminOnly || isSuperAdmin)
  const filteredSettings = settingsItems.filter(item => !item.adminOnly || isSuperAdmin)

  const isNavActive = (href: string) => {
    if (href === '/studio') return pathname === '/studio'
    return pathname === href || pathname.startsWith(`${href}/`)
  }

  return (
    <AppContext.Provider
      value={{
        organizations,
        brands,
        products,
        selectedOrg,
        selectedBrand,
        selectedProduct,
        setSelectedOrg,
        setSelectedBrand,
      setSelectedProduct,
      refreshProducts,
      loading,
      user,
      signOut,
      openContextDrawer: () => setContextDrawerOpen(true),
      setContextDrawerExtra,
      setTopBarExtra,
    }}
  >
      <div className="h-[100dvh] min-h-0 bg-[var(--editor-bg)] text-[var(--editor-ink)] flex">
        {/* Sidebar */}
        <aside
          className={`relative z-30 bg-[var(--editor-rail)] text-[var(--editor-rail-ink)] flex flex-col border-r border-white/10 transition-[width] duration-200 ${
            sidebarCollapsed ? 'w-[78px]' : 'w-64'
          }`}
        >
          {/* Brand / Toggle */}
          <div className="h-16 px-4 flex items-center justify-between border-b border-white/10">
            <Link href="/studio" className="flex items-center gap-3 min-w-0">
              <div className="w-10 h-10 rounded-2xl bg-[var(--editor-accent)] text-white flex items-center justify-center font-semibold">
                BL
              </div>
              {!sidebarCollapsed && (
                <div className="min-w-0">
                  <p className="text-[10px] uppercase tracking-[0.35em] text-white/60">Studio</p>
                  <p className="font-serif text-lg text-white truncate">BrandLab</p>
                </div>
              )}
            </Link>

            <button
              onClick={() => {
                setSidebarCollapsed((v) => {
                  const next = !v
                  localStorage.setItem('sidebar_collapsed', next ? '1' : '0')
                  return next
                })
                if (!sidebarCollapsed) setSettingsOpen(false)
              }}
              className="w-9 h-9 grid place-items-center rounded-xl hover:bg-white/10 transition-colors"
              title={sidebarCollapsed ? 'Open sidebar' : 'Collapse sidebar'}
              aria-label="Toggle sidebar"
            >
              <HamburgerIcon />
            </button>
          </div>

          {/* Main Nav */}
          <nav className="flex-1 px-3 py-4 space-y-2">
            {!sidebarCollapsed && (
              <p className="px-3 text-[10px] uppercase tracking-[0.32em] text-white/40">
                Workspace
              </p>
            )}
            <div className="space-y-1">
              {filteredNav.map((item) => {
                const active = isNavActive(item.href)
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    title={sidebarCollapsed ? item.label : undefined}
                    className={`flex items-center gap-3 px-3 py-2 rounded-2xl text-sm transition-all border ${
                      active
                        ? 'bg-white/10 text-white border-white/20 shadow-[0_18px_40px_-26px_rgba(0,0,0,0.65)]'
                        : 'text-white/70 border-transparent hover:text-white hover:bg-white/5'
                    }`}
                  >
                    <span className="w-5 h-5">{item.icon}</span>
                    {!sidebarCollapsed && <span className="font-medium">{item.label}</span>}
                  </Link>
                )
              })}
            </div>

            <div className="pt-3 mt-3 border-t border-white/10">
              <button
                onClick={() => {
                  if (sidebarCollapsed) {
                    setSidebarCollapsed(false)
                    setSettingsOpen(true)
                    return
                  }
                  setSettingsOpen((v) => !v)
                }}
                className={`w-full flex items-center gap-3 px-3 py-2 rounded-2xl text-sm transition-all border ${
                  settingsOpen && !sidebarCollapsed
                    ? 'bg-white/10 text-white border-white/20'
                    : 'text-white/70 border-transparent hover:text-white hover:bg-white/5'
                }`}
                title={sidebarCollapsed ? 'Settings' : undefined}
              >
                <span className="w-5 h-5"><GearIcon /></span>
                {!sidebarCollapsed && (
                  <>
                    <span className="font-medium flex-1 text-left">Settings</span>
                    <span className="text-xs text-white/60">{settingsOpen ? '-' : '+'}</span>
                  </>
                )}
              </button>

              {settingsOpen && !sidebarCollapsed && (
                <div className="mt-2 space-y-1">
                  {filteredSettings.map((item) => {
                    const active = isNavActive(item.href)
                    return (
                      <Link
                        key={item.href}
                        href={item.href}
                        className={`flex items-center gap-3 px-3 py-2 rounded-2xl text-sm transition-all border ${
                          active
                            ? 'bg-white/10 text-white border-white/20'
                            : 'text-white/70 border-transparent hover:text-white hover:bg-white/5'
                        }`}
                      >
                        <span className="w-5 h-5">{item.icon}</span>
                        <span className="font-medium">{item.label}</span>
                      </Link>
                    )
                  })}
                </div>
              )}
            </div>
          </nav>

          <div className="mt-auto px-3 pb-4">
            <div className="pt-3 border-t border-white/10">
              {user && (
                <div className="flex items-center gap-3">
                  <span className="w-9 h-9 rounded-xl bg-white/10 flex items-center justify-center text-white/80">
                    <UserIcon />
                  </span>
                  {!sidebarCollapsed && (
                    <div className="min-w-0 flex-1">
                      <p className="text-xs text-white/60">Signed in</p>
                      <p className="text-sm text-white truncate">{user.email}</p>
                    </div>
                  )}
                  <button
                    onClick={signOut}
                    className="w-9 h-9 rounded-xl hover:bg-white/10 grid place-items-center text-white/70"
                    title="Sign out"
                    aria-label="Sign out"
                  >
                    <LogoutIcon />
                  </button>
                </div>
              )}
            </div>
          </div>
        </aside>

        {/* Main Content */}
        <div className="relative z-10 flex-1 flex flex-col min-h-0">
          {/* Top Bar */}
          <header className="h-16 border-b border-[var(--editor-border)] bg-[var(--editor-panel)]/70 backdrop-blur flex items-center px-6 gap-4">
            <button
              onClick={() => setContextDrawerOpen(true)}
              className="editor-button-ghost text-sm flex items-center gap-2"
              title="Select org/brand/product"
            >
              <span className="w-4 h-4"><ContextIcon /></span>
              <span className="font-semibold">
                {selectedProductName ? selectedProductName : 'Select context'}
              </span>
              {!selectedProductName && (
                <span className="text-[var(--editor-ink-muted)] font-medium">
                  (org/brand/product)
                </span>
              )}
              {selectedBrandName && selectedProductName && (
                <span className="text-[var(--editor-ink-muted)] font-medium">
                  {selectedBrandName}
                </span>
              )}
            </button>

            <div className="flex-1" />
            {topBarExtra}
          </header>

          {/* Page Content */}
          <main className="flex-1 overflow-hidden min-h-0">
            {children}
          </main>
        </div>
      </div>

      {/* Context Drawer */}
      {contextDrawerOpen && (
        <div className="fixed inset-0 z-50">
          <div
            className="absolute inset-0 bg-black/25 backdrop-blur-sm"
            onClick={() => setContextDrawerOpen(false)}
          />
          <div className="absolute right-0 top-0 h-full w-[440px] max-w-[92vw] bg-[var(--editor-panel)] border-l border-[var(--editor-border)] shadow-[0_30px_60px_-40px_var(--editor-shadow)]">
            <div className="h-16 px-6 border-b border-[var(--editor-border)] flex items-center justify-between">
              <div>
                <p className="text-[10px] uppercase tracking-[0.3em] text-[var(--editor-ink-muted)]">
                  Context
                </p>
                <p className="font-serif text-lg">Workspace</p>
              </div>
              <button
                onClick={() => setContextDrawerOpen(false)}
                className="w-10 h-10 rounded-2xl hover:bg-black/5 grid place-items-center"
                aria-label="Close context"
              >
                <span className="text-xl leading-none">x</span>
              </button>
            </div>

            <div className="p-6 space-y-5 overflow-auto h-[calc(100%-4rem)]">
              <div>
                <label className="block text-xs uppercase tracking-[0.22em] text-[var(--editor-ink-muted)] mb-2">
                  Organization
                </label>
                <select
                  value={selectedOrg || ''}
                  onChange={(e) => setSelectedOrg(e.target.value || null)}
                  className="editor-input w-full text-sm"
                >
                  {organizations.map((o) => (
                    <option key={o.id} value={o.id}>
                      {o.name}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs uppercase tracking-[0.22em] text-[var(--editor-ink-muted)] mb-2">
                  Brand
                </label>
                <select
                  value={selectedBrand || ''}
                  onChange={(e) => setSelectedBrand(e.target.value || null)}
                  className="editor-input w-full text-sm"
                  disabled={brands.length === 0}
                >
                  {brands.length === 0 && <option value="">No brands</option>}
                  {brands.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.name}
                    </option>
                  ))}
                </select>
              </div>

              {pathname !== '/studio/settings/products' && (
                <div>
                  <label className="block text-xs uppercase tracking-[0.22em] text-[var(--editor-ink-muted)] mb-2">
                    Product
                  </label>
                  <select
                    value={selectedProduct || ''}
                    onChange={(e) => setSelectedProduct(e.target.value || null)}
                    className="editor-input w-full text-sm"
                    disabled={products.length === 0}
                  >
                    {products.length === 0 && <option value="">No products</option>}
                    {products.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                  </select>
                </div>
              )}

              {contextDrawerExtra && (
                <div className="pt-6 mt-6 border-t border-[var(--editor-border)]">
                  {contextDrawerExtra}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </AppContext.Provider>
  )
}

function HamburgerIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" className="w-5 h-5" aria-hidden="true">
      <path
        d="M5 7h14M5 12h14M5 17h14"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      />
    </svg>
  )
}

function SparkIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" className="w-5 h-5" aria-hidden="true">
      <path
        d="M13 2l1.2 6.2L20 10l-5.8 1.8L13 18l-1.2-6.2L6 10l5.8-1.8L13 2z"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinejoin="round"
      />
    </svg>
  )
}

function AgentsIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" className="w-5 h-5" aria-hidden="true">
      <path
        d="M7 7a3 3 0 106 0 3 3 0 00-6 0zM11 13a4 4 0 00-4 4v2h8v-2a4 4 0 00-4-4z"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M15.5 6.5a2.5 2.5 0 112.5 2.5 2.5 2.5 0 01-2.5-2.5zM16 13h4a3 3 0 013 3v3"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

function AvatarIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" className="w-5 h-5" aria-hidden="true">
      <circle cx="12" cy="8" r="3.4" stroke="currentColor" strokeWidth="1.8" />
      <path
        d="M5 20a7 7 0 0114 0"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
    </svg>
  )
}

function FilmIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" className="w-5 h-5" aria-hidden="true">
      <path
        d="M4 6h16v12H4V6z"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinejoin="round"
      />
      <path
        d="M8 6v12M16 6v12M4 10h4M4 14h4M16 10h4M16 14h4"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
    </svg>
  )
}

function LibraryIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" className="w-5 h-5" aria-hidden="true">
      <path
        d="M4 5h4v14H4V5zm6 0h4v14h-4V5zm6 0h4v14h-4V5z"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinejoin="round"
      />
    </svg>
  )
}

function SearchIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" className="w-5 h-5" aria-hidden="true">
      <path
        d="M11 19a8 8 0 100-16 8 8 0 000 16z"
        stroke="currentColor"
        strokeWidth="1.8"
      />
      <path
        d="M20 20l-3.5-3.5"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
    </svg>
  )
}

function TargetIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" className="w-5 h-5" aria-hidden="true">
      <circle cx="12" cy="12" r="7" stroke="currentColor" strokeWidth="1.8" />
      <circle cx="12" cy="12" r="3" stroke="currentColor" strokeWidth="1.8" />
      <path d="M12 2v3" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      <path d="M12 19v3" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      <path d="M2 12h3" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      <path d="M19 12h3" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  )
}

function WandIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" className="w-5 h-5" aria-hidden="true">
      <path
        d="M5 19l9-9"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
      <path
        d="M14.5 5.5l.8-2.5.8 2.5 2.5.8-2.5.8-.8 2.5-.8-2.5-2.5-.8 2.5-.8z"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
    </svg>
  )
}

function GearIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" className="w-5 h-5" aria-hidden="true">
      <path
        d="M12 15.5a3.5 3.5 0 110-7 3.5 3.5 0 010 7z"
        stroke="currentColor"
        strokeWidth="1.8"
      />
      <path
        d="M19.4 15a7.9 7.9 0 000-6l-2.1.4a6.2 6.2 0 00-1.1-1.1L16.6 6a7.9 7.9 0 00-6 0l.4 2.3a6.2 6.2 0 00-1.1 1.1L7.8 9a7.9 7.9 0 000 6l2.1-.4a6.2 6.2 0 001.1 1.1l-.4 2.3a7.9 7.9 0 006 0l-.4-2.3a6.2 6.2 0 001.1-1.1l2.1.4z"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinejoin="round"
      />
    </svg>
  )
}

function ContextIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" className="w-4 h-4" aria-hidden="true">
      <path
        d="M4 7.5h16M7 12h10M10 16.5h4"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
    </svg>
  )
}

function UserIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" className="w-4 h-4" aria-hidden="true">
      <path
        d="M12 12a4 4 0 100-8 4 4 0 000 8zM5 20a7 7 0 0114 0"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
    </svg>
  )
}

function LogoutIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" className="w-4 h-4" aria-hidden="true">
      <path
        d="M15 7l5 5-5 5M20 12H9M12 5H6a2 2 0 00-2 2v10a2 2 0 002 2h6"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

function OrgIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" className="w-5 h-5" aria-hidden="true">
      <path
        d="M4 20V7l8-4 8 4v13H4z"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinejoin="round"
      />
      <path
        d="M9 20v-6h6v6"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinejoin="round"
      />
    </svg>
  )
}

function TagIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" className="w-5 h-5" aria-hidden="true">
      <path
        d="M20 13l-7 7-10-10V3h7l10 10z"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinejoin="round"
      />
      <path
        d="M7.5 7.5h.01"
        stroke="currentColor"
        strokeWidth="3"
        strokeLinecap="round"
      />
    </svg>
  )
}

function BoxIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" className="w-5 h-5" aria-hidden="true">
      <path
        d="M4 7l8-4 8 4v10l-8 4-8-4V7z"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinejoin="round"
      />
      <path
        d="M4 7l8 4 8-4"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinejoin="round"
      />
      <path
        d="M12 11v10"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
    </svg>
  )
}

function UsersIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" className="w-5 h-5" aria-hidden="true">
      <path
        d="M16 11a4 4 0 10-8 0 4 4 0 008 0z"
        stroke="currentColor"
        strokeWidth="1.8"
      />
      <path
        d="M4 21a8 8 0 0116 0"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
    </svg>
  )
}

function KeyIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" className="w-5 h-5" aria-hidden="true">
      <path
        d="M15 7a4 4 0 11-8 0 4 4 0 018 0z"
        stroke="currentColor"
        strokeWidth="1.8"
      />
      <path
        d="M11 11v3l3 3h3l2 2"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}
