#!/usr/bin/env python3
"""Decode NRSC-5 from shared RTL CU8 or Airspy HF+ CF32 IQ."""
import base64
import json
import os
import sys
import threading
import traceback

nrsc5_dir = sys.argv[1] if len(sys.argv) > 1 else "."
freq = float(sys.argv[2]) if len(sys.argv) > 2 else 87.5
program = int(sys.argv[3]) if len(sys.argv) > 3 else 0
gain_arg = sys.argv[4] if len(sys.argv) > 4 else "auto"
iq_format = sys.argv[5].lower() if len(sys.argv) > 5 else "cu8"
if iq_format not in ("cu8", "cf32"):
    raise SystemExit(f"Unsupported IQ format: {iq_format}")
stop_event = threading.Event()
stdout_lock = threading.Lock()
radio_lock = threading.Lock()

if hasattr(os, "add_dll_directory"):
    try:
        os.add_dll_directory(os.path.abspath(nrsc5_dir))
    except Exception:
        pass
sys.path.insert(0, nrsc5_dir)

def emit(payload):
    sys.stderr.write(json.dumps(payload) + "\n")
    sys.stderr.flush()

def send_audio(data):
    with stdout_lock:
        os.write(1, bytes(data))

try:
    import nrsc5 as nrsc5lib
except Exception as exc:
    emit({"type": "error", "msg": f"libnrsc5 unavailable: {exc}"})
    raise SystemExit(1)

emit({"type": "bridge_version", "version": "3.0-hybrid", "mode": "shared-iq",
      "iq_format": iq_format})
sample_rate = 44100
samples_per_frame = 2048
bitrate_avg = 0.0
ber = [0.0, 0.0, 0.0, 0.0]
audio_programs_seen = set()

def update_bitrate(num_bytes):
    global bitrate_avg
    kbps = num_bytes * 8 * sample_rate / samples_per_frame / 1000
    bitrate_avg = kbps if bitrate_avg == 0 else 0.99 * bitrate_avg + 0.01 * kbps

def update_ber(cber):
    if ber == [0.0, 0.0, 0.0, 0.0]:
        ber[:] = [cber, cber, cber, cber]
    else:
        ber[0] = cber
        ber[1] = 0.9 * ber[1] + 0.1 * cber
        ber[2] = min(ber[2], cber)
        ber[3] = max(ber[3], cber)

def callback(evt_type, evt):
    try:
        if evt_type == nrsc5lib.EventType.SYNC:
            emit({"type": "sync"})
        elif evt_type == nrsc5lib.EventType.LOST_SYNC:
            emit({"type": "lost_sync"})
        elif evt_type == nrsc5lib.EventType.MER:
            emit({"type": "mer", "lower": round(evt.lower, 2), "upper": round(evt.upper, 2)})
        elif evt_type == nrsc5lib.EventType.BER:
            update_ber(evt.cber)
            emit({"type": "ber", "now": round(ber[0] * 100, 4),
                  "avg": round(ber[1] * 100, 4), "min": round(ber[2] * 100, 4),
                  "max": round(ber[3] * 100, 4)})
        elif evt_type == nrsc5lib.EventType.AUDIO:
            event_program = int(getattr(evt, "program", -1))
            if event_program not in audio_programs_seen:
                audio_programs_seen.add(event_program)
                emit({"type": "audio_program", "program": event_program})
                if len(audio_programs_seen) == 1:
                    emit({"type": "audio_first", "event_program": event_program,
                          "want_program": program, "data_len": len(evt.data) if evt.data else 0})
            if event_program == program:
                send_audio(evt.data)
        elif evt_type == nrsc5lib.EventType.HDC and evt.program == program:
            update_bitrate(len(evt.data))
            emit({"type": "bitrate", "kbps": round(bitrate_avg, 1)})
        elif evt_type == nrsc5lib.EventType.ID3 and evt.program == program:
            emit({"type": "id3", "title": evt.title or "", "artist": evt.artist or "",
                  "album": evt.album or "", "genre": evt.genre or ""})
        elif evt_type == nrsc5lib.EventType.SIS:
            services = []
            for svc in evt.audio_services or []:
                services.append({"program": svc.program, "type": getattr(svc.type, "name", "UNDEFINED")})
            emit({"type": "sis", "name": evt.name or "", "slogan": evt.slogan or "",
                  "message": evt.message or "", "alert": evt.alert or "",
                  "country": evt.country_code or "", "audioServices": services})
        elif evt_type == nrsc5lib.EventType.LOT:
            mime_name = getattr(evt.mime, "name", "") if evt.mime else ""
            lot_name = evt.name or ""
            raw = evt.data or b""
            lower_name = lot_name.lower()
            if raw.startswith(b"\x89PNG\r\n\x1a\n"):
                mime_name = "PNG"
            elif raw.startswith(b"\xff\xd8\xff"):
                mime_name = "JPEG"
            image_types = ("STATION_LOGO", "PRIMARY_IMAGE", "JPEG", "PNG", "HERE_IMAGE")
            image_ext = lower_name.endswith((".jpg", ".jpeg", ".png", ".gif", ".webp", ".bmp"))
            if raw and (mime_name in image_types or image_ext):
                emit({"type": "lot", "mime": mime_name or "JPEG", "name": lot_name,
                      "data": base64.b64encode(raw).decode("ascii")})
        elif evt_type == nrsc5lib.EventType.SIG:
            services = [{"type": svc.type.name.lower(), "number": svc.number,
                         "name": svc.name or ""} for svc in evt]
            if services:
                emit({"type": "sig", "services": services})
    except Exception:
        emit({"type": "error", "msg": traceback.format_exc()})

def command_loop():
    global program, freq
    try:
        command_pipe = os.fdopen(3, "r", encoding="utf-8", buffering=1)
        for line in command_pipe:
            try:
                command = json.loads(line)
                operation = command.get("cmd")
                if operation == "program":
                    program = int(command.get("value", 0))
                    emit({"type": "program_set", "value": program})
                elif operation == "freq":
                    next_freq = float(command.get("value", freq))
                    if 87.5 <= next_freq <= 108.0:
                        with radio_lock:
                            radio.stop()
                            audio_programs_seen.clear()
                            freq = next_freq
                            radio.set_frequency(freq * 1e6)
                            radio.start()
                        emit({"type": "freq_set", "value": freq})
                elif operation == "quit":
                    stop_event.set()
                    break
            except Exception as exc:
                emit({"type": "error", "msg": str(exc)})
    except OSError:
        stop_event.set()

radio = nrsc5lib.NRSC5(callback)
try:
    radio.open_pipe()
    radio.set_frequency(freq * 1e6)
    radio.start()
    emit({"type": "started", "freq": freq, "program": program,
          "gain": gain_arg, "mode": "shared-iq", "iq_format": iq_format})
    threading.Thread(target=command_loop, daemon=True).start()

    source = sys.stdin.buffer
    while not stop_event.is_set():
        chunk = source.read(262144)
        if not chunk:
            break
        frame_size = 8 if iq_format == "cf32" else 2
        usable = len(chunk) - (len(chunk) % frame_size)
        if usable:
            with radio_lock:
                if iq_format == "cf32":
                    radio.pipe_samples_cf32(chunk[:usable])
                else:
                    radio.pipe_samples_cu8(chunk[:usable])
except Exception as exc:
    emit({"type": "error", "msg": f"Hybrid decoder failed: {exc}\n{traceback.format_exc()}"})
finally:
    try:
        radio.stop()
    except Exception:
        pass
    try:
        radio.close()
    except Exception:
        pass
