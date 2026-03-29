/**
 * Recorder.jsx — iOS-compatible audio recorder
 *
 * Uses Web Audio API (ScriptProcessorNode) to capture raw PCM,
 * then encodes to WAV with the audioUtils helper.
 *
 * iOS Safari notes:
 *  • AudioContext MUST be created inside a direct user-gesture handler.
 *  • The audio graph MUST connect to audioContext.destination (even with
 *    gain=0) for ScriptProcessorNode to fire on iOS.
 *  • getUserMedia is called from the startRecording button tap — never
 *    from useEffect, which would be outside the gesture window on older iOS.
 */

import React, { useState, useRef, useCallback } from 'react'
import { encodeWAV } from '../utils/audioUtils'

const SILENCE_THRESHOLD  = 0.018  // RMS level below which audio is "silent"
const SILENCE_TIMEOUT_MS = 3000   // auto-stop after this many ms of silence
const MAX_DURATION_MS    = 90_000 // hard stop at 90 s
const PROCESSOR_FRAMES   = 4096  // ScriptProcessor buffer size

export default function Recorder({ onRecordingComplete, onCancel }) {
  const [phase, setPhase] = useState('ready')   // ready | recording | error
  const [duration, setDuration] = useState(0)
  const [silent, setSilent] = useState(false)
  const [errorMsg, setErrorMsg] = useState('')

  // Refs survive re-renders without triggering them
  const ctxRef          = useRef(null)
  const processorRef    = useRef(null)
  const sourceRef       = useRef(null)
  const silentGainRef   = useRef(null)
  const streamRef       = useRef(null)
  const samplesRef      = useRef([])
  const sampleRateRef   = useRef(44100)
  const silenceTimerRef = useRef(null)
  const maxTimerRef     = useRef(null)
  const durationRef     = useRef(null)
  const stoppingRef     = useRef(false)

  // ── Teardown + encode ────────────────────────────────────────
  const finish = useCallback(() => {
    if (stoppingRef.current) return
    stoppingRef.current = true

    // Clear all timers
    clearTimeout(silenceTimerRef.current)
    clearTimeout(maxTimerRef.current)
    clearInterval(durationRef.current)
    silenceTimerRef.current = null
    maxTimerRef.current = null
    durationRef.current = null

    // Collect samples before graph teardown
    const samples    = new Float32Array(samplesRef.current)
    const sampleRate = sampleRateRef.current

    // Disconnect audio graph nodes
    try { processorRef.current?.disconnect() }  catch (_) {}
    try { silentGainRef.current?.disconnect() } catch (_) {}
    try { sourceRef.current?.disconnect() }     catch (_) {}
    processorRef.current = null
    silentGainRef.current = null
    sourceRef.current = null

    // Stop mic tracks
    streamRef.current?.getTracks().forEach((t) => t.stop())
    streamRef.current = null

    // Close context (non-blocking)
    ctxRef.current?.close().catch(() => {})
    ctxRef.current = null

    setPhase('ready')

    // Need at least ~0.3 s of audio for Azure to work with
    if (samples.length < sampleRate * 0.3) {
      setErrorMsg('Recording was too short — please speak for at least 1 second.')
      stoppingRef.current = false
      return
    }

    const wavBuffer = encodeWAV(samples, sampleRate)
    const blob      = new Blob([wavBuffer], { type: 'audio/wav' })
    onRecordingComplete(blob)
  }, [onRecordingComplete])

  // ── Start recording — MUST be called directly from a button tap ─
  const startRecording = useCallback(async () => {
    setErrorMsg('')
    samplesRef.current  = []
    stoppingRef.current = false

    let stream
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
          // Note: iOS ignores sampleRate constraint — it picks 44100 or 48000
        },
      })
    } catch (err) {
      let msg = 'Microphone access denied or unavailable.'
      if (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError') {
        msg =
          'Microphone blocked. On iPhone: Settings → Safari → Microphone → Allow.'
      } else if (err.name === 'NotFoundError') {
        msg = 'No microphone found on this device.'
      } else if (err.name === 'NotSupportedError') {
        msg = 'Microphone not supported in this browser. Try Safari on iOS 14.3+.'
      }
      setErrorMsg(msg)
      return
    }

    streamRef.current = stream

    // Create AudioContext INSIDE the gesture handler (required on iOS)
    const AudioCtx = window.AudioContext || window.webkitAudioContext
    const ctx      = new AudioCtx()  // iOS may give 44100 or 48000
    ctxRef.current = ctx
    sampleRateRef.current = ctx.sampleRate

    // Resume if the context was created in a suspended state (iOS quirk)
    if (ctx.state === 'suspended') {
      await ctx.resume()
    }

    const source    = ctx.createMediaStreamSource(stream)
    sourceRef.current = source

    // ScriptProcessorNode: broadly supported including iOS 14+
    // bufferSize 4096 balances latency vs. CPU on mobile
    const processor = ctx.createScriptProcessor(PROCESSOR_FRAMES, 1, 1)
    processorRef.current = processor

    // iOS REQUIRES the graph to reach ctx.destination or the processor
    // never fires. We mute it with gain=0 so no echo leaks to speakers.
    const silentGain    = ctx.createGain()
    silentGain.gain.value = 0
    silentGainRef.current = silentGain

    processor.onaudioprocess = (e) => {
      if (stoppingRef.current) return

      const input = e.inputBuffer.getChannelData(0)
      // Accumulate samples (push spread is fine for typical recording lengths)
      for (let i = 0; i < input.length; i++) samplesRef.current.push(input[i])

      // RMS for silence detection
      let sumSq = 0
      for (let i = 0; i < input.length; i++) sumSq += input[i] * input[i]
      const rms = Math.sqrt(sumSq / input.length)
      const isSilent = rms < SILENCE_THRESHOLD
      setSilent(isSilent)

      if (isSilent) {
        if (!silenceTimerRef.current) {
          silenceTimerRef.current = setTimeout(finish, SILENCE_TIMEOUT_MS)
        }
      } else {
        if (silenceTimerRef.current) {
          clearTimeout(silenceTimerRef.current)
          silenceTimerRef.current = null
        }
      }
    }

    // source → processor → silentGain → destination
    source.connect(processor)
    processor.connect(silentGain)
    silentGain.connect(ctx.destination)

    setPhase('recording')
    setDuration(0)

    // Hard max-duration stop
    maxTimerRef.current = setTimeout(finish, MAX_DURATION_MS)

    // Duration counter — updates every 500 ms
    const startedAt = Date.now()
    durationRef.current = setInterval(
      () => setDuration(Math.floor((Date.now() - startedAt) / 1000)),
      500,
    )
  }, [finish])

  // ── Render ──────────────────────────────────────────────────
  if (errorMsg) {
    return (
      <div className="recorder recorder-error">
        <p className="error-msg">⚠ {errorMsg}</p>
        <div className="segment-controls" style={{ marginTop: 8 }}>
          <button
            className="btn btn-secondary btn-sm"
            onClick={() => { setErrorMsg(''); startRecording() }}
          >
            Try Again
          </button>
          <button className="btn btn-ghost btn-sm" onClick={onCancel}>
            Cancel
          </button>
        </div>
      </div>
    )
  }

  if (phase === 'ready') {
    return (
      <div className="recorder recorder-ready">
        <p className="recorder-hint">
          Press <strong>Start Recording</strong>, then read the Hebrew text above aloud.
          Recording stops automatically after {SILENCE_TIMEOUT_MS / 1000} s of silence.
        </p>
        <div className="segment-controls">
          <button className="btn btn-record btn-sm" onClick={startRecording}>
            🎤 Start Recording
          </button>
          <button className="btn btn-ghost btn-sm" onClick={onCancel}>
            Cancel
          </button>
        </div>
      </div>
    )
  }

  // phase === 'recording'
  return (
    <div className="recorder recorder-active">
      <div className="recorder-status">
        <span className={`rec-dot ${silent ? 'rec-dot-silent' : 'rec-dot-active'}`} />
        <span className="rec-label">
          Recording&nbsp;
          <span className="rec-timer">{duration}s</span>
        </span>
        {silent && (
          <span className="rec-silent-hint">
            (silence — stops in {SILENCE_TIMEOUT_MS / 1000}s)
          </span>
        )}
      </div>
      <p className="recorder-hint">
        {silent
          ? 'Speak now to continue, or wait to auto-stop…'
          : 'Read the text above. Tap Stop when finished.'}
      </p>
      <button className="btn btn-danger btn-sm" onClick={finish}>
        ⏹ Stop Recording
      </button>
    </div>
  )
}
