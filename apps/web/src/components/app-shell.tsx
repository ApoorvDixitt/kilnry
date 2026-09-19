'use client';

// Kilnry — https://github.com/ApoorvDixitt/kilnry
// Copyright (c) 2026 Apoorv Dixit. Licensed under the Sustainable Use License 1.0.
// SPDX-License-Identifier: LicenseRef-Sustainable-Use-1.0
// See LICENSE.md in the repository root. You may not remove or obscure this notice.

import type { ReactNode } from 'react';
import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import {
  Command,
  Images,
  LayoutGrid,
  ListTodo,
  MessageCircle,
  PanelLeftClose,
  PanelLeftOpen,
  Plus,
  Search,
  Settings,
  Sparkles,
  UserRound,
  Workflow,
  X,
} from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { BrandMark } from './brand-mark';
import { ChecklistWidget } from './checklist-widget';
import NumberFlow from '@number-flow/react';
import { ThemeSwitcher } from './theme-switcher';
import { message } from '../lib/messages';

const navigation = [
  { href: '/create', label: 'nav.create', icon: Plus, chord: 'C' },
  { href: '/library', label: 'nav.library', icon: Images, chord: 'L' },
  { href: '/characters', label: 'nav.characters', icon: UserRound, chord: 'H' },
  { href: '/presets', label: 'nav.presets', icon: LayoutGrid, chord: 'P' },
  { href: '/workflows', label: 'nav.workflows', icon: Workflow, chord: 'W' },
  { href: '/chat', label: 'nav.chat', icon: MessageCircle, chord: 'A' },
  { href: '/jobs', label: 'nav.jobs', icon: ListTodo, chord: 'J' },
  { href: '/settings', label: 'nav.settings', icon: Settings, chord: 'S' },
] as const;

