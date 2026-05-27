import { EditorContent, useEditor } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import { Table } from '@tiptap/extension-table'
import { TableRow } from '@tiptap/extension-table-row'
import { TableHeader } from '@tiptap/extension-table-header'
import { TableCell } from '@tiptap/extension-table-cell'
import { useEffect } from 'react'

type RichEditorProps = {
  value: string
  onChange: (html: string) => void
  placeholder?: string
  minHeight?: number
}

export function RichEditor({ value, onChange, placeholder, minHeight = 100 }: RichEditorProps) {
  const editor = useEditor({
    extensions: [
      StarterKit.configure({ heading: { levels: [1, 2, 3] } }),
      Table.configure({ resizable: true }),
      TableRow,
      TableHeader,
      TableCell,
    ],
    content: value || '',
    onUpdate({ editor }) {
      const html = editor.getHTML()
      // tiptap returns "<p></p>" for empty; normalize to ''
      onChange(html === '<p></p>' ? '' : html)
    },
    editorProps: {
      attributes: {
        class: 'richEditorContent',
        'data-placeholder': placeholder ?? '',
        style: `min-height:${minHeight}px;`,
      },
    },
  })

  useEffect(() => {
    if (!editor) return
    const current = editor.getHTML()
    const incoming = value || ''
    if (incoming === current) return
    if (incoming === '' && current === '<p></p>') return
    editor.commands.setContent(incoming, { emitUpdate: false })
  }, [value, editor])

  return (
    <div className="richEditorWrap">
      <div className="richEditorToolbar">
        <button type="button" onClick={() => editor?.chain().focus().toggleBold().run()} className={editor?.isActive('bold') ? 'active' : ''} title="굵게"><b>B</b></button>
        <button type="button" onClick={() => editor?.chain().focus().toggleItalic().run()} className={editor?.isActive('italic') ? 'active' : ''} title="기울임"><i>I</i></button>
        <button type="button" onClick={() => editor?.chain().focus().toggleStrike().run()} className={editor?.isActive('strike') ? 'active' : ''} title="취소선"><s>S</s></button>
        <span className="divider" />
        <button type="button" onClick={() => editor?.chain().focus().toggleHeading({ level: 2 }).run()} className={editor?.isActive('heading', { level: 2 }) ? 'active' : ''} title="제목">H</button>
        <button type="button" onClick={() => editor?.chain().focus().toggleBulletList().run()} className={editor?.isActive('bulletList') ? 'active' : ''} title="목록">•</button>
        <button type="button" onClick={() => editor?.chain().focus().toggleOrderedList().run()} className={editor?.isActive('orderedList') ? 'active' : ''} title="번호 목록">1.</button>
        <button type="button" onClick={() => editor?.chain().focus().toggleCodeBlock().run()} className={editor?.isActive('codeBlock') ? 'active' : ''} title="코드">{'</>'}</button>
        <button type="button" onClick={() => editor?.chain().focus().toggleBlockquote().run()} className={editor?.isActive('blockquote') ? 'active' : ''} title="인용">”</button>
        <span className="divider" />
        <button type="button" onClick={() => editor?.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run()} title="표 삽입 (3×3)">▦</button>
        {editor?.isActive('table') && (
          <>
            <button type="button" onClick={() => editor?.chain().focus().addColumnAfter().run()} title="열 추가">⊞열</button>
            <button type="button" onClick={() => editor?.chain().focus().addRowAfter().run()} title="행 추가">⊞행</button>
            <button type="button" onClick={() => editor?.chain().focus().deleteColumn().run()} title="열 삭제">⊟열</button>
            <button type="button" onClick={() => editor?.chain().focus().deleteRow().run()} title="행 삭제">⊟행</button>
            <button type="button" onClick={() => editor?.chain().focus().toggleHeaderRow().run()} title="헤더 행 토글">H행</button>
            <button type="button" onClick={() => editor?.chain().focus().deleteTable().run()} title="표 삭제">✕표</button>
          </>
        )}
        <span className="divider" />
        <button type="button" onClick={() => editor?.chain().focus().undo().run()} title="실행 취소">↶</button>
        <button type="button" onClick={() => editor?.chain().focus().redo().run()} title="다시 실행">↷</button>
      </div>
      <EditorContent editor={editor} />
    </div>
  )
}

export function RichTextView({ html, fallback }: { html: string; fallback?: string }) {
  const trimmed = (html ?? '').trim()
  if (!trimmed) return <p className="richEditorFallback">{fallback ?? '아직 입력되지 않았습니다.'}</p>
  // Backward compat: if value doesn't look like HTML (no tags), wrap in <p> with preserved whitespace
  const looksLikeHtml = /<[a-z][\s\S]*>/i.test(trimmed)
  if (looksLikeHtml) {
    return <div className="richEditorView" dangerouslySetInnerHTML={{ __html: trimmed }} />
  }
  return <div className="richEditorView plain">{trimmed}</div>
}
