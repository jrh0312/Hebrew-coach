/**
 * App.jsx — Hebrew Pronunciation Coach
 *
 * State overview:
 *   view            'input' | 'practice'
 *   segments        string[]
 *   audioCache      { [index: number]: string }  (data: URL per segment)
 *   prefetchStatus  'idle' | 'loading' | 'done' | 'error'
 *   fullPlayStatus  'stopped' | 'playing' | 'paused'
 *   playingIdx      number | null  (segment currently highlighted)
 *
 * Full-play state machine (ref-based to avoid closure staleness):
 *   playbackRef.active        — is the loop running?
 *   playbackRef.paused        — is it currently paused mid-loop?
 *   playbackRef.currentAudio  — the active Audio object (if any)
 *   playbackRef.audioResolve  — resolve fn for the current "wait for audio" promise
 *   playbackRef.pauseResolve  — resolve fn for the "wait for resume" promise
 */

import React, { useState, useRef, useCallback, useEffect } from 'react'
import TextInput    from './components/TextInput'
import SegmentPlayer from './components/SegmentPlayer'
import { segmentText } from './utils/textUtils'
import './App.css'

// In dev, Vite proxy forwards /api → localhost:8000
// In prod, set VITE_API_URL=https://your-backend.onrender.com/api
const API_BASE = import.meta.env.VITE_API_URL || '/api'

