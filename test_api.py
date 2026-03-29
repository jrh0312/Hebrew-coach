#!/usr/bin/env python3
"""
test_api.py — Smoke-test script for the Hebrew Pronunciation Coach backend.

Run BEFORE touching the frontend to confirm your API credentials work.

Usage:
    cd hebrew-coach
    pip install requests python-dotenv
    python test_api.py [--url http://localhost:8000]

What it tests:
    1. GET  /api/health              — server is up
    2. POST /api/tts                 — Google Cloud TTS returns MP3
    3. POST /api/tts/prefetch        — batch TTS returns base64 MP3s
    4. POST /api/assess              — Azure pronunciation assessment returns scores
       (uses a tiny synthetic WAV so you don't need a mic to run this)
"""

import argparse
import base64
import io
import json
import struct
import sys
import wave
import os

try:
    import requests
except ImportError:
    sys.exit("Install requests first:  pip install requests")

try:
    from dotenv import load_dotenv
    load_dotenv("backend/.env")   # load from backend/.env if run from project root
    load_dotenv(".env")            # also try current directory
except ImportError:
    pass  # dotenv optional; env vars may already be set

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

GREEN = "\033[92m"
RED   = "\033[91m"
YELLOW = "\033[93m"
BOLD  = "\033[1m"
RESET = "\033[0m"


def ok(msg: str):
    print(f"  {GREEN}✓{RESET} {msg}")


def fail(msg: str):
    print(f"  {RED}✗{RESET} {msg}")


def warn(msg: str):
    print(f"  {YELLOW}!{RESET} {msg}")


def section(title: str):
    print(f"\n{BOLD}{'─'*60}{RESET}")
    print(f"{BOLD} {title}{RESET}")
    print(f"{BOLD}{'─'*60}{RESET}")


# ---------------------------------------------------------------------------
# Synthetic WAV generator
# (16-bit PCM mono 16 kHz, 1-second silence — enough for Azure to accept)
# ---------------------------------------------------------------------------

def make_silent_wav(duration_s: float = 1.5, sample_rate: int = 16000) -> bytes:
    """Generate a minimal valid WAV file containing silence."""
    n_samples = int(sample_rate * duration_s)
    buf = io.BytesIO()
    with wave.open(buf, "wb") as wf:
        wf.setnchannels(1)
        wf.setsampwidth(2)          # 16-bit
        wf.setframerate(sample_rate)
        wf.writeframes(b"\x00\x00" * n_samples)
    return buf.getvalue()


# ---------------------------------------------------------------------------
# Test functions
# ---------------------------------------------------------------------------

def test_health(base_url: str) -> bool:
    section("1 / Health check")
    try:
        r = requests.get(f"{base_url}/api/health", timeout=10)
        r.raise_for_status()
        data = r.json()
        if data.get("status") == "ok":
            ok(f"Server is up  ({base_url})")
            return True
        else:
            fail(f"Unexpected response: {data}")
            return False
    except Exception as exc:
        fail(f"Health check failed: {exc}")
        print(f"     Make sure the backend is running:  uvicorn main:app --reload")
        return False


def test_tts_single(base_url: str) -> bool:
    section("2 / POST /api/tts  — Google Cloud TTS (single segment)")
    payload = {"text": "שָׁלוֹם, אֵיךְ אַתָּה?"}
    print(f"  Sending text: {payload['text']}")
    try:
        r = requests.post(f"{base_url}/api/tts", json=payload, timeout=30)
        if r.status_code == 200:
            ct = r.headers.get("content-type", "")
            size = len(r.content)
            if "audio" in ct and size > 1000:
                ok(f"Received MP3 audio  ({size:,} bytes, content-type: {ct})")
                # Save for manual inspection
                out = "_test_tts_output.mp3"
                with open(out, "wb") as f:
                    f.write(r.content)
                ok(f"Saved to {out}  — open in any audio player to verify Hebrew voice")
                return True
            else:
                fail(f"Response doesn't look like audio: {ct}, {size} bytes")
                return False
        else:
            fail(f"HTTP {r.status_code}: {r.text[:400]}")
            _hint_tts_error(r.status_code, r.text)
            return False
    except Exception as exc:
        fail(f"Request failed: {exc}")
        return False


