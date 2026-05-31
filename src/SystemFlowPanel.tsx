import { useCallback, useEffect, useId, useRef, useState } from 'react'
import mermaid from 'mermaid'
import { Minus, Plus, RotateCcw } from 'lucide-react'

mermaid.initialize({
  startOnLoad: false,
  theme: 'base',
  securityLevel: 'loose',
  fontFamily: 'inherit',
  flowchart: { curve: 'linear', nodeSpacing: 55, rankSpacing: 70, padding: 16, useMaxWidth: true, htmlLabels: true },
  themeVariables: {
    fontSize: '15px',
    primaryColor: '#ffffff',
    primaryBorderColor: '#5b6bd6',
    primaryTextColor: '#1d2330',
    lineColor: '#b0b6c0',
    clusterBkg: '#f7f9fc',
    clusterBorder: '#dfe4ee',
  },
})

const flowDefinition = `flowchart LR
    A(["① 새 요청 등록<br/><b>요청자</b>"]):::requester ==> B{"기획 단계<br/>필요 여부?"}:::gate
    B -- "필요" --> C["② 기획 문서 작성 (SRS+SDS)<br/><b>PM</b>"]:::pm
    B -- "생략" --> D
    C ==> D["③ 부서 검토 · 승인<br/><b>CEM·개발·정보보호<br/>인프라·QA·특허</b>"]:::multi
    D == "역할 전원 확인" ==> E["④ 개발 (일정 조율 · 진행)<br/><b>기획(PM) · 개발자</b>"]:::dev
    E ==> G["⑤ 검토 (QC · 보안 · PM)<br/><b>QA · 보안 · PM 3자</b>"]:::qa
    G == "3자 검토 완료" ==> H["⑥ 완료 보고 · 게시<br/><b>관리자</b>"]:::admin

    D -. "반려" .-> R(["반려"]):::stop
    G -. "반려" .-> R
    R -. "재요청" .-> A

    C -. "보류" .-> Z(["보류 (해제 시 재개)"]):::hold
    D -. "보류" .-> Z
    E -. "보류" .-> Z

    classDef requester fill:#e7f0ff,stroke:#2f6bd8,color:#14386e,font-weight:700;
    classDef pm fill:#eee9ff,stroke:#6d4fd0,color:#392487,font-weight:700;
    classDef multi fill:#f3e9fb,stroke:#9b51c4,color:#5a1d7a,font-weight:700;
    classDef dev fill:#e2f6f1,stroke:#149e7e,color:#0c5a47,font-weight:700;
    classDef qa fill:#fff0e2,stroke:#d98324,color:#7a4500,font-weight:700;
    classDef admin fill:#eef1f5,stroke:#5a6473,color:#2b323d,font-weight:700;
    classDef done fill:#e7f8ee,stroke:#1c9d5b,color:#0f5132,font-weight:700;
    classDef gate fill:#fff8d6,stroke:#a8860a,color:#5a4500;
    classDef stop fill:#fdecea,stroke:#c0392b,color:#7a1d12,font-weight:700;
    classDef hold fill:#fff4e0,stroke:#c98a1a,color:#6b4500,font-weight:700;

    linkStyle 0,3,4,5,6 stroke:#1c9d5b,stroke-width:2.5px;
    linkStyle 7,8,9 stroke:#c0392b,stroke-width:1.5px;
    linkStyle 10,11,12 stroke:#c98a1a,stroke-width:1.5px;`

const legend = [
  { color: '#e7f0ff', border: '#2f6bd8', label: '요청자' },
  { color: '#eee9ff', border: '#6d4fd0', label: '기획 (PM)' },
  { color: '#f3e9fb', border: '#9b51c4', label: '다중 협의·승인' },
  { color: '#e2f6f1', border: '#149e7e', label: '개발' },
  { color: '#fff0e2', border: '#d98324', label: '품질·보안 (QA·보안)' },
  { color: '#eef1f5', border: '#5a6473', label: '관리자' },
  { color: '#fff8d6', border: '#a8860a', label: '조건 분기' },
  { color: '#e7f8ee', border: '#1c9d5b', label: '완료 보고 (게시 포함)' },
  { color: '#fdecea', border: '#c0392b', label: '반려' },
  { color: '#fff4e0', border: '#c98a1a', label: '보류' },
]

