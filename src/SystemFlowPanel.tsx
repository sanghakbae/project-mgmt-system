import { useEffect, useId, useState } from 'react'
import mermaid from 'mermaid'

mermaid.initialize({
  startOnLoad: false,
  theme: 'base',
  securityLevel: 'loose',
  fontFamily: 'inherit',
  flowchart: { curve: 'basis', nodeSpacing: 45, rankSpacing: 55, padding: 12, useMaxWidth: true },
  themeVariables: {
    fontSize: '15px',
    primaryColor: '#eef2ff',
    primaryBorderColor: '#5b6bd6',
    primaryTextColor: '#1d2330',
    lineColor: '#9aa1ad',
    tertiaryColor: '#fff',
  },
})

const flowDefinition = `flowchart TD
    A([요청자: 새 요청 등록]):::start --> B{기획 단계 필요?}

    B -- "필요" --> C[기획 SRS+SDS 작성<br/>담당: PM]
    B -- "생략" --> D

    C --> C1{SRS·SDS 모두 작성?}:::gate
    C1 -- 아니오 --> C
    C1 -- 예 --> D[부서 검토 · 승인 의견 취합<br/>PM·CEM·개발·정보보호·인프라·QA·특허·최종]

    D --> D1{각 역할 확인 완료?}:::gate
    D1 -- 일부 대기 --> D
    D1 -- "전원 확인 → 자동 진행" --> E[개발 준비 · 일정 확정<br/>일정 조율: 기획·개발 협의]

    E --> F[개발<br/>담당: 개발자]
    F --> G[QC · 보안 · PM 검토<br/>3자 사인오프 게이트]

    G --> G1{QA·보안·PM 모두 완료?}:::gate
    G1 -- 일부 대기 --> G
    G1 -- 전원 완료 --> H[완료 보고<br/>담당: 관리자]

    H --> H1{요청자 결과 확인?}:::gate
    H1 -- 미확인 --> H
    H1 -- 확인 완료 --> I([게시 / Published]):::done

    D -. 반려 .-> R([반려 / Rejected]):::stop
    E -. 반려 .-> R
    F -. 반려 .-> R
    G -. 반려 .-> R
    R -. 재요청 .-> A

    C -. 보류 .-> P[보류 / On Hold<br/>PM·관리자 해제 시까지 잠금]:::hold
    D -. 보류 .-> P
    E -. 보류 .-> P
    F -. 보류 .-> P
    G -. 보류 .-> P
    P -. 해제 .-> D

    classDef start fill:#e9f2ff,stroke:#3b5bdb,color:#1b3a8f,font-weight:700;
    classDef done fill:#e9f7ef,stroke:#1c7a4d,color:#14532d,font-weight:700;
    classDef stop fill:#fdecea,stroke:#c0392b,color:#7a1d12,font-weight:700;
    classDef hold fill:#fff4e0,stroke:#c98a1a,color:#6b4500,font-weight:700;
    classDef gate fill:#fff8d6,stroke:#a8860a,color:#5a4500;`

const legend = [
  { color: '#e9f2ff', border: '#3b5bdb', label: '시작 (요청)' },
  { color: '#fff', border: '#5b6bd6', label: '진행 단계' },
  { color: '#fff8d6', border: '#a8860a', label: '게이트(조건 분기)' },
  { color: '#e9f7ef', border: '#1c7a4d', label: '완료 / 게시' },
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

  return (
    <section className="flowPanel">
      <div className="flowPanelHead">
        <div>
          <h2>시스템 흐름도</h2>
          <p>새 요청 등록부터 게시까지의 전체 업무 흐름과 역할·게이트·분기를 한눈에 보여줍니다.</p>
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
          <div className="flowSvgWrap" dangerouslySetInnerHTML={{ __html: svg }} />
        ) : (
          <p className="flowLoading">흐름도를 그리는 중…</p>
        )}
      </div>
    </section>
  )
}
