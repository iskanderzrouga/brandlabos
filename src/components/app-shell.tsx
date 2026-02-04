'use client'

import { createContext, useContext, useState, useEffect, ReactNode } from 'react'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import type { User } from '@supabase/supabase-js'

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
  user: User | null
  signOut: () => Promise<void>
}

interface Org { id: string; name: string; slug: string }
interface Brand { id: string; organization_id: string; name: string; slug: string }
interface Product { id: string; brand_id: string; name: string; slug: string }

const AppContext = createContext<AppContextType | null>(null)

export function useAppContext() {
  const ctx = useContext(AppContext)
  if (!ctx) throw new Error('useAppContext must be used within AppShell')
  return ctx
}

// ============================================================================
// APP SHELL COMPONENT - Light Mode Creator Studio
// ============================================================================

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname()
  const router = useRouter()
  const [organizations, setOrganizations] = useState<Org[]>([])
  const [brands, setBrands] = useState<Brand[]>([])
  const [products, setProducts] = useState<Product[]>([])
  const [selectedOrg, setSelectedOrg] = useState<string | null>(null)
  const [selectedBrand, setSelectedBrand] = useState<string | null>(null)
  const [selectedProduct, setSelectedProduct] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [user, setUser] = useState<User | null>(null)

  // Fetch user on mount
  useEffect(() => {
    const supabase = createClient()
    supabase.auth.getUser().then(({ data: { user } }) => {
      setUser(user)
    })

    // Listen for auth changes
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null)
    })

    return () => subscription.unsubscribe()
  }, [])

  const signOut = async () => {
    const supabase = createClient()
    await supabase.auth.signOut()
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
          setSelectedBrand(data[0].id)
        } else {
          setSelectedBrand(null)
        }
      })
  }, [selectedOrg])

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
          setSelectedProduct(data[0].id)
        } else {
          setSelectedProduct(null)
        }
      })
  }, [selectedBrand])

  const navItems = [
    { label: 'Generate', href: '/studio', icon: '⚡' },
    { label: 'Avatars', href: '/studio/avatars', icon: '👤' },
    { label: 'Pitches', href: '/studio/pitches', icon: '🎯' },
    { label: 'Prompt Blocks', href: '/studio/prompts', icon: '📝' },
    { label: 'History', href: '/studio/history', icon: '📜' },
  ]

  const settingsItems = [
    { label: 'Organizations', href: '/studio/settings/organizations', icon: '🏢' },
    { label: 'Brands', href: '/studio/settings/brands', icon: '🏷️' },
    { label: 'Products', href: '/studio/settings/products', icon: '📦' },
    { label: 'Users', href: '/admin/users', icon: '👥' },
  ]

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
        loading,
        user,
        signOut,
      }}
    >
      <div className="min-h-screen bg-[var(--editor-bg)] text-[var(--editor-ink)] flex">
        {/* Sidebar */}
        <aside className="w-64 bg-[var(--editor-rail)] text-[var(--editor-rail-ink)] flex flex-col border-r border-white/10">
          {/* Logo */}
          <div className="p-5 border-b border-white/10">
            <Link href="/studio" className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-2xl bg-[var(--editor-accent)] text-white flex items-center justify-center font-semibold">
                BL
              </div>
              <div>
                <p className="text-[10px] uppercase tracking-[0.35em] text-white/60">Studio</p>
                <p className="font-serif text-lg text-white">BrandLab</p>
              </div>
            </Link>
          </div>

          {/* Main Nav */}
          <nav className="flex-1 p-4 space-y-1">
            <p className="px-3 text-[10px] uppercase tracking-[0.3em] text-white/40 mb-3">
              Workspace
            </p>
            {navItems.map(item => (
              <Link
                key={item.href}
                href={item.href}
                className={`flex items-center gap-3 px-3 py-2 rounded-xl text-sm transition-all border ${
                  pathname === item.href
                    ? 'bg-white/10 text-white border-white/20 shadow-[0_12px_30px_-20px_rgba(0,0,0,0.6)]'
                    : 'text-white/70 border-transparent hover:text-white hover:bg-white/5'
                }`}
              >
                <span className="text-lg">{item.icon}</span>
                <span className="font-medium">{item.label}</span>
              </Link>
            ))}

            <div className="pt-4 mt-4 border-t border-white/10">
              <p className="px-3 text-[10px] text-white/40 uppercase tracking-[0.3em] mb-2">
                Settings
              </p>
              {settingsItems.map(item => (
                <Link
                  key={item.href}
                  href={item.href}
                  className={`flex items-center gap-3 px-3 py-2 rounded-xl text-sm transition-all border ${
                    pathname === item.href
                      ? 'bg-white/10 text-white border-white/20'
                      : 'text-white/70 border-transparent hover:text-white hover:bg-white/5'
                  }`}
                >
                  <span className="text-lg">{item.icon}</span>
                  <span className="font-medium">{item.label}</span>
                </Link>
              ))}
            </div>
          </nav>

          <div className="p-4 border-t border-white/10">
            <div className="rounded-2xl bg-white/5 border border-white/10 p-4">
              <p className="text-xs uppercase tracking-[0.3em] text-white/50">Status</p>
              <p className="mt-2 text-sm text-white">Copy engine online</p>
              <p className="text-xs text-white/60 mt-1">Latency: 1.6s</p>
            </div>
          </div>
        </aside>

        {/* Main Content */}
        <div className="flex-1 flex flex-col">
          {/* Top Bar */}
          <header className="h-16 border-b border-[var(--editor-border)] bg-[var(--editor-panel)]/80 backdrop-blur flex items-center px-6 gap-5">
            <div className="flex items-center gap-3">
              <span className="text-[10px] uppercase tracking-[0.4em] text-[var(--editor-ink-muted)]">
                Workspace
              </span>
              <div className="h-5 w-px bg-[var(--editor-border)]" />
            </div>

            {/* Org Selector */}
            <div className="flex items-center gap-2">
              <span className="text-[10px] uppercase tracking-[0.3em] text-[var(--editor-ink-muted)]">Org</span>
              <select
                value={selectedOrg || ''}
                onChange={e => setSelectedOrg(e.target.value || null)}
                className="editor-input text-sm min-w-[140px] bg-[var(--editor-panel)]"
              >
                {organizations.map(o => (
                  <option key={o.id} value={o.id}>{o.name}</option>
                ))}
              </select>
            </div>

            {/* Brand Selector */}
            <div className="flex items-center gap-2">
              <span className="text-[10px] uppercase tracking-[0.3em] text-[var(--editor-ink-muted)]">Brand</span>
              <select
                value={selectedBrand || ''}
                onChange={e => setSelectedBrand(e.target.value || null)}
                className="editor-input text-sm min-w-[140px] bg-[var(--editor-panel)]"
                disabled={brands.length === 0}
              >
                {brands.length === 0 && <option value="">No brands</option>}
                {brands.map(b => (
                  <option key={b.id} value={b.id}>{b.name}</option>
                ))}
              </select>
            </div>

            {/* Product Selector */}
            <div className="flex items-center gap-2">
              <span className="text-[10px] uppercase tracking-[0.3em] text-[var(--editor-ink-muted)]">Product</span>
              <select
                value={selectedProduct || ''}
                onChange={e => setSelectedProduct(e.target.value || null)}
                className="editor-input text-sm min-w-[160px] bg-[var(--editor-panel)]"
                disabled={products.length === 0}
              >
                {products.length === 0 && <option value="">No products</option>}
                {products.map(p => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </select>
            </div>

            <div className="flex-1" />

            {/* User Menu */}
            {user && (
              <div className="flex items-center gap-3">
                <span className="text-sm text-[var(--editor-ink-muted)]">{user.email}</span>
                <button
                  onClick={signOut}
                  className="editor-button-ghost text-sm"
                >
                  Sign out
                </button>
              </div>
            )}
          </header>

          {/* Page Content */}
          <main className="flex-1 overflow-hidden">
            {children}
          </main>
        </div>
      </div>
    </AppContext.Provider>
  )
}
