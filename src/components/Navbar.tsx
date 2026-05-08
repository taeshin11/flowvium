'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { useTranslations } from 'next-intl';
import { Link, useRouter } from '@/i18n/routing';
import { Menu, X, Link as LinkIcon, MessageCircle, Search } from 'lucide-react';
import { allCompanies } from '@/data/companies';
import { companyNamesI18n } from '@/data/company-names-i18n';

const navLinks = [
  { href: '/report', key: 'report' },
  { href: '/earnings', key: 'earnings' },
  { href: '/insider', key: 'insider' },
  { href: '/heatmap', key: 'heatmap' },
  { href: '/screener', key: 'screener' },
  { href: '/short', key: 'short' },
  { href: '/explore', key: 'explore' },
  { href: '/cascade', key: 'cascade' },
  { href: '/signals', key: 'signals' },
  { href: '/news-gap', key: 'newsGap' },
  { href: '/intelligence', key: 'intelligence' },
  { href: '/osint', key: 'osint' },
  { href: '/satellite', key: 'satellite' },
  { href: '/about', key: 'about' },
] as const;

const companies = allCompanies.map((c) => ({
  name: c.name,
  ticker: c.ticker,
  sector: c.sector,
}));

function GlobalSearch({ onClose }: { onClose: () => void }) {
  const router = useRouter();
  const t = useTranslations('nav');
  const [query, setQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(-1);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const filtered = query.trim().length > 0
    ? companies.filter((c) => {
        const q = query.toLowerCase();
        if (c.name.toLowerCase().includes(q) || c.ticker.toLowerCase().includes(q)) return true;
        const localized = companyNamesI18n[c.ticker];
        if (localized?.some((n) => n.toLowerCase().includes(q))) return true;
        return false;
      }).slice(0, 10)
    : [];

  const handleSelect = useCallback((ticker: string) => {
    onClose();
    router.push(`/company/${ticker}`);
  }, [router, onClose]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') { onClose(); return; }
    if (filtered.length === 0) return;
    if (e.key === 'ArrowDown') { e.preventDefault(); setActiveIndex((p) => (p < filtered.length - 1 ? p + 1 : 0)); }
    if (e.key === 'ArrowUp') { e.preventDefault(); setActiveIndex((p) => (p > 0 ? p - 1 : filtered.length - 1)); }
    if (e.key === 'Enter' && activeIndex >= 0) { e.preventDefault(); handleSelect(filtered[activeIndex].ticker); }
  };

  useEffect(() => { setActiveIndex(-1); }, [query]);

  useEffect(() => {
    if (activeIndex >= 0 && listRef.current) {
      (listRef.current.children[activeIndex] as HTMLElement)?.scrollIntoView({ block: 'nearest' });
    }
  }, [activeIndex]);

  return (
    <div
      className="fixed inset-0 z-[100] flex items-start justify-center pt-20 px-4"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} />

      {/* Search box */}
      <div className="relative w-full max-w-xl bg-white rounded-2xl shadow-2xl border border-cf-border overflow-hidden animate-scale-in">
        {/* Input */}
        <div className="flex items-center gap-3 px-4 py-3 border-b border-cf-border">
          <Search className="w-5 h-5 text-cf-text-secondary flex-shrink-0" />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={t('companySearchFull')}
            className="flex-1 text-sm outline-none text-cf-text-primary placeholder:text-cf-text-secondary/60 bg-transparent"
          />
          {query && (
            <button onClick={() => setQuery('')} className="text-cf-text-secondary hover:text-cf-text-primary transition-colors">
              <X className="w-4 h-4" />
            </button>
          )}
          <button onClick={onClose} className="text-xs text-cf-text-secondary border border-cf-border rounded px-2 py-1 hover:bg-gray-50 transition-colors">
            ESC
          </button>
        </div>

        {/* Results */}
        {filtered.length > 0 && (
          <ul ref={listRef} className="max-h-80 overflow-y-auto py-1">
            {filtered.map((c, i) => (
              <li
                key={c.ticker}
                onMouseEnter={() => setActiveIndex(i)}
                onClick={() => handleSelect(c.ticker)}
                className={`flex items-center justify-between px-4 py-3 cursor-pointer transition-colors ${
                  i === activeIndex ? 'bg-cf-primary/5' : 'hover:bg-gray-50'
                }`}
              >
                <div>
                  <p className="text-sm font-medium text-cf-text-primary">{c.name}</p>
                  <p className="text-xs text-cf-text-secondary capitalize">{c.sector?.replace(/-/g, ' ')}</p>
                </div>
                <span className="text-xs font-mono font-bold text-cf-primary bg-cf-primary/10 px-2.5 py-1 rounded-lg">
                  {c.ticker}
                </span>
              </li>
            ))}
          </ul>
        )}

        {query.trim().length > 0 && filtered.length === 0 && (
          <div className="px-4 py-8 text-center text-sm text-cf-text-secondary">
            &quot;{query}&quot; {t('noResults')}
          </div>
        )}

        {query.trim().length === 0 && (
          <div className="px-4 py-5 text-center text-xs text-cf-text-secondary">
            {t('totalCompanies', { count: companies.length })}
          </div>
        )}
      </div>
    </div>
  );
}

