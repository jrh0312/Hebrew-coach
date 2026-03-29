/**
 * SegmentPlayer.jsx
 *
 * Manages one Hebrew text segment's entire lifecycle:
 *
 *   idle  →  playing (individual Listen)
 *         →  recording (Recorder shown)
 *             → recorded (blob ready, preview shown)
 *                 → assessing (API call)
 *                     → results (ResultsDisplay)
 *
 * Props:
 *   id           {string}   DOM id for scroll-into-view from App
 *   index        {number}   0-based segment index (displayed as 1-based)
 *   segment      {string}   The Hebrew text string
 *   audioUrl     {string|null}  Pre-fetched base64 data: URL, or null
 *   isHighlighted {bool}    True when full-play mode is on this segment
 *   apiBase      {string}   e.g. "/api" or "https://backend.onrender.com/api"
 */

import React, { useState, useRef, useCallback } from 'react'
import Recorder from './Recorder'
import ResultsDisplay from './ResultsDisplay'

export default function SegmentPlayer({
  id,
  index,
  segment,
  audioUrl,
  isHighlighted,
  apiBase,
}) {
  // ── Local state machine ────────────────────────────────────────
  // mode: idle | playing | recording | recorded | assessing | results
  const [mode, setMode] = useState('idle')
  const [recordingBlob, setRecordingBlob] = useState(null)
  const [previewUrl,    setPreviewUrl]    = useState(null)  // Object URL for <audio>
  const [result,        setResult]        = useState(null)
  const [assessError,   setAssessError]   = useState('')

  // Ref to the currently playing individual-listen audio
  const audioRef = useRef(null)

  // ── Individual Listen ──────────────────────────────────────────
  const handleListen = useCallback(() => {
    if (!audioUrl) return

    if (mode === 'playing') {
      // Toggle off
      audioRef.current?.pause()
      audioRef.current = null
      setMode('idle')
      return
    }

    setMode('playing')
    const audio = new Audio(audioUrl)
    audioRef.current = audio

    const done = () => {
      audioRef.current = null
      setMode('idle')
    }
    audio.addEventListener('ended', done, { once: true })
    audio.addEventListener('error', done, { once: true })
    audio.play().catch(done)
  }, [audioUrl, mode])

  // ── Recorder callbacks ────────────────────────────────────────
  const handleRecordingComplete = useCallback((blob) => {
    // Revoke any previous preview URL to avoid memory leaks
    if (previewUrl) URL.revokeObjectURL(previewUrl)
    const url = URL.createObjectURL(blob)
    setRecordingBlob(blob)
    setPreviewUrl(url)
    setMode('recorded')
  }, [previewUrl])

  const handleCancelRecording = useCallback(() => {
    setMode('idle')
  }, [])

  // ── Re-record ─────────────────────────────────────────────────
  const handleReRecord = useCallback(() => {
    if (previewUrl) URL.revokeObjectURL(previewUrl)
    setRecordingBlob(null)
    setPreviewUrl(null)
    setAssessError('')
    setMode('recording')
  }, [previewUrl])

  // ── Submit for assessment ──────────────────────────────────────
  const handleAssess = useCallback(async () => {
    if (!recordingBlob) return
    setMode('assessing')
    setAssessError('')

    const form = new FormData()
    form.append('audio', recordingBlob, 'recording.wav')
    form.append('reference_text', segment)

    try {
      const res = await fetch(`${apiBase}/assess`, {
        method: 'POST',
        body: form,
      })

      if (!res.ok) {
        const payload = await res.json().catch(() => ({}))
        throw new Error(payload.detail || `HTTP ${res.status}`)
      }

      const data = await res.json()
      setResult(data)
      setMode('results')
    } catch (err) {
      setAssessError(err.message)
      setMode('recorded')  // Let user retry
    }
  }, [recordingBlob, segment, apiBase])

  // ── Close results / reset ─────────────────────────────────────
  const handleCloseResults = useCallback(() => {
    if (previewUrl) URL.revokeObjectURL(previewUrl)
    setPreviewUrl(null)
    setRecordingBlob(null)
    setResult(null)
    setAssessError('')
    setMode('idle')
  }, [previewUrl])

  // ── Render ────────────────────────────────────────────────────
  return (
    <div
      id={id}
      className={`segment-card${isHighlighted ? ' highlighted' : ''}`}
    >
      {/* Segment number badge (top-right, matches RTL layout) */}
      <div className="segment-meta">
        <span className="segment-number">#{index + 1}</span>
      </div>

      {/* ── Hebrew text ── */}
      <p className="segment-text" dir="rtl" lang="he">
        {segment}
      </p>

      {/* ── Controls: idle / playing ── */}
      {(mode === 'idle' || mode === 'playing') && (
        <div className="segment-controls">
          <button
            className={`btn btn-sm ${mode === 'playing' ? 'btn-secondary' : 'btn-primary'}`}
            onClick={handleListen}
            disabled={!audioUrl}
            title={audioUrl ? 'Play model pronunciation' : 'TTS audio unavailable'}
          >
            {mode === 'playing' ? '⏸ Stop' : '🔊 Listen'}
          </button>

          <button
            className="btn btn-record btn-sm"
            onClick={() => setMode('recording')}
          >
            🎤 Record
          </button>
        </div>
      )}

      {/* ── Recorder ── */}
      {mode === 'recording' && (
        <Recorder
          onRecordingComplete={handleRecordingComplete}
          onCancel={handleCancelRecording}
        />
      )}

      {/* ── Recorded: preview + re-record / submit ── */}
      {mode === 'recorded' && (
        <div className="recorded-controls">
          {previewUrl && (
            <audio
              controls
              src={previewUrl}
              className="recording-preview"
              preload="auto"
            />
          )}
          {assessError && (
            <p className="error-msg">⚠ {assessError}</p>
          )}
          <div className="segment-controls">
            <button className="btn btn-secondary btn-sm" onClick={handleReRecord}>
              🔄 Re-record
            </button>
            <button className="btn btn-success btn-sm" onClick={handleAssess}>
              📊 Assess Pronunciation
            </button>
          </div>
        </div>
      )}

      {/* ── Assessing spinner ── */}
      {mode === 'assessing' && (
        <div className="assessing-state">
          <div className="spinner" />
          <span>Analyzing pronunciation…</span>
        </div>
      )}

      {/* ── Results ── */}
      {mode === 'results' && result && (
        <ResultsDisplay result={result} onClose={handleCloseResults} />
      )}
    </div>
  )
}
