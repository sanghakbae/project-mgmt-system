import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { CheckCircle2, ChevronRight, CircleAlert, PauseCircle } from 'lucide-react'

type Stage = {
  num: string
  title: string
  owner: string
  work: string
  done: string
  cls: string
  enterLabel?: string
}

const stages: Stage[] = [
  { num: '1', title: '요청하기', owner: '요청자', work: '무엇이 필요한지 적어요.', done: '요청 내용이 저장되면 다음으로 갑니다.', cls: 'requester' },
  { num: '2', title: '계획 세우기', owner: 'PM', work: '요구사항(SRS)과 설계(SDS)를 정리해요.', done: '문서가 준비되면 승인 요청합니다.', cls: 'pm', enterLabel: '내용 정리' },
  { num: '3', title: '함께 승인하기', owner: '관련 부서', work: 'CEM·개발·정보보호·인프라·QA·특허가 확인해요.', done: '모두 승인하면 만들 수 있습니다.', cls: 'multi', enterLabel: '문서 준비' },
  { num: '4', title: '만들기', owner: 'PM·개발자', work: '일정을 잡고 개발 작업을 진행해요.', done: '개발이 끝나면 검토로 갑니다.', cls: 'dev', enterLabel: '승인 완료' },
  { num: '5', title: '검사하기', owner: 'QA·보안·PM', work: '품질, 보안, 인수 조건을 확인해요.', done: '문제가 없으면 완료 보고합니다.', cls: 'qa', enterLabel: '개발 완료' },
  { num: '6', title: '끝내고 알리기', owner: 'PM·관리자', work: '완료 보고서를 쓰고 게시해요.', done: '모두가 결과를 확인할 수 있습니다.', cls: 'admin', enterLabel: '검토 완료' },
]

// 분기: 어떤 단계(인덱스)에서 어떤 분기 노드로 가는지
const rejectFrom = [2, 4] // ③ 부서 검토, ⑤ 검토
const holdFrom = [1, 2, 3] // ② 기획, ③ 승인, ④ 개발

const flowRules = [
  { icon: CheckCircle2, title: '초록 화살표', text: '문제가 없으면 오른쪽으로 한 칸 이동합니다.' },
  { icon: PauseCircle, title: '보류', text: '잠깐 멈추고, 해결되면 같은 단계에서 다시 시작합니다.' },
  { icon: CircleAlert, title: '반려', text: '내용을 고쳐야 해서 요청자에게 되돌아갑니다.' },
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
          <p>프로젝트는 <b>요청 → 계획 → 승인 → 만들기 → 검사 → 완료</b> 순서로 움직입니다. 각 칸에는 누가 맡는지, 무엇을 하는지, 언제 다음으로 가는지가 적혀 있습니다.</p>
        </div>
      </div>

      <div className="flowSimpleGuide">
        {flowRules.map((item) => {
          const Icon = item.icon
          return (
            <div key={item.title} className="flowSimpleRule">
              <Icon size={18} />
              <strong>{item.title}</strong>
              <span>{item.text}</span>
            </div>
          )
        })}
      </div>

      <div className="flowStage">
        <div className="flowStageInner" ref={containerRef}>
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
            <div className={`flowStep ${stage.cls}`} key={stage.num} ref={(el) => { cardRefs.current[index] = el }}>
              {index > 0 && (
                <div className="flowConnector" aria-hidden="true">
                  {stage.enterLabel && <span className="flowConnectorLabel">{stage.enterLabel}</span>}
                  <ChevronRight size={20} />
                </div>
              )}
              <span className="flowStepNum">{stage.num}</span>
              <strong className="flowStepTitle">{stage.title}</strong>
              <span className="flowStepOwner">담당: {stage.owner}</span>
              <span className="flowStepWork">{stage.work}</span>
              <span className="flowStepDone">다음: {stage.done}</span>
            </div>
          ))}
        </div>

        <div className="flowBranchLane">
          <div className="flowBranchNode hold" ref={holdRef}>
            <strong>보류</strong>
            <span>잠깐 멈춤 · 같은 단계에서 다시 시작</span>
          </div>
          <div className="flowBranchNode reject" ref={rejectRef}>
            <strong>반려</strong>
            <span>요청자에게 돌아가서 고친 뒤 다시 요청</span>
          </div>
        </div>
        </div>
      </div>
    </section>
  )
}
