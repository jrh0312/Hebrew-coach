"""
Hebrew Pronunciation Coach — FastAPI Backend
Endpoints:
  GET  /api/health               — liveness check
  POST /api/tts                  — single-segment TTS → MP3
  POST /api/tts/prefetch         — batch TTS → base64 MP3 array
  POST /api/assess               — pronunciation assessment via Azure
"""

import os
import json
import base64
import tempfile
import logging
from pathlib import Path

from fastapi import FastAPI, File, UploadFile, Form, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import Response
from pydantic import BaseModel
from typing import List, Optional
from dotenv import load_dotenv

load_dotenv()

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)
logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# App + CORS
# ---------------------------------------------------------------------------

app = FastAPI(title="Hebrew Pronunciation Coach API", version="1.0.0")

_raw_origins = os.getenv("ALLOWED_ORIGINS", "*")
allowed_origins = [o.strip() for o in _raw_origins.split(",")]

app.add_middleware(
    CORSMiddleware,
    allow_origins=allowed_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ---------------------------------------------------------------------------
# Kamatz Katan correction
# ---------------------------------------------------------------------------
# Kamatz Gadol (U+05B8 ָ ) = /a/ vowel (open or accented syllable)
# Kamatz Katan (U+05C7 ׇ ) = /o/ vowel (closed, unaccented syllable)
# Google TTS treats them differently. We detect Kamatz Katan algorithmically
# and replace U+05B8 → U+05C7 in the TTS-bound text only (display unchanged).

_KAMATZ        = '\u05B8'   # ָ  Qamats Gadol
_QAMATS_KATAN  = '\u05C7'   # ׇ  Qamats Katan
_SHVA          = '\u05B0'   # ְ  Shva
_DAGESH        = '\u05BC'   # ּ  Dagesh / Mappiq

# Full vowel characters (everything except shva and half-vowels 05B1-05B3)
_FULL_VOWELS = frozenset('\u05B4\u05B5\u05B6\u05B7\u05B8\u05B9\u05BA\u05BB\u05C7')

# Cantillation / accent marks that can appear on a syllable
_CANTILLATION = frozenset(
    [chr(c) for c in range(0x0591, 0x05AF + 1)]  # U+0591–U+05AE
    + ['\u05BD', '\u05BF']                         # meteg, rafe
)

# Word-final letters that are silent vowel-letters (matres lectionis).
# When one of these is the last letter of a word with no dagesh/mappiq,
# the preceding syllable is OPEN even though the letter has no vowel dot.
_QUIESCENT_FINALS = frozenset('\u05D4\u05D0')  # ה, א

# High-frequency words where Kamatz is always Katan regardless of context.
# Format: (exact-word-with-kamatz-gadol, replacement-with-qamats-katan)
_KK_LEXICON: list[tuple[str, str]] = [
    # כָּל / כָל  (kol — "all/every") — standalone and common prefixed forms
    ('\u05DB\u05BC\u05B8\u05DC', '\u05DB\u05BC\u05C7\u05DC'),   # כָּל
    ('\u05DB\u05B8\u05DC',       '\u05DB\u05C7\u05DC'),           # כָל
    ('\u05D1\u05BC\u05B0\u05DB\u05B8\u05DC', '\u05D1\u05BC\u05B0\u05DB\u05C7\u05DC'),  # בְּכָל
    ('\u05D1\u05B0\u05DB\u05B8\u05DC',       '\u05D1\u05B0\u05DB\u05C7\u05DC'),         # בְכָל
    ('\u05DC\u05B0\u05DB\u05B8\u05DC',       '\u05DC\u05B0\u05DB\u05C7\u05DC'),         # לְכָל
    ('\u05D5\u05B0\u05DB\u05B8\u05DC',       '\u05D5\u05B0\u05DB\u05C7\u05DC'),         # וְכָל
    ('\u05DE\u05B4\u05DB\u05BC\u05B8\u05DC', '\u05DE\u05B4\u05DB\u05BC\u05C7\u05DC'),  # מִכָּל
]


def _has_cantillation(chars: list[str], start: int, end: int) -> bool:
    """Return True if any cantillation mark appears in chars[start:end]."""
    return any(c in _CANTILLATION for c in chars[start:end])


def _is_heb_letter(c: str) -> bool:
    return '\u05D0' <= c <= '\u05EA'


def _fix_kamatz_katan(text: str) -> str:
    """
    Replace Kamatz Gadol (U+05B8) with Qamats Katan (U+05C7) where the
    kamatz represents the /o/ vowel (closed, unaccented syllable).

    Algorithm (per word):
      Stage 1 — Lexicon: replace known words wholesale (handles בְּכָל etc.)
      Stage 2 — Syllable analysis on remaining words:
        A kamatz is Katan when ALL of:
          (a) The syllable has no cantillation / accent mark.
          (b) The syllable is closed: the *next* consonant carries no full
              vowel (only Shva Nach or nothing at all).
          (c) The next consonant is not a word-final quiescent ה or א
              (those signal an open syllable even without a vowel dot).
    """
    words = text.split(' ')
    out = []

    for word in words:
        # Stage 1 — lexicon substitution (whole word match)
        replaced = False
        for src, dst in _KK_LEXICON:
            if word == src:
                out.append(dst)
                replaced = True
                break
        if replaced:
            continue

        # Stage 2 — character-level syllable analysis
        if _KAMATZ not in word:
            out.append(word)
            continue

        chars = list(word)
        n = len(chars)

        for i, ch in enumerate(chars):
            if ch != _KAMATZ:
                continue

            # Find the consonant that carries this kamatz (scan left for letter)
            carrier = i - 1
            while carrier >= 0 and not _is_heb_letter(chars[carrier]):
                carrier -= 1
            if carrier < 0:
                continue

            # (a) Check for cantillation on this consonant cluster
            cluster_start = carrier
            cluster_end = i + 1  # include the kamatz itself
            j = cluster_end
            while j < n and not _is_heb_letter(chars[j]):
                cluster_end = j + 1
                j += 1
            if _has_cantillation(chars, cluster_start, cluster_end):
                continue  # accented → Gadol

            # (b) Find the next consonant after this cluster
            next_letter_idx = cluster_end
            while next_letter_idx < n and not _is_heb_letter(chars[next_letter_idx]):
                next_letter_idx += 1
            if next_letter_idx >= n:
                continue  # no following consonant → open syllable, leave as Gadol

            # (c) Word-final quiescent ה or א = open syllable even without vowel dot
            next_letter = chars[next_letter_idx]
            # Is this the last letter in the word (only diacritics may follow)?
            after_next = next_letter_idx + 1
            while after_next < n and not _is_heb_letter(chars[after_next]):
                after_next += 1
            is_last_letter = (after_next >= n)
            has_mappiq = _DAGESH in chars[next_letter_idx:next_letter_idx + 3]
            if is_last_letter and next_letter in _QUIESCENT_FINALS and not has_mappiq:
                continue  # open syllable (silent final letter)

            # Check for full vowel on the next consonant
            j = next_letter_idx + 1
            next_vowel: str | None = None
            while j < n and not _is_heb_letter(chars[j]):
                if chars[j] in _FULL_VOWELS or chars[j] == _SHVA:
                    next_vowel = chars[j]
                    break
                j += 1

            # Closed syllable: next consonant has Shva Nach or no vowel at all
            if next_vowel is None or next_vowel == _SHVA:
                chars[i] = _QAMATS_KATAN

        out.append(''.join(chars))

    return ' '.join(out)


# ---------------------------------------------------------------------------
# Google Cloud TTS helpers
# ---------------------------------------------------------------------------

_WAVENET_VOICES = ["he-IL-Wavenet-A", "he-IL-Wavenet-B"]


def _build_tts_client():
    """
    Build a Google Cloud TTS client.
    Prefers GOOGLE_TTS_API_KEY (simple API key).
    Falls back to GOOGLE_APPLICATION_CREDENTIALS (service-account JSON).
    """
    api_key = os.getenv("GOOGLE_TTS_API_KEY")
    if api_key:
        from google.cloud import texttospeech_v1 as tts
        from google.api_core.client_options import ClientOptions
        return tts.TextToSpeechClient(
            client_options=ClientOptions(api_key=api_key)
        )
    # ADC / service-account path
    from google.cloud import texttospeech as tts  # type: ignore
    return tts.TextToSpeechClient()


def synthesize_speech(text: str) -> bytes:
    """
    Synthesize Hebrew text → MP3 bytes.
    Tries he-IL-Wavenet-A first, then Wavenet-B.
    Never falls back to Standard voices — raises HTTPException instead.
    """
    from google.cloud import texttospeech as tts  # type: ignore

    client = _build_tts_client()

    text = text.replace("יְהוָה", "השם")
    text = text.replace("יהוה", "השם")
    text = _fix_kamatz_katan(text)
    synthesis_input = tts.SynthesisInput(text=text)
    audio_config = tts.AudioConfig(
        audio_encoding=tts.AudioEncoding.MP3,
        speaking_rate=0.7,  # slightly slower for language learners
    )

    last_error: Optional[Exception] = None
    for voice_name in _WAVENET_VOICES:
        voice = tts.VoiceSelectionParams(
            language_code="he-IL",
            name=voice_name,
        )
        try:
            response = client.synthesize_speech(
                input=synthesis_input,
                voice=voice,
                audio_config=audio_config,
            )
            logger.info("TTS success | voice=%s | chars=%d", voice_name, len(text))
            return response.audio_content
        except Exception as exc:
            logger.warning("TTS attempt failed | voice=%s | error=%s", voice_name, exc)
            last_error = exc

    raise HTTPException(
        status_code=502,
        detail=(
            f"Google Cloud TTS failed for both Wavenet voices. "
            f"Last error: {last_error}"
        ),
    )


# ---------------------------------------------------------------------------
# Pydantic models
# ---------------------------------------------------------------------------

class TTSRequest(BaseModel):
    text: str


class PrefetchRequest(BaseModel):
    segments: List[str]


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------

@app.get("/api/health")
async def health():
    return {"status": "ok", "service": "hebrew-pronunciation-coach"}


@app.post("/api/tts")
async def tts_single(request: TTSRequest):
    """
    Synthesize one text segment.
    Returns: audio/mpeg (MP3)
    """
    if not request.text.strip():
        raise HTTPException(status_code=400, detail="text must not be empty")

    try:
        audio_bytes = synthesize_speech(request.text)
    except HTTPException:
        raise
    except Exception as exc:
        logger.exception("Unexpected TTS error")
        raise HTTPException(status_code=500, detail=str(exc))

    return Response(
        content=audio_bytes,
        media_type="audio/mpeg",
        headers={"Content-Disposition": "inline; filename=speech.mp3"},
    )


@app.post("/api/tts/prefetch")
async def tts_prefetch(request: PrefetchRequest):
    """
    Synthesize multiple text segments in one request.
    Returns JSON:
    {
      "segments": [
        { "text": "...", "audio": "<base64-mp3>", "error": null },
        ...
      ],
      "failed_indices": [2, 5]   // indices where TTS failed
    }
    """
    if not request.segments:
        raise HTTPException(status_code=400, detail="segments list must not be empty")

    results = []
    failed_indices = []

    for idx, segment in enumerate(request.segments):
        if not segment.strip():
            results.append({"text": segment, "audio": None, "error": "empty segment"})
            failed_indices.append(idx)
            continue
        try:
            audio_bytes = synthesize_speech(segment)
            b64 = base64.b64encode(audio_bytes).decode("utf-8")
            results.append({"text": segment, "audio": b64, "error": None})
        except HTTPException as exc:
            logger.error("Prefetch TTS failed | idx=%d | detail=%s", idx, exc.detail)
            results.append({"text": segment, "audio": None, "error": exc.detail})
            failed_indices.append(idx)
        except Exception as exc:
            logger.exception("Unexpected prefetch error | idx=%d", idx)
            results.append({"text": segment, "audio": None, "error": str(exc)})
            failed_indices.append(idx)

    return {"segments": results, "failed_indices": failed_indices}


@app.post("/api/assess")
async def assess_pronunciation(
    audio: UploadFile = File(..., description="WAV audio recording from the user"),
    reference_text: str = Form(..., description="Hebrew text the user was reading"),
):
    """
    Send user's audio to Azure Pronunciation Assessment (he-IL).

    Returns JSON with:
    - pronunciation_score, accuracy_score, fluency_score, completeness_score
    - words[]  → word-level accuracy + error_type + phonemes[]
    - recognized_text  (what Azure heard)

    All scores are 0–100 as returned by Azure — no rescaling.
    """
    azure_key = os.getenv("AZURE_SPEECH_KEY")
    azure_region = os.getenv("AZURE_SPEECH_REGION", "westeurope")

    if not azure_key:
        raise HTTPException(
            status_code=500,
            detail="AZURE_SPEECH_KEY environment variable is not set",
        )
    if not reference_text.strip():
        raise HTTPException(status_code=400, detail="reference_text must not be empty")

    # ---- persist upload to a temp file Azure SDK can read ----
    upload_suffix = Path(audio.filename or "recording.wav").suffix or ".wav"
    tmp_file = tempfile.NamedTemporaryFile(suffix=upload_suffix, delete=False)
    try:
        content = await audio.read()
        tmp_file.write(content)
        tmp_file.flush()
        tmp_file.close()

        logger.info(
            "Assessment request | bytes=%d | ref_text_len=%d | region=%s",
            len(content),
            len(reference_text),
            azure_region,
        )

        result_payload = _run_azure_assessment(
            audio_path=tmp_file.name,
            reference_text=reference_text,
            azure_key=azure_key,
            azure_region=azure_region,
        )
        return result_payload

    finally:
        try:
            os.unlink(tmp_file.name)
        except OSError:
            pass


def _run_azure_assessment(
    audio_path: str,
    reference_text: str,
    azure_key: str,
    azure_region: str,
) -> dict:
    """
    Core Azure Pronunciation Assessment logic, separated for testability.
    Uses the synchronous recognize_once() call with PronunciationAssessmentConfig.
    """
    import azure.cognitiveservices.speech as speechsdk  # type: ignore

    speech_config = speechsdk.SpeechConfig(
        subscription=azure_key,
        region=azure_region,
    )
    speech_config.speech_recognition_language = "he-IL"

    pron_config = speechsdk.PronunciationAssessmentConfig(
        reference_text=reference_text,
        grading_system=speechsdk.PronunciationAssessmentGradingSystem.HundredMark,
        granularity=speechsdk.PronunciationAssessmentGranularity.Phoneme,
        enable_miscue=True,
    )

    audio_config = speechsdk.audio.AudioConfig(filename=audio_path)
    recognizer = speechsdk.SpeechRecognizer(
        speech_config=speech_config,
        audio_config=audio_config,
    )
    pron_config.apply_to(recognizer)

    result = recognizer.recognize_once()

    if result.reason == speechsdk.ResultReason.RecognizedSpeech:
        pron_result = speechsdk.PronunciationAssessmentResult(result)

        raw_json_str = result.properties.get(
            speechsdk.PropertyId.SpeechServiceResponse_JsonResult, "{}"
        )
        raw_json = json.loads(raw_json_str)

        # Azure returns NBest array; use index 0 (highest confidence)
        nbest = raw_json.get("NBest", [{}])
        top_result = nbest[0] if nbest else {}
        raw_words = top_result.get("Words", [])

        words = []
        for w in raw_words:
            pa = w.get("PronunciationAssessment", {})
            phonemes = [
                {
                    "phoneme": p.get("Phoneme", ""),
                    "accuracy_score": p.get("PronunciationAssessment", {}).get(
                        "AccuracyScore", 0
                    ),
                }
                for p in w.get("Phonemes", [])
            ]
            words.append(
                {
                    "word": w.get("Word", ""),
                    "accuracy_score": pa.get("AccuracyScore", 0),
                    "error_type": pa.get("ErrorType", "None"),
                    "phonemes": phonemes,
                }
            )

        logger.info(
            "Assessment complete | pron=%.1f | acc=%.1f | flu=%.1f | comp=%.1f",
            pron_result.pronunciation_score,
            pron_result.accuracy_score,
            pron_result.fluency_score,
            pron_result.completeness_score,
        )

        return {
            "recognized_text": result.text,
            "pronunciation_score": pron_result.pronunciation_score,
            "accuracy_score": pron_result.accuracy_score,
            "fluency_score": pron_result.fluency_score,
            "completeness_score": pron_result.completeness_score,
            "words": words,
        }

    elif result.reason == speechsdk.ResultReason.NoMatch:
        no_match_detail = speechsdk.NoMatchDetails(result)
        logger.warning("NoMatch: %s", no_match_detail.reason)
        raise HTTPException(
            status_code=422,
            detail=(
                "Azure could not recognize speech in the recording. "
                "Please speak clearly into the microphone."
            ),
        )

    else:
        cancellation = speechsdk.CancellationDetails(result)
        logger.error(
            "Recognition cancelled | reason=%s | detail=%s",
            cancellation.reason,
            cancellation.error_details,
        )
        raise HTTPException(
            status_code=502,
            detail=f"Azure recognition failed: {cancellation.error_details}",
        )
