/**
 * ResultsDisplay.jsx
 *
 * Shows the Azure Pronunciation Assessment result for one segment:
 *  • 4 score cards (Overall · Accuracy · Fluency · Completeness)
 *  • RTL Hebrew words, each colour-coded by accuracy score
 *  • Tapping a word expands an inline phoneme breakdown panel
 *  • "Hear correct pronunciation" button per word (calls /api/tts)
 *
 * Scores are used as-is from Azure (0–100). No rescaling.
 */

import React, { useState, useCallback } from 'react'
import { scoreClass } from '../utils/audioUtils'

const API_BASE = import.meta.env.VITE_API_URL || '/api'

// ── Subcomponents ─────────────────────────────────────────────────

function ScoreCard({ label, value }) {
  const cls = scoreClass(Math.round(value))
  return (
    <div className={`score-card score-${cls}`}>
      <div className="score-value">{Math.round(value)}</div>
      <div className="score-label">{label}</div>
    </div>
  )
}

function WordBadge({ wordData, isSelected, onClick }) {
  const cls = scoreClass(wordData.accuracy_score)
  return (
    <span
      className={`word-badge word-${cls}${isSelected ? ' selected' : ''}`}
      onClick={onClick}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => e.key === 'Enter' && onClick()}
      title={`Accuracy: ${Math.round(wordData.accuracy_score)}`}
      aria-pressed={isSelected}
    >
      {wordData.word}
      <sup className="word-score-sup">{Math.round(wordData.accuracy_score)}</sup>
    </span>
  )
}

function PhonemePanel({ wordData, onClose }) {
  const [replayState, setReplayState] = useState('idle') // idle | loading | error
  const wordScoreCls = scoreClass(wordData.accuracy_score)

  const replayWord = useCallback(async () => {
    setReplayState('loading')
    try {
      const res = await fetch(`${API_BASE}/tts`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: wordData.word }),
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const blob = await res.blob()
      const url  = URL.createObjectURL(blob)
      const audio = new Audio(url)
      audio.addEventListener('ended',  () => URL.revokeObjectURL(url), { once: true })
      audio.addEventListener('error',  () => URL.revokeObjectURL(url), { once: true })
      await audio.play()
      setReplayState('idle')
    } catch (err) {
      console.error('Word replay failed:', err)
      setReplayState('error')
    }
  }, [wordData.word])

  return (
    <div className="phoneme-panel">
      {/* Panel header */}
      <div className="phoneme-panel-header">
        <span className="phoneme-word" dir="rtl" lang="he">
          {wordData.word}
        </span>
        <span className={`phoneme-word-score score-${wordScoreCls}`}>
          {Math.round(wordData.accuracy_score)}/100
        </span>
        {wordData.error_type && wordData.error_type !== 'None' && (
          <span className="error-tag">{wordData.error_type}</span>
        )}
        <button
          className="btn btn-ghost btn-sm"
          style={{ marginInlineStart: 'auto' }}
          onClick={onClose}
          aria-label="Close phoneme panel"
        >
          ✕
        </button>
      </div>

      {/* Phoneme rows */}
      {wordData.phonemes && wordData.phonemes.length > 0 ? (
        <div className="phoneme-list">
          {wordData.phonemes.map((p, i) => {
            const cls = scoreClass(p.accuracy_score)
            return (
              <div key={i} className={`phoneme-row ph-${cls}`}>
                <span className="phoneme-symbol">{p.phoneme || '—'}</span>
                <div className="phoneme-bar-track">
                  <div
                    className={`phoneme-bar ph-${cls}`}
                    style={{ width: `${Math.max(2, p.accuracy_score)}%` }}
                  />
                </div>
                <span className="phoneme-score-val">{Math.round(p.accuracy_score)}</span>
              </div>
            )
          })}
        </div>
      ) : (
        <p className="phoneme-empty">No phoneme data returned for this word.</p>
      )}

      {/* Replay button */}
      <button
        className="btn btn-secondary btn-sm"
        onClick={replayWord}
        disabled={replayState === 'loading'}
      >
        {replayState === 'loading'
          ? '⏳ Loading…'
          : replayState === 'error'
          ? '⚠ Retry replay'
          : '🔊 Hear correct pronunciation'}
      </button>
    </div>
  )
}

// ── Main export ──────────────────────────────────────────────────

export default function ResultsDisplay({ result, onClose }) {
  const [selectedIdx, setSelectedIdx] = useState(null)

  const toggleWord = useCallback((idx) => {
    setSelectedIdx((prev) => (prev === idx ? null : idx))
  }, [])

  const { words = [] } = result

  return (
    <div className="results">
      {/* Header */}
      <div className="results-header">
        <h3 className="results-title">Pronunciation Results</h3>
        <button className="btn btn-ghost btn-sm" onClick={onClose}>
          ✕ Close
        </button>
      </div>

      {/* ── 4 overall score cards ── */}
      <div className="score-cards">
        <ScoreCard label="Overall"    value={result.pronunciation_score} />
        <ScoreCard label="Accuracy"   value={result.accuracy_score} />
        <ScoreCard label="Fluency"    value={result.fluency_score} />
        <ScoreCard label="Complete"   value={result.completeness_score} />
      </div>

      {/* Recognised text */}
      {result.recognized_text && (
        <div className="recognized-row">
          <span className="recognized-label">Heard:</span>
          <span className="recognized-value" dir="rtl" lang="he">
            {result.recognized_text}
          </span>
        </div>
      )}

      {/* ── Word-by-word breakdown ── */}
      {words.length > 0 && (
        <div className="word-breakdown">
          <p className="word-breakdown-hint">Tap a word to see phoneme details:</p>

          <div className="words-display" dir="rtl" lang="he">
            {words.map((w, idx) => (
              <WordBadge
                key={idx}
                wordData={w}
                isSelected={selectedIdx === idx}
                onClick={() => toggleWord(idx)}
              />
            ))}
          </div>

          {/* Inline phoneme panel for the selected word */}
          {selectedIdx !== null && words[selectedIdx] && (
            <PhonemePanel
              wordData={words[selectedIdx]}
              onClose={() => setSelectedIdx(null)}
            />
          )}
        </div>
      )}

      {/* Legend */}
      <div className="score-legend">
        <span className="legend-item legend-green">80–100 Great</span>
        <span className="legend-item legend-yellow">50–79 Needs work</span>
        <span className="legend-item legend-red">0–49 Focus here</span>
      </div>
    </div>
  )
}
