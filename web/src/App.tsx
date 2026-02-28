import { useEffect, useState, useRef, useCallback, type ReactNode } from 'react'
import './App.css'

// ── Types ──────────────────────────────────────────────────────────────────

interface TimelineEvent {
  event_id:        string   // E001, E002, …
  datetime_utc:    string   // 1947-02-28T01:00:00Z  or  1947-02-28
  datetime_local:  string   // 1947-02-28T09:00:00+08:00  or  1947-02-28
  date:            string   // YYYY-MM-DD
  time_local:      string   // HH:MM (24h Taiwan time) or ''
  time_known:      string   // 'true' | 'false'
  time_precision:  string   // 'exact' | 'fuzzy' | ''
  time_label:      string   // original Chinese time word, e.g. '下午'
  time_category:   string   // normalised category, e.g. '夜間'
  time_note:       string   // free-form note, e.g. '約九時'
  region:          string
  city:            string
  place:           string
  refs:            string   // semicolon-separated ref ids, e.g. '2;14;15'
  event_zh:        string
  source_chapter:  string
  context_zh:      string
}

interface RefPopover {
  id:   number
  text: string
  rect: DOMRect
}

// ── CSV parser ─────────────────────────────────────────────────────────────

function parseCSV(text: string): Record<string, string>[] {
  const lines = text.trim().split('\n')
  const headers = lines[0].split(',')
  return lines.slice(1).map(line => {
    const fields: string[] = []
    let cur = ''
    let inQuote = false
    for (const ch of line) {
      if (ch === '"') { inQuote = !inQuote }
      else if (ch === ',' && !inQuote) { fields.push(cur); cur = '' }
      else { cur += ch }
    }
    fields.push(cur)
    const obj: Record<string, string> = {}
    headers.forEach((h, i) => { obj[h.trim()] = (fields[i] ?? '').trim() })
    return obj
  })
}

// ── Refs renderer ─────────────────────────────────────────────────────────

function renderWithRefs(
  text: string,
  refMap: Map<number, string>,
  onRef: (id: number, text: string, rect: DOMRect) => void,
): ReactNode[] {
  return text.split(/(\[\d+\])/).map((part, i) => {
    const m = part.match(/^\[(\d+)\]$/)
    if (!m) return part
    const id = parseInt(m[1], 10)
    const refText = refMap.get(id)
    if (!refText) return <span key={i} className="ref-num">{part}</span>
    return (
      <button
        key={i}
        className="ref-num"
        onClick={e => {
          e.stopPropagation()
          onRef(id, refText, (e.currentTarget as HTMLElement).getBoundingClientRect())
        }}
      >
        {part}
      </button>
    )
  })
}

// ── Time utilities ─────────────────────────────────────────────────────────