def test_tts_prefetch(base_url: str) -> bool:
    section("3 / POST /api/tts/prefetch  — Google Cloud TTS (batch)")
    segments = [
        "בְּרֵאשִׁית בָּרָא אֱלֹהִים",
        "אֵת הַשָּׁמַיִם וְאֵת הָאָרֶץ",
        "שָׁלוֹם עוֹלָם",
    ]
    print(f"  Sending {len(segments)} segments")
    try:
        r = requests.post(
            f"{base_url}/api/tts/prefetch",
            json={"segments": segments},
            timeout=60,
        )
        if r.status_code == 200:
            data = r.json()
            segs = data.get("segments", [])
            success = sum(1 for s in segs if s.get("audio"))
            failed  = data.get("failed_indices", [])
            if success == len(segments):
                ok(f"All {success}/{len(segments)} segments synthesised successfully")
            else:
                warn(f"{success}/{len(segments)} succeeded; failed indices: {failed}")
            # Spot-check base64 decode
            first_audio_b64 = segs[0].get("audio", "")
            decoded = base64.b64decode(first_audio_b64)
            ok(f"First segment decoded OK ({len(decoded):,} bytes)")
            return success > 0
        else:
            fail(f"HTTP {r.status_code}: {r.text[:400]}")
            _hint_tts_error(r.status_code, r.text)
            return False
    except Exception as exc:
        fail(f"Request failed: {exc}")
        return False


def test_assess(base_url: str) -> bool:
    section("4 / POST /api/assess  — Azure Pronunciation Assessment")
    ref_text = "שָׁלוֹם"
    wav_bytes = make_silent_wav()
    print(f"  Reference text : {ref_text}")
    print(f"  Audio          : synthetic {len(wav_bytes):,}-byte WAV (silence)")
    print(f"  NOTE: A silent WAV will trigger a NoMatch (422) — that proves Azure")
    print(f"        is reachable and credentials are valid. A 502 means auth failed.")

    try:
        r = requests.post(
            f"{base_url}/api/assess",
            data={"reference_text": ref_text},
            files={"audio": ("test.wav", wav_bytes, "audio/wav")},
            timeout=30,
        )

        if r.status_code == 200:
            data = r.json()
            ok("Azure returned a successful assessment result!")
            print(f"\n  Scores:")
            print(f"    Pronunciation : {data.get('pronunciation_score')}")
            print(f"    Accuracy      : {data.get('accuracy_score')}")
            print(f"    Fluency       : {data.get('fluency_score')}")
            print(f"    Completeness  : {data.get('completeness_score')}")
            print(f"    Recognized    : {data.get('recognized_text', '')!r}")
            words = data.get("words", [])
            if words:
                print(f"\n  Word breakdown ({len(words)} words):")
                for w in words:
                    score = w.get("accuracy_score", 0)
                    phonemes = w.get("phonemes", [])
                    print(
                        f"    {w['word']:20s}  acc={score:5.1f}  "
                        f"error={w.get('error_type','?'):12s}  "
                        f"phonemes={len(phonemes)}"
                    )
            return True

        elif r.status_code == 422:
            # NoMatch — expected for silence, still proves connectivity
            ok("Azure is reachable and credentials are valid  (NoMatch for silent audio — expected)")
            warn("To test with real speech, record yourself and POST a real WAV.")
            return True

        elif r.status_code == 500 and "AZURE_SPEECH_KEY" in r.text:
            fail("AZURE_SPEECH_KEY is not set in your .env file")
            return False

        else:
            fail(f"HTTP {r.status_code}: {r.text[:500]}")
            _hint_azure_error(r.status_code, r.text)
            return False

    except Exception as exc:
        fail(f"Request failed: {exc}")
        return False