export default function Navbar() {
  const t = useTranslations('nav');
  const [isOpen, setIsOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const handleScroll = () => setScrolled(window.scrollY > 10);
    window.addEventListener('scroll', handleScroll, { passive: true });
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  useEffect(() => {
    document.body.style.overflow = (isOpen || searchOpen) ? 'hidden' : '';
    return () => { document.body.style.overflow = ''; };
  }, [isOpen, searchOpen]);

  // Cmd/Ctrl+K shortcut
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        setSearchOpen(true);
      }
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, []);

  return (
    <>
      <nav
        className={`sticky top-0 z-50 w-full transition-all duration-300 ${
          scrolled ? 'glass shadow-md' : 'bg-transparent'
        }`}
      >
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <div className="flex h-16 items-center justify-between">
            {/* Logo */}
            <Link href="/" className="flex items-center gap-2 group flex-shrink-0">
              <div className="flex items-center justify-center w-8 h-8 rounded-lg bg-cf-primary/10 group-hover:bg-cf-primary/20 transition-colors duration-200">
                <LinkIcon className="w-4 h-4 text-cf-primary" />
              </div>
              <span className="text-xl font-heading font-bold text-cf-text-primary tracking-tight">
                Flow<span className="text-cf-primary">vium</span>
              </span>
            </Link>

            {/* Desktop: search bar (center) */}
            <button
              onClick={() => setSearchOpen(true)}
              className="hidden md:flex items-center gap-2 px-3 py-2 rounded-lg border border-cf-border bg-gray-50 hover:bg-white hover:border-cf-primary/30 transition-all duration-200 text-sm text-cf-text-secondary min-w-[160px] flex-shrink-0"
            >
              <Search className="w-4 h-4" />
              <span className="flex-1 text-left">{t('companySearchShort')}</span>
              <kbd className="text-[10px] px-1.5 py-0.5 rounded bg-gray-200 text-gray-500 font-mono">⌘K</kbd>
            </button>

            {/* Desktop nav links */}
            <div className="hidden md:flex items-center gap-0.5">
              {navLinks.map((link) => (
                <Link
                  key={link.key}
                  href={link.href}
                  className="px-2 py-2 rounded-lg text-sm font-medium text-cf-text-secondary
                             hover:text-cf-text-primary hover:bg-cf-primary/5
                             transition-all duration-200 whitespace-nowrap"
                >
                  {t(link.key)}
                </Link>
              ))}
              <a
                href="mailto:taeshinkim11@gmail.com"
                className="px-3 py-2 rounded-lg text-xs font-medium text-cf-text-secondary/70
                           hover:text-cf-primary hover:bg-cf-primary/5
                           transition-all duration-200 flex items-center gap-1"
              >
                <MessageCircle className="w-3 h-3" />
                {t('feedback')}
              </a>
            </div>

            {/* Mobile: search icon + hamburger */}
            <div className="md:hidden flex items-center gap-1">
              <button
                onClick={() => setSearchOpen(true)}
                className="flex items-center justify-center w-10 h-10 rounded-lg text-cf-text-secondary hover:text-cf-text-primary hover:bg-cf-primary/5 transition-all duration-200"
                aria-label={t('companySearchShort')}
              >
                <Search className="w-5 h-5" />
              </button>
              <button
                onClick={() => setIsOpen(!isOpen)}
                className="flex items-center justify-center w-10 h-10 rounded-lg text-cf-text-secondary hover:text-cf-text-primary hover:bg-cf-primary/5 transition-all duration-200"
                aria-label={isOpen ? t('close') : t('menu')}
              >
                {isOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
              </button>
            </div>
          </div>
        </div>
      </nav>

      {/* Global search overlay */}
      {searchOpen && <GlobalSearch onClose={() => setSearchOpen(false)} />}

      {/* Mobile drawer overlay */}
      {isOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/20 backdrop-blur-sm md:hidden animate-fade-in"
          onClick={() => setIsOpen(false)}
        />
      )}

      {/* Mobile slide-in drawer */}
      <div
        className={`fixed top-0 right-0 z-50 h-full w-72 bg-white shadow-xl
                     transform transition-transform duration-300 ease-out md:hidden
                     ${isOpen ? 'translate-x-0' : 'translate-x-full'}`}
      >
        <div className="flex items-center justify-between p-4 border-b border-cf-border">
          <span className="text-lg font-heading font-bold text-cf-text-primary">
            Flow<span className="text-cf-primary">vium</span>
          </span>
          <button
            onClick={() => setIsOpen(false)}
            className="flex items-center justify-center w-10 h-10 rounded-lg text-cf-text-secondary hover:text-cf-text-primary hover:bg-cf-primary/5 transition-all duration-200"
            aria-label={t('close')}
          >
            <X className="w-5 h-5" />
          </button>
        </div>
        <nav className="flex flex-col p-4 gap-1">
          {navLinks.map((link) => (
            <Link
              key={link.key}
              href={link.href}
              onClick={() => setIsOpen(false)}
              className="px-4 py-3 rounded-lg text-sm font-medium text-cf-text-secondary
                         hover:text-cf-text-primary hover:bg-cf-primary/5
                         transition-all duration-200"
            >
              {t(link.key)}
            </Link>
          ))}
        </nav>
      </div>
    </>
  );
}
