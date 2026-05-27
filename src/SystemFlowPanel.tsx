import { useEffect, useId, useState } from 'react'
import mermaid from 'mermaid'

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

const flowDefinition = `flowchart TB
    A(["새 요청 등록<br/><b>요청자</b>"]):::start

    subgraph PH1["1 · 기획"]
      direction TB
      B{"기획 단계<br/>필요 여부"}:::gate
      C["기획 문서 작성<br/>SRS + SDS<br/><b>PM</b>"]:::step
    end

    subgraph PH2["2 · 부서 검토 · 승인"]
      direction TB
      D["승인 의견 취합<br/><b>PM · CEM · 개발 · 정보보호</b><br/><b>인프라 · QA · 특허 · 최종</b>"]:::step
    end

    subgraph PH3["3 · 일정 · 개발 · 품질"]
      direction TB
      E["일정 확정<br/><b>기획 · 개발 협의</b>"]:::step --> F["개발 진행<br/><b>개발자</b>"]:::step --> G["QC · 보안 · PM 검토<br/><b>3자 사인오프</b>"]:::step
    end

    subgraph PH4["4 · 완료 · 게시"]
      direction TB
      H["완료 보고<br/><b>관리자</b>"]:::step
      I(["게시 완료"]):::done
    end

    A ==> B
    B -- "필요" --> C
    B -- "생략" --> D
    C ==> D
    D == "역할 전원 확인" ==> E
    G == "3자 검토 완료" ==> H
    H == "요청자 결과 확인" ==> I

    D -. "반려" .-> R(["반려"]):::stop
    G -. "반려" .-> R
    R -. "재요청" .-> A

    C -. "보류" .-> Z(["보류<br/>(해제 시 재개)"]):::hold
    D -. "보류" .-> Z
    F -. "보류" .-> Z

    classDef start fill:#e9f2ff,stroke:#3b5bdb,color:#1b3a8f,font-weight:700;
    classDef step fill:#ffffff,stroke:#5b6bd6,color:#1d2330;
    classDef done fill:#e9f7ef,stroke:#1c7a4d,color:#14532d,font-weight:700;
    classDef stop fill:#fdecea,stroke:#c0392b,color:#7a1d12,font-weight:700;
    classDef hold fill:#fff4e0,stroke:#c98a1a,color:#6b4500,font-weight:700;
    classDef gate fill:#fff8d6,stroke:#a8860a,color:#5a4500;

    linkStyle 2,5,6,7,8 stroke:#1c7a4d,stroke-width:2.5px;
    linkStyle 9,10,11 stroke:#c0392b,stroke-width:1.5px;
    linkStyle 12,13,14 stroke:#c98a1a,stroke-width:1.5px;`

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
