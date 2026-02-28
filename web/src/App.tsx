import { useEffect, useState, useRef, useCallback, Fragment, type ReactNode } from 'react'
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
  source:          string   // source id, e.g. 'ey-1992', 'mmf2025'
}

interface RefPopover {
  id:   number
  text: string
  rect: DOMRect
}

// ── Keyword highlighter ────────────────────────────────────────────────────

function highlightKeyword(nodes: ReactNode[], keyword: string, className: string): ReactNode[] {
  return nodes.flatMap((node, i) => {
    if (typeof node !== 'string') return [node]
    const parts = node.split(keyword)
    return parts.flatMap((part, j) => {
      const result: ReactNode[] = [part]
      if (j < parts.length - 1)
        result.push(<span key={`kw-${i}-${j}`} className={className}>{keyword}</span>)
      return result
    })
  })
}

// ── CSV parser ─────────────────────────────────────────────────────────────

function parseCSV(text: string): Record<string, string>[] {
  // RFC 4180-compliant parser: handles quoted fields containing commas and newlines
  const rows: string[][] = []
  let fields: string[] = []
  let cur = ''
  let inQuote = false
  // Normalise line endings
  const s = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').trim()
  for (let i = 0; i < s.length; i++) {
    const ch = s[i]
    if (inQuote) {
      if (ch === '"') {
        if (s[i + 1] === '"') { cur += '"'; i++ }   // escaped quote
        else { inQuote = false }
      } else {
        cur += ch
      }
    } else {
      if (ch === '"') {
        inQuote = true
      } else if (ch === ',') {
        fields.push(cur); cur = ''
      } else if (ch === '\n') {
        fields.push(cur); cur = ''
        rows.push(fields); fields = []
      } else {
        cur += ch
      }
    }
  }
  fields.push(cur)
  rows.push(fields)

  const headers = rows[0].map(h => h.trim())
  return rows.slice(1).map(row => {
    const obj: Record<string, string> = {}
    headers.forEach((h, i) => { obj[h] = (row[i] ?? '').trim() })
    return obj
  })
}

// ── Refs renderer ─────────────────────────────────────────────────────────