function toTaiwanTime(d: Date) {
  const tw = new Date(d.getTime() + 8 * 60 * 60 * 1000)
  const month  = tw.getUTCMonth() + 1
  const day    = tw.getUTCDate()
  const hour   = tw.getUTCHours()
  const minute = tw.getUTCMinutes()
  const second = tw.getUTCSeconds()
  const mmdd   = `${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
  const hhmmss = `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}:${String(second).padStart(2, '0')}`
  return { mmdd, hhmmss, minutes: hour * 60 + minute }
}

function toMinutes(hhmm: string): number {
  if (!hhmm) return -1
  const [h, m] = hhmm.split(':').map(Number)
  return h * 60 + m
}

function formatTimeChinese(hhmm: string): string {
  if (!hhmm) return ''
  const [h, m] = hhmm.split(':').map(Number)
  const period = h < 12 ? '上午' : '下午'
  const dh = h === 0 ? 12 : h > 12 ? h - 12 : h
  return `${period}${dh}:${m.toString().padStart(2, '0')}`
}

function formatReaderTime(d: Date): string {
  return d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit' })
}

function formatTaiwanClock(d: Date): string {
  return toTaiwanTime(d).hhmmss
}

// ── Date labels ────────────────────────────────────────────────────────────

const DATE_LABELS: Record<string, string> = {
  '02-27': '2月27日', '02-28': '2月28日',
  '03-01': '3月1日',  '03-02': '3月2日',  '03-03': '3月3日',
  '03-04': '3月4日',  '03-05': '3月5日',  '03-06': '3月6日',
  '03-07': '3月7日',  '03-08': '3月8日',  '03-09': '3月9日',
  '03-10': '3月10日', '03-11': '3月11日', '03-12': '3月12日',
  '03-13': '3月13日', '03-14': '3月14日', '03-15': '3月15日',
  '03-17': '3月17日',
  '04-03': '4月3日',  '04-04': '4月4日',  '04-05': '4月5日',
  '04-06': '4月6日',  '04-07': '4月7日',  '04-08': '4月8日',
  '04-10': '4月10日', '04-11': '4月11日', '04-16': '4月16日',
  '04-19': '4月19日',
}

function labelFor(isoDate: string): string {
  return DATE_LABELS[isoDate.slice(5)] ?? isoDate
}

// ── Component ──────────────────────────────────────────────────────────────

export default function App() {
  const [events, setEvents]             = useState<TimelineEvent[]>([])
  const [refMap, setRefMap]             = useState<Map<number, string>>(new Map())
  const [now, setNow]                   = useState(new Date())
  const [activeId, setActiveId]         = useState<number | null>(null)
  const [selectedDate, setSelectedDate] = useState<string | null>(null)
  const [selectedCity, setSelectedCity] = useState<string | null>(null)
  const [jumpPending, setJumpPending]   = useState(false)
  const [popover, setPopover]           = useState<RefPopover | null>(null)
  const [stickyHeight, setStickyHeight] = useState(0)
  const [copiedId, setCopiedId]         = useState<string | null>(null)
  const [expandedCtx, setExpandedCtx]   = useState<Set<string>>(new Set())
  const [aboutOpen, setAboutOpen]        = useState(false)
  const activeRef       = useRef<HTMLDivElement | null>(null)
  const todayRef        = useRef<HTMLDivElement | null>(null)
  const stickyBarRef    = useRef<HTMLDivElement | null>(null)
  const dateNavRef      = useRef<HTMLElement | null>(null)
  const popoverRef      = useRef<HTMLDivElement | null>(null)
  const hasScrolledHash = useRef(false)

  // Load timeline CSV
  useEffect(() => {
    fetch(`${import.meta.env.BASE_URL}timeline.csv`)
      .then(r => r.text())
      .then(t => setEvents(parseCSV(t) as unknown as TimelineEvent[]))
  }, [])

  // Load references CSV
  useEffect(() => {
    fetch(`${import.meta.env.BASE_URL}references.csv`)
      .then(r => r.text())
      .then(t => {
        const rows = parseCSV(t)
        const map = new Map<number, string>()
        for (const row of rows) {
          map.set(parseInt(row.ref_id, 10), row.text)
        }
        setRefMap(map)
      })
  }, [])

  // Tick every second for the live clock
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1_000)
    return () => clearInterval(id)
  }, [])

  // Track sticky-bar height for sticky day banners
  useEffect(() => {
    const el = stickyBarRef.current
    if (!el) return
    const observer = new ResizeObserver(entries => {
      setStickyHeight(entries[0].contentRect.height)
    })
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  // Close popover on click outside
  useEffect(() => {
    if (!popover) return
    function onPointerDown(e: PointerEvent) {
      if (popoverRef.current && !popoverRef.current.contains(e.target as Node)) {
        setPopover(null)
      }
    }
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') setPopover(null)
    }
    document.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [popover])

  // All comparisons use Taiwan time as reference
  const tw             = toTaiwanTime(now)
  const currentDate    = `1947-${tw.mmdd}`
  const currentMinutes = tw.minutes
  const isHistoricalPeriod = events.some(e => e.date === currentDate)

  // Compute filtered list early — used in effects below
  const allDates = [...new Set(events.map(e => e.date))].sort()

  // Cities ordered geographically: North → Central → South → East → Islands
  const CITY_ORDER = [
    '台北市','基隆市','淡水','宜蘭','桃園縣','新竹縣','新竹市','苗栗',
    '台中市','彰化','埔里','南投',
    '嘉義市','台南市','高雄市','屏東','旗山',
    '花蓮','台東',
    '澎湖',
  ]
  const allCities = CITY_ORDER.filter(c => events.some(e => e.city === c))

  const filteredEvents = events
    .map((e, i) => ({ ...e, idx: i }))
    .filter(e => selectedDate === null || e.date === selectedDate)
    .filter(e => selectedCity === null || e.city === selectedCity)

  // Find the event on today's historical date whose time is closest to now
  useEffect(() => {
    if (!isHistoricalPeriod || events.length === 0) return
    const candidates = events
      .map((e, i) => ({ ...e, idx: i }))
      .filter(e => e.date === currentDate && e.time_local)
    if (candidates.length === 0) return
    const closest = candidates.reduce((best, e) =>
      Math.abs(toMinutes(e.time_local) - currentMinutes) <
      Math.abs(toMinutes(best.time_local) - currentMinutes) ? e : best
    )
    setActiveId(closest.idx)
  }, [events, currentDate, currentMinutes, isHistoricalPeriod])

  // Auto-scroll on initial active event detection
  useEffect(() => {
    activeRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' })
  }, [activeId])

  // Jump-to-current: fires after filter cleared + DOM re-rendered
  useEffect(() => {
    if (!jumpPending) return
    activeRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' })
    setJumpPending(false)
  }, [jumpPending, filteredEvents])

  // Update URL hash as user scrolls through events
  useEffect(() => {
    if (events.length === 0) return
    let raf: number | null = null
    function onScroll() {
      if (raf !== null) return
      raf = requestAnimationFrame(() => {
        raf = null
        const line = stickyHeight + 20  // detection line just below sticky bar
        let current = ''
        for (const el of document.querySelectorAll<HTMLElement>('.event[id]')) {
          if (el.getBoundingClientRect().top <= line) {
            current = el.id   // keep updating — last one above the line wins
          } else {
            break             // events are in DOM order, safe to stop early
          }
        }
        if (current && window.location.hash !== '#' + current) {
          history.replaceState(null, '', '#' + current)
        }
      })
    }
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => {
      window.removeEventListener('scroll', onScroll)
      if (raf !== null) cancelAnimationFrame(raf)
    }
  }, [events, stickyHeight])

  // On mobile, scroll date nav so today's / active button is visible
  useEffect(() => {
    if (!isHistoricalPeriod || !dateNavRef.current) return
    const nav = dateNavRef.current
    const active = nav.querySelector<HTMLElement>('button.today, button.active')
    if (active) {
      const navLeft  = nav.getBoundingClientRect().left
      const btnLeft  = active.getBoundingClientRect().left
      nav.scrollLeft += btnLeft - navLeft - nav.clientWidth / 2 + active.clientWidth / 2
    }
  }, [isHistoricalPeriod])

  // Initial hash routing: scroll to event referenced in URL on first load
  useEffect(() => {
    if (hasScrolledHash.current || events.length === 0) return
    const hash = window.location.hash.slice(1)
    if (!hash) return
    hasScrolledHash.current = true
    setSelectedDate(null)
    setTimeout(() => {
      document.getElementById(hash)?.scrollIntoView({ behavior: 'smooth', block: 'center' })
    }, 50)
  }, [events])

  function toggleCtx(eventId: string) {
    setExpandedCtx(prev => {
      const next = new Set(prev)
      next.has(eventId) ? next.delete(eventId) : next.add(eventId)
      return next
    })
  }

  function copyLink(eventId: string) {
    const url = `${location.origin}${location.pathname}#${eventId}`
    navigator.clipboard.writeText(url).then(() => {
      setCopiedId(eventId)
      setTimeout(() => setCopiedId(null), 1500)
    })
  }

  function jumpToCurrent() {
    setSelectedDate(null)
    setSelectedCity(null)    // ensure active event is in the rendered list
    if (activeId !== null) {
      setJumpPending(true)
    } else {
      // No timed event yet — scroll to today's day banner
      setTimeout(() => {
        todayRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
      }, 0)
    }
  }

  const handleRef = useCallback((id: number, text: string, rect: DOMRect) => {
    setPopover(prev => prev?.id === id ? null : { id, text, rect })
  }, [])

  const readerTZ = Intl.DateTimeFormat().resolvedOptions().timeZone
  const canJump  = isHistoricalPeriod

  // Popover position: below the ref button if room, otherwise above
  let popoverStyle: React.CSSProperties = {}
  if (popover) {
    const POPOVER_W  = 340
    const POPOVER_MH = 220
    const vw = window.innerWidth
    const vh = window.innerHeight
    const left = Math.max(12, Math.min(popover.rect.left, vw - POPOVER_W - 12))
    const spaceBelow = vh - popover.rect.bottom - 12
    const top = spaceBelow >= POPOVER_MH / 2
      ? popover.rect.bottom + 6
      : Math.max(12, popover.rect.top - POPOVER_MH - 6)
    popoverStyle = { top, left, width: POPOVER_W, maxHeight: POPOVER_MH }
  }

  return (
    <div className="app">

      {/* ── Sticky bar: header + date nav ── */}
      <div className="sticky-bar" ref={stickyBarRef}>
        <header>
          <div className="header-links">
            <button className="header-link" onClick={() => setAboutOpen(true)}>關於</button>
            <span className="footer-sep">·</span>
            <a
              className="header-link"
              href="https://github.com/mlouielu/228-massacre-timeline"
              target="_blank"
              rel="noopener noreferrer"
            >GitHub</a>
          </div>
          <h1>二二八大屠殺事件時間軸</h1>
          <p className="subtitle">1947年2月27日—4月19日・台灣</p>

          {isHistoricalPeriod ? (
            <div className="live-banner">
              <span className="live-text">
                <span className="live-title">歷史上的今天</span>
                <span className="live-date">1947年{labelFor(currentDate)}</span>
              </span>
              <div className="clock-row">
                <span className="clock-item">
                  <span className="clock-label">台灣時間</span>
                  <span className="clock-value tw">{formatTaiwanClock(now)}</span>
                </span>
                <span className="clock-sep">/</span>
                <span className="clock-item">
                  <span className="clock-label">{readerTZ}</span>
                  <span className="clock-value">{formatReaderTime(now)}</span>
                </span>
              </div>
            </div>
          ) : (
            <div className="clock-row-static">
              <span className="clock-item">
                <span className="clock-label">台灣時間</span>
                <span className="clock-value tw">{formatTaiwanClock(now)}</span>
              </span>
              <span className="clock-sep">/</span>
              <span className="clock-item">
                <span className="clock-label">{readerTZ}</span>
                <span className="clock-value">{formatReaderTime(now)}</span>
              </span>
            </div>
          )}
        </header>

        <nav className="date-nav" ref={dateNavRef}>
          <button
            className={selectedDate === null ? 'active' : ''}
            onClick={() => setSelectedDate(null)}
          >全部</button>
          {allDates.map(d => (
            <button
              key={d}
              className={[
                selectedDate === d ? 'active' : '',
                d === currentDate && isHistoricalPeriod ? 'today' : '',
              ].filter(Boolean).join(' ')}
              onClick={() => setSelectedDate(prev => prev === d ? null : d)}
            >
              {labelFor(d)}
            </button>
          ))}
        </nav>

        <nav className="city-nav">
          <span className="city-nav-label">地區</span>
          <button
            className={selectedCity === null ? 'active' : ''}
            onClick={() => setSelectedCity(null)}
          >全部</button>
          {allCities.map(c => (
            <button
              key={c}
              className={selectedCity === c ? 'active' : ''}
              onClick={() => setSelectedCity(prev => prev === c ? null : c)}
            >
              {c}
            </button>
          ))}
        </nav>
      </div>

      {/* ── Timeline ── */}
      <main className="timeline">
        {(() => {
          const nodes: ReactNode[] = []
          let lastDate = ''
          for (const { idx, ...event } of filteredEvents) {
            // Day banner on date change
            if (event.date !== lastDate) {
              const isDayPast  = isHistoricalPeriod && event.date < currentDate
              const isDayToday = isHistoricalPeriod && event.date === currentDate
              nodes.push(
                <div
                  key={`banner-${event.date}`}
                  className={['day-banner', isDayPast ? 'past' : '', isDayToday ? 'today' : ''].filter(Boolean).join(' ')}
                  style={{ top: stickyHeight }}
                  ref={isDayToday ? todayRef : null}
                >
                  <span className="day-banner-label">1947年{labelFor(event.date)}</span>
                </div>
              )
              lastDate = event.date
            }

            const isActive = idx === activeId
            const isPast = isHistoricalPeriod && (
              event.date < currentDate ||
              (event.date === currentDate &&
               event.time_known === 'true' &&
               toMinutes(event.time_local) <= currentMinutes)
            )
            const locationParts = [event.city, event.place].filter(Boolean)
            nodes.push(
              <div
                key={idx}
                id={event.event_id}
                className={['event', isActive ? 'active' : '', isPast ? 'past' : ''].filter(Boolean).join(' ')}
                ref={isActive ? activeRef : null}
              >
                <div className="event-meta">
                  {event.time_precision === 'exact' && (
                    <span className="event-time">{formatTimeChinese(event.time_local)}</span>
                  )}
                  {event.time_precision === 'fuzzy' && (
                    <span className="event-time fuzzy">{event.time_label}</span>
                  )}
                  {locationParts.length > 0 && (
                    <span className="event-location">{locationParts.join('・')}</span>
                  )}
                  {event.region && (
                    <span className="event-region">{event.region}</span>
                  )}
                  <button
                    className={['event-anchor', copiedId === event.event_id ? 'copied' : ''].filter(Boolean).join(' ')}
                    onClick={() => copyLink(event.event_id)}
                    title="複製連結"
                  >
                    {copiedId === event.event_id ? '✓ 已複製' : `# ${event.event_id}`}
                  </button>
                </div>
                <p className="event-text">
                  {renderWithRefs(event.event_zh, refMap, handleRef)}
                </p>
                {event.context_zh && (
                  <div className="event-context">
                    <button
                      className={['ctx-toggle', expandedCtx.has(event.event_id) ? 'open' : ''].filter(Boolean).join(' ')}
                      onClick={() => toggleCtx(event.event_id)}
                    >
                      原文<span className="ctx-arrow">{expandedCtx.has(event.event_id) ? '▲' : '▼'}</span>
                    </button>
                    {expandedCtx.has(event.event_id) && (
                      <blockquote className="ctx-text">{event.context_zh}</blockquote>
                    )}
                  </div>
                )}
              </div>
            )
          }
          return nodes
        })()}
      </main>

      {/* ── Reference popover ── */}
      {popover && (
        <div className="ref-popover" style={popoverStyle} ref={popoverRef}>
          <div className="ref-popover-header">
            <span className="ref-popover-id">[{popover.id}]</span>
            <button className="ref-popover-close" onClick={() => setPopover(null)}>×</button>
          </div>
          <p className="ref-popover-text">{popover.text}</p>
        </div>
      )}

      {/* ── About modal ── */}
      {aboutOpen && (
        <div className="modal-backdrop" onClick={() => setAboutOpen(false)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <span className="modal-title">關於本站</span>
              <button className="modal-close" onClick={() => setAboutOpen(false)}>×</button>
            </div>
            <div className="modal-body">
              <p>本站為非商業、教育性質之歷史資料整理，時間軸內容依據以下來源整理：</p>
              <ul>
                <li>
                  <a href="https://www.228.org.tw/incident-research1" target="_blank" rel="noopener noreferrer">
                    「二二八事件」研究報告
                  </a>
                  <span className="modal-meta">財團法人二二八事件紀念基金會</span>
                </li>
                <li>
                  <a href="https://www.kobo.com/tw/zh/ebook/GcO8yoYwjzSAmClmFn8INA" target="_blank" rel="noopener noreferrer">
                    電子書版本（Kobo）
                  </a>
                  <span className="modal-meta">ISBN 978-626-995-170-3</span>
                </li>
              </ul>
              <p className="modal-notice">
                本站依著作權法第65條（合理使用）原則引用原著作片段，原著作之著作權仍歸屬於財團法人二二八事件紀念基金會及原著作者。
              </p>
              <p>
                原始碼：
                <a href="https://github.com/mlouielu/228-massacre-timeline" target="_blank" rel="noopener noreferrer">
                  github.com/mlouielu/228-massacre-timeline
                </a>
              </p>
            </div>
          </div>
        </div>
      )}

      {/* ── Jump-to-current FAB ── */}
      {canJump && (
        <button className="jump-btn" onClick={jumpToCurrent} title="跳至當前事件">
          <span className="jump-arrow">↓</span>
          <span className="jump-label">現在</span>
        </button>
      )}
    </div>
  )
}