export function SystemFlowPanel() {
  const [svg, setSvg] = useState('')
  const [error, setError] = useState('')
  const renderId = `flow-${useId().replace(/[^a-zA-Z0-9]/g, '')}`

  useEffect(() => {
    let active = true
    mermaid
      .render(renderId, flowDefinition)
      .then(({ svg }) => {
        if (active) setSvg(svg)
      })
      .catch((err) => {
        if (active) setError(String(err))
      })
    return () => {
      active = false
    }
  }, [renderId])

  // 확대/축소 · 팬(드래그)
  const MIN_SCALE = 0.5
  const MAX_SCALE = 3
  const [scale, setScale] = useState(1)
  const [offset, setOffset] = useState({ x: 0, y: 0 })
  const [dragging, setDragging] = useState(false)
  const dragRef = useRef<{ x: number; y: number; ox: number; oy: number } | null>(null)

  const clampScale = (s: number) => Math.min(MAX_SCALE, Math.max(MIN_SCALE, s))
  const zoomBy = useCallback((delta: number) => setScale((s) => clampScale(Math.round((s + delta) * 100) / 100)), [])
  const reset = useCallback(() => {
    setScale(1)
    setOffset({ x: 0, y: 0 })
  }, [])

  const viewportRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const el = viewportRef.current
    if (!el) return
    const handler = (e: WheelEvent) => {
      e.preventDefault()
      zoomBy(e.deltaY < 0 ? 0.15 : -0.15)
    }
    el.addEventListener('wheel', handler, { passive: false })
    return () => el.removeEventListener('wheel', handler)
  }, [zoomBy, svg])

  const onPointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0) return
    dragRef.current = { x: e.clientX, y: e.clientY, ox: offset.x, oy: offset.y }
    setDragging(true)
    ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
  }
  const onPointerMove = (e: React.PointerEvent) => {
    if (!dragRef.current) return
    setOffset({
      x: dragRef.current.ox + (e.clientX - dragRef.current.x),
      y: dragRef.current.oy + (e.clientY - dragRef.current.y),
    })
  }
  const endDrag = () => {
    dragRef.current = null
    setDragging(false)
  }

  return (
    <section className="flowPanel">
      <div className="flowPanelHead">
        <div>
          <h2>프로젝트 흐름도</h2>
          <p>새 요청 등록부터 완료 보고까지 6단계 흐름입니다. <b>각 단계 색이 담당 역할</b>을 나타내며, 굵은 초록 화살표가 정상 진행 경로, 점선은 반려·보류 분기입니다.</p>
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

      <div className="flowDiagram">
        {error ? (
          <p className="flowError">다이어그램을 그릴 수 없습니다: {error}</p>
        ) : svg ? (
          <>
            <div className="flowZoomBar">
              <button type="button" onClick={() => zoomBy(0.2)} title="확대" aria-label="확대"><Plus size={16} /></button>
              <span className="flowZoomLevel">{Math.round(scale * 100)}%</span>
              <button type="button" onClick={() => zoomBy(-0.2)} title="축소" aria-label="축소"><Minus size={16} /></button>
              <button type="button" onClick={reset} title="원래대로" aria-label="원래대로"><RotateCcw size={15} /></button>
            </div>
            <div
              ref={viewportRef}
              className={`flowViewport ${dragging ? 'dragging' : ''}`}
              onPointerDown={onPointerDown}
              onPointerMove={onPointerMove}
              onPointerUp={endDrag}
              onPointerLeave={endDrag}
            >
              <div
                className="flowSvgWrap"
                style={{ transform: `translate(${offset.x}px, ${offset.y}px) scale(${scale})` }}
                dangerouslySetInnerHTML={{ __html: svg }}
              />
            </div>
          </>
        ) : (
          <p className="flowLoading">흐름도를 그리는 중…</p>
        )}
      </div>
    </section>
  )
}