function renderWithRefs(
  text: string,
  source: string,
  refMap: Map<string, string>,
  onRef: (id: number, text: string, rect: DOMRect) => void,
): ReactNode[] {
  return text.split(/(\[\d+\])/).map((part, i) => {
    const m = part.match(/^\[(\d+)\]$/)
    if (!m) return part
    const id = parseInt(m[1], 10)
    const refText = refMap.get(`${source}:${id}`)
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

// ── Report sources ─────────────────────────────────────────────────────────

interface SourceMeta {
  label:       string
  title:       string
  author:      string
  publisher:   string
  description: string
  links:       { label: string; url: string }[]
}

const SOURCES: Record<string, SourceMeta> = {
  'ey-1992': {
    label:       '行政院1992報告',
    title:       '「二二八事件」研究報告',
    author:      '行政院研究二二八事件小組',
    publisher:   '財團法人二二八事件紀念基金會',
    description: '1991年行政院成立二二八研究小組，重新撰寫二二八事件調查報告，於1992年2月公開內容。此報告已修改過去「暴動」、「暴民」之說，對事件發生的經過敘述詳細，但囿於當時政治環境，未能觸及二二八責任歸屬的問題。',
    links: [
      { label: '行政院《「二二八事件」研究報告》摘要 - 財團法人二二八事件紀念基金會', url: 'https://www.228.org.tw/incident-research1' },
      { label: '行政院「二二八事件」研究報告 - 電子書（Kobo）ISBN 978-626-995-170-3',  url: 'https://www.kobo.com/tw/zh/ebook/GcO8yoYwjzSAmClmFn8INA' },
    ],
  },
  'mmf2025': {
    label:       '基金會2005報告',
    title:       '二二八事件責任歸屬研究報告',
    author:      '財團法人二二八事件紀念基金會',
    publisher:   '財團法人二二八事件紀念基金會',
    description: '財團法人二二八事件紀念基金會於2025年重新出版之二二八責任歸屬研究報告版本。',
    links: [
        { label: '財團法人二二八事件紀念基金會', url: 'https://www.228.org.tw/' },
      { label: '二二八事件責任歸屬研究報告 - 電子書（Kobo）ISBN 978-626-995-170-3',  url: 'https://www.kobo.com/tw/zh/ebook/ig97vlbaaz65yvbafnjhfa' },
    ],
  },
}

// ── Date labels ────────────────────────────────────────────────────────────

// isoDate = 'YYYY-MM-DD'
// showYear=false → omit year for 1947 dates (compact nav buttons)
// showYear=true  → always include year (day banners, live clock, swimlane)
function labelFor(isoDate: string, showYear = false): string {
  const [y, m, d] = isoDate.split('-').map(Number)
  const md = `${m}月${d}日`
  return (showYear || y !== 1947) ? `${y}年${md}` : md
}

// ── Martial law periods ────────────────────────────────────────────────────

const MARTIAL_LAW_PERIODS = [
  { start: '1947-02-28', end: '1947-03-01', index: 1, label: '台北市臨時戒嚴令' },
  { start: '1947-03-09', end: '1947-05-16', index: 2, label: '全省戒嚴令' },
]

function getMartialLawPeriod(isoDate: string) {
  return MARTIAL_LAW_PERIODS.find(p => isoDate >= p.start && isoDate <= p.end) ?? null
}

// ── City → Region normalisation ────────────────────────────────────────────

const CITY_NORMALIZE: Record<string, string> = {
  // 台北
  '台北市': '台北', '臺北市': '台北', '新北市': '台北',
  '台北縣': '台北', '台北縣板橋鎮': '台北', '台北縣士林鎮': '台北',
  '台北縣北投鎮': '台北', '台北縣新莊鎮': '台北', '台北縣新店鎮': '台北',
  '台北縣淡水鎮': '台北', '台北縣瑞芳鎮': '台北', '台北縣汐止鎮': '台北',
  '台北縣鶯歌鎮': '台北', '台北縣三峽鎮': '台北', '台北縣三重市': '台北',
  // 基隆
  '基隆市': '基隆',
  // 宜蘭
  '宜蘭市': '宜蘭', '宜蘭縣': '宜蘭', '羅東鎮': '宜蘭', '蘇澳鎮': '宜蘭',
  // 桃園
  '桃園縣': '桃園',
  // 新竹
  '新竹市': '新竹', '新竹縣': '新竹',
  // 苗栗
  '苗栗縣': '苗栗',
  // 台中
  '台中市': '台中', '中部地區': '台中',
  '台中縣豐原區': '台中', '台中縣清水區': '台中', '台中縣大甲區': '台中',
  '台中縣梧棲鎮': '台中', '台中縣沙鹿鎮': '台中', '台中縣東勢區': '台中',
  '台中縣大肚鄉': '台中',
  // 彰化
  '彰化市': '彰化', '員林鎮': '彰化', '溪湖鎮': '彰化', '北斗區': '彰化',
  // 南投
  '南投縣草屯鎮': '南投', '南投縣竹山鎮': '南投', '南投縣埔里鎮': '南投',
  '南投縣南投鎮': '南投', '南投縣集集鎮': '南投', '南投縣水里鄉': '南投',
  // 雲林
  '雲林縣': '雲林', '雲林縣虎尾鎮': '雲林', '雲林縣林內鄉': '雲林',
  // 嘉義
  '嘉義市': '嘉義', '嘉義縣': '嘉義',
  // 台南
  '台南市': '台南', '台南縣': '台南',
  // 高雄
  '高雄市': '高雄', '高雄縣': '高雄',
  // 屏東
  '屏東市': '屏東', '屏東縣': '屏東', '屏東縣林邊鄉': '屏東',
  '屏東縣南州鄉': '屏東', '屏東縣東港': '屏東', '旗山': '屏東',
  // 花蓮
  '花蓮市': '花蓮', '花蓮縣': '花蓮',
  // 台東
  '台東縣': '台東',
  // 澎湖
  '澎湖縣': '澎湖',
}

const REGION_ORDER = [
  '台北', '基隆', '宜蘭', '桃園', '新竹', '苗栗',
  '台中', '彰化', '南投', '雲林', '嘉義',
  '台南', '高雄', '屏東',
  '花蓮', '台東', '澎湖',
]

// ── Swimlane view ──────────────────────────────────────────────────────────

interface SwimlaneProps {
  events:       (TimelineEvent & { idx: number })[]
  stickyHeight: number
  onEventClick: (e: TimelineEvent & { idx: number }) => void
  currentDate:  string
  currentHour:  number
}

function SwimlaneView({ events, stickyHeight, onEventClick, currentDate, currentHour }: SwimlaneProps) {
  const normalized = events
    .map(e => ({ ...e, region_col: CITY_NORMALIZE[e.city] ?? null }))
    .filter(e => e.region_col !== null)

  const activeRegions = REGION_ORDER.filter(r =>
    normalized.some(e => e.region_col === r)
  )

  const allDates = [...new Set(normalized.map(e => e.date))].sort()

  // Group: date → hour (0–23 | 'none') → region → events[]
  type HourKey = number | 'none'
  const byDate = new Map<string, Map<HourKey, Map<string, typeof normalized>>>()

  for (const e of normalized) {
    if (!byDate.has(e.date)) byDate.set(e.date, new Map())
    const hourMap = byDate.get(e.date)!
    const hour: HourKey = e.time_local ? Math.floor(toMinutes(e.time_local) / 60) : 'none'
    if (!hourMap.has(hour)) hourMap.set(hour, new Map())
    const regionMap = hourMap.get(hour)!
    if (!regionMap.has(e.region_col!)) regionMap.set(e.region_col!, [])
    regionMap.get(e.region_col!)!.push(e)
  }

  const cols = activeRegions.length

  return (
    // Wrapper is the scroll container (both axes); top:0 sticky = right below sticky-bar
    <div className="sl-wrapper" style={{ height: `calc(100vh - ${stickyHeight}px)` }}>
      <div
        className="sl-grid"
        style={{ gridTemplateColumns: `44px repeat(${cols}, 60px)` }}
      >
        {/* Sticky region header — top:0 within the scroll container */}
        <div className="sl-head sl-head-corner" />
        {activeRegions.map(r => (
          <div key={r} className="sl-head sl-head-region">{r}</div>
        ))}

        {allDates.map(date => {
          const hourMap = byDate.get(date)!
          const hours = ([...hourMap.keys()] as HourKey[]).sort((a, b) => {
            if (a === 'none') return -1
            if (b === 'none') return 1
            return (a as number) - (b as number)
          })
          const isCurrentDate = date === currentDate

          return (
            <Fragment key={date}>
              <div
                className={['sl-date-sep', isCurrentDate ? 'current' : ''].filter(Boolean).join(' ')}
                style={{ gridColumn: `1 / span ${cols + 1}` }}
              >
                {labelFor(date, true)}
              </div>

              {hours.map(hour => {
                const regionMap = hourMap.get(hour)!
                const label = hour === 'none' ? '—' : `${String(hour).padStart(2, '0')}時`
                const isCurrentRow = isCurrentDate && hour === currentHour
                return (
                  <Fragment key={String(hour)}>
                    <div
                      id={`sl-row-${date}-${hour}`}
                      className={['sl-hour-label', isCurrentRow ? 'current' : ''].filter(Boolean).join(' ')}
                    >
                      {label}
                    </div>
                    {activeRegions.map(region => {
                      const cellEvents = (regionMap.get(region) ?? [])
                        .slice()
                        .sort((a, b) => toMinutes(a.time_local) - toMinutes(b.time_local))
                      return (
                        <div
                          key={region}
                          className={[
                            'sl-cell',
                            cellEvents.length ? 'has-events' : '',
                            isCurrentRow ? 'current' : '',
                          ].filter(Boolean).join(' ')}
                        >
                          {cellEvents.map(e => (
                            <p
                              key={e.idx}
                              className={['sl-line', `sl-line--${e.source}`, e.event_zh.includes('宣布戒嚴') ? 'martial-law' : '', e.event_zh.includes('到達現場') ? 'origin' : '', e.event_zh.includes('福州載運二千士兵') ? 'massacre' : ''].filter(Boolean).join(' ')}
                              onClick={() => onEventClick(e)}
                            >
                              {e.event_zh}
                            </p>
                          ))}
                        </div>
                      )
                    })}
                  </Fragment>
                )
              })}
            </Fragment>
          )
        })}
      </div>
    </div>
  )
}

// ── Component ──────────────────────────────────────────────────────────────

export default function App() {
  const [events, setEvents]             = useState<TimelineEvent[]>([])
  const [refMap, setRefMap]             = useState<Map<string, string>>(new Map())
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
  const [sourceOpen, setSourceOpen]      = useState<{ eventId: string; source: string } | null>(null)
  const [anchorId, setAnchorId]          = useState<string | null>(null)
  const [viewMode, setViewMode]          = useState<'timeline' | 'swimlane'>('timeline')
  const [slDetail, setSlDetail]          = useState<(TimelineEvent & { idx: number }) | null>(null)
  const activeRef       = useRef<HTMLDivElement | null>(null)
  const todayRef        = useRef<HTMLDivElement | null>(null)
  const stickyBarRef    = useRef<HTMLDivElement | null>(null)
  const dateNavRef      = useRef<HTMLElement | null>(null)
  const popoverRef      = useRef<HTMLDivElement | null>(null)
  const hasScrolledHash = useRef(false)
  const hashLockRef     = useRef(false)

  // Load timeline CSVs (all known sources; missing files are silently skipped)
  useEffect(() => {
    // Short prefix per source to namespace event IDs (e.g. EY-E0001, MF-E0001)
    const SOURCE_PREFIX: Record<string, string> = {
      'ey-1992': 'EY',
      'mmf2025': 'MF',
    }
    const load = (sourceId: string) => {
      const prefix = SOURCE_PREFIX[sourceId] ?? sourceId.toUpperCase()
      return fetch(`${import.meta.env.BASE_URL}sources/${sourceId}/timeline.csv`)
        .then(r => r.ok ? r.text() : null)
        .then(t => t
          ? (parseCSV(t) as unknown as TimelineEvent[]).map(e => ({
              ...e,
              source:   sourceId,
              event_id: `${prefix}-${e.event_id}`,
            }))
          : [])
        .catch(() => [] as TimelineEvent[])
    }

    Promise.all([load('ey-1992'), load('mmf2025')]).then(([a, b]) => {
      const merged = [...a, ...b]
      const precRank = (e: TimelineEvent) => e.time_precision === 'exact' ? 0 : 1
      merged.sort((x, y) => {
        const dateCmp = x.date.localeCompare(y.date)
        if (dateCmp !== 0) return dateCmp
        const timeCmp = (x.time_local || '12:00').localeCompare(y.time_local || '12:00')
        if (timeCmp !== 0) return timeCmp
        return precRank(x) - precRank(y)
      })
      setEvents(merged)
    })
  }, [])

  // Load references CSVs (namespaced by source to avoid ID collisions)
  useEffect(() => {
    const load = (sourceId: string) =>
      fetch(`${import.meta.env.BASE_URL}sources/${sourceId}/references.csv`)
        .then(r => r.ok ? r.text() : null)
        .then(t => {
          if (!t) return []
          return parseCSV(t).map(row => [`${sourceId}:${row.ref_id}`, row.text] as [string, string])
        })
        .catch(() => [] as [string, string][])

    Promise.all([load('ey-1992'), load('mmf2025')]).then(([a, b]) => {
      setRefMap(new Map([...a, ...b]))
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

  // Date range boundaries
  const DATE_CORE_START = '1947-02-17'
  const DATE_CORE_END   = '1947-05-16'

  // Compute filtered list early — used in effects below
  const allDates = [...new Set(events.map(e => e.date))].sort()
  const coreDates   = allDates.filter(d => d >= DATE_CORE_START && d <= DATE_CORE_END)
  const hasBefore   = allDates.some(d => d < DATE_CORE_START)
  const hasAfter    = allDates.some(d => d > DATE_CORE_END)

  // Normalise 臺→台 so both variants match the same city
  const normCity = (s: string) => s.replace(/臺/g, '台')

  // Cities ordered geographically: North → Central → South → East → Islands
  const CITY_ORDER = [
    '台北市','基隆市','淡水','宜蘭','桃園縣','新竹縣','新竹市','苗栗',
    '台中市','彰化','埔里','南投',
    '嘉義市','台南市','高雄市','屏東','旗山',
    '花蓮','台東',
    '澎湖',
  ]
  const allCities = CITY_ORDER.filter(c => events.some(e => normCity(e.city) === c))

  const dateFilter = (date: string) => {
    if (selectedDate === null)        return true
    if (selectedDate === '__before__') return date < DATE_CORE_START
    if (selectedDate === '__after__')  return date > DATE_CORE_END
    return date === selectedDate
  }

  const filteredEvents = events
    .map((e, i) => ({ ...e, idx: i }))
    .filter(e => dateFilter(e.date))
    .filter(e => selectedCity === null || normCity(e.city) === selectedCity)

  // Swimlane ignores city filter — showing all regions is the point
  const swimlaneEvents = events
    .map((e, i) => ({ ...e, idx: i }))
    .filter(e => dateFilter(e.date))

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
    if (activeId !== null) {
      const eventId = events[activeId]?.event_id
      if (eventId) {
        hashLockRef.current = true
        history.replaceState(null, '', '#' + eventId)
        setAnchorId(eventId)
        setTimeout(() => { hashLockRef.current = false }, 1200)
      }
    }
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
        const center = stickyHeight + (window.innerHeight - stickyHeight) / 2
        let current = ''
        let bestDist = Infinity
        for (const el of document.querySelectorAll<HTMLElement>('.event[id]')) {
          const rect = el.getBoundingClientRect()
          const mid = rect.top + rect.height / 2
          const dist = Math.abs(mid - center)
          if (dist < bestDist) { bestDist = dist; current = el.id }
        }
        if (current && !hashLockRef.current) {
          if (window.location.hash !== '#' + current)
            history.replaceState(null, '', '#' + current)
          setAnchorId(current)
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
    let hash = window.location.hash.slice(1)
    if (!hash) return
    // Backwards-compat: bare #Exxxx → #EY-Exxxx
    if (/^E\d+$/.test(hash)) hash = `EY-${hash}`
    hasScrolledHash.current = true
    setSelectedDate(null)
    setAnchorId(hash)
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
    if (viewMode === 'swimlane') {
      const hour = Math.floor(currentMinutes / 60)
      document.getElementById(`sl-row-${currentDate}-${hour}`)
        ?.scrollIntoView({ behavior: 'smooth', block: 'center' })
      return
    }
    setSelectedDate(null)
    setSelectedCity(null)    // ensure active event is in the rendered list

    // Scroll the "today" date button into the centre of the date nav
    setTimeout(() => {
      const nav = dateNavRef.current
      const todayBtn = nav?.querySelector<HTMLElement>('button.today')
      if (nav && todayBtn) {
        const navCenter = nav.offsetWidth / 2
        const btnCenter = todayBtn.offsetLeft + todayBtn.offsetWidth / 2
        nav.scrollTo({ left: btnCenter - navCenter, behavior: 'smooth' })
      }
    }, 0)

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

  const anchorDate = anchorId ? events.find(e => e.event_id === anchorId)?.date : null
  const martialLawPeriod = anchorDate ? getMartialLawPeriod(anchorDate) : null
  const martialLawActive = martialLawPeriod !== null

  return (
    <div className={[viewMode === 'swimlane' ? 'app app--swimlane' : 'app', martialLawActive ? 'martial-law-active' : ''].filter(Boolean).join(' ')}>

      {martialLawActive && <div className="martial-law-bar" aria-label="戒嚴期間" />}

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
          <p className="subtitle">1947年2月27日—5月16日・台灣</p>

          <div className="header-banner-group">
            {isHistoricalPeriod ? (
              <div className="live-banner">
                <span className="live-text">
                  <span className="live-title">歷史上的今天</span>
                  <span className="live-date">{labelFor(currentDate, true)}</span>
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
            {martialLawPeriod && (
              <div className="martial-law-badge">
                <span className="martial-law-badge-title">⚠ 第{martialLawPeriod.index === 1 ? '一' : '二'}次戒嚴中</span>
                <span className="martial-law-badge-meta">{martialLawPeriod.label}・{labelFor(martialLawPeriod.start, true)} — {labelFor(martialLawPeriod.end, true)}</span>
              </div>
            )}
          </div>
        </header>

        <nav className="date-nav" ref={dateNavRef}>
          <button
            className={selectedDate === null ? 'active' : ''}
            onClick={() => setSelectedDate(null)}
          >全部</button>
          {hasBefore && (
            <button
              className={selectedDate === '__before__' ? 'active' : ''}
              onClick={() => setSelectedDate(prev => prev === '__before__' ? null : '__before__')}
            >事件前</button>
          )}
          {coreDates.map(d => (
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
          {hasAfter && (
            <button
              className={selectedDate === '__after__' ? 'active' : ''}
              onClick={() => setSelectedDate(prev => prev === '__after__' ? null : '__after__')}
            >事件後</button>
          )}
        </nav>

        <div className="city-row">
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

          <div className="view-toggle">
            <button
              className={viewMode === 'timeline' ? 'active' : ''}
              onClick={() => setViewMode('timeline')}
            >時間軸</button>
            <button
              className={viewMode === 'swimlane' ? 'active' : ''}
              onClick={() => setViewMode('swimlane')}
            >並行</button>
          </div>
        </div>
      </div>

      {/* ── Timeline / Swimlane ── */}
      {viewMode === 'swimlane'
        ? <SwimlaneView
            events={swimlaneEvents}
            stickyHeight={stickyHeight}
            onEventClick={setSlDetail}
            currentDate={currentDate}
            currentHour={Math.floor(currentMinutes / 60)}
          />
        : null}
      <main className="timeline" style={{ display: viewMode === 'timeline' ? undefined : 'none' }}>
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
                  <span className="day-banner-label">{labelFor(event.date, true)}</span>
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
            const isMartialLaw   = event.event_zh.includes('宣布戒嚴')
            const isOrigin       = event.event_zh.includes('到達現場')
            const isMassacre     = event.event_zh.includes('福州載運二千士兵')
            const locationParts = [event.city, event.place].filter(Boolean)
            nodes.push(
              <div
                key={idx}
                id={event.event_id}
                className={['event', isActive ? 'active' : '', anchorId === event.event_id ? 'anchored' : '', isPast ? 'past' : '', isMartialLaw ? 'martial-law' : '', isOrigin ? 'origin' : '', isMassacre ? 'massacre' : ''].filter(Boolean).join(' ')}
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
                    className={`source-badge source-badge--${event.source}`}
                    onClick={e => { e.stopPropagation(); setSourceOpen({ eventId: event.event_id, source: event.source }) }}
                    title={SOURCES[event.source]?.title ?? event.source}
                  >{SOURCES[event.source]?.label ?? event.source}</button>
                  <button
                    className={['event-anchor', copiedId === event.event_id ? 'copied' : ''].filter(Boolean).join(' ')}
                    onClick={() => copyLink(event.event_id)}
                    title="複製連結"
                  >
                    {copiedId === event.event_id ? '✓ 已複製' : `# ${event.event_id}`}
                  </button>
                </div>
                <p className="event-text">
                  {isMartialLaw
                    ? highlightKeyword(renderWithRefs(event.event_zh, event.source, refMap, handleRef), '宣布戒嚴', 'keyword-box')
                    : renderWithRefs(event.event_zh, event.source, refMap, handleRef)}
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

      {/* ── Source modal ── */}
      {sourceOpen && (() => {
        const src = SOURCES[sourceOpen.source]
        return (
          <div className="modal-backdrop" onClick={() => setSourceOpen(null)}>
            <div className="modal" onClick={e => e.stopPropagation()}>
              <div className="modal-header">
                <span className="modal-title"><span className="source-modal-event-id">{sourceOpen.eventId}</span> 資料來源：{src.title}</span>
                <button className="modal-close" onClick={() => setSourceOpen(null)}>×</button>
              </div>
              <div className="modal-body">
                <p className="source-modal-meta"><span>著者</span>{src.author}</p>
                <p className="source-modal-meta"><span>出版</span>{src.publisher}</p>
                <p className="source-modal-desc">{src.description}</p>
                <ul className="source-modal-links">
                  {src.links.map(l => (
                    <li key={l.url}>
                      <a href={l.url} target="_blank" rel="noopener noreferrer">{l.label}</a>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          </div>
        )
      })()}

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

      {/* ── Swimlane event detail modal ── */}
      {slDetail && (
        <div className="modal-backdrop" onClick={() => setSlDetail(null)}>
          <div className="modal sl-detail-modal" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <span className="modal-title">
                {slDetail.event_id}
                {slDetail.city && <span className="sl-detail-loc">・{slDetail.city}{slDetail.place ? `・${slDetail.place}` : ''}</span>}
              </span>
              <button className="modal-close" onClick={() => setSlDetail(null)}>×</button>
            </div>
            <div className="modal-body">
              {slDetail.time_precision === 'exact' && (
                <p className="sl-detail-time">{labelFor(slDetail.date, true)} {formatTimeChinese(slDetail.time_local)}</p>
              )}
              {slDetail.time_precision === 'fuzzy' && slDetail.time_label && (
                <p className="sl-detail-time">{labelFor(slDetail.date, true)} {slDetail.time_label}</p>
              )}
              <p className="sl-detail-text">{slDetail.event_zh}</p>
              <div className="sl-detail-actions">
                <button
                  className="sl-detail-jump"
                  onClick={() => {
                    setSlDetail(null)
                    setViewMode('timeline')
                    setSelectedDate(null)
                    setSelectedCity(null)
                    setTimeout(() => {
                      document.getElementById(slDetail.event_id)
                        ?.scrollIntoView({ behavior: 'smooth', block: 'center' })
                    }, 50)
                  }}
                >
                  在時間軸中查看 →
                </button>
                <button
                  className={['sl-detail-anchor', copiedId === slDetail.event_id ? 'copied' : ''].filter(Boolean).join(' ')}
                  onClick={() => copyLink(slDetail.event_id)}
                >
                  {copiedId === slDetail.event_id ? '✓ 已複製' : `# ${slDetail.event_id}`}
                </button>
              </div>
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