export default function App() {
  // ── View ───────────────────────────────────────────────────────
  const [view, setView] = useState('input')  // 'input' | 'practice'

  // ── Text / segments ───────────────────────────────────────────
  const [segments,       setSegments]       = useState([])
  const [audioCache,     setAudioCache]     = useState({})  // idx → dataURL
  const [prefetchStatus, setPrefetchStatus] = useState('idle')
  const [prefetchCount,  setPrefetchCount]  = useState({ done: 0, total: 0 })

  // ── Full-play ──────────────────────────────────────────────────
  const [fullPlayStatus, setFullPlayStatus] = useState('stopped')
  const [playingIdx,     setPlayingIdx]     = useState(null)

  /**
   * All mutable full-play state lives in a ref so async loop
   * closures always see the latest values.
   */
  const pb = useRef({
    active:       false,
    paused:       false,
    currentAudio: null,
    audioResolve: null,  // resolves when current Audio finishes or is force-stopped
    pauseResolve: null,  // resolves when the loop is un-paused between segments
  })

  // ── Text submit → prefetch ────────────────────────────────────
  const handleTextSubmit = useCallback(async (rawText) => {
    const segs = segmentText(rawText)
    if (!segs.length) return

    setSegments(segs)
    setAudioCache({})
    setPrefetchStatus('loading')
    setPrefetchCount({ done: 0, total: segs.length })
    setView('practice')

    try {
      const res = await fetch(`${API_BASE}/tts/prefetch`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ segments: segs }),
      })

      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        throw new Error(err.detail || `HTTP ${res.status}`)
      }

      const data = await res.json()

      const cache = {}
      let successCount = 0
      ;(data.segments || []).forEach((item, idx) => {
        if (item.audio) {
          cache[idx]   = `data:audio/mpeg;base64,${item.audio}`
          successCount++
        }
      })

      setAudioCache(cache)
      setPrefetchCount({ done: successCount, total: segs.length })
      setPrefetchStatus(successCount > 0 ? 'done' : 'error')
    } catch (err) {
      console.error('TTS prefetch failed:', err)
      setPrefetchStatus('error')
    }
  }, [])

  // ── Full-play: start ──────────────────────────────────────────
  const startFullPlay = useCallback(async () => {
    if (!segments.length || prefetchStatus !== 'done') return

    // Reset ref state
    pb.current.active       = true
    pb.current.paused       = false
    pb.current.currentAudio = null
    pb.current.audioResolve = null
    pb.current.pauseResolve = null

    setFullPlayStatus('playing')

    for (let i = 0; i < segments.length; i++) {
      if (!pb.current.active) break

      // ── If paused between segments: wait for resume ────────
      if (pb.current.paused) {
        await new Promise((resolve) => {
          pb.current.pauseResolve = resolve
        })
        if (!pb.current.active) break
      }

      setPlayingIdx(i)

      const url = audioCache[i]
      if (!url) continue  // skip segments whose TTS failed

      // ── Play this segment ──────────────────────────────────
      await new Promise((resolve) => {
        const audio          = new Audio(url)
        pb.current.currentAudio = audio
        pb.current.audioResolve = resolve

        const done = () => {
          pb.current.currentAudio = null
          pb.current.audioResolve = null
          resolve()
        }
        audio.addEventListener('ended', done, { once: true })
        audio.addEventListener('error', done, { once: true })
        audio.play().catch(done)
      })
    }

    // Loop finished (or was stopped)
    if (pb.current.active) {
      pb.current.active = false
      setFullPlayStatus('stopped')
      setPlayingIdx(null)
    }
  }, [segments, prefetchStatus, audioCache])

  // ── Full-play: pause ──────────────────────────────────────────
  const pauseFullPlay = useCallback(() => {
    if (!pb.current.active || pb.current.paused) return
    pb.current.paused = true
    setFullPlayStatus('paused')

    // Pause the currently-playing Audio object (keeps position)
    pb.current.currentAudio?.pause()
  }, [])

  // ── Full-play: resume ─────────────────────────────────────────
  const resumeFullPlay = useCallback(() => {
    if (!pb.current.active || !pb.current.paused) return
    pb.current.paused = false
    setFullPlayStatus('playing')

    if (pb.current.currentAudio) {
      // Resume the Audio that was mid-playback
      pb.current.currentAudio.play().catch(() => {
        // If iOS refuses the resumed play, advance to next segment
        pb.current.audioResolve?.()
      })
    } else if (pb.current.pauseResolve) {
      // Was paused between segments — unblock the for-loop
      pb.current.pauseResolve()
      pb.current.pauseResolve = null
    }
  }, [])

  // ── Full-play: stop ───────────────────────────────────────────
  const stopFullPlay = useCallback(() => {
    pb.current.active = false
    pb.current.paused = false

    // Stop and release the Audio object
    if (pb.current.currentAudio) {
      pb.current.currentAudio.pause()
      pb.current.currentAudio = null
    }

    // Unblock any pending promise so the async loop can exit
    pb.current.audioResolve?.()
    pb.current.audioResolve = null
    pb.current.pauseResolve?.()
    pb.current.pauseResolve = null

    setFullPlayStatus('stopped')
    setPlayingIdx(null)
  }, [])

  // ── Auto-scroll to highlighted segment ───────────────────────
  useEffect(() => {
    if (playingIdx === null) return
    const el = document.getElementById(`seg-${playingIdx}`)
    el?.scrollIntoView({ behavior: 'smooth', block: 'center' })
  }, [playingIdx])

  // ── Back to input ─────────────────────────────────────────────
  const handleBack = useCallback(() => {
    stopFullPlay()
    setView('input')
    setSegments([])
    setAudioCache({})
    setPrefetchStatus('idle')
    setPlayingIdx(null)
  }, [stopFullPlay])

  // ── Render ────────────────────────────────────────────────────
  return (
    <div className="app">
      {/* ── Sticky header ── */}
      <header className="app-header">
        <div className="header-top">
          <h1 className="app-title">🇮🇱 Hebrew Coach</h1>
          {view === 'practice' && (
            <button className="btn btn-ghost btn-sm" onClick={handleBack}>
              ← New Text
            </button>
          )}
        </div>

        {/* Full-play controls bar — only in practice view */}
        {view === 'practice' && segments.length > 0 && (
          <div className="fullplay-bar">
            {prefetchStatus === 'loading' && (
              <span className="prefetch-status">
                ⏳ Fetching audio… ({prefetchCount.done}/{prefetchCount.total})
              </span>
            )}

            {prefetchStatus === 'error' && (
              <span className="prefetch-status error">
                ⚠ TTS failed — check your Google API key
              </span>
            )}

            {prefetchStatus === 'done' && (
              <div className="fullplay-controls">
                <span className="fullplay-label">Read full text:</span>

                {fullPlayStatus === 'stopped' && (
                  <button className="btn btn-primary btn-sm" onClick={startFullPlay}>
                    ▶ Play All
                  </button>
                )}

                {fullPlayStatus === 'playing' && (
                  <>
                    <button className="btn btn-secondary btn-sm" onClick={pauseFullPlay}>
                      ⏸ Pause
                    </button>
                    <button className="btn btn-danger btn-sm" onClick={stopFullPlay}>
                      ⏹ Stop
                    </button>
                  </>
                )}

                {fullPlayStatus === 'paused' && (
                  <>
                    <button className="btn btn-primary btn-sm" onClick={resumeFullPlay}>
                      ▶ Resume
                    </button>
                    <button className="btn btn-danger btn-sm" onClick={stopFullPlay}>
                      ⏹ Stop
                    </button>
                  </>
                )}
              </div>
            )}
          </div>
        )}
      </header>

      {/* ── Main content ── */}
      <main className="app-main">
        {view === 'input' ? (
          <TextInput onSubmit={handleTextSubmit} />
        ) : (
          <div className="segments-list">
            {segments.map((seg, idx) => (
              <SegmentPlayer
                key={idx}
                id={`seg-${idx}`}
                index={idx}
                segment={seg}
                audioUrl={audioCache[idx] ?? null}
                isHighlighted={playingIdx === idx}
                apiBase={API_BASE}
              />
            ))}
          </div>
        )}
      </main>
    </div>
  )
}
