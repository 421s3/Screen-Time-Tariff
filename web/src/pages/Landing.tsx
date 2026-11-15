import type { CSSProperties, ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { motion } from 'framer-motion'
import { useWallet } from '@solana/wallet-adapter-react'
import { WalletMultiButton } from '@solana/wallet-adapter-react-ui'
import { ArrowRight, Coins, Eye, Gamepad2, Globe, LayoutDashboard, Plus, ShieldCheck, Ticket, Users } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { USE_MOCK } from '../config'
import { useCurrentGroupId } from '../lib/currentGroup'
import { Mascot, type TomMood } from '../components/Mascot'
import { TomMoment, type TomMomentName } from '../components/TomMoment'

/* Public landing page. Storytelling rhythm takes cues from ahead-app.com (soft sky hero with clouds,
   product illustrations with the mascot peeking in, pastel tiles, alternating story rows); the
   illustrations of Tariff Tom and the product are our own. */

export function Landing() {
  const { connected } = useWallet()
  const groupId = useCurrentGroupId()
  return (
    <div>
      <Hero connected={connected} groupId={groupId} />
      <Problem />
      <WhatCounts />
      <HowItWorks />
      <TomMoments />
      <Trust connected={connected} />
      <footer className="border-t bg-white">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-6 gap-y-2 px-4 py-8 text-sm text-muted-foreground sm:px-6">
          <span className="flex items-center gap-2 font-medium text-ink">
            <Mascot size={26} animated={false} /> Screen Time Tariff
          </span>
          <span>Built at sunhacks 9.0 · Solana devnet only, no real money.</span>
          <span className="sm:ml-auto">Tracking only: we never block or close your apps.</span>
        </div>
      </footer>
    </div>
  )
}

/* ------------------------------------------------------------------ actions */

function Actions({ connected, groupId }: { connected: boolean; groupId: string | null }) {
  if (!connected) return <WalletMultiButton />
  return (
    <>
      <Button asChild size="lg" variant="cta">
        <Link to="/create">
          <Plus /> Create a group
        </Link>
      </Button>
      <Button asChild size="lg" variant="outline">
        <Link to={groupId ? `/group/${groupId}` : '/join'}>
          {groupId ? <LayoutDashboard /> : <Ticket />}
          {groupId ? 'Open dashboard' : 'Join with a code'}
        </Link>
      </Button>
    </>
  )
}

/* ------------------------------------------------------------------ hero */

function Hero({ connected, groupId }: { connected: boolean; groupId: string | null }) {
  return (
    <section className="wash-hero relative overflow-hidden">
      <HeroShapes />
      <div className="relative mx-auto grid max-w-6xl items-center gap-8 px-4 pb-24 pt-10 sm:px-6 md:grid-cols-[1fr_1.05fr] md:gap-6 md:pb-28 md:pt-14">
        <div className="text-center md:text-left">
          <p className="inline-flex items-center gap-2 rounded-full border border-[#d9cffc] bg-white/80 px-3 py-1 text-sm font-medium text-ink">
            <Users className="size-4" /> A screen-time pact for friend groups
          </p>
          <h1 className="mt-5 text-[2.25rem] font-semibold leading-[1.1] sm:text-5xl lg:text-[3.25rem]">
            Put a <span className="mark">price</span> on your screen time
          </h1>
          <p className="mx-auto mt-4 max-w-md text-lg text-muted-foreground md:mx-0">
            Friends stake devnet SOL and agree on a daily allowance. Go over it, and every extra minute moves part of
            your stake into the group pot. Least screen time wins it all.
          </p>
          <div className="mt-7 flex flex-wrap justify-center gap-3 md:justify-start">
            <Actions connected={connected} groupId={groupId} />
          </div>
          <p className="mt-3 text-sm text-muted-foreground">
            {connected ? 'Phantom connected on devnet.' : 'Connect Phantom on devnet to start.'}
            {USE_MOCK && ' Demo mode: simulated data.'}
          </p>
        </div>
        <HeroIllustration />
      </div>
      <Clouds className="absolute inset-x-0 bottom-0 h-16 w-full text-white sm:h-24" />
    </section>
  )
}

/** Floating geometry behind the hero: coins, a ring, a sparkle, soft blobs. */
function HeroShapes() {
  return (
    <div className="pointer-events-none absolute inset-0" aria-hidden="true">
      <span className="absolute -left-10 top-24 size-40 rounded-full bg-[#b9a5ff]/30 blur-2xl" />
      <span className="absolute right-[8%] top-10 hidden size-24 rounded-full border-[10px] border-[#b9a5ff]/50 md:block" />
      <Coin className="drift absolute left-[46%] top-16 hidden w-10 md:block" />
      <Coin className="absolute bottom-24 right-[4%] w-8 rotate-12" style={{ animation: 'drift 7s ease-in-out .6s 2' }} />
      <Sparkle className="absolute left-[6%] top-[62%] hidden w-6 text-[#f6b9d6] md:block" />
      <Sparkle className="absolute right-[38%] top-[14%] w-5 text-[#7654f6]" />
      <span className="absolute bottom-28 left-[42%] hidden size-4 rotate-45 rounded-[3px] bg-[#ffe39a] md:block" />
    </div>
  )
}

function Coin({ className = '', style }: { className?: string; style?: CSSProperties }) {
  return (
    <svg viewBox="0 0 40 40" className={className} style={style}>
      <circle cx="20" cy="21.5" r="17" fill="#c8890f" />
      <circle cx="20" cy="19" r="17" fill="#ffd45e" />
      <circle cx="20" cy="19" r="10" fill="none" stroke="#c8890f" strokeWidth="2.5" />
      <path d="M14 11a10 10 0 0 1 6-2" stroke="#fff6d6" strokeWidth="2.5" strokeLinecap="round" fill="none" />
    </svg>
  )
}

function Sparkle({ className = '' }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className}>
      <path d="M12 0c1 7 5 11 12 12-7 1-11 5-12 12-1-7-5-11-12-12 7-1 11-5 12-12Z" fill="currentColor" />
    </svg>
  )
}