def test_assess_with_real_wav(base_url: str, wav_path: str) -> bool:
    """Optional: test with a real WAV file passed via --wav flag."""
    section(f"4b / POST /api/assess  — Real WAV: {wav_path}")
    ref_text = "שָׁלוֹם עוֹלָם"  # adjust if your recording says something else
    try:
        with open(wav_path, "rb") as f:
            wav_bytes = f.read()
        r = requests.post(
            f"{base_url}/api/assess",
            data={"reference_text": ref_text},
            files={"audio": ("recording.wav", wav_bytes, "audio/wav")},
            timeout=30,
        )
        if r.status_code == 200:
            data = r.json()
            ok("Got assessment result!")
            print(json.dumps(data, ensure_ascii=False, indent=2))
            return True
        else:
            fail(f"HTTP {r.status_code}: {r.text[:400]}")
            return False
    except Exception as exc:
        fail(f"Failed: {exc}")
        return False


# ---------------------------------------------------------------------------
# Error hints
# ---------------------------------------------------------------------------

def _hint_tts_error(status: int, body: str):
    if status == 502 or "Wavenet" in body or "TTS" in body:
        print()
        print("  Hints for Google TTS errors:")
        print("    • Verify GOOGLE_TTS_API_KEY or GOOGLE_APPLICATION_CREDENTIALS is set")
        print("    • Enable the Cloud Text-to-Speech API in your project:")
        print("      https://console.cloud.google.com/apis/library/texttospeech.googleapis.com")
        print("    • Make sure the API key has Text-to-Speech scope (not restricted to other APIs)")


def _hint_azure_error(status: int, body: str):
    if status in (401, 403, 502) or "auth" in body.lower() or "key" in body.lower():
        print()
        print("  Hints for Azure Speech errors:")
        print("    • Verify AZURE_SPEECH_KEY is correct (copy from Azure portal → Keys and Endpoint)")
        print("    • Verify AZURE_SPEECH_REGION matches where you created the resource")
        print("    • Common regions: westeurope, eastus, eastasia")
        print("    • Free tier (F0) has 5 hours/month of speech recognition")


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------

def main():
    parser = argparse.ArgumentParser(description="Smoke-test the Hebrew Coach backend")
    parser.add_argument(
        "--url",
        default="http://localhost:8000",
        help="Base URL of the running backend (default: http://localhost:8000)",
    )
    parser.add_argument(
        "--wav",
        default=None,
        help="Optional path to a real WAV file for a live pronunciation test",
    )
    args = parser.parse_args()

    base_url = args.url.rstrip("/")
    print(f"\n{BOLD}Hebrew Pronunciation Coach — API Test Suite{RESET}")
    print(f"Target: {base_url}")

    results = {}

    results["health"]   = test_health(base_url)
    if not results["health"]:
        print(f"\n{RED}Backend is not reachable. Start it first:{RESET}")
        print("  cd backend && uvicorn main:app --reload --port 8000")
        sys.exit(1)

    results["tts"]        = test_tts_single(base_url)
    results["prefetch"]   = test_tts_prefetch(base_url)
    results["assess"]     = test_assess(base_url)

    if args.wav:
        results["assess_real"] = test_assess_with_real_wav(base_url, args.wav)

    # Summary
    section("Summary")
    passed = sum(1 for v in results.values() if v)
    total  = len(results)
    for name, passed_flag in results.items():
        icon = f"{GREEN}PASS{RESET}" if passed_flag else f"{RED}FAIL{RESET}"
        print(f"  {icon}  {name}")

    print()
    if passed == total:
        print(f"{GREEN}{BOLD}All {total} tests passed. Your backend is ready!{RESET}")
    else:
        print(f"{YELLOW}{BOLD}{passed}/{total} tests passed. Fix the failures above.{RESET}")
        sys.exit(1)


if __name__ == "__main__":
    main()
