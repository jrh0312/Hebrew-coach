import React, { useState, useRef, useCallback } from 'react'

// ── Sample texts for quick testing ──────────────────────────────
const EXAMPLES = [
  {
    he: 'בְּרֵאשִׁית בָּרָא אֱלֹהִים אֵת הַשָּׁמַיִם וְאֵת הָאָרֶץ.',
    en: 'Genesis 1:1 — In the beginning God created the heavens and the earth.',
  },
  {
    he: 'שְׁמַע יִשְׂרָאֵל, יְהוָה אֱלֹהֵינוּ, יְהוָה אֶחָד.',
    en: 'The Shema — Hear O Israel, the LORD our God, the LORD is one.',
  },
  {
    he: 'שָׁלוֹם, מָה שְׁלוֹמְךָ? אֲנִי בְּסֵדֶר, תּוֹדָה רַבָּה.',
    en: 'Everyday greeting — Hello, how are you? I am fine, thank you very much.',
  },
  {
    he: 'הַיּוֹם הוּא יוֹם טוֹב לִלְמֹד עִבְרִית. אֲנִי אוֹהֵב לִקְרוֹא בְּעִבְרִית.',
    en: 'Practice sentence — Today is a good day to learn Hebrew. I love reading Hebrew.',
  },
]

export default function TextInput({ onSubmit }) {
  const [text, setText] = useState('')
  const [fileName, setFileName] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const fileInputRef = useRef(null)

  const handleFileChange = useCallback((e) => {
    const file = e.target.files?.[0]
    if (!file) return
    if (!file.name.endsWith('.txt')) {
      alert('Please upload a .txt file.')
      return
    }
    setFileName(file.name)
    const reader = new FileReader()
    reader.onload = (evt) => setText(evt.target.result || '')
    reader.readAsText(file, 'UTF-8')
  }, [])

  const handleSubmit = useCallback(async () => {
    const trimmed = text.trim()
    if (!trimmed) return
    setIsLoading(true)
    try {
      await onSubmit(trimmed)
    } finally {
      setIsLoading(false)
    }
  }, [text, onSubmit])

  const handleExample = useCallback((heText) => {
    setText(heText)
    setFileName('')
  }, [])

  const handleKeyDown = useCallback(
    (e) => {
      // Cmd/Ctrl+Enter submits
      if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
        e.preventDefault()
        handleSubmit()
      }
    },
    [handleSubmit],
  )

  return (
    <div className="text-input-view">
      <h2 className="text-input-title">Hebrew Pronunciation Coach</h2>
      <p className="text-input-subtitle">
        Paste Hebrew text or upload a .txt file, then practice reading aloud
        and get instant pronunciation feedback.
      </p>

      {/* ── Text area ── */}
      <div className="textarea-wrapper">
        <textarea
          className="text-area"
          dir="rtl"
          lang="he"
          placeholder="הַדְבֵּק כָּאן טֶקְסְט עִבְרִי…"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={handleKeyDown}
          spellCheck={false}
          autoCorrect="off"
          autoCapitalize="off"
        />
      </div>

      {/* ── File upload + submit ── */}
      <div className="input-row">
        <label className="file-upload-label">
          📄 Upload .txt
          <input
            ref={fileInputRef}
            className="file-input"
            type="file"
            accept=".txt,text/plain"
            onChange={handleFileChange}
          />
        </label>

        {fileName && <span className="file-name">{fileName}</span>}

        {/* Spacer */}
        <span style={{ flex: 1 }} />

        <button
          className="btn btn-primary btn-md"
          onClick={handleSubmit}
          disabled={!text.trim() || isLoading}
        >
          {isLoading ? '⏳ Loading…' : '▶ Start Practice'}
        </button>
      </div>

      {/* ── Sample texts ── */}
      <div className="example-section">
        <div className="example-section-label">Quick start — tap to load a sample</div>
        <div className="example-list">
          {EXAMPLES.map((ex, i) => (
            <button
              key={i}
              className="example-btn"
              onClick={() => handleExample(ex.he)}
              dir="rtl"
            >
              <span className="example-he">{ex.he}</span>
              <span className="example-en">{ex.en}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}