function HeroIllustration() {
  return (
    <div className="relative mx-auto h-[300px] w-full max-w-[480px] sm:h-[400px]" aria-hidden="true">
      {/* lavender disc Tom stands on */}
      <span className="absolute bottom-2 right-0 hidden h-28 w-56 rounded-[50%] bg-gradient-to-r from-[#b9a5ff]/70 to-[#f6b9d6]/70 sm:block" />
      <div className="drift absolute left-0 right-[10%] top-2 sm:left-[2%] sm:right-[30%] sm:top-4">
        <DashboardWindow />
      </div>
      <div className="absolute -bottom-3 right-2 z-10 hidden sm:block">
        <Mascot size={150} mood="happy" />
      </div>
      <motion.p
        initial={{ opacity: 0, y: 8, scale: 0.9 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ delay: 0.6, type: 'spring', stiffness: 260, damping: 18 }}
        className="absolute bottom-[150px] -right-6 z-20 hidden rounded-xl rounded-br-sm bg-ink px-3 py-2 text-sm font-medium text-white sm:block"
      >
        That&rsquo;s <span className="text-[#ffe39a]">0.01 SOL</span>, Alice.
      </motion.p>
      <div className="absolute -right-1 top-0 z-10 sm:hidden">
        <Mascot size={72} mood="happy" />
      </div>
      <div
        className="absolute bottom-0 left-[-2%] hidden w-[220px] sm:block"
        style={{ animation: 'drift 7s ease-in-out 1.2s 2' }}
      >
        <TrackerWindow />
      </div>
    </div>
  )
}