function activeFor(pathname: string, href: string): boolean {
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function AppShell({ children }: { children: ReactNode }): React.ReactNode {
  const pathname = usePathname();
  const router = useRouter();
  const [collapsed, setCollapsed] = useState(false);
  const [palette, setPalette] = useState(false);
  const [pendingChord, setPendingChord] = useState(false);
  const [activeJobs, setActiveJobs] = useState(0);

  useEffect(() => setCollapsed(localStorage.getItem('kilnry-sidebar') === 'collapsed'), []);

  // Keep the Jobs badge showing how many jobs are running or queued, refreshed
  // from the server-sent-events stream so it ticks as jobs change.
  useEffect(() => {
    const refresh = (): void => {
      void fetch('/api/jobs')
        .then((response) =>
          response.ok ? (response.json() as Promise<{ jobs: Array<{ status: string }> }>) : null,
        )
        .then((body) => {
          if (!body) return;
          setActiveJobs(
            body.jobs.filter((job) => ['running', 'queued', 'waiting'].includes(job.status)).length,
          );
        })
        .catch(() => setActiveJobs(0));
    };
    refresh();
    if (typeof EventSource === 'undefined') return;
    const source = new EventSource('/api/events');
    source.addEventListener('message', refresh);
    source.addEventListener('error', () => source.close());
    return () => source.close();
  }, []);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const listener = (event: KeyboardEvent): void => {
      const target = event.target as HTMLElement | null;
      const editing = target?.matches('input, textarea, select, [contenteditable=true]') ?? false;
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setPalette((value) => !value);
        return;
      }
      if ((event.metaKey || event.ctrlKey) && event.key === '\\') {
        event.preventDefault();
        setCollapsed((value) => !value);
        return;
      }
      if (event.key === 'Escape') setPalette(false);
      if (editing || event.metaKey || event.ctrlKey || event.altKey) return;
      if (pendingChord) {
        const item = navigation.find((entry) => entry.chord.toLowerCase() === event.key.toLowerCase());
        setPendingChord(false);
        if (timer) clearTimeout(timer);
        if (item) router.push(item.href);
        return;
      }
      if (event.key.toLowerCase() === 'g') {
        setPendingChord(true);
        timer = setTimeout(() => setPendingChord(false), 600);
      }
    };
    window.addEventListener('keydown', listener);
    return () => {
      window.removeEventListener('keydown', listener);
      if (timer) clearTimeout(timer);
    };
  }, [pendingChord, router]);

  useEffect(() => localStorage.setItem('kilnry-sidebar', collapsed ? 'collapsed' : 'open'), [collapsed]);

  const title = useMemo(() => {
    const item = navigation.find((entry) => activeFor(pathname, entry.href));
    return item ? message(item.label) : message('brand.name');
  }, [pathname]);

  return (
    <div className={collapsed ? 'app-shell is-collapsed' : 'app-shell'}>
      <aside className="sidebar">
        <div className="sidebar-brand">
          <BrandMark />
          <span className="sidebar-label">{message('brand.name')}</span>
        </div>
        <nav className="primary-nav" aria-label={message('brand.name')}>
          {navigation.slice(0, -1).map((item) => {
            const Icon = item.icon;
            const active = activeFor(pathname, item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                className={active ? 'nav-item is-active' : 'nav-item'}
                title={`${message(item.label)} · G ${item.chord}`}
              >
                <Icon size={19} strokeWidth={1.75} />
                <span className="sidebar-label">{message(item.label)}</span>
                {item.href === '/jobs' ? (
                  <span className="live-badge">
                    <NumberFlow value={activeJobs} respectMotionPreference />
                  </span>
                ) : null}
              </Link>
            );
          })}
        </nav>
        <div className="sidebar-spacer" />
        <ChecklistWidget />
        <Link
          href="/settings"
          className={activeFor(pathname, '/settings') ? 'nav-item is-active' : 'nav-item'}
        >
          <Settings size={19} strokeWidth={1.75} />
          <span className="sidebar-label">{message('nav.settings')}</span>
        </Link>
        <button
          className="nav-item collapse-button"
          type="button"
          onClick={() => setCollapsed((value) => !value)}
        >
          {collapsed ? <PanelLeftOpen size={18} /> : <PanelLeftClose size={18} />}
          <span className="sidebar-label">⌘\</span>
        </button>
      </aside>
      <main className="main-stage">
        <header className="topbar">
          <h1>{title}</h1>
          <div className="budget-meter" data-money="true">
            <span>{message('shell.budget')}</span>
            <i>
              <b />
            </i>
          </div>
          <button
            className="icon-button"
            type="button"
            aria-label={message('shell.command')}
            onClick={() => setPalette(true)}
          >
            <Command size={18} strokeWidth={1.75} />
            <kbd>⌘K</kbd>
          </button>
          <ThemeSwitcher />
        </header>
        <div className="route-stage">{children}</div>
      </main>

      <AnimatePresence>
        {palette ? (
          <motion.div
            className="palette-backdrop"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
          >
            <motion.section
              className="command-palette"
              role="dialog"
              aria-modal="true"
              aria-label={message('shell.command')}
              initial={{ opacity: 0, scale: 0.98, y: -8 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.98, y: -6 }}
              transition={{ duration: 0.2, ease: [0.32, 0.72, 0, 1] }}
            >
              <div className="palette-search">
                <Search size={18} />
                <span>{message('shell.command')}</span>
                <button type="button" onClick={() => setPalette(false)} aria-label={message('shell.close')}>
                  <X size={17} />
                </button>
              </div>
              <div className="palette-results">
                {navigation.map((item) => {
                  const Icon = item.icon;
                  return (
                    <Link key={item.href} href={item.href} onClick={() => setPalette(false)}>
                      <Icon size={18} />
                      <span>{message(item.label)}</span>
                      <kbd>G {item.chord}</kbd>
                    </Link>
                  );
                })}
              </div>
              <footer>
                <Sparkles size={15} />
                {message('brand.tagline')}
              </footer>
            </motion.section>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
  );
}
