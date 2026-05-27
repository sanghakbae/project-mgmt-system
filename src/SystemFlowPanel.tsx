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
    A(["① 새 요청 등록<br/><b>요청자</b>"]):::requester ==> B{"기획 단계<br/>필요 여부?"}:::gate
    B -- "필요" --> C["② 기획 문서 작성 (SRS+SDS)<br/><b>PM</b>"]:::pm
    B -- "생략" --> D
    C ==> D["③ 부서 검토 · 승인<br/><b>PM·CEM·개발·정보보호<br/>인프라·QA·특허·최종</b>"]:::multi
    D == "역할 전원 확인" ==> E["④ 일정 확정<br/><b>PM · 개발 협의</b>"]:::multi
    E ==> F["⑤ 개발 진행<br/><b>개발자</b>"]:::dev
    F ==> G["⑥ QC · 보안 · PM 검토<br/><b>QA · 보안 · PM 3자</b>"]:::qa
    G == "3자 검토 완료" ==> H["⑦ 완료 보고<br/><b>관리자</b>"]:::admin
    H == "요청자 결과 확인" ==> I(["⑧ 게시 완료"]):::done

    D -. "반려" .-> R(["반려"]):::stop
    G -. "반려" .-> R
    R -. "재요청" .-> A

    C -. "보류" .-> Z(["보류 (해제 시 재개)"]):::hold
    D -. "보류" .-> Z
    F -. "보류" .-> Z

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

    linkStyle 0,3,4,5,6,7,8 stroke:#1c9d5b,stroke-width:2.5px;
    linkStyle 9,10,11 stroke:#c0392b,stroke-width:1.5px;
    linkStyle 12,13,14 stroke:#c98a1a,stroke-width:1.5px;`

const legend = [
  { color: '#e7f0ff', border: '#2f6bd8', label: '요청자' },
  { color: '#eee9ff', border: '#6d4fd0', label: '기획 (PM)' },
  { color: '#f3e9fb', border: '#9b51c4', label: '다중 협의·승인' },
  { color: '#e2f6f1', border: '#149e7e', label: '개발' },
  { color: '#fff0e2', border: '#d98324', label: '품질·보안 (QA·보안)' },
  { color: '#eef1f5', border: '#5a6473', label: '관리자' },
  { color: '#fff8d6', border: '#a8860a', label: '조건 분기' },
  { color: '#e7f8ee', border: '#1c9d5b', label: '완료·게시' },
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
          <p>새 요청 등록부터 게시까지 8단계 흐름입니다. <b>각 단계 색이 담당 역할</b>을 나타내며, 굵은 초록 화살표가 정상 진행 경로, 점선은 반려·보류 분기입니다.</p>
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