/** Our dashboard, drawn small: who's on what, and whose allowance is gone. */
function DashboardWindow() {
  const rows: { name: string; mood: TomMood; used: number; label: string; over?: boolean }[] = [
    { name: 'Bob', mood: 'happy', used: 35, label: '0:21 / 1:00' },
    { name: 'Alice', mood: 'angry', used: 100, label: 'TikTok · 0:24 over', over: true },
    { name: 'Carol', mood: 'sleepy', used: 62, label: 'Idle · 0:37' },
  ]
  return (
    <div className="overflow-hidden rounded-xl border border-[#e3dbfb] bg-white text-ink shadow-[0_20px_40px_-28px_rgba(74,47,208,0.55)]">
      <div className="flex items-center gap-1.5 border-b px-3.5 py-2.5">
        <span className="size-2.5 rounded-full bg-[#f6b9d6]" />
        <span className="size-2.5 rounded-full bg-[#ffe39a]" />
        <span className="size-2.5 rounded-full bg-[#bcefe0]" />
        <span className="ml-2 truncate text-xs font-medium text-muted-foreground">Finals Week Survivors</span>
      </div>
      <div className="space-y-3 p-3.5">
        <div className="wash-purple flex items-end justify-between rounded-lg px-3 py-2.5 text-white">
          <span>
            <span className="block text-[11px] font-medium text-white/85">Group pot</span>
            <span className="font-display text-xl font-semibold">0.53 SOL</span>
          </span>
          <span className="rounded bg-white/20 px-1.5 py-0.5 font-mono text-[11px] font-semibold">12:40 left</span>
        </div>
        {rows.map((r) => (
          <div key={r.name} className="flex items-center gap-2.5">
            <Mascot size={28} mood={r.mood} animated={false} />
            <div className="min-w-0 flex-1">
              <div className="flex justify-between gap-2 text-xs">
                <span className="font-semibold">{r.name}</span>
                <span className={r.over ? 'truncate font-semibold text-bad' : 'truncate text-muted-foreground'}>{r.label}</span>
              </div>
              <div className="mt-1 h-1.5 rounded-full bg-muted">
                <div
                  className={`h-full rounded-full ${r.over ? 'bg-[#d6364a]' : r.used > 60 ? 'bg-gold' : 'bg-[#2fa56f]'}`}
                  style={{ width: `${r.used}%` }}
                />
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

/** The Windows desktop tracker, drawn small. */
function TrackerWindow({ app = 'TikTok', kind = 'site' }: { app?: string; kind?: 'site' | 'game' }) {
  return (
    <div className="overflow-hidden rounded-xl bg-[#241a5c] text-white shadow-[0_18px_40px_-24px_rgba(36,26,92,0.7)]">
      <div className="flex items-center justify-between px-3 pt-2 text-[11px] text-white/75">
        <span>Desktop tracker</span>
        <span className="flex items-center gap-1">
          <span className="size-1.5 rounded-full bg-[#5cc79a]" /> Live
        </span>
      </div>
      <div className="flex items-center gap-2.5 px-3 pb-3 pt-1">
        <Mascot size={48} mood="angry" animated={false} />
        <div className="min-w-0">
          <p className="text-sm font-semibold leading-tight">Tom sees {app}</p>
          <span className="mt-1 inline-block rounded bg-[#d6364a] px-1.5 py-0.5 text-[10px] font-bold tracking-wide">
            TRACKED {kind === 'game' ? 'GAME' : 'SITE'}
          </span>
        </div>
      </div>
    </div>
  )
}

function Clouds({ className = '' }: { className?: string }) {
  return (
    <svg viewBox="0 0 1440 120" preserveAspectRatio="none" className={className} aria-hidden="true">
      <path
        fill="currentColor"
        d="M0 120V78c60-26 120-30 180-8 40-40 120-54 180-18 50-34 140-38 190 4 60-48 170-50 230 6 50-30 130-28 170 12 60-42 160-46 220 2 50-26 120-26 160 6 50-22 90-20 110-4V120Z"
      />
    </svg>
  )
}

/* ------------------------------------------------------------------ problem */

function Problem() {
  const points = [
    { n: '60 min', t: 'is the limit you set', b: 'Phone and PC limits are a tap away from "ignore for today".' },
    { n: '0 SOL', t: 'is what ignoring it costs', b: 'Nothing happens when you blow past it, so you do.' },
    { n: '4 friends', t: 'watching changes that', b: 'Put a small stake on it, and your group chat keeps score.' },
  ]
  return (
    <section className="bg-white">
      <div className="mx-auto grid max-w-6xl items-center gap-10 px-4 pb-16 pt-8 sm:px-6 md:grid-cols-[1fr_1.4fr] md:gap-14 md:pb-20">
        <div>
          <p className="text-sm font-semibold text-brand">The problem</p>
          <h2 className="mt-2 text-3xl font-semibold leading-tight sm:text-4xl">
            Screen-time limits are <span className="mark">free</span> to ignore
          </h2>
          <p className="mt-4 text-lg text-muted-foreground">
            Our group chat lost finals week to TikTok and ranked Valorant. So we put a price on it, and gave the
            money to whoever stayed focused.
          </p>
        </div>
        <div className="grid gap-3 sm:grid-cols-3">
          {points.map((p, i) => (
            <div
              key={p.n}
              className={`rounded-xl p-5 ${
                ['bg-gradient-to-br from-[#ffe39a] to-[#fff3cc] sm:-rotate-2', 'bg-gradient-to-br from-[#e7e0ff] to-[#f6b9d6]/60 sm:translate-y-4', 'bg-gradient-to-br from-[#bcefe0] to-[#e3f8f1] sm:rotate-2'][i]
              }`}
            >
              <p className="font-display text-3xl font-semibold">{p.n}</p>
              <p className="mt-1 font-medium">{p.t}</p>
              <p className="mt-2 text-sm text-ink/75">{p.b}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}

/* ------------------------------------------------------------------ what counts */

type FaceMood = 'angry' | 'smug' | 'worried' | 'sleepy' | 'wink' | 'sad'

const TILES: { label: string; kind: 'Site' | 'Game'; bg: string; face: FaceMood }[] = [
  { label: 'TikTok', kind: 'Site', bg: 'from-[#f6b9d6] to-[#ffd6cc]', face: 'angry' },
  { label: 'Valorant', kind: 'Game', bg: 'from-[#ffe39a] to-[#fff1c4]', face: 'smug' },
  { label: 'YouTube', kind: 'Site', bg: 'from-[#bcefe0] to-[#dcf7ee]', face: 'worried' },
  { label: 'Steam games', kind: 'Game', bg: 'from-[#cfdcff] to-[#e7e0ff]', face: 'sleepy' },
  { label: 'League', kind: 'Game', bg: 'from-[#b9a5ff] to-[#e2d9ff]', face: 'wink' },
  { label: 'Instagram', kind: 'Site', bg: 'from-[#ffd6cc] to-[#f6b9d6]', face: 'sad' },
]

function WhatCounts() {
  return (
    <section className="relative bg-gradient-to-b from-[#efeaff] via-[#f6f4ff] to-[#f6f4ff] py-16 md:py-20">
      <div className="mx-auto max-w-6xl px-4 sm:px-6">
        <SectionTitle
          eyebrow="What counts"
          title={
            <>
              Your group picks the apps that <span className="mark">cost</span>
            </>
          }
          sub="Games match by their program, sites by the browser tab you're looking at, and any game launched from Steam can count too."
        />
        <div className="mx-auto mt-10 grid max-w-4xl grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4">
          {TILES.map((t, i) => (
            <motion.div
              key={t.label}
              whileHover={{ y: -4, rotate: i % 2 ? 1.5 : -1.5 }}
              transition={{ type: 'spring', stiffness: 300, damping: 18 }}
              className={`bg-gradient-to-br ${t.bg} flex min-h-[150px] flex-col justify-between rounded-xl p-4 text-ink sm:min-h-[180px] sm:p-5 ${
                i % 3 === 1 ? 'sm:translate-y-5' : ''
              }`}
            >
              <TomFace mood={t.face} className="w-20 sm:w-24" />
              <div>
                <p className="font-display text-lg font-semibold sm:text-xl">{t.label}</p>
                <p className="flex items-center gap-1 text-xs font-medium text-ink/75">
                  {t.kind === 'Game' ? <Gamepad2 className="size-3.5" /> : <Globe className="size-3.5" />}
                  {t.kind}
                </p>
              </div>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  )
}

/** Tom's face only (eyes, monocle, mustache), for the pastel tiles. */
function TomFace({ mood, className = '' }: { mood: FaceMood; className?: string }) {
  const eye = (cx: number) =>
    mood === 'sleepy' || (mood === 'wink' && cx > 60) ? (
      <path d={`M${cx - 9} 34 q9 7 18 0`} fill="none" stroke="#17162a" strokeWidth="4" strokeLinecap="round" />
    ) : (
      <>
        <circle cx={cx} cy="34" r="11" fill="#fff" />
        <circle cx={cx} cy={mood === 'sad' ? 37 : 35} r="6" fill="#17162a" />
      </>
    )
  return (
    <svg viewBox="0 0 120 80" className={className} aria-hidden="true">
      {eye(40)}
      {eye(80)}
      {mood === 'angry' && (
        <g stroke="#17162a" strokeWidth="5" strokeLinecap="round">
          <line x1="28" y1="16" x2="50" y2="24" />
          <line x1="92" y1="16" x2="70" y2="24" />
        </g>
      )}
      {mood === 'smug' && (
        <g stroke="#17162a" strokeWidth="5" strokeLinecap="round">
          <line x1="29" y1="20" x2="50" y2="17" />
          <line x1="91" y1="20" x2="70" y2="17" />
        </g>
      )}
      {(mood === 'worried' || mood === 'sad') && (
        <g stroke="#17162a" strokeWidth="4" strokeLinecap="round">
          <line x1="30" y1="21" x2="49" y2="16" />
          <line x1="90" y1="21" x2="71" y2="16" />
        </g>
      )}
      {mood !== 'wink' && mood !== 'sleepy' && <circle cx="80" cy="34" r="15" fill="none" stroke="#b8860b" strokeWidth="3.5" />}
      <path d="M36 58 Q48 50 60 58 Q72 50 84 58 Q72 68 60 62 Q48 68 36 58 Z" fill="#3b2a20" />
      {mood === 'smug' || mood === 'wink' ? (
        <path d="M52 71 Q60 77 68 71" fill="none" stroke="#3b2a20" strokeWidth="3.5" strokeLinecap="round" />
      ) : mood === 'angry' || mood === 'sad' ? (
        <path d="M52 75 Q60 69 68 75" fill="none" stroke="#3b2a20" strokeWidth="3.5" strokeLinecap="round" />
      ) : null}
    </svg>
  )
}

/* ------------------------------------------------------------------ how it works */

function HowItWorks() {
  const steps: { title: ReactNode; body: string; art: ReactNode; tint: string }[] = [
    {
      title: (
        <>
          Pool your <span className="mark">stakes</span>
        </>
      ),
      body: 'Create a group, share a six-character invite code, and everyone stakes devnet SOL. A Solana program holds the pot, not us and not anyone in the group.',
      art: <StepScene moment="join"><PotArt /></StepScene>,
      tint: 'bg-gradient-to-br from-[#ffe39a] via-[#fff1c4] to-[#ffd6cc]',
    },
    {
      title: (
        <>
          Agree on an <span className="mark">allowance</span>
        </>
      ),
      body: 'Pick a daily allowance and a tariff per minute. Time on tracked apps fills your bar. Once it’s full, each extra minute moves part of your stake into the pot.',
      art: <StepScene moment="over"><AllowanceArt /></StepScene>,
      tint: 'bg-gradient-to-br from-[#bcefe0] via-[#dff7ef] to-[#dce6ff]',
    },
    {
      title: (
        <>
          Run the <span className="mark">desktop tracker</span>
        </>
      ),
      body: 'Pair the Windows tracker with a code from the dashboard. Every second it checks which app or tab is in front and reports it. It only measures; it never blocks or closes anything.',
      art: <StepScene moment="tracking"><TrackerArt /></StepScene>,
      tint: 'bg-gradient-to-br from-[#b9a5ff] via-[#d8ccff] to-[#f6b9d6]',
    },
    {
      title: (
        <>
          Least time <span className="mark">wins the pot</span>
        </>
      ),
      body: 'When the period ends, the staked member with the least screen time takes the whole pot. Everyone withdraws what’s left of their stake.',
      art: <StepScene moment="win"><WinArt /></StepScene>,
      tint: 'bg-gradient-to-br from-[#f6b9d6] via-[#fbd9e8] to-[#ffe39a]',
    },
  ]
  return (
    <section className="bg-white">
      <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6 md:py-24">
      <SectionTitle
        eyebrow="How it works"
        title={
          <>
            Four steps to a group chat that <span className="mark">logs off</span>
          </>
        }
      />
      <ol className="mt-12 space-y-14 md:space-y-20">
        {steps.map((s, i) => (
          <li
            key={i}
            className={`grid items-center gap-6 md:gap-12 ${i % 2 ? 'md:grid-cols-[1.15fr_0.85fr]' : 'md:grid-cols-[0.85fr_1.15fr]'}`}
          >
            <div className={`max-w-md ${i % 2 ? 'md:order-2' : ''}`}>
              <span className="inline-flex size-9 items-center justify-center rounded-full bg-gradient-to-br from-[#6a47f0] to-[#7b3fd4] font-display text-base font-semibold text-white">
                {i + 1}
              </span>
              <h3 className="mt-1 text-2xl font-semibold leading-tight sm:text-3xl">{s.title}</h3>
              <p className="mt-3 text-muted-foreground">{s.body}</p>
            </div>
            <div className={`relative w-full overflow-hidden rounded-2xl ${s.tint} p-5 sm:p-8`}>
              <span aria-hidden="true" className="absolute -right-8 -top-8 size-28 rounded-full bg-white/35" />
              <span aria-hidden="true" className="absolute -bottom-6 left-6 size-12 rounded-full border-[6px] border-white/40" />
              <div className="relative">{s.art}</div>
            </div>
          </li>
        ))}
      </ol>
      </div>
    </section>
  )
}

/** A step illustration: Tom acting out the moment beside a slice of the product. */
function StepScene({ moment, children }: { moment: TomMomentName; children: ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-4 sm:flex-row sm:items-end">
      <TomMoment moment={moment} size={150} className="sm:-mb-3 sm:-ml-2" />
      <div className="w-full min-w-0 flex-1">{children}</div>
    </div>
  )
}

function PotArt() {
  return (
    <div className="flex items-end justify-center gap-5">
      <svg viewBox="0 0 120 110" className="hidden w-20 shrink-0 lg:block" aria-hidden="true">
        {[0, 1, 2, 3].map((i) => (
          <g key={i} transform={`translate(0 ${70 - i * 16})`}>
            <ellipse cx="60" cy="22" rx="44" ry="13" fill="#b45309" />
            <ellipse cx="60" cy="16" rx="44" ry="13" fill="#f2b524" />
            <ellipse cx="60" cy="16" rx="24" ry="6" fill="none" stroke="#b45309" strokeWidth="3" />
          </g>
        ))}
      </svg>
      <div className="mb-1 rounded-lg bg-white p-3.5">
        <p className="text-xs font-medium text-muted-foreground">Group pot</p>
        <p className="font-display text-2xl font-semibold">1.50 SOL</p>
        <div className="mt-2 flex -space-x-2">
          {(['happy', 'sleepy', 'happy'] as TomMood[]).map((m, i) => (
            <span key={i} className="rounded-full bg-white ring-2 ring-white">
              <Mascot size={28} mood={m} animated={false} />
            </span>
          ))}
        </div>
      </div>
    </div>
  )
}

function AllowanceArt() {
  return (
    <div className="space-y-4 rounded-lg bg-white p-4 text-sm">
      <Bar name="Bob" used={42} label="0:42 / 1:00" color="bg-[#2fa56f]" />
      <Bar name="Alice" used={100} label="0:24 over" color="bg-[#d6364a]" over />
      <p className="rounded-md bg-coral px-3 py-2 text-xs font-medium">
        Next −0.01 SOL from Alice in <span className="font-mono">0:36</span>
      </p>
    </div>
  )
}

function Bar({ name, used, label, color, over }: { name: string; used: number; label: string; color: string; over?: boolean }) {
  return (
    <div>
      <div className="flex justify-between gap-2">
        <span className="font-semibold">{name}</span>
        <span className={over ? 'font-mono font-semibold text-bad' : 'font-mono text-muted-foreground'}>{label}</span>
      </div>
      <div className="mt-1.5 h-2 rounded-full bg-muted">
        <div className={`h-full rounded-full ${color}`} style={{ width: `${used}%` }} />
      </div>
    </div>
  )
}

function TrackerArt() {
  return (
    <div className="mx-auto max-w-[280px] space-y-4">
      <TrackerWindow app="Valorant" kind="game" />
      <div>
        <div className="flex justify-center gap-1.5" aria-hidden="true">
          {'482913'.split('').map((d, i) => (
            <span key={i} className="code-digit h-10 w-8 text-lg">
              {d}
            </span>
          ))}
        </div>
        <p className="mt-2 text-center text-xs font-medium text-ink/75">One-time pairing code from the dashboard</p>
      </div>
    </div>
  )
}

function WinArt() {
  return (
    <div className="flex items-center gap-4">
      <div className="min-w-0 flex-1 rounded-lg bg-white p-4 text-sm">
        <p className="text-xs font-medium text-muted-foreground">Winner</p>
        <p className="font-display text-xl font-semibold">Bob</p>
        <p className="font-medium text-good">+0.53 SOL from the pot</p>
        <ol className="mt-3 space-y-1 text-muted-foreground">
          {[
            ['1. Bob', '0:42'],
            ['2. Carol', '0:58'],
            ['3. Alice', '1:24'],
          ].map(([n, t]) => (
            <li key={n} className="flex justify-between">
              <span>{n}</span>
              <span className="font-mono">{t}</span>
            </li>
          ))}
        </ol>
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ trust */

function Trust({ connected }: { connected: boolean }) {
  const feed = [
    { who: 'Alice', what: 'TikTok', sol: '0.01', mins: 1 },
    { who: 'Carol', what: 'Valorant', sol: '0.02', mins: 2 },
    { who: 'Alice', what: 'YouTube', sol: '0.01', mins: 1 },
  ]
  const points = [
    { icon: ShieldCheck, t: 'Penalties only go to your friends', b: 'The program can move stake into the pot and pay the pot to a member. Nothing else.' },
    { icon: Eye, t: 'Every tariff is public', b: 'Each charge is a devnet transaction with an Explorer link.' },
    { icon: Coins, t: 'Closing the tracker doesn’t help', b: 'Missed check-ins count as time over the limit.' },
  ]
  return (
    <section className="wash-purple on-color relative overflow-hidden py-16 text-white md:py-20">
      <span aria-hidden="true" className="absolute -left-16 bottom-0 size-56 rounded-full bg-white/10" />
      <span aria-hidden="true" className="absolute right-[45%] top-8 size-5 rotate-45 rounded-[4px] bg-[#ffe39a]" />
      <div className="relative mx-auto grid max-w-6xl items-center gap-12 px-4 sm:px-6 md:grid-cols-2">
        <div>
          <p className="text-sm font-semibold text-white">Why it works</p>
          <h2 className="mt-2 text-3xl font-semibold leading-tight sm:text-4xl">Keep each other accountable</h2>
          <ul className="mt-6 space-y-4">
            {points.map((p) => (
              <li key={p.t} className="flex gap-3">
                <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-white/15">
                  <p.icon className="size-4 text-[#ffe39a]" />
                </span>
                <div>
                  <p className="font-medium">{p.t}</p>
                  <p className="text-sm text-white/85">{p.b}</p>
                </div>
              </li>
            ))}
          </ul>
          <div className="mt-8 flex flex-wrap gap-3">
            {connected ? (
              <>
                <Button asChild size="lg" className="bg-white text-[#4a2fd0] hover:bg-[#f3efff]">
                  <Link to="/create">
                    <Plus /> Start a group
                  </Link>
                </Button>
                <Button asChild size="lg" variant="link" className="text-white">
                  <Link to="/join">
                    Join with a code <ArrowRight />
                  </Link>
                </Button>
              </>
            ) : (
              <WalletMultiButton />
            )}
          </div>
        </div>
        <div className="relative pt-10">
          <Mascot size={76} mood="celebrate" className="absolute -top-2 right-4 z-10" />
          <div className="rounded-2xl bg-white p-4 text-ink shadow-[0_24px_50px_-30px_rgba(23,21,45,0.6)] sm:p-5">
            <div className="flex items-center gap-3 text-xs font-medium text-muted-foreground">
              <span>Penalty feed</span>
              <span className="flex items-center gap-1.5 text-good">
                <span className="size-1.5 rounded-full bg-[#2fa56f]" /> Live
              </span>
            </div>
            <ul className="mt-2 divide-y">
              {feed.map((f, i) => (
                <li key={i} className="flex items-center gap-3 py-3">
                  <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-lemon">
                    <Coins className="size-4" />
                  </span>
                  <p className="min-w-0 flex-1 text-sm">
                    <span className="font-semibold">{f.who}</span> paid {f.sol} SOL
                    <span className="text-muted-foreground"> · {f.mins} min of {f.what}</span>
                  </p>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>
    </section>
  )
}

function SectionTitle({ eyebrow, title, sub }: { eyebrow: string; title: ReactNode; sub?: string }) {
  return (
    <div className="mx-auto max-w-2xl text-center">
      <p className="text-sm font-semibold text-brand">{eyebrow}</p>
      <h2 className="mt-2 text-3xl font-semibold leading-tight sm:text-4xl">{title}</h2>
      {sub && <p className="mt-3 text-lg text-muted-foreground">{sub}</p>}
    </div>
  )
}

/* ------------------------------------------------------------------ Tom's moments */

const MOMENTS: { m: TomMomentName; t: string; b: string }[] = [
  { m: 'join', t: 'You join', b: 'A six-character code and you are in.' },
  { m: 'tracking', t: 'Tracked app', b: 'TikTok in front? Tom notices.' },
  { m: 'over', t: 'Over the limit', b: 'Allowance gone. The clock starts charging.' },
  { m: 'penalty', t: 'Tariff paid', b: 'Your stake drops into the pot.' },
  { m: 'offline', t: 'Tracker offline', b: 'Missed check-ins still count.' },
  { m: 'win', t: 'You win', b: 'Least screen time takes it all.' },
]

function TomMoments() {
  return (
    <section className="relative overflow-hidden bg-gradient-to-b from-[#f6f4ff] to-[#efeaff] py-16 md:py-20">
      <div className="mx-auto max-w-6xl px-4 sm:px-6">
        <div className="grid items-end gap-4 md:grid-cols-[1fr_1.2fr]">
          <div>
            <p className="text-sm font-semibold text-brand">Meet Tariff Tom</p>
            <h2 className="mt-2 text-3xl font-semibold leading-tight sm:text-4xl">
              Your group&rsquo;s very <span className="mark">polite</span> tax collector
            </h2>
          </div>
          <p className="text-lg text-muted-foreground md:pb-1">
            Tom shows up on the dashboard and in the desktop app at the moments that matter, and stays out of the way
            the rest of the time.
          </p>
        </div>
        <ol className="mt-10 grid grid-cols-2 gap-x-4 gap-y-8 sm:grid-cols-3 lg:grid-cols-6">
          {MOMENTS.map((x, i) => (
            <li key={x.m} className={`flex flex-col items-center text-center ${i % 2 ? 'lg:mt-10' : ''}`}>
              <TomMoment moment={x.m} size={136} />
              <p className="mt-3 font-semibold">{x.t}</p>
              <p className="mt-0.5 text-sm text-muted-foreground">{x.b}</p>
            </li>
          ))}
        </ol>
      </div>
    </section>
  )
}
