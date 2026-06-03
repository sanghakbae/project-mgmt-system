import { Fragment, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { ChevronRight } from 'lucide-react'

type Stage = {
  num: string
  title: string
  role: string
  cls: string
  enterLabel?: string
}

const stages: Stage[] = [
  { num: '①', title: '새 요청 등록', role: '요청자', cls: 'requester' },
  { num: '②', title: '기획 문서 작성 (SRS+SDS)', role: 'PM', cls: 'pm' },
  { num: '③', title: '부서 검토 · 승인', role: 'CEM·개발·정보보호\n인프라·QA·특허', cls: 'multi', enterLabel: '기획 완료' },
  { num: '④', title: '개발 (일정 조율·진행)', role: '기획(PM)·개발자', cls: 'dev', enterLabel: '역할 전원 확인' },
  { num: '⑤', title: '검토 (QC·보안·PM)', role: 'QA·보안·PM 3자', cls: 'qa', enterLabel: '일정 확정' },
  { num: '⑥', title: '완료 보고·게시', role: 'PM·관리자', cls: 'admin', enterLabel: '3자 검토 완료' },
]

// 분기: 어떤 단계(인덱스)에서 어떤 분기 노드로 가는지
const rejectFrom = [2, 4] // ③ 부서 검토, ⑤ 검토
const holdFrom = [1, 2, 3] // ② 기획, ③ 승인, ④ 개발

const legend = [
  { color: '#e7f0ff', border: '#2f6bd8', label: '요청자' },
  { color: '#eee9ff', border: '#6d4fd0', label: '기획 (PM)' },
  { color: '#f3e9fb', border: '#9b51c4', label: '다중 협의·승인' },
  { color: '#e2f6f1', border: '#149e7e', label: '개발' },
  { color: '#fff0e2', border: '#d98324', label: '검토 (QA·보안·PM)' },
  { color: '#eef1f5', border: '#5a6473', label: '완료 (PM·관리자)' },
]

type Line = { d: string; kind: 'reject' | 'hold'; lx: number; ly: number; label: string }

export function SystemFlowPanel() {
  const containerRef = useRef<HTMLDivElement>(null)
  const cardRefs = useRef<Array<HTMLDivElement | null>>([])
  const rejectRef = useRef<HTMLDivElement>(null)
  const holdRef = useRef<HTMLDivElement>(null)
  const [lines, setLines] = useState<Line[]>([])
  const [size, setSize] = useState({ w: 0, h: 0 })

  const measure = useCallback(() => {
    const container = containerRef.current
    if (!container) return
    const c = container.getBoundingClientRect()
    // SVG는 패딩 박스(테두리 안쪽) 기준이므로 테두리 두께만큼 보정
    const originX = c.left + container.clientLeft
    const originY = c.top + container.clientTop
    const rel = (el: HTMLElement | null) => {
      if (!el) return null
      const r = el.getBoundingClientRect()
      return { cx: r.left - originX + r.width / 2, top: r.top - originY, bottom: r.top - originY + r.height }
    }
    const next: Line[] = []
    const connect = (cardIdx: number, target: HTMLDivElement | null, kind: 'reject' | 'hold', showLabel: boolean) => {
      const s = rel(cardRefs.current[cardIdx])
      const t = rel(target)
      if (!s || !t) return
      const x1 = s.cx
      const y1 = s.bottom
      const x2 = t.cx
      const y2 = t.top
      const midY = y1 + (y2 - y1) * 0.5
      next.push({
        d: `M ${x1} ${y1} C ${x1} ${midY}, ${x2} ${midY}, ${x2} ${y2}`,
        kind,
        lx: x1,
        ly: y1 + 12,
        label: showLabel ? (kind === 'reject' ? '반려' : '보류') : '',
      })
    }
    rejectFrom.forEach((idx, i) => connect(idx, rejectRef.current, 'reject', i === 0))
    holdFrom.forEach((idx, i) => connect(idx, holdRef.current, 'hold', i === 0))
    setLines(next)
    setSize({ w: container.clientWidth, h: container.clientHeight })
  }, [])

  useLayoutEffect(() => {
    measure()
  }, [measure])

  useEffect(() => {
    const container = containerRef.current
    if (!container) return
    const ro = new ResizeObserver(() => measure())
    ro.observe(container)
    window.addEventListener('resize', measure)
    return () => {
      ro.disconnect()
      window.removeEventListener('resize', measure)
    }
  }, [measure])

  return (
    <section className="flowPanel">
      <div className="flowPanelHead">
        <div>
          <h2>프로젝트 흐름도</h2>
          <p>새 요청 등록부터 완료 보고까지 6단계 흐름입니다. <b>각 단계 색이 담당 역할</b>을 나타내며, 굵은 화살표가 정상 진행 경로, 아래 점선이 반려·보류 분기입니다.</p>
        </div>
      </div>

      <div className="flowLegend">
        {legend.map((item) => (
          <span key={item.label} className="flowLegendItem">
            <i style={{ background: item.color, borderColor: item.border }} />
            {item.label}
          </span>
        ))}
      </div>

      <div className="flowStage" ref={containerRef}>
        <svg className="flowLines" width={size.w} height={size.h} viewBox={`0 0 ${size.w} ${size.h}`} aria-hidden="true">
          {lines.map((line, i) => (
            <g key={i} className={`flowLine ${line.kind}`}>
              <path d={line.d} fill="none" />
              {line.label && (
                <text x={line.lx} y={line.ly} className="flowLineLabel">{line.label}</text>
              )}
            </g>
          ))}
        </svg>

        <div className="flowStrip">
          {stages.map((stage, index) => (
            <Fragment key={stage.num}>
              {index > 0 && (
                <div className="flowConnector" aria-hidden="true">
                  {stage.enterLabel && <span className="flowConnectorLabel">{stage.enterLabel}</span>}
                  <ChevronRight size={20} />
                </div>
              )}
              <div className={`flowStep ${stage.cls}`} ref={(el) => { cardRefs.current[index] = el }}>
                <span className="flowStepNum">{stage.num}</span>
                <strong className="flowStepTitle">{stage.title}</strong>
                <span className="flowStepRole">
                  {stage.role.split('\n').map((line, i) => (
                    <span key={i}>{line}</span>
                  ))}
                </span>
              </div>
            </Fragment>
          ))}
        </div>

        <div className="flowBranchLane">
          <div className="flowBranchNode hold" ref={holdRef}>
            <strong>보류</strong>
            <span>해제 시 같은 지점 재개</span>
          </div>
          <div className="flowBranchNode reject" ref={rejectRef}>
            <strong>반려</strong>
            <span>요청자 보완 후 재요청</span>
          </div>
        </div>
      </div>
    </section>
  )
}
